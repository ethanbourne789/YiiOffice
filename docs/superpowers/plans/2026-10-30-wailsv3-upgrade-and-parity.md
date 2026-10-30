# Wails v3.0.0 升级 + 纯 Go 化 + P0/P1/P2 功能补齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把项目从 Wails `v3.0.0-beta.28` 升级到最新稳定版 `v3.0.0`，移除 Rust sidecar 改为纯 Go（excelize），并把审计出的 P0/P1/P2 功能全部接通，PDF 能力收敛为 pdfcpu 能覆盖的范围。

**Architecture:** 保持现有分层：渲染层（React，6 个 Vite app）原样复用；Go 侧 `internal/*` 负责宿主能力；前端经 `frontend/packages/wails-bridge` 调用 Wails 生成的命名绑定（`$Call.ByID`）。升级后统一用官方组件替换手写实现（updater / 托盘 / 多窗口），并把所有 `noop` 桩替换为真实绑定。

**Tech Stack:** Go 1.27、Wails v3.0.0、WebView2、React 19 + Vite、pdfcpu 0.16.4、excelize v2.11.0、modernc sqlite FTS5、`github.com/wailsapp/wails/v3/pkg/updater`。

## Progress (updated 2026-10-30)

- **Phase A — done.** Module + CLI on `v3.0.0`; `wails3 build` produces `build/bin/yiioffice.exe`; smoke launch stays alive.
- **Phase B — done.** `internal/workbook` (excelize) implements open/read/find/outline/recalc/media/save with the exact renderer JSON contract. Rust `apps/sheets/native/xlsx-engine`, `internal/sidecar`, `scripts/build-xlsx-sidecar.ps1` deleted; `WorkbookService` and `main.go` rewired; bindings regenerated (8 services / 112 methods / 58 models). Contract verified by feeding real engine JSON through the renderer's zod schemas (7/7 parse). `frontend/packages/wails-bridge` typecheck + tests green; 6 renderers build.
- **Phase C — done.** C1: new `bridge.ExportService` (HTML→PDF via Edge headless with `@page` paper size, pdfcpu merge of per-page parts, printer list, save/folder dialogs); docs export path rewritten to per-page render + merge; markdown `exportPdf`/`exportDocx`/`save`/image export wired to real bindings. C2: `Tab`/`TabSummary` carry `Dirty` (and `Path`), `TabService.SetDirty`/`GetDirtyTabs`, `main.go` CloseGuard prompts via Win32 `MessageBox`, renderers report through `?tabId=` + `setCurrentTabDirty`. C3: `DocsService.PickImage/PickFiles/SaveImageAs`, `SlidesService.PickFiles/FilesAdd`, native folder/save dialogs for exports. C4: pdfcpu-only surface — `InsertBlankPage`, extract/insert/replace/merge/split/n-up/cut/crop/export-images added on `internal/pdfengine` + `bridge.pdfops`; `ListFormFills` and other pdfcpu-absent capabilities now reject explicitly instead of no-op stubs.
- **Phase D — D1 done, D2/D3 done, D5 partially done.** D1 detach opens a real window and removes the tab, `Dock` restores it (both former red tests green). D2 window `EnableFileDrop` + `common:WindowFilesDropped` → `openPath`. D3 single-instance + command-line/file-association opening (`host.RegisterAssociations` writes per-user ProgIDs, tested against a throwaway key). D5: `package:windows` Taskfile target; sidecar steps already removed in Phase B.
- **Phase E — done.** E1: `internal/update` rewritten on the official `pkg/updater` with the Gitee releases feed (provider tests via `httptest`). E2: system tray with Show/Hide/Quit (Quit respects the close guard).
- **Next:** full `wails3 build` + installer smoke run, and the remaining renderer-side wiring for editor features that never had a Go implementation (docs DOCX round-trip dialogs, slides element ops, PDF annotations) — those are explicitly out of scope per the pdfcpu constraint, not stubs to be filled.

