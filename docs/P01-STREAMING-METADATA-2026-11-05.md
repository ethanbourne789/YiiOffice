# P-01 实施报告：工作簿元数据流式扫描

日期：2026-11-05
范围：`internal/workbook`（未改 binding 契约、未改前端）

---

## 一、结论

**同进程 A/B（`BenchmarkSheetMetadataPaths`，两侧都先 `excelize.OpenFile`，只有提取方式不同）：**

| 路径 | 耗时 | 分配 | allocs/op |
| --- | --- | --- | --- |
| `excelize_getters`（改动前） | 0.77–0.81 s | 452.5 MB | 8.19 M |
| `streaming_scan`（改动后） | 0.223 s | 122.2 MB | 2.49 M |
| **比值** | **3.5×** | **−73%** | **−70%** |

（数值取自加护栏后的最终复测，两轮各 5 次迭代。）

**端到端 `BenchmarkEngineOpen/medium`（5 sheet × 2000 行 × 20 列）：**

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 首轮测量（较冷机器） | 735 ms | 208–233 ms |
| 高负载下复测 | — | 520–590 ms |
| 分配 | 452.5 MB | 122.3 MB |
| allocs/op | 8.19 M | 2.49 M |

绝对耗时随机器负载明显漂移（同一份代码在连续跑测试后从 208 ms 涨到 590 ms），所以**以 A/B 比值 3.5× 和分配量 −73% 为准**；这两个数与端到端的 735→216 比值一致，互相印证。

同一份收益同时作用于两条路径，因为两者都调用 `sheetMetadata`：

- `engine.go:192` — 打开工作簿
- `reads.go:611` — **每次保存后的重建**（前端 `save-actions.ts:696` 在保存成功后会 `openLazyWorkbook(file)`）

后者是高频路径：`App.tsx:508-540` 的自动保存在**每 30 秒**和**窗口 blur** 时触发，因此大表编辑期间每次切窗口回来都会付一次这个成本。

---

## 二、根因（profile 实测，非推测）

原始 735 ms 里 `sheetMetadata` 占 65.9%，可拆成两段，**同一个 worksheet XML 被解析了两遍**：

1. `sheetDimensions`（29.1%）— `excelize.Rows()`。查 `excelize/rows.go:339` 可知，该函数在 sheet 已被 `workSheetReader` 缓存时会 **`xml.Marshal` 整个结构体再重新 decode**，且每行 `Columns()` 把整行 cell 转成 `[]string`。
2. `columnWidths`（36.8%）— 每列 4 次 `GetCol*`，第一次调用触发 `workSheetReader` 对整表做**结构体全量 decode**。

改动后再 profile：`readSheetGeometry` 占总时间 **49.8%**，`excelize.OpenFile` 仅 **2.7%**——瓶颈已完全转移到扫描器自身（`encoding/xml` 约 28 MB/s 的吞吐），这部分继续优化属于「自定义 XML 解析器」范畴，本轮不做（见第六节）。

---

## 三、做法

新增 `internal/workbook/ooxml.go`（约 560 行），一次流式扫描产出 `SheetMeta` 的全部 worksheet 级字段：

```
zip.OpenReader
  → xl/workbook.xml            <sheet name r:id state>        按文档顺序
  → xl/_rels/workbook.xml.rels rId → Target                   仅 /worksheet
  → xl/worksheets/sheetN.xml   单次 Token 遍历：
        <sheetPr>        tabColor/@rgb
        <sheetFormatPr>  defaultRowHeight / defaultColWidth
        <sheetViews>     <sheetView>（*第一个*）+ <pane>（*最后一个*）
        <cols>           min/max/width/hidden/outlineLevel/style
        <sheetData>      max(row/@r)、max(c/@r)，cell 内容 dec.Skip 掉
        </sheetData> 之后 bulk skip，只保留 <tableParts>
  → xl/worksheets/_rels/sheetN.xml.rels → xl/tables/*.xml（ref/name/tableStyleInfo）
```

`sheetMetadata` 改为：能扫描走扫描，否则调用保留下来的 `applyWorksheetMetaFromExcelize`（原逻辑原样搬出，一行未改）。

### 列宽解析语义

刻意与 excelize 逐列对齐，否则会出现渲染差异：

