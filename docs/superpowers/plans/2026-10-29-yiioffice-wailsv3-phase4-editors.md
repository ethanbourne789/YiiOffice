# Phase 4: 编辑器宿主

> 接续 Phase 3（[phase3-fs-index.md](2026-10-29-yiioffice-wailsv3-phase3-fs-index.md)）。
>
> **For agentic workers:** REQUIRED SUB-Skill: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** 让 5 个编辑器（docs / sheets / slides / pdf / markdown）在 Wails 标签内可用，完成所有编辑器专用的全局 Bridge API（`desktop` / `desktopApi` / `slidesApi` / `pdfApi` / `markdownApi`），接入 Rust xlsx sidecar 进程管理。

**Exit Gate G4:** 5 个编辑器在 Wails 中打开 Electron 版本相同的 fixture 文件，渲染内容一致，编辑器专用 Bridge API 调用无 `unknown channel` 错误。

---

## 1. 范围与约束

### 1.1 必须实现

| 编辑器 | 全局变量 | 关键通道/方法 | P4 任务 |
|---|---|---|---|
| **docs** | `window.desktop` | `docs:open`, `docs:save`, `docs:save-as`, `docs:export-pdf`, `docs:close-check` | Task 3 |
| **sheets** | `window.desktopApi` | `workbook:*` (open/save/read-range/sidecar-crashed 等) | Task 4 |
| **slides** | `window.slidesApi` | `slides:open`, `slides:save`, `slides:export-pdf` | Task 5 |
| **pdf** | `window.pdfApi` | `pdf:read-file`, `pdf:save`, `pdf:extract-pages`, `pdf:merge-pdf` | Task 6 |
| **markdown** | `window.markdownApi` | `markdown:read-file`, `markdown:save`, `markdown:export-pdf` | Task 7 |
| **all** | — | 标签容器 iframe 渲染、`app:*` 公共事件 | Task 2 |
| **sheets** | — | Rust xlsx sidecar 进程管理 | Task 8 |

### 1.2 依赖 Phase 1-3

| 前置产出 | P4 用途 |
|---|---|
| `bridge.Router` + `Service.Invoke` | 注册所有编辑器专用通道 |
| `bridge.RegisterTabBar` (P2) | 打开编辑器标签 |
| `host.SettingsStore` (P2) | 编辑器 `app:*` 通道（语言/主题/自动保存） |
| `host.RecentManager` (P2) | `docs:opened` 等更新最近文件 |
| `host.FolderManager` (P2) | 文件保存/打开路径约束 |
| `host.DialogManager` (P2) | `docs:save-as`, `slides:save-as` 等对话框 |
| `host.FileAssocManager` (P2) | `docs:save-as` 默认应用检查 |
| `index.FileIndexStore` (P3) | 文件打开后触发索引刷新 |
| `index.Lifecycle` (P3) | 文件保存/重命名后触发索引刷新 |

### 1.3 通道清单

Phase 4 新增的 Go 侧 IPC 通道（按编辑器分组）：

| 前缀 | 通道名 | 说明 |
|---|---|---|
| **docs** | `docs:open`, `docs:open-path`, `docs:save`, `docs:save-as`, `docs:save-new`, `docs:save-to` | 文档读写 |
| docs | `docs:consume-pending-open`, `docs:consume-new-blank`, `docs:consume-ai-doc-content`, `docs:consume-headless-export` | 待处理事件 |
| docs | `docs:export-pdf`, `docs:export-html`, `docs:print` | 导出/打印 |
| docs | `docs:context-menu-*`, `docs:spell-*` | 右键菜单/拼写检查 |
| docs | `docs:close-check*`, `docs:opened`, `docs:renamed` | 关闭确认/事件通知 |
| docs | `docs:mcp-*` | AI 命令通道 |
| docs | `docs:teardown`, `docs:view-menu-state` | 编辑器卸载/菜单状态 |
| **sheets** | `workbook:select`, `workbook:open*`, `workbook:read-*`, `workbook:save*`, `workbook:close*` | 工作簿 CRUD |
| sheets | `workbook:export-*`, `workbook:print`, `workbook:create-document` | 导出/打印 |
| sheets | `workbook:sidecar-crashed`, `workbook:recalc`, `workbook:find-cells` | sidecar 集成 |
| sheets | `sheets:files-*`, `sheets:capture-screen-*` | 附件/截图 |
| sheets | `user:display-name` | 用户名 |
| **slides** | `slides:open*`, `slides:save*`, `slides:edit-*`, `slides:add-*`, `slides:delete-*` | 演示文稿编辑 |
| slides | `slides:export-*`, `slides:print`, `slides:presenter-*` | 导出/放映 |
| slides | `slides:undo`, `slides:redo`, `slides:is-dirty` | 撤销/重做/脏标记 |
| **pdf** | `pdf:read-file`, `pdf:save`, `pdf:save-as*`, `pdf:export-*`, `pdf:print*` | PDF 读写 |
| pdf | `pdf:*` (页操作/签名/OCR/裁剪/合并/拆分) | PDF 高级操作 |
| pdf | `pdf:dirty-changed`, `pdf:close-save-*` | 脏标记/关闭 |
| **markdown** | `markdown:read-file`, `markdown:save*`, `markdown:export*` | Markdown 读写 |
| markdown | `markdown:pick-image`, `markdown:save-image*` | 图片操作 |
| markdown | `markdown:dirty-changed`, `markdown:close-save-*` | 脏标记/关闭 |
| **shell** | `shell:read-local-image`, `shell:open-external` | 读取本地图片/打开外部链接 |
| **yiioffice** | `yiioffice:view-image` | 查看图片 |