**硬约束（用户指定）：**
- 只保留 pdfcpu 的 PDF 能力；pdfcpu 不支持的（原地文字编辑、OCR、签名、Office 互转、表单设计）**不实现、不保留桩**，前端对应入口显式禁用。
- 不再引入 Node/Rust/Python 等第二运行时；唯一"非 Go"是 Wails 必需的 WebView2 与前端构建链。
- 注释用英文；仅 Windows 目标。

---

## 0. 前置事实（已核实，执行时直接使用）

| 事实 | 证据 |
|---|---|
| 最新稳定版 = `v3.0.0`（2026-10-26 发布），另有 `v3.1.0-nightly.*` | `go list -m -versions` 输出；官方发布公告 |
| `app.Window.NewWithOptions(WebviewWindowOptions)` 在 v3.0.0 仍存在 | `pkg/application/window_manager.go:54` |
| `WebviewWindowOptions.EnableFileDrop bool` 存在 | `pkg/application/webview_window_options.go:189` |
| `application.SingleInstanceOptions{UniqueID, OnSecondInstanceLaunch func(SecondInstanceData), AdditionalData map[string]string}` | `pkg/application/single_instance.go:28-45` |
| 官方 updater：`pkg/updater`（`updater.New(host)` / `Check(ctx)` / `DownloadAndInstall(ctx)` / providers） | `pkg/updater/updater.go` |
| `app.SystemTray *SystemTrayManager` | `pkg/application/application.go:439` |
| excelize 最新 `v2.11.0` | `go list -m -versions github.com/xuri/excelize/v2` |

**代理设置（本机需要，否则拉不到依赖）：**

```powershell
$env:GOPROXY='https://goproxy.cn,direct'; $env:GOSUMDB='sum.golang.google.cn'
```

**每次 `wails3 generate bindings` 后必须重建手写 `.d.ts`**（生成器会删掉它们）：
`shellservice.d.ts`、`tabservice.d.ts`、`homeservice.d.ts`、`docsservice.d.ts`、`slidesservice.d.ts`、`pdfservice.d.ts`、`markdownservice.d.ts`、`workbookservice.d.ts`，位于 `frontend/bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/`。

**统一验证基线（每个 Phase 结束都要跑）：**

```powershell
go build -tags production ./...
go test ./internal/...
cd frontend\packages\wails-bridge; npm run typecheck; npm test; cd ..\..\..
cd frontend; node tools/build-renderers.mjs shell docs sheets slides pdf markdown; cd ..
```

---

## Phase A — 升级 Wails 到 v3.0.0（阻塞项，必须最先做）

### Task A1: 升级 CLI 与模块版本

**Files:** `go.mod`、`go.sum`

- [ ] **Step 1: 升级 wails3 CLI**

```powershell
$env:GOPROXY='https://goproxy.cn,direct'; $env:GOSUMDB='sum.golang.google.cn'
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0
wails3 version
```

预期输出包含 `v3.0.0`。若 PATH 中仍是旧版，用 `C:\Users\Ethan\go\bin\wails3.exe` 全路径执行。

- [ ] **Step 2: 升级模块**

```powershell
go get github.com/wailsapp/wails/v3@v3.0.0
go mod tidy
```

- [ ] **Step 3: 编译，收集所有 API 断裂点**

```powershell
go build -tags production ./...
```

预期：可能失败。把每条错误按「包内 API 改名/删除」归类，逐条修 `main.go`、`internal/platform/app.go`。**不要**为了通过编译去改 `internal/host`、`internal/bridge` 的业务逻辑。

- [ ] **Step 4: 重新生成绑定并补回 8 个 `.d.ts`**

```powershell
wails3 generate bindings -d frontend/bindings
```

然后按上表重建 8 个 `.d.ts`（内容与生成的 `<svc>.js` JSDoc 一致；签名不变时直接沿用旧文件内容）。

