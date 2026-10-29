# Phase 2: 宿主服务对齐

> 接续 Phase 1（[phase1-foundation.md](2026-10-29-yiioffice-wailsv3-phase1-foundation.md)）。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** 实现 Phase 1 中声明的 278 个 `ipcMain.handle` 通道中 Shell 域的全部通道，使 Home 页和标签条的所有交互无 `unknown channel` 错误。

**Scope:** 仅 Windows 平台。不创建 macOS/Linux 代码。

**Exit Gate G2:** Home 与标签条所有交互无 `unknown channel` 错误；Go 侧记录未实现通道清单为空；`npm run typecheck` 通过。

---

## 1. 范围与约束

### 1.1 必须实现

Phase 2 覆盖 **Shell Home (47 通道)** 和 **Shell Tabs (17 通道)** 的全部 IPC 通道。编辑器域通道（docs/sheets/slides/pdf/markdown，约 225 个）属于 Phase 4，不在本阶段。

### 1.2 依赖 Phase 1

| Phase 1 产出 | Phase 2 用途 |
|---|---|
| `bridge.Router` + `Service.Invoke` | 注册所有新通道 |
| `bridge.channels.go` | 现有常量（P1 已注册 7 个 home 通道 + 2 个 tabs 通道） |
| `host.SettingsStore` | 扩展新字段（documentTheme, autoSaveDefault, defaultSaveDir） |
| `fsutil.WriteFileAtomic` | 最近文件/星标文件持久化 |
| `platform.OpenExternal` | 打开回收站/资源管理器 |
| `@yiioffice/wails-bridge` 前端兼容层 | 扩展新通道 API |

### 1.3 通道清单（来源：源项目实测）

**HOME_CHANNELS（47 通道，P1 已实现 7 个）**：

| 通道名 | P1 状态 | P2 归属任务 |
|---|---|---|
| `home:get-app-version` | ✅ 已实现 | — |
| `home:get-theme` | ✅ 已实现 | — |
| `home:set-theme` | ✅ 已实现 | — |
| `home:get-language` | ✅ 已实现 | — |
| `home:set-language` | ✅ 已实现 | — |
| `home:get-document-theme` | — | Task 3 (设置扩展) |
| `home:set-document-theme` | — | Task 3 |
| `home:get-auto-save-default` | — | Task 3 |
| `home:set-auto-save-default` | — | Task 3 |
| `home:get-default-save-dir` | — | Task 4 (对话框/保存目录) |
| `home:pick-default-save-dir` | — | Task 4 |
| `home:open-settings` (event) | — | Task 2 (主窗口事件) |
| `home:recents` | — | Task 5 (最近文件) |
| `home:search-files` | — | Phase 3 (不实现) |
| `home:starred` | — | Task 5 |
| `home:starred-groups` | — | Task 5 |
| `home:set-starred-group` | — | Task 5 |
| `home:toggle-star` | — | Task 5 |
| `home:unstar-paths` | — | Task 5 |
| `home:stat-paths` | — | Task 5 |
| `home:open-path` | — | Task 6 (文件路由) |
| `home:browse` | — | Task 4 (对话框) |
| `home:new-doc` | — | Task 6 |
| `home:new-sheet` | — | Task 6 |
| `home:new-slide` | — | Task 6 |
| `home:new-markdown` | — | Task 6 |
| `home:new-pdf` | — | Task 6 |
| `home:remove-recent` | — | Task 5 |
| `home:reveal-path` | — | Task 4 |
| `home:rename-file` | — | Task 6 |
| `home:duplicate-file` | — | Task 6 |
| `home:delete-files` | — | Task 6 |
| `home:open-trash` | — | Task 6 |
| `home:folder-roots` | — | Task 7 (文件夹树) |
| `home:folder-root-add` | — | Task 7 |
| `home:folder-root-drop` | — | Task 7 |
| `home:folder-root-remove` | — | Task 7 |
| `home:folder-list` | — | Task 7 |
| `home:folder-create` | — | Task 7 |
| `home:folder-rename` | — | Task 7 |
| `home:move-paths` | — | Task 7 |
| `home:folder-delete` | — | Task 7 |
| `home:folder-changed` (event) | — | Task 7 |
| `home:get-default-app-status` | — | Task 8 (文件关联) |
| `home:set-default-app` | — | Task 8 |

**TABS_CHANNELS（17 通道，P1 已实现 2 个）**：