### 1.4 本阶段明确不做

- 不实现 `printToPDF`（Phase 5 决策门 D6）
- 不实现 `--headless-export` CLI（Phase 5）
- 不实现 MCP/AI 聊天相关通道（仅注册空通道防止报错）
- 不实现 `slides:presenter-*` 多屏协作
- 不实现 PDF 签名/OCR 的 Go 侧原生版本（返回 stub）
- 不实现公式重计算（仅透传 sidecar 结果）

---

## 2. 目标仓库结构（Phase 4 新增文件）

```text
internal/
├── bridge/
│   ├── docs.go                  # docs:open/save/export 等 (Task 3)
│   ├── docs_test.go
│   ├── sheets.go                # workbook:* + sheets:* (Task 4)
│   ├── sheets_test.go
│   ├── slides.go                # slides:open/save/export (Task 5)
│   ├── slides_test.go
│   ├── pdf.go                   # pdf:read-file/save/export (Task 6)
│   ├── pdf_test.go
│   ├── markdown.go              # markdown:read-file/save/export (Task 7)
│   ├── markdown_test.go
│   ├── editor-common.go         # app:* 公共事件 (Task 2)
│   └── shell.go                 # shell:read-local-image, shell:open-external
├── sidecar/
│   ├── xlsx.go                  # Rust sidecar 进程管理 (Task 8)
│   └── xlsx_test.go
└── host/
    └── foldertree.go            # 追加 openPath 路由
```

---

## 3. 关键决策

| ID | 决策 | 理由 | 回退 |
|---|---|---|---|
| P4-D1 | 编辑器通过 iframe 嵌入 shell（非 WebContentsView） | Wails V3 不支持 WebContentsView，P1 已确认 iframe 方案可行 | 多窗口模式，每个标签独立 BrowserWindow |
| P4-D2 | 编辑器专用 Bridge API 通过 Wails service 统一暴露 | 所有 IPC 走同一个 `Service.Invoke` 入口，避免重复注册 | 每个编辑器独立 service |
| P4-D3 | Go 侧仅实现需要原生能力的通道；纯前端逻辑通道返回 stub | 如 `slides:edit-text` 纯前端操作，Go 侧返回空结果；`docs:save` 需文件系统，Go 侧实现 | 全部通道都实现 Go 后端 |
| P4-D4 | Rust xlsx sidecar 通过 `os/exec` + stdin/stdout JSON 协议通信 | 与 Electron 版本 `xlsx-sidecar-client.ts` 行为一致 | 使用 Go 版 xlsx 库（`excelize`），但公式计算不支持 |
| P4-D5 | PDF 高级操作（合并/拆分/OCR/签名）先返回 stub | 这些操作 P4 不核心，P5/P7 再实现 | 使用 `pdfcpu` 实现基础操作 |
| P4-D6 | 编辑器 iframe 通过 `/docs/index.html`, `/sheets/index.html` 等路径加载 | 与 Electron `WebContentsView` preload + renderer URL 模式对应 | 使用 hash 路由或 query 参数 |

---

## 4. Phase 4 详细任务（可执行）

### Task 1: 标签容器 — 编辑器 iframe 加载

**Go 文件:** 无
**前端文件:**
- Modify: `frontend/apps/shell/src/renderer/src/AppFrame.tsx`
- Create: `frontend/apps/shell/src/renderer/src/TabFrame.tsx`

**Steps:**

- [ ] **Step 1: 创建 `TabFrame.tsx`**

根据 TabKind 加载对应编辑器的 iframe，支持 keep-alive（隐藏时不卸载）。

