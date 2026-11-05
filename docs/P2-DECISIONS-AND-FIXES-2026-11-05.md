# P2 修复与决策报告（2026-11-05）

承接 `docs/CODE-REVIEW-2026-11-05.md` 第九节 P2 清单。本轮包含两部分：**两项待决事项的判定**（用户委托），以及 **P2 中可控范围内的落地**。

---

## 一、两项决策的判定与依据

### 决策 1：golangci-lint 采用「全量开闸」而非「先建基线、分批收敛」

**判定：全量开闸。** 依据是实测基数，而不是偏好。

| 步骤 | 结果 |
| --- | --- |
| 默认 linter 集（errcheck/govet/ineffassign/staticcheck/unused）首轮 | **55 条** |
| 其中 `defer *.Close()` / `os.Remove(All)` / `fmt.Print*` 类噪声 | 约 40 条 |
| 启用官方 `std-error-handling` + `common-false-positives` preset 后 | **15 条** |
| 人工修复后（含 2 处顺手加固） | **0 条** |

55 条对一个 139 文件的 Go 仓库属于「一次修得完」的量级，做长期基线豁免反而是更贵的债（每次新增问题都要判断是否已在基线里）。15 条残留全部是真实问题（事务 `Rollback`、`OpenExternal`、`trace.Start`、`cmd.Start`、未使用函数、两处 ST1005、一处 ineffassign、一处 SA6003），逐条修掉，没有用 `//nolint` 掩盖任何一条。

顺带按 golangci-lint 官方「先小后大」的建议，把未启用的 linter 与原因写进 `.golangci.yml` 注释（gosec 需先做 exec/registry/文件路径的 triage）。

两处顺带加固（preset 会掩盖，但语义上必须处理）：

- `internal/host/fileops.go` `Duplicate()`：去掉 `defer dst.Close()`，改为显式检查 Close —— 写入失败被吞掉会返回一个被截断的「Copy of」文件。
- `internal/fsutil/atomicwrite.go` 已有正确的 Close 检查，未改。

**刻意不启用 gofmt/gofumpt formatter**：仓库跟踪的 `.go` 文件是 CRLF，gofmt 会判定 **62 个文件**「未格式化」，全部是行尾差异。统一行尾是仓库级决定，不该被 lint 门禁顺手绑架。已在配置注释中写明。

**CI 接入位置**：放进既有的 `go` job（`windows-latest`）而不是新开 ubuntu job。本项目是 `//go:build windows`，Linux runner 上 golangci-lint 会跳过 `internal/` 的绝大部分文件，那样的门禁是假的。

### 决策 2：未保存新文档的关闭保存 —— 保持「弹原生另存为」，不改成静默落盘

**判定：保持弹窗（与 Word / VS Code / LibreOffice 一致），并把「默认保存文件夹」接成该对话框的起始目录。**

前提先被证伪：上一轮我说「docs 静默存到默认目录、其余四个应用弹另存为」，**这是错的**。`DocsService.SaveDocxNew` 直接转调 `SaveDocxAs` → `saveFileDialog` → `platform.Dialog.SaveFile()`，从来就是原生对话框。那条「静默落盘」的注释是 Electron 时代的遗留，Go 移植时行为已经变了。所以五个编辑器的行为本来就是一致的，**不需要统一到某个新行为**。

但顺着这条线查出一个真缺陷和一处名存实亡的配置：

1. **崩溃恢复定时器每 30 秒弹一次另存为**（高，已修）
   `file-actions.ts` 的 `writeRecoveryCopy()` 对「无路径文档」的分支是 `save(ctx, false, true)`。由于第一次保存必然需要对话框，用户在「新建文档」里打字满 30 秒就会被打断一次；`doc.isBlank` 只能挡住空文档。修复方式是把该分支改为直接返回：**自动保存路径永远不允许弹模态框**（自动保存的 effect 本来就有 `!doc.filePath` 门槛，这里补上同样的门槛即可）。代价是无路径文档在这一段时间内没有恢复副本 —— 属已知取舍，写进了注释。