- [ ] **Step 5: 验证**

```powershell
go build -tags production ./...
cd frontend\packages\wails-bridge; npm run typecheck; npm test; cd ..\..\..
```

- [ ] **Step 6: 提交**

```bash
git add go.mod go.sum main.go internal/bridge frontend/bindings frontend/packages/wails-bridge
git commit -m "chore: upgrade wails v3 to v3.0.0 stable and regenerate bindings"
```

### Task A2: 运行时冒烟

- [ ] **Step 1: 构建并启动**

```powershell
cd frontend; node tools/build-renderers.mjs shell docs sheets slides pdf markdown; cd ..
wails3 build
.\build\bin\yiioffice.exe
```

验收：窗口出现、Home 显示版本号、能新建 docs 标签、控制台无 `unknown channel`/`$Call` 报错。
- [ ] **Step 2: 若 runtime.js 路径变化，修正 `frontend/packages/wails-bridge/src/transport.ts` 中对 `@wailsio/runtime` 的导入**（v3.0.0 新增 `@wailsio/runtime/cancellable` 子路径导出，订阅类调用可能需要改为 `CancellablePromise`）。

---

## Phase B — 移除 Rust sidecar，改用纯 Go（excelize）

**目标接口保持不变**（`internal/sidecar` 的 `XlsxManager` 由 `internal/workbook` 取代），`WorkbookService` 方法签名不动，只换实现，避免前端改动。

### Task B1: 新增 `internal/workbook` 纯 Go 引擎

**Files:**
- Create: `internal/workbook/engine.go`
- Create: `internal/workbook/engine_test.go`
- 删除: `internal/sidecar/xlsx.go`、`internal/sidecar/xlsx_test.go`
- 删除: `apps/sheets/native/xlsx-engine`（Rust 工程整体移除）
- Modify: `main.go`（去掉 sidecar 初始化）
- Modify: `internal/bridge/workbookservice.go`（依赖从 `*sidecar.XlsxManager` → `*workbook.Engine`）

- [ ] **Step 1: 先写失败测试**（`internal/workbook/engine_test.go`）

用 `excelize` 现场生成一个含公式与分级显示的 xlsx 作为 fixture，断言：

```go
func TestReadRangeReturnsValues(t *testing.T)      // A1:B2 → 二维字符串数组
func TestReadFormulasReturnsRawFormulas(t *testing.T) // "=SUM(1,2)"
func TestFindCellsFindsSubstring(t *testing.T)
func TestReadRowOutlineReturnsLevels(t *testing.T)
func TestRecalcComputesFormula(t *testing.T)       // CalcCellValue("=1+2") == "3"
func TestReadMediaReturnsImageList(t *testing.T)
func TestCloseReleasesSession(t *testing.T)
```

- [ ] **Step 2: 运行确认失败**

```powershell
go test ./internal/workbook -run TestReadRange -v
```

预期：`no Go files` / `undefined: Engine`。

- [ ] **Step 3: 实现 `engine.go`**

```go
package workbook

import (
    "fmt"
    "os"
    "sync"

    "github.com/xuri/excelize/v2"
)

// Engine is a pure-Go replacement for the former Rust xlsx sidecar.
type Engine struct {
    mu       sync.Mutex
    sessions map[string]*session
}

type session struct {
    path string
    f    *excelize.File
}

func NewEngine() *Engine { return &Engine{sessions: map[string]*session{}} }

// Open loads a workbook and returns a session id. Re-opening the same path
// reuses the cached session so the renderer's save flow stays cheap.
func (e *Engine) Open(path string) (string, error) { ... }

// ReadRange returns a 2D string matrix for `range` (e.g. "A1:B2").
func (e *Engine) ReadRange(sessionID, sheet, rng string) ([][]string, error) { ... }

// ReadFormulas returns cell->formula pairs for cells that carry formulas.
func (e *Engine) ReadFormulas(sessionID, sheet string) (map[string]string, error) { ... }

// FindCells returns matching cell addresses with their text values.
func (e *Engine) FindCells(sessionID, sheet, query string) (map[string]string, error) { ... }

// ReadRowOutline returns row index -> outline level.
func (e *Engine) ReadRowOutline(sessionID, sheet string) (map[int]int, error) { ... }

// Recalc evaluates every formula cell in a sheet via CalcCellValue.
func (e *Engine) Recalc(sessionID string) (map[string]map[string]string, error) { ... }

// ReadMedia returns embedded images of the workbook as base64.
func (e *Engine) ReadMedia(sessionID string) ([]string, error) { ... }

// Close drops the session.
func (e *Engine) Close(sessionID string) error { ... }
```