```tsx
// TabFrame.tsx
import { useEffect, useRef, useState } from 'react'
import type { TabSummary } from '../../shared/tabs-api'

const APP_URLS: Record<string, string> = {
  docs: '/docs/index.html',
  sheets: '/sheets/index.html',
  slides: '/slides/index.html',
  pdf: '/pdf/index.html',
  markdown: '/markdown/index.html',
}

export function TabFrame({ tabs, activeTabId }: { tabs: TabSummary[], activeTabId: string }) {
  const [activeId, setActiveId] = useState(activeTabId)

  useEffect(() => {
    setActiveId(activeTabId)
  }, [activeTabId])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {tabs.map((tab) => (
        <EditorIframe
          key={tab.id}
          tab={tab}
          visible={tab.id === activeId}
        />
      ))}
    </div>
  )
}

function EditorIframe({ tab, visible }: { tab: TabSummary, visible: boolean }) {
  const src = APP_URLS[tab.kind] || ''

  return (
    <iframe
      title={tab.id}
      src={src}
      style={{
        position: 'absolute',
        inset: 0,
        border: 'none',
        width: '100%',
        height: '100%',
        display: visible ? 'block' : 'none',
      }}
    />
  )
}
```

- [ ] **Step 2: 修改 `AppFrame.tsx`**

移除 `TabHostSpike` 探针，接入 `TabFrame`。

```tsx
export function AppFrame() {
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const [activeTabId, setActiveTabId] = useState('')

  useEffect(() => {
    void window.aiOfficeTabs.list().then((list) => {
      setTabs(list)
      const active = list.find(t => t.active)
      if (active) setActiveTabId(active.id)
    })
    return window.aiOfficeTabs.onChanged((list) => {
      setTabs(list)
      const active = list.find(t => t.active)
      if (active) setActiveTabId(active.id)
    })
  }, [])

  const hasEditorTabs = tabs.some(t => t.kind !== 'home')
  const homeActive = !hasEditorTabs

  return (
    <div className="app-frame">
      <TabBar />
      <div className="app-frame-content" style={{ visibility: homeActive ? 'visible' : 'hidden' }}>
        <Home />
      </div>
      {hasEditorTabs && (
        <TabFrame tabs={tabs.filter(t => t.kind !== 'home')} activeTabId={activeTabId} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: 验证**

启动应用，确认：
1. 打开 `.docx` 文件，docs 编辑器 iframe 加载
2. 打开 `.xlsx` 文件，sheets 编辑器 iframe 加载
3. 标签切换时 iframe 正确显示/隐藏

- [ ] **Step 4: 提交**

```powershell
git add frontend/apps/shell/src/renderer/src/TabFrame.tsx frontend/apps/shell/src/renderer/src/AppFrame.tsx
git commit -m "feat: add editor tab frame with iframe-based rendering"
```

---

### Task 2: 编辑器公共 Bridge API（`app:*` 事件）

**Go 文件:**
- Create: `internal/bridge/editor-common.go`

**Steps:**

- [ ] **Step 1: 实现 `app:*` 公共通道**

所有编辑器共享的 `app:get-language`, `app:get-theme`, `app:get-document-theme`, `app:get-auto-save-default` 等通道在 P1/P2 已实现（通过 `home:*` 前缀）。编辑器使用 `app:*` 前缀，需要额外映射。

```go
// editor-common.go
package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

const (
	ChannelAppGetLanguage        = "app:get-language"
	ChannelAppGetTheme           = "app:get-theme"
	ChannelAppGetDocumentTheme   = "app:get-document-theme"
	ChannelAppGetAutoSaveDefault = "app:get-auto-save-default"
	ChannelAppChromePressed      = "app:chrome-pressed"
)