2. **「默认保存文件夹」设置此前不生效**（中，已修）
   `HomeService.GetDefaultSaveDir()` 只是被设置页读取显示，没有任何保存路径消费它。现在通过 `bridge.SetDefaultSaveDirProvider()` 注入，`saveFileDialogIn()` 用它作为**无来源路径时**的起始目录；`SaveDocxAs` 则优先用文档自身目录（`srcPath` 参数此前完全未被使用，等于白传）。这样设置第一次真正生效，而「另存为」仍然从文件所在目录开始。

---

## 二、P2 落地清单

### P-02 摘要匹配 O(n²) → O(n)（高收益，已完成并量化）

`internal/index/snippet.go` `findTextRangesInRunes` 原实现逐字节扫全文，且**每命中一次**就用 `len([]rune(text[:i]))` 把前缀重数一遍 —— 命中越密越慢。

改为在 rune 空间用首字符跳过的字面匹配（`indexRunes`），一次线性扫描。

实测（1 MB 中英混排语料，70.3 万 rune，needle = `the` / `营收` / `报表`，命中 49348 处）：

| 实现 | 耗时 | 命中数 |
| --- | --- | --- |
| 旧（逐字节 + 前缀重数） | 23.84 s | 49348 |
| 新（rune 空间线性扫描） | **2.99 ms** | 49348 |

约 **7950×**，结果完全一致（命中数逐一对齐，不是「变快但结果不同」）。基准已入库：`internal/index/bench_test.go`（`BenchmarkBuildExcerpt`、`BenchmarkFindTextRangesInRunes`）。

### P-04 正文索引：Office 文档不再只索引文件名（高价值，已完成）

`internal/index/extract.go` 原先对 `.docx/.xlsx/.pptx` 一律返回 `name-only`，即本应用主要编辑的格式**全文搜索等于只能搜文件名**。

新增 `extractOOXML`：三种格式的文本都落在局部名为 `t` 的元素里（`w:t` / `a:t` / `si/t`），因此一个 token 走查器覆盖全部三种。

| 格式 | 取文本方式 |
| --- | --- |
| `.docx/.docm` | `word/document.xml` + footnotes/endnotes/comments（存在才读） |
| `.pptx/.pptm` | `ppt/slides/slideN.xml`，按**数字**排序（`slide2` 必须早于 `slide10`） |
| `.xlsx/.xlsm` | `xl/sharedStrings.xml`；缺失时回退扫描 `xl/worksheets/sheetN.xml`（覆盖 inline string） |

边界处理：单部件 `io.LimitReader` 32 MB（zip bomb）、部件数上限 200、总体按 `MaxBodyChars` 截断、非 zip 容器降级为 `name-only`（不把文件标成 error，保证文件名仍可搜到）、单个部件解析失败只丢该部件。段落/单元格边界写 `\n`，避免相邻 run 粘连导致摘要不可读。

新增 6 个测试（`extract_ooxml_test.go`），覆盖三格式、slide 数字序、inline string 回退、无文本容器、损坏容器。

### V-M7 工作簿会话无界增长 / 密码常驻 / UUID 冲突（已完成）

| 子项 | 处理 |
| --- | --- |
| 会话只增不减 | 新增 `maxSessions = 32`，超出时按 `lastUsed` 淘汰最久未用的会话并关闭其 excelize 文件 |
| 密码无法清除 | `session.password` 由 `string` 改为 `[]byte`，`release()` 中 `clear()` 清零 |
| `newUUID` 失败返回固定 UUID | 改为返回 `error`，`OpenWithPassword` 在失败时关闭文件并上报（固定 ID 会让两个会话互相覆盖） |
| `Close` 错误被忽略 | 抽出 `session.release()`，`Close`/`CloseAll`/淘汰路径统一走它并记录错误 |

**刻意不做时间型 TTL**：文档可能被用户放几小时不动，按时间踢会话会让下一次编辑变成保存失败（丢数据）。改用「数量上限 + 最久未用淘汰」，把内存封顶而不引入静默丢数据的路径。理由写进了 `defaultMaxSessions` 的注释。