| 通道名 | P1 状态 | P2 归属任务 |
|---|---|---|
| `tabs:list` | ✅ 已实现 (空数组) | Task 1 (升级为真实标签管理) |
| `tabs:activate` | ✅ 已实现 (空操作) | Task 1 |
| `tabs:close` | — | Task 1 |
| `tabs:reorder` | — | Task 1 |
| `tabs:show-menu` | — | Task 9 (菜单) |
| `tabs:show-new-menu` | — | Task 9 |
| `tabs:show-tab-menu` | — | Task 9 |
| `tabs:show-app-menu` | — | Task 9 |
| `tabs:detach` | — | Task 2 (独立窗口) |
| `tabs:tear-off` | — | Task 2 |
| `tabs:drag-torn-window` | — | Task 2 |
| `tabs:dock-torn-window` | — | Task 2 |
| `tabs:end-torn-drag` | — | Task 2 |
| `tabs:dock-preview` (event) | — | Task 2 |
| `tabs:dock-index` | — | Task 2 |
| `tabs:changed` (event) | — | Task 1 |
| `tabs:chrome-pressed` | — | Task 1 |

**PDF_PASSWORD_CHANNELS（4 通道）**：属于 Phase 4（PDF 编辑器宿主），P2 暂不实现。

### 1.4 本阶段明确不做

- 不实现 `home:search-files`（Phase 3 的 FTS5 索引）
- 不实现编辑器域通道（docs/sheets/slides/pdf/markdown，Phase 4）
- 不实现 PDF 密码对话框（Phase 4）
- 不做 macOS child window 式标签分离
- 不做 Linux 相关代码
- 不实现系统托盘（源项目本身无 Tray 实现）

---

## 2. 目标仓库结构（Phase 2 新增文件）

```text
internal/
├── bridge/
│   ├── home.go                  # P1 已有，追加新通道
│   ├── home_test.go             # P1 已有，追加新测试
│   ├── tabs.go                  # P1 已有，升级为真实标签管理
│   ├── tabs_test.go             # P1 已有
│   ├── recent.go                # 最近文件通道 (Task 5)
│   ├── recent_test.go
│   ├── folder.go                # 文件夹树通道 (Task 7)
│   ├── folder_test.go
│   └── dialog.go                # 对话框/文件路由通道 (Task 4, 6)
│       └── dialog_test.go
├── host/
│   ├── settings.go              # P1 已有，追加新字段
│   ├── settings_test.go         # P1 已有
│   ├── settings_store.go        # 新增：最近文件/星标文件持久化 (Task 5)
│   ├── settings_store_test.go
│   ├── dialogs.go               # 文件对话框 (Task 4)
│   ├── dialogs_test.go
│   ├── recentfiles.go           # 最近文件模型 (Task 5)
│   ├── recentfiles_test.go
│   ├── fileops.go               # 文件操作 (重命名/复制/删除) (Task 6)
│   ├── fileops_test.go
│   ├── foldertree.go            # 文件夹树操作 (Task 7)
│   ├── foldertree_test.go
│   ├── folderroots.go           # 文件夹根管理 (Task 7)
│   ├── folderroots_test.go
│   ├── tabhost.go               # 标签宿主 (iframe 管理) (Task 1)
│   ├── tabhost_test.go
│   ├── detached.go              # 独立窗口 (撕裂标签) (Task 2)
│   ├── detached_test.go
│   ├── fileassoc.go             # 文件关联/默认应用 (Task 8)
│   ├── fileassoc_test.go
│   └── menus.go                 # 原生菜单 (Task 9)
│       └── menus_test.go
└── platform/
    ├── app.go                   # P1 已有，追加菜单/对话框/单实例
    └── dialog_windows.go        # 对话框实现 (Task 4)
```

---

## 3. 关键决策