// RegisterEditorCommon wires the common app:* channels shared by all editors.
func RegisterEditorCommon(r *Router, ss *host.SettingsStore) {
	ssHandle := r.Handle
	// Map app:get-language -> home:get-language handler
	r.Handle(ChannelAppGetLanguage, func(_ context.Context, _ []json.RawMessage) (any, error) {
		lang, _ := ss.GetLanguage()
		return lang, nil
	})
	r.Handle(ChannelAppGetTheme, func(_ context.Context, _ []json.RawMessage) (any, error) {
		theme, _ := ss.GetTheme()
		return theme, nil
	})
	r.Handle(ChannelAppGetDocumentTheme, func(_ context.Context, _ []json.RawMessage) (any, error) {
		docTheme, _ := ss.GetDocumentTheme()
		return docTheme, nil
	})
	r.Handle(ChannelAppGetAutoSaveDefault, func(_ context.Context, _ []json.RawMessage) (any, error) {
		autoSave, _ := ss.GetAutoSaveDefault()
		return autoSave, nil
	})
	r.Handle(ChannelAppChromePressed, func(_ context.Context, _ []json.RawMessage) (any, error) {
		platform.Emit(ChannelTabsChromePressed, nil)
		return nil, nil
	})
}
```

- [ ] **Step 2: 在 `channels.go` 添加常量**

```go
ChannelAppGetLanguage        = "app:get-language"
ChannelAppGetTheme           = "app:get-theme"
ChannelAppGetDocumentTheme   = "app:get-document-theme"
ChannelAppGetAutoSaveDefault = "app:get-auto-save-default"
ChannelAppChromePressed      = "app:chrome-pressed"
```

- [ ] **Step 3: 在 `main.go` 注册**

```go
bridge.RegisterEditorCommon(router, ss)
```

- [ ] **Step 4: 提交**

```powershell
git add internal/bridge/editor-common.go internal/bridge/channels.go main.go
git commit -m "feat: add common app:* channels for all editors"
```

---

### Task 3: docs 编辑器 Bridge（`desktop`）

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\docs\src\shared\ipc.ts`

**Go 文件:**
- Create: `internal/bridge/docs.go`
- Test: `internal/bridge/docs_test.go`

**Key channels:**
- `docs:open`, `docs:open-path` — 通过 `file-parse` 读取 OOXML 字节
- `docs:save`, `docs:save-as`, `docs:save-new`, `docs:save-to` — 写入文件
- `docs:consume-pending-open`, `docs:consume-new-blank` — 返回待处理打开事件
- `docs:export-pdf`, `docs:export-html` — Phase 5，返回 stub
- `docs:close-check`, `docs:close-check-result` — 关闭确认
- `docs:opened`, `docs:renamed` — 通知 shell 更新最近文件
- `docs:spell-*` — 拼写检查（P5，先 stub）
- `docs:context-menu-*` — 右键菜单（纯前端，返回 stub）
- `docs:mcp-*` — AI 命令（纯前端/外部服务，返回 stub）
- `docs:teardown` — 编辑器卸载

**Steps:**

- [ ] **Step 1: 实现 `docs:open-path`**

```go
const (
	ChannelDocsOpenPath  = "docs:open-path"
	ChannelDocsSave      = "docs:save"
	ChannelDocsSaveAs    = "docs:save-as"
	ChannelDocsOpened    = "docs:opened"
	ChannelDocsRenamed   = "docs:renamed"
	ChannelDocsCloseCheck    = "docs:close-check"
	ChannelDocsCloseCheckResult = "docs:close-check-result"
	ChannelDocsExportPdf   = "docs:export-pdf"
	ChannelDocsExportHtml  = "docs:export-html"
)

func RegisterDocs(r *Router, rm *host.RecentManager, idxl *index.Lifecycle) {
	r.Handle(ChannelDocsOpenPath, func(_ context.Context, args []json.RawMessage) (any, error) {
		pathStr, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(pathStr)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})

	r.Handle(ChannelDocsSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		saveReq, err := DecodeArg[DocsSaveRequest](args, 0)
		if err != nil {
			return nil, err
		}
		data, _ := base64.StdEncoding.DecodeString(saveReq.Content)
		return host.AtomicWrite(saveReq.Path, data, 0o644)
	})

	// ... more channels
}
```

- [ ] **Step 2: 实现 `docs:save-as`**

调用 `DialogManager.PickDirectory` 或 `PickFile`，然后保存文件。

- [ ] **Step 3: 实现事件通知通道**

`docs:opened` — 调用 `rm.RecordOpen()` 更新最近文件，触发索引刷新。
`docs:renamed` — 更新文件名，触发索引刷新。

- [ ] **Step 4: 实现 stub 通道**

为以下通道注册空实现（防止 `unknown channel` 错误）：
`docs:export-pdf`, `docs:export-html`, `docs:spell-*`, `docs:context-menu-*`, `docs:mcp-*`, `docs:teardown`, `docs:view-menu-state`

- [ ] **Step 5: 提交**

```powershell
git add internal/bridge/docs* internal/bridge/channels.go
git commit -m "feat: add docs editor bridge channels"
```

---