- 定义生效条件 `min <= n <= max`，**后出现的定义覆盖前面的**；
- 匹配到的 `<col>` 没有 `width` 属性时**保留上一个值**，不是清空；
- 无任何定义时 `width` 取 `9.140625`（excelize 的 `defaultColWidth`），因此**每一列都会带 `Width`**——与改动前完全一致；
- `<col min="1" max="16384">` 的区间按检测到的列数裁剪后再展开，避免小表付 16384 次分配。

---

## 四、行为一致性如何保证

`TestSheetGeometryMatchesExcelize`（`ooxml_test.go`）构造一个覆盖全部属性面的工作簿——隐藏 sheet、tab 颜色、冻结窗格、`showGridLines`/`showFormulas`/`showRowColHeaders`/`rightToLeft`/`zoomScale`、自定义列宽、隐藏列、列分组、表格、空 sheet、稀疏行——然后对**每一个** sheet 执行：

```
want := applyWorksheetMetaFromExcelize(...)   // 旧路径
got  := scan.applyWorksheetMeta(...)          // 新路径
reflect.DeepEqual(got, want)
```

这个测试在开发过程中抓到了两个真实缺陷，都已修复：

1. **`RowCount` 语义错误**：我最初统计 `<row>` 元素个数，但 excelize 的迭代器会在 `r="40"` 之前合成空行，所以它返回的是**行位置**。稀疏表会把 `RowCount` 算小，前端网格会裁掉数据。
2. **`tabColor` 被覆盖**：`readSheetGeometry` 里一句 `geom.tabColorRGB = ref.tabColor` 把扫描结果覆盖成空串。

两个都是「测试没写就一定会漏到线上」的问题，这也是先写一致性测试、后看性能数字的原因。

另有一处刻意保留的不一致：`GetSheetView` 取**第一个** `<sheetView>`，而 `getPanes` 取**最后一个**。真实文件通常只有一个，但为保持逐字段等价，两者分别复刻。

### 这个测试的盲区，以及 E2E 抓到的第三个缺陷（已修复）

上面的夹具由 **excelize 自己生成**，因此它必然带有 `excelize` 认为必需的元素——`<sheetViews>`、`<sheetFormatPr>`、`<dimension>`。手工生成器（本仓库的 E2E 夹具就是 `JSZip` 手写 XML）不会写这些可选元素。

首次跑 E2E 时 `sheets.spec.ts` 4 个用例全部失败，页面显示「无法打开工作簿。」。根因是 `ooxml.go` 里：

```go
if last := g.views[len(g.views)-1]; last.pane != nil && ... {   // len(g.views) == 0 → index -1
```

没有 `<sheetViews>` 的工作表让 `views` 为空切片，`len-1 == -1` 直接 panic，整个打开流程中断。**一致性测试 100% 覆盖字段，却因为夹具来源单一而漏掉了「元素缺失」这一维度。**

修复分两层，缺一不可：

1. **修根因**：`if len(g.views) > 0 { ... }` 包住取首/取尾两处索引。
2. **加护栏**：新增 `applyScannedMeta`，用 `recover()` 包住单表的扫描结果应用，并且**先写入 `scratch` 副本、成功才提交**。手写解析器面对的是本项目无法控制的输入，一个边界 bug 不应该让用户打不开文档；回退到 excelize 只是慢一点。

对应地补了 `TestSheetGeometryMinimalPackage`：用 `archive/zip` 在测试里**现场构造**最小包（无 `<sheetViews>`/`<sheetFormatPr>`/`<cols>`/`<dimension>`，只有一行一列），仍然做 `DeepEqual` 对比。「不 panic」只是及格线，逐字段等价才是断言。

> 教训值得写下来：用被测实现的上游库生成夹具，会系统性地漏掉「上游库自己总会补上的元素」。E2E 手写夹具在这里不是冗余，而是唯一能覆盖该维度的用例。

---

## 五、回退边界（明确列举）

`readSheetGeometry` 在以下情况返回 `ok=false`，调用方自动走 excelize 原路径：

| 场景 | 原因 |
| --- | --- |
| 加密工作簿 | OLE 复合文档容器，不是 zip |
| CSV | 不是 zip |
| 旧版 `.xls` | 二进制格式 |
| `xl/workbook.xml` / `.rels` 缺失或 `<sheet>` 无 `r:id` | 包结构非预期 |
| rels 里找不到某 sheet 的 target、或 zip 里没有该 part | 同上 |
| 图表工作表（chartsheet） | rels 类型不是 `/worksheet` |