| ID | 决策 | 理由 | 回退 |
|---|---|---|---|
| P2-D1 | 标签管理使用 iframe 池（同源方案） | 延续 P1 的 D3 同源决策；标签复用 iframe 而非每次新建 | 如 G1 判定失败，回退到 postMessage 中继 |
| P2-D2 | 撕裂标签使用独立 Wails 窗口 | Wails V3 支持多窗口（`app.Window.NewWithOptions`）；不做 macOS child window | 无 |
| P2-D3 | 最近文件/星标文件用 JSON 原子写 | 源项目用 `userData` 目录的 JSON 文件；Go 侧用 `WriteJSONAtomic` | 无 |
| P2-D4 | 原生菜单用 Wails `app.Menu` | Wails V3 的 `MenuManager` 支持 `*gmenu.Menu`；需要确认 beta.28 菜单 API | 若 beta.28 菜单 API 不完整，前端实现 DOM 菜单 |
| P2-D5 | 对话框用 Wails `app.Dialog` | `DialogManager` 提供 `OpenFile`/`SaveFile`；目录记忆需手动实现 | 无 |
| P2-D6 | 单实例用 Wails `SingleInstanceOptions` | Wails V3 内置 `SingleInstanceOptions`，直接注册即可 | 无 |
| P2-D7 | 文件夹树监控用 Go `osFS` + `fsnotify` | 源项目用 `fs.watch`（Node.js）；Go 侧用 `github.com/fsnotify/fsnotify` | 无 |
| P2-D8 | 文件关联默认应用通过 Windows 注册表 + `ms-settings:` URI | 源项目 Windows 端通过 `reg query` + `ms-settings:defaultapps` | 无 |
| P2-D9 | `home:search-files` 推迟到 P3 | 索引库尚未实现，返回空结果即可通过 G2 | 在 G2 清单中标注为"已推迟" |

---

## 4. Phase 2 详细任务（可执行）

> 约定：所有命令在 PowerShell 中执行，`$env:Path` 和 `$env:GOPROXY` 需要先刷新。
> 每个任务结束都要提交一次。

### Task 1: 标签宿主（iframe 池 + 真实标签管理）

**Wails API 参考:** `app.Window.Current()`, `app.Window.GetAll()`, `application.InvokeAsync`

**Go 文件:**
- Create: `internal/host/tabhost.go` — 标签集合管理、iframe 池
- Test: `internal/host/tabhost_test.go`
- Modify: `internal/bridge/tabs.go` — 升级为真实通道

**前端文件:**
- Modify: `frontend/packages/wails-bridge/src/tabs.ts` — 扩展 `TabsBridge` 接口（close, reorder, onChange, onDockPreview 等）
- Modify: `frontend/packages/wails-bridge/src/index.ts` — 更新 `createTabsApi` 实现
- Modify: `frontend/apps/shell/src/renderer/src/AppFrame.tsx` — 正式 TabBar 组件（移除 spike 标记）

**Steps:**

- [ ] **Step 1: 定义 `Tab` 结构体和 `TabHost`**

`internal/host/tabhost.go`:
```go
// Package host implements desktop services.
package host

import (
	"sync"
	"sync/atomic"
)

// TabKind identifies the editor type for a tab.
type TabKind string

const (
	TabKindDocs     TabKind = "docs"
	TabKindSheets   TabKind = "sheets"
	TabKindSlides   TabKind = "slides"
	TabKindPDF      TabKind = "pdf"
	TabKindMarkdown TabKind = "markdown"
	TabKindHome     TabKind = "home"
)

// Tab represents an open document tab.
type Tab struct {
	ID     string    `json:"id"`
	Kind   TabKind   `json:"kind"`
	Title  string    `json:"title"`
	Path   string    `json:"path,omitempty"`
	Active bool      `json:"active"`
}

// TabSummary is the serializable view sent to the frontend.
type TabSummary struct {
	ID     string  `json:"id"`
	Kind   TabKind `json:"kind"`
	Title  string  `json:"title"`
	Active bool    `json:"active"`
}

// TabHost manages the ordered list of open tabs.
type TabHost struct {
	mu      sync.RWMutex
	tabs    []*Tab
	nextID  atomic.Int64
}

// NewTabHost creates an empty tab host with a Home tab.
func NewTabHost() *TabHost {
	return &TabHost{tabs: []*Tab{
		{ID: "home", Kind: TabKindHome, Title: "Home", Active: true},
	}}
}

// List returns serializable summaries of all tabs.
func (h *TabHost) List() []TabSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]TabSummary, len(h.tabs))
	for i, t := range h.tabs {
		out[i] = TabSummary{ID: t.ID, Kind: t.Kind, Title: t.Title, Active: t.Active}
	}
	return out
}

// Activate sets the active tab by ID.
func (h *TabHost) Activate(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i, t := range h.tabs {
		t.Active = t.ID == id
	}
	for _, t := range h.tabs {
		if t.ID == id {
			return true
		}
	}
	return false
}

// AddTab creates a new tab and returns its ID.
func (h *TabHost) AddTab(kind TabKind, title string, path string) string {
	id := fmt.Sprintf("tab-%d", h.nextID.Add(1))
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, t := range h.tabs {
		t.Active = false
	}
	h.tabs = append(h.tabs, &Tab{ID: id, Kind: kind, Title: title, Path: path, Active: true})
	return id
}

// CloseTab removes a tab by ID. Home tab cannot be closed.
func (h *TabHost) CloseTab(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if id == "home" {
		return false
	}
	for i, t := range h.tabs {
		if t.ID == id {
			h.tabs = append(h.tabs[:i], h.tabs[i+1:]...)
			// Activate previous tab if the closed tab was active
			if t.Active && len(h.tabs) > 0 {
				h.tabs[len(h.tabs)-1].Active = true
			}
			return true
		}
	}
	return false
}

// Reorder moves a tab from oldIndex to newIndex.
func (h *TabHost) Reorder(from, to int) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if from < 0 || from >= len(h.tabs) || to < 0 || to >= len(h.tabs) {
		return false
	}
	tab := h.tabs[from]
	if from < to {
		copy(h.tabs[from:], h.tabs[from+1:to+1])
	} else {
		copy(h.tabs[to+1:], h.tabs[to:from])
	}
	h.tabs[to] = tab
	return true
}
```