新增 2 个测试：`TestEngineEvictsLeastRecentlyUsed`、`TestCloseWipesStoredPassword`（后者真实用 excelize 加密一份 xlsx 再验证字节被清零）。

### V-M14 生产构建剔除调试钩子（部分已修）

核对结论：`__yiiofficeControl` **不是**调试钩子，而是 `yiioffice open --block / --range / selection` 的正式 IPC 通道，保留；`apps/sheets` 的 `__journal` / `__univerRuntime` / `__ribbonCommand` 一组**本来就包在 `if (import.meta.env.DEV)` 里**，无需改。

真正暴露在外的只有 docs 的 4 个自动化全局：`__aidocs`（含 `save`/`exportPdfTo`）、`__exportPdf`、`__exportImages`、`__openPagePreview`。新增 `debug-hooks.ts`，统一用 `import.meta.env.DEV || window.__yiiofficeDebugHooks === true` 判定（后者正是 shell 在 `YIIOFFICE_DEBUG_HOOKS=1` 时才注入的开关），并在 effect 清理时 `delete`。已确认 E2E 未引用这些全局，不会破坏测试。

### P-01 工作簿打开性能：建立基线 + 定位，未做结构改造（明确说明）

新增 `internal/workbook/bench_test.go`（`BenchmarkEngineOpen`，small / medium 两档）。基线：

| 用例 | 耗时 | 分配 |
| --- | --- | --- |
| 1 sheet × 100 行 × 10 列 | 6.9 ms | 3.8 MB / 60 k allocs |
| 5 sheet × 2000 行 × 20 列（20 万单元格） | **695 ms** | **452 MB** / 8.19 M allocs |

CPU profile 归因：`sheetMetadata` 占 **65.9%**，可拆成两段——

- `columnWidths`/`GetCol*` 首次调用触发 `workSheetReader` 对整张表做**结构体全量 decode**（含所有 row/cell），占 36.8% CPU、45% 分配；
- `sheetDimensions` 用 `Rows` **另做一次流式解析**，占 29.1%。

即每个 sheet 被解析两次，且第二次是把 20 万单元格解成 Go struct。这不是本项目代码能靠微调消掉的：excelize 只是把 `<cols>`/`sheetPr` 藏在全量 decode 之后，导出 API 没有「只读 `<cols>`」的入口；唯一的结构性解法是**把 per-sheet 元数据改成按需加载**（打开只返回 sheet 名与活动页，宽度/视图在首次激活时取），这会改动 `FileInfo.Sheets` 的 binding 契约与 sheets 前端同步逻辑，属于独立迭代的风险级别。

本轮只做了不影响语义的小幅收敛（`hashFile` 已同时返回 size，避免再次 Stat），并把 benchmark 留在仓库里作为下一轮改造的验收门槛。**没有为了「看起来变快」去信任 `<dimension>` 元素** —— 该元素在真实工作簿里经常过期，代码里已有的注释就是为此写的，用它换 30% 耗时会换来「数据区被裁掉」的渲染事故。

### S-03 / T-09 文档校准（已完成）

- `e2e/README.md`：声明「70 tests in 11 files」→ 实测 **79 tests / 13 files**；表格按 `grep -c` 逐文件重算，补上缺失的 `home-recents.spec.ts`、`sheets-quality.spec.ts`；`sheets.spec.ts` 的 fixme 数由 1 改为 4（实测 6 个 fixme：docs 1、sheets 4、slides 1）。
- `docs/releasing.md`：补一段说明 `.github/workflows/release.yml` 已落地（tag 触发、版本槽校验、安装包 + `.sha256`、`gh release create`），同时明确它**没有**改资产命名，因此 updater 的 `DefaultAssetMatcher` 仍匹配不到 —— 第 2 节仍是恢复自动更新前唯一的硬前置。

### C-02 lint 门禁（已完成）

`.golangci.yml` + CI 步骤（`golangci/golangci-lint-action@v8`，版本钉 `v2.15.0`，跑在 `windows-latest`）。

---

## 三、验证结果