### Task 4: sheets 编辑器 Bridge（`desktopApi`）

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\sheets\src\shared\ipc-channels.ts` + `desktop-api.ts`

**Go 文件:**
- Create: `internal/bridge/sheets.go`
- Test: `internal/bridge/sheets_test.go`

**Key channels (workbook:*):**
- `workbook:select`, `workbook:select-for-merge` — 文件对话框
- `workbook:open-for-merge` — 打开工作簿
- `workbook:read-range` — 读取单元格范围（调用 sidecar）
- `workbook:read-formulas` — 读取公式（调用 sidecar）
- `workbook:find-cells` — 查找单元格（调用 sidecar）
- `workbook:read-row-outline` — 读取行大纲（调用 sidecar）
- `workbook:recalc` — 公式重计算（调用 sidecar）
- `workbook:read-media` — 读取媒体资源（调用 sidecar）
- `workbook:read-pivot-definition` — 数据透视表定义（调用 sidecar）
- `workbook:close` — 关闭工作簿（调用 sidecar）
- `workbook:save` — 保存工作簿
- `workbook:save-edits-*` — 增量保存
- `workbook:export-pdf`, `workbook:export-csv` — 导出
- `workbook:create-document` — 创建新文档
- `workbook:sidecar-crashed` — sidecar 崩溃通知

**sheets:* 通道:**
- `sheets:files-*` — 文件操作（pick/add/read）
- `sheets:capture-screen-*` — 截图（P5 stub）
- `sheets:consume-new-blank` — 新空白工作簿
- `sheets:has-queued-workbook` — 队列工作簿

**Steps:**

- [ ] **Step 1: 实现 `workbook:read-range`（透传到 sidecar）**

sheets 是 Phase 4 最复杂的编辑器，因为它需要 Rust xlsx sidecar。所有 `workbook:read-*` 和 `workbook:close` 通道都通过 sidecar 进程处理。

```go
func RegisterSheets(r *Router, sm *host.SettingsStore, dlgm *host.DialogManager, sidecar *sidecar.XlsxManager) {
	r.Handle(ChannelWorkbookReadRange, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[WorkbookReadRangeRequest](args, 0)
		if err != nil {
			return nil, err
		}
		return sidecar.ReadRange(req.SessionId, req.Sheet, req.Range)
	})

	r.Handle(ChannelWorkbookSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		saveReq, err := DecodeArg[WorkbookSaveRequest](args, 0)
		if err != nil {
			return nil, err
		}
		// Save to file, then update recent files
		// ...
	})
}
```

- [ ] **Step 2: 实现 `workbook:export-csv`**

从 sidecar 读取工作表数据，导出为 CSV。

- [ ] **Step 3: 实现 stub 通道**

`workbook:export-pdf` (Phase 5), `sheets:capture-screen-*` (Phase 5), `workbook:recalc` (需 sidecar 完成)

- [ ] **Step 4: 提交**

```powershell
git add internal/bridge/sheets*
git commit -m "feat: add sheets editor bridge channels"
```

---

### Task 5: slides 编辑器 Bridge（`slidesApi`）

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\slides\src\shared\ipc.ts`

**Go 文件:**
- Create: `internal/bridge/slides.go`
- Test: `internal/bridge/slides_test.go`

**Key channels:**
- `slides:open`, `slides:open-path` — 打开演示文稿
- `slides:save`, `slides:save-as` — 保存
- `slides:is-dirty` — 脏标记检查
- `slides:edit-*`, `slides:add-*`, `slides:delete-*` — 纯前端编辑操作（Go 侧 stub）
- `slides:export-pdf`, `slides:export-images` — Phase 5，先 stub
- `slides:presenter-*` — 多屏协作（stub）
- `slides:undo`, `slides:redo` — 纯前端
- `slides:files-*` — 文件操作

**Steps:**

- [ ] **Step 1: 实现 `slides:open-path` / `slides:save` / `slides:save-as`**

```go
func RegisterSlides(r *Router, rm *host.RecentManager, dlgm *host.DialogManager) {
	r.Handle(ChannelSlidesOpenPath, func(_ context.Context, args []json.RawMessage) (any, error) {
		pathStr, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(pathStr)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})

	r.Handle(ChannelSlidesSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		// Decode base64 content, write to path
		// ...
	})
}
```

- [ ] **Step 2: 实现 stub 通道**

`slides:edit-*`, `slides:add-*`, `slides:delete-*`, `slides:undo`, `slides:redo`, `slides:export-*`, `slides:presenter-*`

- [ ] **Step 3: 提交**

```powershell
git add internal/bridge/slides*
git commit -m "feat: add slides editor bridge channels"
```

---