实现要点（务必照做，避免踩坑）：
- `ReadRowOutline`：excelize `GetRows` 不含 outline 信息，需用 `f.GetSheetXML` 或读 `xl/worksheets/sheetN.xml`，用 `encoding/xml` 解析 `<row outlineLevel="n">`。
- `Recalc`：excelize `CalcCellValue(sheet, cell)` 对每个含公式单元格求值，返回 `map[sheet]map[cell]value`；遇到 `#NAME?` 记为字符串原样返回，不 panic。
- `ReadMedia`：`f.GetPictureCells(sheet)` + `f.GetPictureData`，转 base64。
- 所有方法在 session 不存在时返回 `fmt.Errorf("unknown session %q", id)`。

- [ ] **Step 4: 测试通过**

```powershell
go test ./internal/workbook -v
```

- [ ] **Step 5: 改 `WorkbookService` 接线**

`internal/bridge/workbookservice.go`：
- 构造函数改为 `NewWorkbookService(eng *workbook.Engine, rm *host.RecentManager)`
- `ReadRange/ReadFormulas/FindCells/ReadRowOutline/Recalc/ReadMedia/Close` 直接转调 `eng`，**不再返回 `nil, nil`**
- `ReadPivotDefinition`：excelize 无透视图 API → 删除该方法，同步删除前端 `wbReadPivotDefinition` 与 `DesktopApiForSheets.readPivotDefinition` 的桩
- 更新 `workbookservice_test.go` 用 `NewEngine()` 替换 mock

- [ ] **Step 6: `main.go` 去掉 sidecar**

删除 `sidecar.NewXlsxManager` 段与 `internal/sidecar` import，改为：

```go
wbEngine := workbook.NewEngine()
```

`build/bin/xlsx-sidecar.exe` 与 `build/windows/nsis/*.nsi` 中对它的拷贝段一并删除。

- [ ] **Step 7: 全量验证 + 提交**

```powershell
go build -tags production ./...; go test ./internal/...; rg -n "xlsx-sidecar|internal/sidecar" --glob '!*.md' .
git add -A
git commit -m "refactor: replace rust xlsx sidecar with pure-Go excelize engine"
```

---

## Phase C — P0 功能接通（编辑器导出/打印/脏标记/文件对话框/PDF）

### Task C1: 导出与打印（最高性价比）

Go 侧 `platform.PrintHTMLToPdf` 与 `MarkdownService.ExportDocx/ExportPdf` 已实现，缺的是绑定与前端接线。

**Files:**
- Create: `internal/bridge/exportservice.go` + `exportservice_test.go`
- Modify: `main.go`（注册 `ExportService`）
- Modify: `frontend/packages/wails-bridge/src/editor-api.ts`

- [ ] **Step 1: 写失败测试**（断言 `ExportPdf` 用给定 HTML 产出非空 PDF 文件）

```go
func TestExportServicePdfWritesFile(t *testing.T)
func TestExportServicePdfRejectsMissingOutputDir(t *testing.T)
func TestExportServiceListPrintersReturnsSlice(t *testing.T)
```

- [ ] **Step 2: 实现 `ExportService`**