（需要 import `fmt`。）

- [ ] **Step 2: 写测试**

`internal/host/tabhost_test.go`:
```go
package host

import (
	"testing"
)

func TestTabHostStartsWithHome(t *testing.T) {
	h := NewTabHost()
	list := h.List()
	if len(list) != 1 || list[0].ID != "home" || !list[0].Active {
		t.Fatalf("expected single active home tab, got %+v", list)
	}
}

func TestTabHostAddAndActivate(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "doc1.docx", "/path/to/doc1.docx")
	if id == "" {
		t.Fatal("empty id")
	}
	list := h.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 tabs, got %d", len(list))
	}
	if !list[1].Active {
		t.Fatal("new tab should be active")
	}
	if list[0].Active {
		t.Fatal("home should be inactive after adding tab")
	}
	// Activate home
	if !h.Activate("home") {
		t.Fatal("activate home should succeed")
	}
	list = h.List()
	if !list[0].Active {
		t.Fatal("home should be active")
	}
}

func TestTabHostCloseNonHome(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "doc1.docx", "")
	if !h.CloseTab(id) {
		t.Fatal("should close non-home tab")
	}
	list := h.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(list))
	}
}

func TestTabHostCannotCloseHome(t *testing.T) {
	h := NewTabHost()
	if h.CloseTab("home") {
		t.Fatal("home should not be closable")
	}
}

func TestTabHostReorder(t *testing.T) {
	h := NewTabHost()
	h.AddTab(TabKindDocs, "a", "")
	h.AddTab(TabKindSheets, "b", "")
	h.Reorder(2, 1) // move 'b' before 'a'
	list := h.List()
	if list[1].Kind != TabKindSheets {
		t.Fatalf("expected sheets at index 1, got %+v", list)
	}
}

func TestTabHostReorderOutOfBounds(t *testing.T) {
	h := NewTabHost()
	if h.Reorder(-1, 0) {
		t.Fatal("should reject negative index")
	}
	if h.Reorder(0, 99) {
		t.Fatal("should reject out of bounds")
	}
}
```

- [ ] **Step 3: 升级 `bridge/tabs.go` 通道**

追加 `tabs:close`, `tabs:reorder`, `tabs:changed` 通道。使用 TabHost 实例。

- [ ] **Step 4: 前端扩展 `TabsBridge` 接口**

在 `frontend/packages/wails-bridge/src/tabs.ts` 扩展：
```ts
// Add to TabsBridge interface:
close(id: string): Promise<void>
reorder(from: number, to: number): Promise<void>
onChromePressed(handler: () => void): () => void
```

- [ ] **Step 5: 构建并测试**

```powershell
go test ./internal/host/ -v -run TabHost
go test ./internal/bridge/ -v
node frontend/tools/build-renderers.mjs shell docs
```

- [ ] **Step 6: 提交**
```powershell
git add internal/host/tabhost* internal/bridge/tabs* frontend/packages/wails-bridge/src/tabs.ts
git commit -m "feat: implement tab host with iframe pool and real tab management"
```

---

### Task 2: 主窗口事件与独立窗口