| 检查 | 结果 |
| --- | --- |
| `golangci-lint run ./...` | ✅ 0 issues（新增配置，CI 已接入） |
| `go vet ./...` | ✅ 通过 |
| `go test ./internal/...`（13 包） | ✅ 全绿，新增 10 个测试函数 |
| `go test -bench`（workbook / index） | ✅ 基线已采集并入库 |
| `npm run typecheck`（17 workspace） | ✅ 通过 |
| `npm test`（全量 Vitest） | ✅ 通过（约 1681 + 外加上下文各包，exit 0） |
| `npm run lint` | ✅ 通过 |
| `node tools/version.mjs check` | ✅ 38 槽位 / 18 文件一致 |
| `go build -tags server,production` | ✅ 通过 |
| `go test -race` | ⚠️ 未在本机执行（`CGO_ENABLED=1` 缺 gcc，环境限制）。CI 的 race job 覆盖 `internal/workbook`，本轮新增的 `atomic.Int64` + `release()` 加锁路径会在那里得到覆盖 |
| 完整 E2E / GUI 冒烟 | ⚠️ 未执行（需 WebView2 与打包装机） |

---

## 四、仍未完成的 P2 项（附理由）

| 项 | 状态 | 理由 |
| --- | --- | --- |
| P-01 工作簿打开 695 ms / 452 MB | 已定位未改造 | 结构性问题（per-sheet 元数据按需加载），需改 binding 契约 + sheets 前端同步，属独立迭代；benchmark 已入库作为门槛 |
| P-03 索引提取串行 | 未做 | 目录扫描**已**用 `errgroup` 并行（`scanParallelism`），剩余串行的是文本提取；而 P-04 刚把 docx/xlsx 提取从「读文件名」变成「解压 + 解析」，此时应先测真实 IO/CPU 占比再决定要不要并发，否则是在猜 |
| P-05 原地裁剪 | 未做 | 与 S-01 同族，属巨型文件治理 |
| S-01 巨型文件拆分 | 未做 | `apps/pdf/.../App.tsx` 9106 行、`univer-sync.ts` 7812 行，按功能域拆分需要完整回归网（当前 E2E 只覆盖 79 个用例），一次会话内做完风险高于收益 |
| Q-02 共享 bootstrap | 未做 | 6 份 bootstrap 去重会同时改动 6 个 app 的启动路径，与 S-01 应同批 |
| Q-09 slides-bridge 类型化 | 未做 | 约 120 处 `any`，需要先补齐 bindings 类型，属独立迭代 |
| V-M7 时间型 TTL | **判定不做** | 会静默踢掉用户正在看的文档 → 下一次保存失败，丢数据风险高于内存收益 |
| 更新器资产命名 | 未做 | `YiiOffice_<version>_setup.exe` 不含 `windows`/`amd64`，Wails `DefaultAssetMatcher` 匹配不到；改名要同步 `installer.nsi` 的 `OutFile` 并经真实打包验证（`docs/releasing.md` 已记录上次尝试因未验证而回退） |

---

## 五、剩余风险

1. **OOXML 提取的内存上界**：单部件 32 MB + 部件数 200 是保守值；极端压缩比的 zip 仍会消耗数百 MB。若后续索引不可信来源的目录，建议再加一层「单文件解压总量」预算。
2. **xlsx 只索引 sharedStrings**：用 `GetCellValue` 计算出的公式结果值不在共享表里，因此公式结果不可搜（单元格字面文本可搜）。要覆盖这点必须走 excelize 的计算路径，代价是重新引入本次刻意避开的全量 decode。
3. **会话上限 32 的取舍**：极端情况下打开第 33 个工作簿会淘汰最久未用的一个，被淘汰的标签页下一次操作会收到 `unknown session` 错误（不会静默损坏）。若产品上需要更高并发，调 `defaultMaxSessions` 即可。
4. **V-M14 只覆盖 docs**：sheets 的 dev 钩子本来就受 `import.meta.env.DEV` 保护，但 `__pageDebug`（docs，只读快照）与 `__docsParseStats`（docs，解析计数）未加门禁，属低危信息暴露，未在本轮处理。
5. **关闭保存仍未在真实 WebView2 上人工验证**（承接 P1 遗留），发版前建议手走一遍。