```go
type ExportService struct{}

// ExportPdf renders HTML to PDF via the WebView2 print pipeline.
func (s *ExportService) ExportPdf(html string, outPath string) (ExportResult, error)
```

`ExportResult{OK bool, Path string, Err string}`。内部调用 `platform.PrintHTMLToPdf`。

- [ ] **Step 3: 注册服务 + 生成绑定 + 补 `exportservice.d.ts`**

```powershell
wails3 generate bindings -d frontend/bindings
```

- [ ] **Step 4: 前端接线**

在 `editor-api.ts` 把下列 `noop` 换成真实调用：
- Docs `exportPdf` → 新增 `docsExportPdf(html, outPath)`（在 `docs-bridge.ts`）
- Sheets `exportPdf` → 保留 `wbExportPdf`（Go 已实现 `WorkbookService.ExportPdf`）
- Slides `exportPdf` → `ExportService.ExportPdf`
- Markdown `exportPdf` / `exportDocx` → `mdExportPdf` / `mdExportDocx`（Go 已实现）
- `print` → 改为 `noop` **但删除注释**，并在 `PdfApi.printRequest`、`SlidesApi.print`、`sheets.print` 上抛明确错误 `new Error('native print is not supported; use Export PDF')`，让 UI 有机会提示而不是静默失败。

- [ ] **Step 5: 验证 + 提交**

```powershell
go test ./internal/bridge -run TestExport -v
cd frontend\packages\wails-bridge; npm run typecheck; npm test; cd ..\..\..
git commit -am "feat: wire pdf export across all editors"
```

### Task C2: 脏标记 + 关闭保护

**Files:** `internal/host/tabhost.go`、`internal/host/closeguard.go`、`internal/bridge/tabservice.go`、`main.go`

- [ ] **Step 1: 失败测试**：`TestTabHostDirtyTracking`、`TestCloseGuardBlocksOnDirty`、`TestCloseGuardAllowsWhenClean`
- [ ] **Step 2: `TabHost` 增加 `SetDirty(id, bool)` / `DirtyTabs() []TabSummary`**
- [ ] **Step 3: `TabService` 新增 `SetDirty(id string, dirty bool)`、`GetDirtyTabs() []host.TabSummary`**
- [ ] **Step 4: `main.go` 的 `CloseGuardConfig.GetDirty` 改为 `func() []host.DirtyTab { return tabHost.DirtyTabs() }`**
- [ ] **Step 5: 前端**：各编辑器在 `dirtyChanged`/`setDirty` 处调用 `tabsSetDirty`；`dirtyChanged` 不再是 noop
- [ ] **Step 6: 验证 + 提交**

### Task C3: 编辑器文件对话框（`filesPick` / `filesAdd` / `filesAddPastedImage` / `saveEditsBegin`）

- [ ] **Step 1: 失败测试**：`TestPickImageReturnsEmptyOnCancel`
- [ ] **Step 2: 在 `MarkdownService.PickImage` 基础上抽出 `internal/host/dialogs.go` 的 `OpenImage(filter)` / `SaveFile(filter)` 复用**
- [ ] **Step 3: 给 `DocsService`/`SlidesService`/`WorkbookService` 增加 `PickFiles(kind string) ([]string, error)`**
- [ ] **Step 4: 前端把 `filesPick/filesAdd/filesAddPastedImage` 换成真实绑定**
- [ ] **Step 5: `saveEditsBegin` → 改为真正的「把编辑后内容回传给 Go 暂存」，若无对应 Go 能力则**删除该接口**（YAGNI，避免留桩）
- [ ] **Step 6: 验证 + 提交**

### Task C4: PDF 能力收敛到 pdfcpu

**Files:** `internal/bridge/pdfservice.go`、`internal/pdfengine/pdfengine.go`、`frontend/packages/wails-bridge/src/editor-api.ts`