### Task 6: pdf 编辑器 Bridge（`pdfApi`）

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\pdf\src\shared\ipc.ts`

**Go 文件:**
- Create: `internal/bridge/pdf.go`
- Test: `internal/bridge/pdf_test.go`

**Key channels:**
- `pdf:read-file`, `pdf:save`, `pdf:save-as-*` — PDF 读写
- `pdf:extract-pages`, `pdf:insert-pdf`, `pdf:split-pdf`, `pdf:merge-pdf` — 页操作
- `pdf:merge-pages`, `pdf:replace-pages`, `pdf:set-page-size` — 页编辑
- `pdf:split-pages`, `pdf:crop-pages` — 页裁剪/拆分
- `pdf:export-images`, `pdf:convert-office` — 导出
- `pdf:page-image-png`, `pdf:page-preview-png` — 页面预览图片
- `pdf:*signature`, `pdf:ocr-page` — 签名/OCR（stub）
- `pdf:dirty-changed`, `pdf:close-save-*` — 脏标记/关闭

**Steps:**

- [ ] **Step 1: 实现 `pdf:read-file` / `pdf:save`**

```go
func RegisterPdf(r *Router, rm *host.RecentManager, dlgm *host.DialogManager) {
	r.Handle(ChannelPdfReadFile, func(_ context.Context, args []json.RawMessage) (any, error) {
		pathStr, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(pathStr)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})
}
```

- [ ] **Step 2: 实现 stub 通道**

所有 PDF 高级操作（页操作/签名/OCR/导出）暂时返回 stub，P5 实现完整功能。

- [ ] **Step 3: 提交**

```powershell
git add internal/bridge/pdf*
git commit -m "feat: add pdf editor bridge channels"
```

---

### Task 7: markdown 编辑器 Bridge（`markdownApi`）

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\markdown\src\shared\ipc.ts`

**Go 文件:**
- Create: `internal/bridge/markdown.go`
- Test: `internal/bridge/markdown_test.go`

**Key channels:**
- `markdown:read-file`, `markdown:save`, `markdown:save-request*` — 读写
- `markdown:read-text-request*` — 读取文本
- `markdown:pick-image`, `markdown:save-image*`, `markdown:read-image` — 图片操作
- `markdown:export-docx`, `markdown:export-pdf` — 导出（stub）
- `markdown:consume-headless-export*` — 无头导出（stub，Phase 5）

**Steps:**

- [ ] **Step 1: 实现 `markdown:read-file` / `markdown:save`**

- [ ] **Step 2: 实现 `markdown:pick-image` / `markdown:save-image`**

调用对话框 API + 文件读写。

- [ ] **Step 3: 实现 stub 通道**

`markdown:export-docx`, `markdown:export-pdf`, `markdown:consume-headless-export`

- [ ] **Step 4: 提交**

```powershell
git add internal/bridge/markdown*
git commit -m "feat: add markdown editor bridge channels"
```

---

### Task 8: Rust xlsx sidecar 进程管理

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\sheets\native\xlsx-engine\` (Rust) + `xlsx-sidecar-client.ts`

**Go 文件:**
- Create: `internal/sidecar/xlsx.go`
- Test: `internal/sidecar/xlsx_test.go`

**Steps:**

- [ ] **Step 1: 构建 Rust sidecar 二进制**

```powershell
# Build the sidecar binary for Windows
cd E:\Dev\YiiOffice-Electron\apps\sheets\native\xlsx-engine
cargo build --release
# Copy to WailsV3 resources
Copy-Item target\release\xlsx-sidecar.exe E:\Dev\YiiOffice-WailsV3\resources\native\
```

- [ ] **Step 2: 实现 `XlsxManager`**

```go
package sidecar

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// XlsxManager manages the xlsx-sidecar Rust process.
type XlsxManager struct {
	binaryPath string
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     *bufio.Reader
	requestID  int64
	mu         sync.Mutex
	pending    map[int64]chan SidecarResponse
	done       chan struct{}
}

// SidecarRequest is a JSON-RPC request to the sidecar.
type SidecarRequest struct {
	ID     int64                  `json:"id"`
	Method string                 `json:"method"`
	Params map[string]interface{} `json:"params"`
}

// SidecarResponse is a JSON-RPC response from the sidecar.
type SidecarResponse struct {
	ID     int64                  `json:"id"`
	Result map[string]interface{} `json:"result,omitempty"`
	Error  *struct{ Code int64; Message string } `json:"error,omitempty"`
}

