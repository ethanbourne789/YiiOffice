# 本轮修复：headless 相对路径 + 索引批量写入（2026-11-05）

延续 P0/P1/P2 与 P-01 流式元数据的工作。本轮处理三件事：

1. 修一个上一轮实测发现、已确认根因的可用性缺陷（`--headless-export` 相对路径必失败）
2. 按「先测量再改」处理索引扫描的写入开销
3. 对三个候选优化项做测量，其中三个判定不做，理由与数据在下文

---

## 一、`--headless-export` 相对路径失败（已修）

### 现象

```
YiiOffice.exe --headless-export build/in.docx --to pdf --out build/out.pdf --json
```

退出码 3（`ExitConversionFailed`），信封里是 `export did not produce a file`，但渲染本身是成功的。换成绝对路径立刻成功、产物字节完全一致。

### 根因（三段链路，各看源码确认）

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 写策略 | `internal/bridge/pathgrants.go:72` | `canonicalWritePath` 对非绝对路径直接返回 `path must be absolute` |
| 授权 | `main.go:105` 调 `bridge.GrantFile(headlessReq.Out)` | 内部 `canonicalWritePath` 失败后**静默 return**，输出路径压根没被授权 |
| 导出 | `internal/bridge/exportservice.go:280` `AuthoriseWrite(outPath)` | 命中未授权 → `ErrExportTargetNotAuthorised` → 前端 `exportFile` 拿到非 ok → 报「未产生文件」 |

也就是说：**渲染没问题，是写盘前被自己的白名单拦了，而拦截原因被吞掉了**。`ValidateHeadlessPaths` 里虽然用过 `filepath.Abs`，但只用于「输入输出是否同一个文件」的比较，没有回写到请求。

### 修复

`internal/export/cli.go` 新增 `AbsolutiseRequest`，`main.go` 在 headless 分支**最前面**调用（早于 `ValidateRequest`、`ValidateHeadlessPaths`、`GrantFile`）：

```go
absReq, absErr := export.AbsolutiseRequest(headlessReq)
if absErr != nil {
    headlessExit(export.HeadlessOutcome{Error: absErr.Error(), ExitHint: export.ExitBadArgs}, headlessReq.JSON)
}
headlessReq = absReq
```

选择这个位置而不是改 `ParseHeadlessExport`，原因是后者被 `TestParseHeadlessExportSuccess` 用 Windows 风格路径（`C:\docs\test.docx`）断言，在非 Windows 上 `filepath.Abs` 会把它当成相对路径，测试语义会被污染。放在入口处既修好真实路径，又不动参数解析的契约。

**副作用（正向）**：JSON 信封的 `input` / `out` 现在是绝对路径，比原来回显用户输入更明确。

### 实测

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| 相对路径 | exit 3，无产物 | **exit 0，`success:true`，31 959 B PDF** |
| 绝对路径 | exit 0，31 959 B | exit 0，31 959 B（字节一致） |

新增测试：`TestAbsolutiseRequestResolvesRelativePaths`、`TestAbsolutiseRequestIsIdempotent`。

---

## 二、索引扫描：批量写入（已修，2.07×）

### 先测量

`BenchmarkIndexScan`（200 个 docx，每个 40 段正文，全新 store）基线：

```
BenchmarkIndexScan-16    3    794 277 000 ns/op     → 3.97 ms/文件
```

CPU profile 归因：

| 项 | 占比 |
| --- | --- |
| `indexFile` 合计 | 64.6% |
| └ `Upsert`（每次一个事务） | **44.9%** |
| &nbsp;&nbsp;&nbsp;└ `Tx.Commit` | **27.9%** |
| `ExtractText` + `Tokenize` | 约 20% |

**结论与原计划相反**：瓶颈不是文本提取，而是「每个文件一次事务」，即 200 次 fsync。原本打算做的「提取并行」即使做到 8 核，上限也只有 20% 左右。

### 改动

`internal/index/store.go`：

- 新增 `IndexRow`（一行的完整载荷：元数据 + 两组 token）
- 把原 `Upsert` 的 SQL 抽成 `upsertRow(tx, row)`，单条与批量共用，避免两份 SQL 漂移
- 新增 `UpsertBatch(rows)`：一个事务写多行，**全有或全无**
- `Upsert` 签名不变（增量路径 `IndexOne` 仍每文件一事务，那里 fsync 是舍入误差）

`internal/index/indexer.go`：

- `indexFile` 拆成 `buildRow`（只做提取 + 分词，不碰数据库）+ `upsertRow`（单条写）
- 扫描主循环改为累积 `[]IndexRow`，**每 64 行或累计 8 MiB 正文** flush 一次
- 批量失败**回退为逐行写**，只丢真正失败的那一个文件 —— 不能因为一行异常让同批另外 63 个一起消失
- 收到 `done` 信号时先 flush 再返回，避免把已经付过提取成本的工作扔掉

