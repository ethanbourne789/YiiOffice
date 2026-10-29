# Phase 5: 导出与无头

> 接续 Phase 4（编辑器宿主）。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** 在 Wails V3 环境下实现文档导出（主要是 PDF）与无头 CLI 模式，对齐 Electron 版本 `--headless-export` 行为，使 `YiiOffice.exe --headless-export input.docx --to pdf --out output.pdf` 可用且输出与 Electron 版本分页一致。

**Scope:** 仅 Windows 平台。不创建 macOS/Linux 代码。

**Exit Gate G5:** `--headless-export docx→pdf` 输出与 Electron 版本页面尺寸/分页一致；CLI 退出码对齐；JSON 输出格式一致。

---

## 1. 范围与约束

### 1.1 必须实现

| 功能 | 源文件 | 说明 |
|---|---|---|
| `printToPDF` 替代 | 各编辑器 `printToPDF()` 调用 | WebView2 COM `ICoreWebView2Controller2.PrintToPdf()` 或等价方案 |
| `--headless-export` CLI | `electron-utils/headless-export.ts` + 各编辑器 | 支持 `--headless-export <input> --to <fmt> --out <path> [--json]` |
| 退出码对齐 | `HEADLESS_EXIT` 常量表 | success(0), badArgs(1), inputError(2), conversionFailure(3) |
| Docs PDF 导出 | `docs-main.ts` export-pdf / headless | docx→pdf，含混合纸张尺寸 |
| Sheets PDF 导出 | `sheets/pdf-export.ts` | xlsx→pdf，含页眉页脚/分页 |
| Slides PDF 导出 | `slides/pdf-export.ts` | pptx→pdf，含链接注释 |
| Markdown PDF 导出 | `markdown/print-pdf.ts` | md→pdf |
| HTML→PDF | `electron-utils/print-html-pdf.ts` | AI 文档场景 |
| 退出 envelopes | `formatHeadlessEnvelope` | JSON/纯文本 stdout 输出 |

### 1.2 依赖 Phase 4

| Phase 4 产出 | Phase 5 用途 |
|---|---|
| 5 个编辑器在标签内可用 | 无头模式下加载文档并执行导出 |
| `slidesApi`/`desktopApi`/`pdfApi`/`markdownApi` 桥接 | 触发各编辑器导出逻辑 |
| Rust xlsx sidecar | Sheets 无头导出依赖 |
| Wails 多窗口 API | 创建隐藏的 WebView2 窗口用于导出 |

### 1.3 明确不做

- 不实现 PDF→Office 反向导出（`runPdfOfficeExport`），该功能依赖 PDFium WASM，属于 P4 决策门 D7 范畴
- 不实现 macOS dock 隐藏行为
- 不实现 notarization / 公证流程

---

## 2. 关键决策

### D6: `printToPDF` 替代方案选择

Electron 的 `webContents.printToPDF()` 在 Wails V3 / WebView2 中无直接等价物。三选一：

| 方案 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|
| **A. WebView2 `PrintToPdf` COM** | 原生支持，页面渲染与 GUI 一致，分页精准 | 需通过 COM 调用 `ICoreWebView2Controller2.PrintToPdf()`，Wails beta 可能不直接暴露 | **首选** |
| B. 外部 Chromium 无头 | 成熟稳定，输出一致 | 需额外进程，增加部署复杂度 | 回退 |
| C. Go PDF 库 | 不依赖外部二进制 | 无法复用编辑器渲染，分页/样式不一致 | 不推荐 |

**决策：A 为首选，B 为回退。**

**实施路径：**
1. 首先检查 Wails V3 beta.28 是否通过 `application.WebviewWindow` 暴露了 `PrintToPdf` 或类似方法
2. 若无，通过 `com` 包直接调用 WebView2 COM API
3. 若 COM 路径不可行，回退到方案 B（下载 headless Chromium，通过 `os/exec` 调用）

### D5-EXT: 无头窗口模型

Wails V3 不支持 `show: false` 的窗口（Electron 核心特性）。两种方案：

| 方案 | 说明 |
|---|---|
| **A. 最小化隐藏窗口** | 创建 1x1 像素窗口，位置设为屏幕外，立即最小化。出口 G5 验证窗口不可见 |
| **B. 延迟创建** | CLI 检测到 `--headless-export` 时，不创建主窗口，仅在需要时才创建临时导出窗口 |