保留：`ReadFile/Save/SaveAs/ExtractPages/InsertPdf/SplitPdf/MergePdf/MergePages/ReplacePages/SetPageSize/SplitPages/CropPages/ExportImages/ListPageImages`。

- [ ] **Step 1: 补 pdfcpu 可覆盖的能力**
  - `InsertBlankPage(path string, index int) error` → pdfcpu 插入空白页
  - `ListFormFills(path string)` → pdfcpu 无表格域 API，删除方法
  - `ExportImages` 改为走 pdfcpu `extract -mode image`（不再依赖 pdfium）
- [ ] **Step 2: 删除 pdfcpu 无法覆盖的 Go 桩**：`OcrPage`、`ConvertOffice`、`CreateDocument`、`GenerateImage`、`ListSignatures/AddSignature/RemoveSignature/GetUsername`、`ValidateTextEdits`、`ListEditFonts`、`CanDrawText`、`PageImagePng`、`PagePreviewPng`、`AutoRename`、`IsUntitled`、`ConsumePending`、`PrintRequest`（连同 `PdfApi` 接口定义一起删）
- [ ] **Step 3: 前端**：上述接口从 `PdfApi` 删除后，`frontend/apps/pdf/src` 中对应菜单项改为 `disabled` + tooltip「pdfcpu 不支持」，**不要留空函数**
- [ ] **Step 4: 测试**：`TestPdfInsertBlankPage`、`TestPdfExtractImages`
- [ ] **Step 5: 验证 +提交**

---

## Phase D — P1

### Task D1: 真·多窗口标签撕离

**Files:** `internal/host/detached.go`、`internal/bridge/tabservice.go`、`main.go`

- [ ] **Step 1: 失败测试**：`TestDetachCreatesWindowEntry`、`TestDockRemovesFromList`
- [ ] **Step 2: `Detach` 返回真实窗口名并创建窗口**（通过 `platform` 注入的 `CreateWindowFn func(name, url string) error`，避免 `host` 依赖 application 包）：

```go
app.Window.NewWithOptions(application.WebviewWindowOptions{
    Name: "detached-" + id, Title: title, Width: 1000, Height: 700,
    URL: "/" + kind + "/index.html?detached=" + id,
})
```

- [ ] **Step 3: `Detach` 从 `TabHost` 移除该标签并广播 `tabs:changed`**（当前实现保留原标签，是 bug）
- [ ] **Step 4: `Dock` 反向操作**
- [ ] **Step 5: 前端 `TabFrame` 在独立窗口隐藏标签条**
- [ ] **Step 6: 验证 + 提交**

### Task D2: 拖文件进窗口打开

- [ ] **Step 1: `main.go` 窗口选项加 `EnableFileDrop: true`**
- [ ] **Step 2: 订阅 Wails 文件拖入事件**（v3.0.0 的 window 事件名以 `pkg/application/events*.go` 为准），拿到路径列表后 emit `app:files-dropped` 事件
- [ ] **Step 3: `wails-bridge` 新增 `installDropOpenBridge()`，把路径转成 `homeOpenPath` 调用；`Home.tsx` 的遮罩改为监听该桥接**
- [ ] **Step 4: 验证**（手动拖一个 .docx 进窗口 → 打开新标签）+ 提交

### Task D3: 二次启动与文件关联

- [ ] **Step 1: `SingleInstance` 增加 `OnSecondInstanceLaunch`**，从 `data.Args`（若 `SecondInstanceData` 带参数，用 `AdditionalData`）解析文件路径并 `homeOpenPath`
- [ ] **Step 2: 首启 argv 解析**：`main.go` 在 `app.Run()` 前把 `os.Args[1:]` 存入 `pendingOpenPaths`，窗口加载完成后打开
- [ ] **Step 3: 文件关联写侧**：`internal/host/fileassoc.go` 增加 `RegisterAssociations(exePath string) error`（写 HKCU `Software\Classes\YiiOffice.<ext>` + `OpenWithProgids`）
- [ ] **Step 4: 安装器调用注册**（`build/windows/nsis/installer.nsi` 增加写入段落）
- [ ] **Step 5: 测试**：`TestRegisterAssociationsWritesProgid`（用临时注册表键）+ 提交