字节预算存在的原因：`MaxBodyChars = 1_000_000`，64 个满额文档会在内存里堆出可观的体积，行数上限管不住这个。

### 实测

```
批量前  794 277 000 ns/op   (200 文件, 3.97 ms/文件)
批量后  382 172 540 ns/op   (200 文件, 1.91 ms/文件)
```

**2.08×**，三轮 379–389 ms 稳定。profile 重测后剩余开销：`buildRow` 25.9%、`UpsertBatch` 25.1%，两者大致相当。

### 为什么不做提取并行

剩下的 25.9% 是提取，即使完美并行（16 核）理论下限也是再省约 24%，但要引入 worker pool、结果收集与顺序保证，而 SQLite 写入仍必须串行。真实场景里一次全量扫描 5000 文件约 9.6 s，优化后到 ~7 s，用户感知差异很小。**收益不抵复杂度，不做。**

### 测试

新增 `TestRunIndexesFilesSpanningMultipleWriteBatches`：70 个文件（64 满批 + 6 尾批），断言全部可检索、`pending` 归零。批边界是最容易漏的地方 —— 尾批只有最后一次 flush 会发出去。

---

## 三、测量后判定不做的三项

### 3.1 Recalc 的整簿克隆

`reads.go:417-427` 每次 Recalc 都 `WriteToBuffer` + `OpenReader` 克隆整本工作簿。实测（5×2000×20，100 行读范围）：

```
BenchmarkRecalc-16    3    482 450 100 ns/op    289 140 501 B/op    4 837 971 allocs/op
```

**每次公式编辑 482 ms / 289 MB**，比打开工作簿还重。profile 拆分：clone 约 38%、`CalcCellValue` 34%、excelize 内部 `getCellFormula`/`setArrayFormulaCells` 29%。

**不做**。理由：

- clone 的语义是隔离 —— renderer 的未保存编辑不能污染共享的 `s.file`（该 file 在保存时要用）。去掉它就要「临时改 + 求值 + 精确回滚」，且求值期间必须持锁，把并发读全堵住。
- 收益上限只有那 38%，而求值本身的 34% 与 excelize 内部的 29% 一分都省不掉。
- 曾考虑用 `excelize.OpenFile(s.path)` 替代 `WriteToBuffer`：`reloadLocked` 证实 `s.file` 始终来自磁盘，语义上可行，但 profile 里 `WriteToBuffer` 占比很小，换完几乎无收益却多一次磁盘读。

benchmark 保留在 `bench_test.go`，作为将来重启这个话题时的测量入口。

### 3.2 索引提取并行

见第二节。数据推翻了原始判断。

### 3.3 watchdog `hotCount` 的「无锁竞态」

原评审标注为并发缺陷。核实后：`hotCount` / `lastReport` 只在 `Start` 的 ticker goroutine 内读写（`sample`、`reportHot`、`writeWatchdogDiagnostic` 全在同一条调用链上），**不是共享状态**。只有 `Start` 被重复调用才会出现两个采样者，而调用方只启动一次。**不改**。

---

## 四、验证

| 项 | 结果 |
| --- | --- |
| `gofmt`（去 CRLF 后逐文件核对） | 干净 |
| `go vet ./...` | 通过 |
| `go build ./...` | 通过 |
| `go test ./internal/...` | 13 个包全部 ok |
| `golangci-lint run ./...` | **0 issues** |
| `BenchmarkIndexScan` | 794 → 382 ms（2.08×） |
| headless 相对路径实测 | exit 0 / `success:true` / 31 959 B |
| headless 绝对路径实测 | exit 0 / 字节一致 |
| E2E 全量（重建 server 二进制后） | **76 passed / 6 skipped / 0 failed**（6 个 skipped 是仓库既有的 `test.skip`/`fixme`） |

`go test -race` 本机 `CGO_ENABLED=0` 不可用；CI 的 race job 覆盖。

### 关于 CRLF

工作区 `.go` 文件是 CRLF，`gofmt -l` 会对几乎整个仓库误报。本轮判断自己改动的文件是否格式正确的方法是：`tr -d '\r'` 生成 LF 副本后跑 `gofmt -l`，副本为空才算干净。这一轮靠它抓到我手工对齐 `IndexRow` 时多打的空格（gofmt 用 tab 对齐）。

---

## 五、遗留

- `GrantFile` 对不可 canonicalise 的路径静默返回。本轮通过入口统一 `Abs` 让这条路径不再被触发，但函数本身仍会吞错。改动它会扩散到所有调用方（保存对话框、打开文件等），留作 P3。
- 打开进度上报、关闭保存三态的真实 WebView2 手工验证、更新器资产改名 —— 均需真实环境，未在本轮。