`TestSheetGeometryFallsBackForUnreadableContainers` 钉住 CSV / 加密 / 文件不存在三种；`TestEncryptedWorkbookStillOpens` 走完整 `Engine.OpenWithPassword` 证明加密会话端到端仍可用（断言 `RowCount=1`、`ColumnCount=1`）。

**已知代价：加密工作簿仍为 735 ms 级别**，因为 fallback 保留了原实现。这是刻意的取舍，不是遗漏。

---

## 六、明确未做的三件事

| 项 | 判定 | 理由 |
| --- | --- | --- |
| 保存后跳过元数据重算 | **不做** | 几何扫描占剩余耗时 49.8%，但判断「几何未变」本身需要扫描。唯一可安全复用的情况是保存请求不含任何单元格编辑——真实保存中几乎不触发，收益≈0。若改用时序推断（如「无 structuralOps 即复用」），普通编辑把数据写到范围外就会导致网格裁掉新数据，风险不对称。 |
| `dec.RawToken` 替代 `dec.Token` | **不做** | 实测失败：RawToken 的属性/命名空间语义与依赖的行为不一致，扫描直接失败并回退（分配回到 452 MB）。 |
| 自写字节级 XML 扫描器 | **不做** | 可把 216 ms 再压到约 70 ms，但需要自行处理注释、CDATA、属性引号与实体，属「重写解析层」。相对 100 ms 以下的用户感知收益，风险不划算。 |

保留 `sheetDimensions` / `columnWidths` / `sheetTables` 三个旧函数作为 fallback，不是死代码。

---

## 七、验证结果

| 项 | 结果 |
| --- | --- |
| `gofmt -l internal/workbook/` | 无输出 |
| `go vet ./...` | 通过 |
| `go build ./...` | 通过 |
| `go test ./internal/...` | 13 个包全部 ok |
| `golangci-lint run ./...` | **0 issues** |
| `npm run typecheck`（frontend，17 ws） | 通过 |
| `npm run lint`（frontend） | 通过 |
| `npm test`（frontend 全 workspace） | 全绿（sheets 264 例 + 其余包） |
| E2E 全量（`npx playwright test --project=real`） | **76 passed / 6 skipped / 0 failed** |
| E2E `sheets-quality`（含加密工作簿 fallback） | 4 passed |
| `go test -race` | 本机 `CGO_ENABLED=0` 无法运行；CI 的 `race` job 覆盖 `internal/workbook`，会执行新增测试 |

E2E 驱动的是 `-tags server,production` 的真实二进制（真实 Go 服务、真实 bindings，无桩），所以它同时验证了「渲染器拿到的 `SheetMeta` 与改动前一致」——这是单元测试之外唯一能证明端到端无回归的证据。

未做人工 GUI 验证（需真实 WebView2）。

---

## 八、剩余风险

1. **`<c>` 缺 `r` 属性**：按行内递增推断。若某个生成器写出的顺序与视觉顺序不一致，列数会算偏。已在代码中处理递增逻辑，但无真实样本验证。**这道风险现已由 `applyScannedMeta` 的 recover 护栏兜底**：真出错时该表退回 excelize，最坏结果是退化为旧速度，而不是打不开。
2. **多 `<sheetView>` 文件**：按 excelize 的分裂语义复刻（前者取第一个、后者取最后一个），但这类文件极罕见，无真实样本。
3. **图表工作表混排**：整个工作簿会 fallback（因为 rels 类型不匹配），不会渲染错误，但也拿不到加速。
4. **`encoding/xml` 吞吐**：约 28 MB/s。超大单表（>50 MB worksheet XML）仍是数百毫秒级，属解析层固有成本。
5. **手写解析器的长期维护成本**：护栏保证「不会打不开」，但**保证不了「字段一定对」**。因此 `TestSheetGeometryMatchesExcelize` 必须保留——它是唯一能在 excelize 升级后立刻发现语义漂移的手段（升级依赖时应先跑它）。

---

## 九、下一步可选（未启动）

若要继续压缩，按收益/风险排序：

1. **只对活动 sheet 做完整扫描，其余用 `GetSheetList` + 延迟到首次切换**——但需要契约变更（`FileInfo.Sheets` 允许缺几何），即之前评估后被判定「边际收益 < 风险」的 PR2–4。
2. 自写字节级扫描器——纯实现层，但需完整 fuzz 覆盖。
3. 把 `sharedStrings` 预解析并入同一遍——当前 `excelize.OpenFile` 已只占 2.7%，收益很小。