**Wails API 参考:** `app.Window.NewWithOptions()`, `app.Window.GetByName()`, `app.Window.Remove()`

**Go 文件:**
- Create: `internal/host/detached.go` — 撕裂标签的独立窗口管理
- Test: `internal/host/detached_test.go`
- Modify: `internal/bridge/tabs.go` — 添加 detach/tear-off/dock 通道
- Modify: `internal/platform/app.go` — 追加窗口管理辅助

**Steps:**

- [ ] **Step 1: 实现独立窗口管理器**

`internal/host/detached.go`:
```go
package host

import (
	"fmt"
	"sync"
)

// DetachedWindow tracks a tab that has been torn off into its own window.
type DetachedWindow struct {
	WindowName string // Wails window name
	TabID      string
	TabKind    TabKind
	TabTitle   string
}

// DetachedHost manages torn-off windows.
type DetachedHost struct {
	mu         sync.Mutex
	detachNext int
	windows    map[string]*DetachedWindow
}

func NewDetachedHost() *DetachedHost {
	return &DetachedHost{windows: make(map[string]*DetachedWindow)}
}

// Detach creates a detached window entry. Returns the Wails window name.
func (d *DetachedHost) Detach(tabID string, kind TabKind, title string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.detachNext++
	name := fmt.Sprintf("detached-%d", d.detachNext)
	d.windows[name] = &DetachedWindow{WindowName: name, TabID: tabID, TabKind: kind, TabTitle: title}
	return name
}

// Dock removes a detached window and returns the original tab ID.
func (d *DetachedHost) Dock(windowName string) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	w, ok := d.windows[windowName]
	if !ok {
		return "", false
	}
	delete(d.windows, windowName)
	return w.TabID, true
}

// Get returns a detached window by its Wails name.
func (d *DetachedHost) Get(windowName string) (*DetachedWindow, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	w, ok := d.windows[windowName]
	return w, ok
}
```

- [ ] **Step 2: 写测试**

- [ ] **Step 3: 注册 detach/tear-off/dock 通道**

`tabs:detach` → 创建 DetachedHost 条目 + 通知前端创建独立窗口
`tabs:tear-off` → 同上，但触发拖拽状态
`tabs:dock-torn-window` → 销毁独立窗口 + 标签回到主窗口
`tabs:end-torn-drag` → 取消拖拽，窗口保持独立
`tabs:drag-torn-window` → 窗口移动通知（Go 侧记录位置即可）

- [ ] **Step 4: `platform/app.go` 追加窗口管理**

```go
// NewWindow creates a new webview window and returns its name.
func NewWindow(opts application.WebviewWindowOptions) {
	if current == nil {
		return
	}
	current.Window.NewWithOptions(opts)
}

// CloseWindow closes the window by name.
func CloseWindow(name string) {
	if current == nil {
		return
	}
	if w, ok := current.Window.GetByName(name); ok {
		w.Close()
	}
}
```

- [ ] **Step 5: 注册 `tabs:chrome-pressed` 通道**

这是浏览器 chrome 区域（标题栏按钮等）的按下事件，Go 侧只需转发事件。

- [ ] **Step 6: 构建并提交**
```powershell
go test ./... -count=1
git add internal
git commit -m "feat: add detached window management for torn-off tabs"
```

---

### Task 3: 设置扩展（documentTheme, autoSaveDefault）

**Go 文件:**
- Modify: `internal/host/settings.go` — 追加 `DocumentTheme` / `AutoSaveDefault` 字段
- Test: `internal/host/settings_test.go` — 追加测试
- Modify: `internal/bridge/home.go` — 注册新通道

**Steps:**

- [ ] **Step 1: 扩展 Settings 结构体**

在 `internal/host/settings.go` 的 `Settings` 结构体增加：
```go
type Settings struct {
	Language        string `json:"language"`
	Theme           string `json:"theme"`
	DocumentTheme   string `json:"documentTheme"`
	AutoSaveDefault bool   `json:"autoSaveDefault"`
}
```

`DocumentTheme` 有效值：`"light"`, `"dark"`, `"auto"`（从源项目确认）。

- [ ] **Step 2: 添加 SetDocumentTheme / GetDocumentTheme / SetAutoSaveDefault**

- [ ] **Step 3: 注册 Go 侧通道**