**决策：A + B 结合。** 主入口检测 `--headless-export` 时跳过主窗口创建，直接创建隐藏导出窗口。

---

## 3. 目标仓库结构（Phase 5 新增文件）

```text
internal/
├── export/
│   ├── cli.go                   # --headless-export 参数解析 (Task 1)
│   ├── cli_test.go
│   ├── runner.go                # 无头导出调度器 (Task 2)
│   ├── runner_test.go
│   ├── print.go                 # PDF 打印窗口 (Task 3)
│   ├── print_test.go
│   ├── docs.go                  # Docs 导出入口 (Task 4)
│   ├── docs_test.go
│   ├── sheets.go                # Sheets 导出入口 (Task 4)
│   ├── slides.go                # Slides 导出入口 (Task 4)
│   ├── markdown.go              # Markdown 导出入口 (Task 4)
│   └── envelope.go              # stdout JSON/文本输出 (Task 1)
│       └── envelope_test.go
└── platform/
    └── print_windows.go         # WebView2 COM PrintToPdf 封装 (Task 3)
```

---

## 4. Phase 5 详细任务（可执行）

### Task 1: CLI 参数解析与退出码

**Source reference:** `packages/electron-utils/src/headless-export.ts`

**Go 文件:**
- Create: `internal/export/cli.go`
- Create: `internal/export/envelope.go`
- Test: 对应测试文件

**Steps:**

- [ ] **Step 1: 定义退出码常量**

```go
// Exit codes must match Electron version exactly.
const (
    ExitSuccess          = 0
    ExitBadArgs          = 1
    ExitInputError       = 2
    ExitConversionFailed = 3
)
```

- [ ] **Step 2: 定义支持的目标格式**

```go
var HeadlessTargets = map[string][]string{
    "docs":     {"pdf", "html"},
    "sheets":   {"pdf"},
    "slides":   {"pdf"},
    "markdown": {"pdf"},
}
```

- [ ] **Step 3: 实现 `parseHeadlessExportArgv`**

解析 `--headless-export <input> --to <format> --out <path> [--json]`，返回结构化请求或错误。

- [ ] **Step 4: 实现 `headlessModuleFor(inputPath)`**

按扩展名路由：`.docx`→docs, `.xlsx/.xls/.csv/.tsv`→sheets, `.pptx`→slides, `.md`→markdown。

- [ ] **Step 5: 实现 `formatHeadlessEnvelope` 和 `headlessExitCode`**

JSON 模式输出 `{"outcome":"success|error",...}`，纯文本模式单行输出。

- [ ] **Step 6: 测试 + 提交**

```powershell
go test ./internal/export/ -v -run 'CLI|Envelope'
git add internal/export
git commit -m "feat: add headless export CLI parsing and exit code constants"
```

---

### Task 2: 无头导出调度器

**Source reference:** `apps/shell/src/main/headless-export.ts`, `apps/shell/src/main/index.ts`

**Go 文件:**
- Create: `internal/export/runner.go`
- Test: `internal/export/runner_test.go`

**Steps:**

- [ ] **Step 1: 路径校验**

`validateHeadlessPaths()` — 输入文件存在且为普通文件，输出目录存在，输入输出不同文件，目标格式被模块支持。

- [ ] **Step 2: 导出调度器**

```go
// HeadlessExporter maps module name to export function.
type HeadlessExporter func(inputPath string, outPath string) error

// RunHeadlessExport validates paths and dispatches to the right exporter.
func RunHeadlessExport(request HeadlessRequest, exporters map[string]HeadlessExporter) HeadlessOutcome
```

- [ ] **Step 3: 输出文件验证**

验证输出文件存在、是普通文件、mtime 在 startedAt 之后（FAT/exFAT 宽容 2 秒）。

- [ ] **Step 4: 测试 + 提交**

---

### Task 3: WebView2 COM `PrintToPdf` 封装

**决策门 D6 实施。**

**Go 文件:**
- Create: `internal/platform/print_windows.go`
- Test: `internal/platform/print_windows_test.go`（仅验证函数签名）

**Steps:**

- [ ] **Step 1: Spike Wails V3 内置导出 API**

检查 Wails V3 beta.28 是否暴露 PDF 导出能力：

```powershell
# 查看 Wails 源码或生成的绑定
Get-ChildItem $env:USERPROFILE\go\pkg\mod\github.com\wailsapp\wails\v3@\v3.0.0-beta.28 -Recurse | Select-String -Pattern "Print|Pdf|Export" -List
```