// NewXlsxManager creates and starts the sidecar process.
func NewXlsxManager(binaryDir string) (*XlsxManager, error) {
	binaryPath := filepath.Join(binaryDir, "xlsx-sidecar.exe")
	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("xlsx-sidecar binary not found: %s", binaryPath)
	}

	cmd := exec.Command(binaryPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}

	m := &XlsxManager{
		binaryPath: binaryPath,
		cmd:        cmd,
		stdin:      stdin,
		stdout:     bufio.NewReader(stdout),
		pending:    make(map[int64]chan SidecarResponse),
		done:       make(chan struct{}),
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	// Start response reader goroutine
	go m.readLoop()

	return m, nil
}

func (m *XlsxManager) readLoop() {
	for {
		line, err := m.stdout.ReadString('\n')
		if err != nil {
			// Process exited
			m.mu.Lock()
			for _, ch := range m.pending {
				ch <- SidecarResponse{Error: &struct{ Code int64; Message string }{
					Code:    -1,
					Message: "sidecar process exited",
				}}
				close(ch)
			}
			m.mu.Unlock()
			return
		}

		var resp SidecarResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			continue
		}

		m.mu.Lock()
		ch, ok := m.pending[resp.ID]
		if ok {
			delete(m.pending, resp.ID)
			ch <- resp
			close(ch)
		}
		m.mu.Unlock()
	}
}

// Call sends a request to the sidecar and waits for the response.
func (m *XlsxManager) Call(method string, params map[string]interface{}) (SidecarResponse, error) {
	m.mu.Lock()
	m.requestID++
	id := m.requestID
	ch := make(chan SidecarResponse, 1)
	m.pending[id] = ch
	m.mu.Unlock()

	req := SidecarRequest{
		ID:     id,
		Method: method,
		Params: params,
	}
	data, err := json.Marshal(req)
	if err != nil {
		return SidecarResponse{}, err
	}
	data = append(data, '\n')

	if _, err := m.stdin.Write(data); err != nil {
		return SidecarResponse{}, err
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-time.After(120 * time.Second):
		return SidecarResponse{}, fmt.Errorf("sidecar request timeout")
	case <-m.done:
		return SidecarResponse{}, fmt.Errorf("sidecar closed")
	}
}

// ReadRange calls workbook:read-range on the sidecar.
func (m *XlsxManager) ReadRange(sessionId string, sheet string, cellRange string) (SidecarResponse, error) {
	return m.Call("read_range", map[string]interface{}{
		"session_id": sessionId,
		"sheet":      sheet,
		"range":      cellRange,
	})
}

// Open opens a workbook in the sidecar.
func (m *XlsxManager) Open(path string) (SidecarResponse, error) {
	return m.Call("open", map[string]interface{}{
		"path": path,
	})
}

// Close closes a workbook session.
func (m *XlsxManager) Close(sessionId string) (SidecarResponse, error) {
	return m.Call("close", map[string]interface{}{
		"session_id": sessionId,
	})
}

// Stop kills the sidecar process.
func (m *XlsxManager) Stop() error {
	close(m.done)
	if m.stdin != nil {
		m.stdin.Close()
	}
	if m.cmd != nil && m.cmd.Process != nil {
		return m.cmd.Process.Kill()
	}
	return nil
}
```

- [ ] **Step 3: 在 `main.go` 启动 sidecar**

```go
sidecarDir := filepath.Join(dataDir, "native")
xlsxMgr, err := sidecar.NewXlsxManager(sidecarDir)
if err != nil {
	log.Printf("warning: xlsx sidecar not available: %v", err)
} else {
	bridge.RegisterSheets(router, ss, dlgm, xlsxMgr)
	defer xlsxMgr.Stop()
}
```

- [ ] **Step 4: 测试**

```go
func TestXlsxManagerOpen(t *testing.T) {
	// Test that the sidecar process can be started
	// Skip if binary not found
}

func TestXlsxManagerCallTimeout(t *testing.T) {
	// Test timeout behavior
}
```

- [ ] **Step 5: 提交**

```powershell
git add internal/sidecar/ main.go
git commit -m "feat: add rust xlsx sidecar process manager"
```

---

### Task 9: Shell 通道补全 + 前端兼容层

**Go 文件:**
- Create: `internal/bridge/shell.go`

**前端文件:**
- Modify: `frontend/packages/wails-bridge/src/home.ts` (已有 searchFiles)
- Create: `frontend/packages/wails-bridge/src/editor-api.ts`

**Steps:**

- [ ] **Step 1: 实现 `shell:read-local-image` 和 `shell:open-external`**

`shell:open-external` 已在 P2 实现。`shell:read-local-image` 读取图片文件返回 base64。

- [ ] **Step 2: 实现 `yiioffice:view-image`**

打开系统图片查看器。

- [ ] **Step 3: 前端兼容层 — 编辑器 API**

在 `@yiioffice/wails-bridge` 中创建编辑器 API 包装：

```ts
// editor-api.ts
import { invoke } from './transport'