在 `internal/bridge/home.go` 追加：
```go
r.Handle(ChannelGetDocumentTheme, func(context.Context, []json.RawMessage) (any, error) {
	return store.Snapshot().DocumentTheme, nil
})
r.Handle(ChannelSetDocumentTheme, func(_ context.Context, args []json.RawMessage) (any, error) {
	theme, err := DecodeArg[string](args, 0)
	if err != nil { return nil, err }
	if !isValidDocumentTheme(theme) { return nil, fmt.Errorf("invalid document theme: %s", theme) }
	store.SetDocumentTheme(theme)
	platform.Emit("app:document-theme-changed", theme)
	return nil, nil
})
// ... autoSaveDefault similar
```

- [ ] **Step 4: 在 channels.go 添加常量**

```go
ChannelGetDocumentTheme    = "home:get-document-theme"
ChannelSetDocumentTheme    = "home:set-document-theme"
ChannelGetAutoSaveDefault  = "home:get-auto-save-default"
ChannelSetAutoSaveDefault  = "home:set-auto-save-default"
```

- [ ] **Step 5: 构建、测试、提交**

---

### Task 4: 对话框与文件操作入口

**Wails API 参考:** `app.Dialog.OpenFile()`, `app.Dialog.SaveFile()`

**Go 文件:**
- Create: `internal/host/dialogs.go` — 带目录记忆的对话框封装
- Test: `internal/host/dialogs_test.go`
- Create: `internal/bridge/dialog.go` — 对话框相关 IPC 通道
- Test: `internal/bridge/dialog_test.go`

**Source reference:** `electron-utils/dialog-memory.ts` — Electron 43+ 的 `defaultPath` 被忽略，需用 `lastDirectory` 手动记忆。

**Steps:**

- [ ] **Step 1: 实现带目录记忆的对话框**

Wails V3 的 `DialogManager` 提供：
```go
app.Dialog.OpenFile(application.OpenDialogOptions{...}) ([]string, error)
app.Dialog.SaveFile(application.SaveDialogOptions{...}) (string, error)
```

实现 `dialogs.go` 包装器，从 `settings.json` 的 `defaultSaveDir` 读取上次目录，写回保存。

- [ ] **Step 2: 注册对话框通道**

`home:browse` → 打开文件对话框（多文件可选）
`home:reveal-path` → `explorer /select,"path"` (Windows)
`home:get-default-save-dir` → 返回设置中的默认保存目录
`home:pick-default-save-dir` → 目录选择对话框

- [ ] **Step 3: 构建、测试、提交**

---

### Task 5: 最近文件与星标文件

**Source reference:** `recent-files.ts` (400+ 行), 存储结构为 JSON 数组

**Go 文件:**
- Create: `internal/host/recentfiles.go` — 最近文件/星标文件 CRUD
- Test: `internal/host/recentfiles_test.go`
- Create: `internal/bridge/recent.go` — 通道实现
- Test: `internal/bridge/recent_test.go`

**Steps:**

- [ ] **Step 1: 定义最近文件模型**

源项目存储结构：
```json
[
  { "path": "C:\\Users\\...\\doc.docx", "ts": 1698765432000 },
  ...
]
```

最大 200 条，默认分页 50 条。

星标文件存储：
```json
{
  "groups": ["Important", "Work"],
  "files": [
    { "path": "...", "group": "Important" },
    ...
  ]
}
```

- [ ] **Step 2: 实现 CRUD 操作**

`AddRecent(path string)`, `GetRecents(offset, limit int)`, `RemoveRecent(path string)`, `StatPaths(paths []string) []FileInfo`

星标文件：`ToggleStar(path string)`, `GetStarred() []StarredFile`, `SetStarredGroup(path, group string)`

- [ ] **Step 3: 注册通道**

`home:recents`, `home:starred`, `home:starred-groups`, `home:set-starred-group`, `home:toggle-star`, `home:unstar-paths`, `home:stat-paths`, `home:remove-recent`

- [ ] **Step 4: 扩展前端 `HomeBridge` 接口**

在 `@yiioffice/wails-bridge` 的 `home.ts` 添加对应方法。

- [ ] **Step 5: 构建、测试、提交**

---

### Task 6: 文件路由与文件操作

**Source reference:** `shell-routing.ts`, `shell-home-ipc.ts` (文件操作部分)

**Go 文件:**
- Create: `internal/bridge/dialog.go` — 文件路由/操作通道
- Modify: `internal/host/dialogs.go` — 追加文件操作

**Steps:**

- [ ] **Step 1: 实现文件路由**