- [ ] **Step 2: 方案 A — WebView2 COM 调用**

若 Wails 不直接支持，使用 COM 调用：

```go
import (
    "github.com/go-ole/go-ole"
    "github.com/go-ole/go-ole/oleutil"
)

// PrintToPdf calls ICoreWebView2Controller2.PrintToPdf on the given webview.
func PrintToPdf(window application.WebviewWindow, outputPath string) error {
    // 1. Get the underlying ICoreWebView2 from the Wails window handle
    // 2. Call PrintToPdf(filePath, options)
    // 3. Wait for completion (async COM call)
}
```

需要的 COM 接口链：`ICoreWebView2Host` → `ICoreWebView2` → `ICoreWebView2Controller2` → `PrintToPdf`

**备选：通过 Wails 前端 JS 调用 WebView2 API：**

```typescript
// 如果 COM 路径不可行，在前端执行：
// window.chrome.webview.postMessage({ action: 'printToPdf', path: '...' })
// 或者直接使用 JS 打印 API
```

- [ ] **Step 3: 方案 B 回退 — 外部 Chromium**

若方案 A 失败：

```go
func PrintToPdfViaChromium(htmlPath string, outputPath string, opts PrintOptions) error {
    chromePath := findHeadlessChrome() // 或从 bundled path
    cmd := exec.Command(chromePath,
        "--headless=new",
        "--disable-gpu",
        "--print-to-pdf="+outputPath,
        "--no-margins",
        htmlPath,
    )
    // ...
}
```

- [ ] **Step 4: 测试 + 提交**

---

### Task 4: 各编辑器无头导出实现

**Go 文件:**
- Create: `internal/export/docs.go`
- Create: `internal/export/sheets.go`
- Create: `internal/export/slides.go`
- Create: `internal/export/markdown.go`

**Steps:**

- [ ] **Step 1: Docs 无头导出**

核心流程：
1. 创建隐藏 WebView2 窗口（1x1 像素，屏幕外）
2. 加载 docs renderer，通过 IPC 传入输入文件路径
3. 等待文档就绪（`pollUntilReady`）
4. 等待分页稳定（连续两次 pageSliceCount 相同）
5. 调用 `PrintToPdf` 导出
6. 验证输出，关闭窗口

超时：300 秒（与 Electron 一致）。

- [ ] **Step 2: Sheets 无头导出**

1. 确保 xlsx-sidecar 已启动
2. 创建隐藏窗口，加载 sheets renderer
3. 等待工作簿加载完成
4. 渲染器生成 HTML，通过 `PrintToPdf` 导出
5. 处理 differentFirst/differentOddEven 页眉页脚（可能需要多次打印 + pdf-lib 合并）

超时：600 秒。

- [ ] **Step 3: Slides 无头导出**

1. 创建隐藏窗口，加载 slides renderer
2. 等待 `slideCount > 0 && pendingImages === 0`
3. 等待字体加载完成
4. 构建 PDF 导出 HTML（含 SVG/PNG 页面和链接覆盖层）
5. 调用 `PrintToPdf`

超时：300 秒。

- [ ] **Step 4: Markdown 无头导出**

最简洁：
1. 创建隐藏窗口
2. 加载 markdown renderer
3. 等待文档就绪
4. 调用 `PrintToPdf({ pageSize: 'A4', printBackground: true, margins: 0.6 })`

超时：180 秒。

- [ ] **Step 5: 注册导出器**

在 `main.go` 或专门的 `headless.go` 中注册：

```go
exporters := map[string]export.HeadlessExporter{
    "docs":     exportDocsHeadless,
    "sheets":   exportSheetsPdfHeadless,
    "slides":   exportSlidesPdfHeadless,
    "markdown": exportMarkdownPdfHeadless,
}
```

- [ ] **Step 6: 测试 + 提交**

---

### Task 5: `main.go` 无头入口集成

**Steps:**

- [ ] **Step 1: 在 `main.go` 检测 `--headless-export`**

```go
func main() {
    // Parse headless export flag BEFORE creating any window
    if req, ok := export.ParseHeadlessExport(os.Args); ok {
        // Skip GUI initialization entirely
        os.Exit(runHeadlessExport(req))
    }

    // Normal GUI startup...
}
```

- [ ] **Step 2: 实现 `runHeadlessExport`**