### Task D4: Slides 通道实测与补齐

- [ ] **Step 1: 先跑一次实测**：打开一个 fixtures/pptx，确认当前 `editText/addElement/undo` 等是否真的只需要前端实现（渲染层 4.4 万行内已有实现）。
  - 若前端已自足 → 从 `SlidesApi` **删除这些通道**（不是留 noop）。
  - 若需要宿主参与（例如保存补丁到 pptx）→ 在 `SlidesService` 增加 `ApplyOps(ops []SlideOp) error`，由 Go 侧 `pptx-engine` 语义实现。
- [ ] **Step 2: `isDirty` 改为真实状态**（接 C2 的脏标记）
- [ ] **Step 3: `exportImages` 接 `ExportService`**
- [ ] **Step 4: 提交**

### Task D5: 打包（NSIS + 代码签名 + 无 sidecar）

**Files:** `Taskfile.yml`、`build/windows/nsis/*.nsi`

- [ ] **Step 1: 新增 Taskfile 任务**

```yaml
  package:windows:
    desc: Build NSIS installer
    cmds:
      - wails3 build
      - makensis build/windows/nsis/installer.nsi
```

- [ ] **Step 2: 移除安装器中对 `xlsx-sidecar.exe` 的拷贝段；确认 `frontend/dist` 全量进包**
- [ ] **Step 3: 验收**：干净目录安装 → 启动 → 打开 5 类文件各一次（`build\bin\yiioffice.exe` 存在即视为构建通过）

---

## Phase E — P2

### Task E1: 官方 Updater 替换自研

- [ ] **Step 1: 删除 `internal/update`**
- [ ] **Step 2: 用 `pkg/updater`**：`updater.New(host)` + `Config{Provider, Window}`，在 `main.go` 注册；provider 指向本地文件/静态 URL 清单
- [ ] **Step 3: 前端接收 `updater:*` 事件并展示**
- [ ] **Step 4: 提交**

### Task E2: 托盘与原生菜单

- [ ] **Step 1: `app.SystemTray.New()` + 菜单（显示主窗/退出）**
- [ ] **Step 2: 保留现有 HTML 菜单（自定义标题栏），**不**迁移为原生菜单，避免破坏渲染层；仅在托盘菜单用原生**
- [ ] **Step 3: 提交**

### Task E3: 文档回填与 E2E

- [ ] **Step 1: 把 7 份 phase 计划中的 checkbox 按 git 历史回填为 `[x]`**
- [ ] **Step 2: `e2e/` 补 5 条最小回归：打开 docx / 保存 xlsx / 打开 pptx / PDF 合并 / 搜索**
- [ ] **Step 3: 全量验证并提交**

---

## 验收清单（DoD）

| 编号 | 验收项 | 命令/方法 |
|---|---|---|
| A | `go build -tags production ./...` 退出 0 | 见基线 |
| B | `go test ./internal/...` 全绿 | 见基线 |
| C | `frontend/packages/wails-bridge` typecheck + test 全绿 | 见基线 |
| D | 6 个渲染器构建成功 | `node tools/build-renderers.mjs ...` |
| E | 手动：5 类文件各打开一次；导出 PDF 各一次；拖入文件打开；标签撕离；关闭未保存文件被拦截 | `build\bin\yiioffice.exe` |
| F | 仓库中不再出现 `xlsx-sidecar`、`internal/sidecar`、`internal/update` | `rg` |
| G | `editor-api.ts` 中不再有 `noop` 桩（除 `print` 的显式报错） | `rg "noop" frontend/packages/wails-bridge/src/editor-api.ts` |