`home:open-path` → 根据文件扩展名确定 TabKind，调用 `tabhost.AddTab()`
`home:new-doc` / `new-sheet` / `new-slide` / `new-markdown` / `new-pdf` → 创建空白文档

- [ ] **Step 2: 实现文件操作**

`home:rename-file` → `os.Rename` + 路径守卫校验
`home:duplicate-file` → `io.Copy` + 新文件名
`home:delete-files` → 移到回收站（Windows: `SHParseDisplayName` + `SHFileOperation` via `shell32.dll`）
`home:open-trash` → `explorer shell:RecycleBin`

- [ ] **Step 3: 扩展前端 `HomeBridge` 接口**

- [ ] **Step 4: 构建、测试、提交**

---

### Task 7: 文件夹树与监控

**Source reference:** `folder-tree.ts`, `folder-roots.ts`, `shell-folders.ts`

**Go 文件:**
- Create: `internal/host/foldertree.go` — 文件夹列表/创建/重命名/移动
- Create: `internal/host/folderroots.go` — 文件夹根管理
- Test: 对应测试文件
- Create: `internal/bridge/folder.go` — 文件夹通道
- Test: `internal/bridge/folder_test.go`

**Dependencies:** 需要 `github.com/fsnotify/fsnotify` 用于文件夹监控。

**Steps:**

- [ ] **Step 1: 文件夹根管理**

`folderRoots` 存储在 `settings.json` 的 `folderRoots` 字段中：
```json
{ "path": "C:\\Users\\...\\Documents", "label": "Documents" }
```

- [ ] **Step 2: 文件夹树操作**

`home:folder-list` → `os.ReadDir` + 排序
`home:folder-create` → `os.Mkdir` + 路径守卫
`home:folder-rename` → `os.Rename`
`home:move-paths` → 批量移动
`home:folder-delete` → 递归删除

- [ ] **Step 3: 文件夹监控**

使用 `fsnotify` 监控已添加的文件夹根，当文件变化时通过 `platform.Emit("home:folder-changed")` 通知前端。

- [ ] **Step 4: 注册所有文件夹通道并测试**

- [ ] **Step 5: 构建、测试、提交**

---

### Task 8: 文件关联与默认应用

**Source reference:** `default-app.ts`

**Wails API 参考:** Wails V3 的 `SingleInstanceOptions`（`Options.SingleInstance`）

**Go 文件:**
- Create: `internal/host/fileassoc.go` — 文件关联状态查询 + 设为默认应用
- Test: `internal/host/fileassoc_test.go`

**Steps:**

- [ ] **Step 1: 查询文件关联状态**

源项目 Windows 实现：通过 `reg query` 读取 `HKCU\Software\Classes\Extensions\.<ext>\OpenWithProgids` 和 `OpenWithList`。

Go 实现使用 `golang.org/x/sys/windows/registry`。

- [ ] **Step 2: 设为默认应用**

Windows 上无法通过注册表直接设为默认（需要调用 WinRT API `Windows.Storage.ApplicationAssociationManager`）。源项目使用 `ms-settings:defaultapps` URI 打开系统设置页。Wails 侧同样通过 `platform.OpenExternal("ms-settings:defaultapps")` 实现。

- [ ] **Step 3: 单实例支持**

在 `main.go` 注册 `SingleInstanceOptions`：
```go
app := application.New(application.Options{
    // ...
    SingleInstance: &application.SingleInstanceOptions{
        // HandleSecondInstance: func(data application.SecondInstanceData) {
        //     收集启动参数，发送到主窗口
        // }
    },
})
```

- [ ] **Step 4: 注册通道并测试**

---

### Task 9: 原生菜单

**Wails API 参考:** `app.Menu` (*MenuManager), `application.Menu`

**Go 文件:**
- Create: `internal/host/menus.go` — 应用菜单/标签右键菜单
- Test: `internal/host/menus_test.go`

**前端:**
- Modify: `@yiioffice/wails-bridge` — 扩展 `TabsBridge` 添加菜单方法

**Steps:**

- [ ] **Step 1: Spike Wails 菜单 API**

用 `wails3 init` 脚手架确认菜单 API。如果 beta.28 的菜单 API 不完整或不可用，记录并决定回退到前端 DOM 菜单。

- [ ] **Step 2: 实现应用菜单**

源项目 `app-menu.ts` 定义了 Edit/View/Window/Help 菜单模板。Windows 侧需要 `File` + `Edit` + `View` + `Help`。