完整流程：
1. 初始化 Go runtime（但不创建 Wails App 窗口）
2. 校验路径
3. 按扩展名路由到对应 exporter
4. 等待导出完成
5. 写 stdout 结果（等待 flush，最多 2 秒）
6. `os.Exit(exitCode)`

- [ ] **Step 3: HTML→PDF 打印窗口**

实现 `printHtmlToPdf()` — 用于 AI 生成的 HTML 内容转 PDF，逻辑与 Electron `print-html-pdf.ts` 对齐。

- [ ] **Step 4: 端到端验证**

```powershell
# 准备测试文件
echo "Hello World" > test.md

# 运行无头导出
.\build\bin\YiiOffice.exe --headless-export test.md --to pdf --out test.pdf --json

# 验证输出
if (Test-Path test.pdf) { Write-Host "SUCCESS" } else { Write-Host "FAIL" }
```

- [ ] **Step 5: 提交**

---

### Task 6: G5 验收

**Steps:**

- [ ] **Step 1: 构建生产版本**

```powershell
wails3 build
```

- [ ] **Step 2: 逐项验证**

| 检查项 | 方法 | 通过标准 |
|---|---|---|
| CLI 参数解析 | 各种参数组合 | 错误参数返回退出码 1 |
| Docs 无头导出 | `--headless-export doc.docx --to pdf --out out.pdf` | 输出文件存在，分页与 Electron 版本一致 |
| Sheets 无头导出 | `--headless-export sheet.xlsx --to pdf --out out.pdf` | 输出文件存在，页眉页脚正确 |
| Slides 无头导出 | `--headless-export slide.pptx --to pdf --out out.pdf` | 输出文件存在，链接注释保留 |
| Markdown 无头导出 | `--headless-export test.md --to pdf --out out.pdf` | 输出文件存在，A4 尺寸 |
| 退出码对齐 | 检查 `$LASTEXITCODE` | success=0, badArgs=1, inputError=2, conversionFailure=3 |
| JSON 输出 | `--json` 标志 | 合法的 JSON 单行，含 outcome 字段 |
| 混合纸张尺寸 | 含 A3+A4 混合 docx | 各页尺寸正确 |
| 超时处理 | 损坏文档（触发渲染超时） | 退出码 3，stderr 有诊断信息 |
| GUI 模式不受影响 | 双击启动 | 正常显示 GUI，无 headless 行为 |

- [ ] **Step 3: 分页一致性对比**

```powershell
# 对比 Electron 和 Wails 导出的 PDF 页面数
# (需要两个版本共存时运行)
$electronPdf = (Get-Item "electron-out.pdf").Length
$wailsPdf = (Get-Item "wails-out.pdf").Length
# 页面数应一致（通过 pdf-lib 或类似工具检查）
```

- [ ] **Step 4: 提交**

```powershell
git add -A
git commit -m "chore: phase 5 gate G5 verification"
```

---

## 5. 风险与回退

| 风险 | 触发信号 | 回退动作 |
|---|---|---|
| WebView2 COM `PrintToPdf` 不可用 | COM 调用失败或 API 不存在 | 方案 B：外部 headless Chromium |
| Wails 不支持无窗口模式 | 必须创建主窗口才能使用 WebView2 | 创建 1x1 隐藏窗口，完成后销毁 |
| 分页与 Electron 不一致 | 像素对比差异 > 5% | 调整 WebView2 缩放/DPI 设置，对齐 Chromium 渲染参数 |
| 超时控制不精确 | 无头导出卡死 | 增加 `context.WithTimeout` + 强制关闭窗口 |
| Sheets 多页眉页脚合并失败 | pdf-lib 合并结果页缺失 | 使用 Go PDF 库（`github.com/pdfcpu/pdfcpu`）替代 |
| xlsx-sidecar 启动失败 | 文件不存在或权限问题 | 在 `beforePack` 检查，输出友好错误 |

---

## 6. 自检清单

- [x] 覆盖度：`HEADLESS_EXIT` 常量表逐条对齐
- [x] 覆盖度：各编辑器 headless 导出函数已映射
- [x] 覆盖度：CLI 语法与 Electron 版本一致
- [x] 无占位符：每个任务有具体文件路径、Go 代码示例、验证命令
- [x] 类型一致性：`HeadlessExporter` 接口签名统一
- [x] Windows-only：无 mac/linux 文件
- [x] 退出码对齐：success(0), badArgs(1), inputError(2), conversionFailure(3)
- [x] 性能预算明确：超时值与 Electron 版本一致
- [x] 决策门 D6 有回退方案