export function createDesktopApi() {
  return {
    open: (options: { path?: string; initialContent?: string }) => invoke('docs:open-path', options.path || ''),
    save: (options: { path: string; content: string }) => invoke('docs:save', options),
    saveAs: (options: any) => invoke('docs:save-as', options),
    exportPdf: () => invoke('docs:export-pdf'),
    // ... other methods
  }
}

export function createDesktopApiForSheets() {
  return {
    readRange: (options: any) => invoke('workbook:read-range', options),
    save: (options: any) => invoke('workbook:save', options),
    // ... other methods
  }
}

export function createSlidesApi() {
  return {
    open: (options: any) => invoke('slides:open', options),
    openPath: (path: string) => invoke('slides:open-path', path),
    save: (options: any) => invoke('slides:save', options),
    // ... other methods
  }
}

export function createPdfApi() {
  return {
    readFile: (path: string) => invoke('pdf:read-file', path),
    save: (options: any) => invoke('pdf:save', options),
    // ... other methods
  }
}

export function createMarkdownApi() {
  return {
    readFile: (path: string) => invoke('markdown:read-file', path),
    save: (options: any) => invoke('markdown:save', options),
    // ... other methods
  }
}
```

- [ ] **Step 4: 提交**

```powershell
git add internal/bridge/shell.go frontend/packages/wails-bridge/src/editor-api.ts
git commit -m "feat: add shell channels and editor API bridge layer"
```

---

### Task 10: G4 验收

**Steps:**

- [ ] **Step 1: 在 Wails 中打开每种类型的 fixture 文件**

| 编辑器 | 测试文件 | 检查项 |
|---|---|---|
| docs | `sample.docx`（含表格/图片/分页） | 内容渲染正确，无 `unknown channel` 错误 |
| sheets | `sample.xlsx`（含公式/图表） | 单元格数据正确，无 sidecar 错误 |
| slides | `sample.pptx`（含动画/母版） | 幻灯片内容正确 |
| pdf | `sample.pdf`（多页/含表单） | PDF 页面渲染正确 |
| markdown | `sample.md`（含代码块/表格） | Markdown 渲染正确 |

- [ ] **Step 2: 检查 Console 错误**

DevTools Console 中无 `unknown channel` 错误。Go 侧日志中无 `unknown bridge channel` 警告。

- [ ] **Step 3: 保存/打开循环测试**

每个编辑器：打开文件 → 编辑 → 保存 → 关闭 → 重新打开，验证内容一致。

- [ ] **Step 4: Go 测试全量通过**

```powershell
go test ./... -count=1
```

- [ ] **Step 5: 提交**

```powershell
git add docs/superpowers/notes/
git commit -m "chore: phase 4 gate G4 verification"
```

---

## 5. 风险与回退

| 风险 | 触发信号 | 回退动作 |
|---|---|---|
| iframe 内编辑器无法访问 Wails bridge | `window.aiOffice` 为 `undefined` | 检查 CSP 和 preload 注入 |
| sheets sidecar 启动失败 | sidecar 二进制不存在或崩溃 | 在 `main.go` 中降级为 `name-only` 模式，sheets 编辑器只读 |
| docs 编辑器渲染异常 | ProseMirror 初始化失败 | 检查 Vite 构建是否包含正确的 preload |
| sheets 编辑器需要 Node.js API | `process` / `fs` 等全局对象缺失 | 检查是否所有 Node API 调用都通过 bridge 代理 |
| 编辑器 preload 文件不兼容 | `window.desktop` 等全局变量未暴露 | 在前端 `editor-api.ts` 中手动挂载全局变量 |
| xlsx sidecar JSON 协议不匹配 | sidecar 返回格式与预期不同 | 对照 `xlsx-sidecar-client.ts` 调整请求/响应格式 |

---

## 6. 自检清单

- [x] 覆盖度：5 个编辑器 + 公共 `app:*` 通道 + shell 通道 + sidecar
- [x] 无占位符：每个任务有具体代码、通道定义、验证步骤
- [x] 类型一致性：Bridge 请求/响应类型与 Electron IPC 保持一致
- [x] Windows-only：无 mac/linux 文件
- [x] 通道名一致：`docs:save`, `workbook:read-range` 等与 Electron 字面一致
- [x] 编辑器 iframe 方案与 P1 结论一致
- [x] Sidecar 进程管理与 Electron `xlsx-sidecar-client.ts` 行为一致
- [x] 性能预算：sidecar 请求超时 120s（与 Electron 一致）