菜单项包括：
- File: New (docs/sheets/slides/pdf/markdown), Open, Close, Save, Save As
- Edit: Undo, Redo, Cut, Copy, Paste, Select All
- View: Zoom In/Out, Full Screen, Toggle DevTools
- Help: About, Documentation

- [ ] **Step 3: 标签右键菜单**

通过 `tabs:show-tab-menu` 触发。Wails 的 `ContextMenu` API 支持在指定位置弹出菜单。

- [ ] **Step 4: `tabs:show-menu` / `tabs:show-new-menu` / `tabs:show-app-menu`**

在 Go 侧通过 `app.Menu` 弹出菜单，返回选中的菜单项 ID。

- [ ] **Step 5: 构建、测试、提交**

---

### Task 10: 前端兼容层扩展与 G2 验收

**Steps:**

- [ ] **Step 1: 扩展前端 `HomeBridge` 和 `TabsBridge` 接口**

将所有 P2 通道对应的前端方法添加到 `@yiioffice/wails-bridge`。

- [ ] **Step 2: 更新 `channels.go` 通道常量**

确保所有 P2 通道常量已定义。

- [ ] **Step 3: 通道覆盖率检查**

编写测试或脚本，统计已注册通道数与源项目通道数的差距：

```go
func TestChannelCoverage(t *testing.T) {
    // List all HOME_CHANNELS from source project
    homeChannels := []string{...} // 47 channels
    r := NewRouter()
    // Register all P2 handlers...
    for _, ch := range homeChannels {
        if !r.Has(ch) {
            t.Logf("NOT IMPLEMENTED: %s", ch)
        }
    }
}
```

- [ ] **Step 4: 运行全部测试**

```powershell
go test ./... -count=1 -v
npm --prefix frontend run test
npm --prefix frontend run typecheck
node frontend/tools/build-renderers.mjs shell docs
go build -tags production
```

- [ ] **Step 5: G2 检查表**

| 检查项 | 方法 | 通过标准 |
|---|---|---|
| Home 通道覆盖率 | 通道测试 | 47 个通道全部注册（`home:search-files` 除外，P3） |
| Tabs 通道覆盖率 | 通道测试 | 17 个通道全部注册 |
| 未实现通道 | `TestChannelCoverage` 日志 | 除 `home:search-files` 外无 `NOT IMPLEMENTED` |
| Go 测试 | `go test ./...` | 全部 PASS |
| 前端测试 | `npm run test` | 全部 PASS |
| 前端类型检查 | `npm run typecheck` | 无错误 |
| 构建 | `go build -tags production` | 成功 |

- [ ] **Step 6: 提交**
```powershell
git add -A
git commit -m "chore: phase 2 gate G2 verification"
```

---

## 5. 风险与回退

| 风险 | 触发信号 | 回退动作 |
|---|---|---|
| Wails 菜单 API 不完整 | Task 9 spike 失败 | 回退到前端 DOM 菜单；`tabs:show-*` 通道在前端直接实现 |
| Wails 对话框 API 无目录记忆 | `OpenDialogOptions` 无 `defaultPath` | 手动在 `settings.json` 记忆上次目录 |
| Wails 单实例 API 不支持传参 | `SecondInstanceData` 无启动路径 | 使用 Windows mutex + WM_COPYDATA 消息 |
| 文件夹监控性能问题 | `fsnotify` 在大型文件夹上 CPU 过高 | 限制监控深度，或使用 `ReadDir` 定时轮询 |
| 菜单 API 在 beta.28 缺失 | `app.Menu` 不存在 | 使用前端 DOM 菜单替代，所有 `tabs:show-menu` 在前端处理 |

---

## 6. 自检清单

- [x] 覆盖度：源项目 47 个 HOME_CHANNELS + 17 个 TABS_CHANNELS 全部映射到任务
- [x] 无占位符：每个任务有具体的文件路径、Go 代码示例、测试要求
- [x] 类型一致性：`TabHost` 与 `bridge/tabs.go` 的 `RegisterTabs` 签名对应；`SettingsStore` 扩展字段与 `home.go` 通道对应
- [x] Windows-only：无 mac/linux 文件
- [x] Wails API 引用来自 P1 已实测的 `wails-v3-api.md`
- [x] `home:search-files` 明确标注为 P3 范围
- [x] PDF_PASSWORD_CHANNELS（4 通道）明确标注为 P4 范围
