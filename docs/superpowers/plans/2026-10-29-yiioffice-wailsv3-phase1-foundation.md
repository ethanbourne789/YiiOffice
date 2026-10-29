# YiiOffice Windows（Go + Wails V3）复刻开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `E:\Dev\YiiOffice-WailsV3` 用 Go + Wails V3 重建 YiiOffice 的桌面外壳，复用 `E:\Dev\YiiOffice-Electron` 的 React 渲染层与其 13 个共享包，目标平台仅 Windows。

**Architecture:** Go 进程取代 Electron 主进程（窗口、标签、对话框、菜单、托盘、文件关联、单实例、协议与静态资源、路径授权、原子写、文件索引）。渲染层通过一个 `window.aiOffice / aiOfficeTabs / slidesApi / desktop / desktopApi / pdfApi / markdownApi` 兼容层（`@yiioffice/wails-bridge`）接回 Go，通道名与 Electron `ipcMain.handle` 一一对应，尽量零改动复用约 10 万行 renderer 代码。标签宿主优先采用同源 iframe（保留编辑器 DOM 与状态），必要时回退到 postMessage 中继或 SPA keep-alive。

**Tech Stack:** Go 1.24、Wails V3 `v3.0.0-beta.28`、WebView2（Evergreen）、React 19 + Vite 8 + TypeScript、Vitest、SQLite FTS5（Go 侧）、Rust `calamine`/`IronCalc` sidecar（沿用）。

---

## 1. 范围与硬约束

### 1.1 必须遵守

| 约束 | 说明 |
| --- | --- |
| 仅 Windows | 目标 Windows 10 1809+ / Windows 11，x64 为主；不产出 macOS / Linux 构建目标 |
| 不写 mac/linux 代码 | 不创建 `platform_darwin.go` / `platform_linux.go`，不写 `darwin` / `linux` 构建标签，Taskfile/CI 只含 `windows` 目标 |
| 渲染层复用优先 | 不改动编辑器业务逻辑；如必须改，只允许改「入口引导」「构建配置」「IPC 调用适配」三类文件 |
| 不引入商业许可依赖 | 不使用 UniOffice / UniPDF 等需要 License Server 校验的库 |
| 本地优先 | 所有文件处理在本地完成，不引入云服务 |
| 注释语言 | 源码注释英文，遵循源仓库 `check:english-comments` 约定 |

### 1.2 明确不做

- 不做 macOS 的 `child window` 式标签分离（Wails V3 的 modal child window 仅 macOS 可用）
- 不做 Linux 打包、桌面文件（`.desktop`）、AppImage
- 不在第一阶段重写 5 个编辑器内核（Tiptap / Univer / Konva / pdf.js / CodeMirror）
- 不在第一阶段实现 `printToPDF` 替代（见 Phase 5 决策门）

### 1.3 规模基线（来自可行性评估）

| 项目 | 规模 |
| --- | --- |
| Electron 主进程 | 43 文件 / 7,054 行（Go 重写对象） |
| preload | 2 文件 / 330 行（由兼容层替代） |
| renderer | 191 个 tsx / 约 101,000 行（原样复用） |
| 共享包 | 336 文件 / 125,511 行（13 个包） |
| IPC 通道 | 278 个 `ipcMain.handle` |
| 全局桥 | `aiOffice`(61) / `slidesApi`(41) / `aiOfficeTabs`(21) / `desktop`(12) |

---

## 2. 总体路线图

每个阶段产出一个可运行、可测试的软件增量，且各自有独立计划文件。**本文件只包含 Phase 1 的逐步可执行任务**；Phase 2–7 在执行到该阶段时再展开为同类计划文件（结构见 §6）。

| 阶段 | 主题 | 交付物（可验证） | 计划文件 |
| --- | --- | --- | --- |
| **P1** | 基础框架 | Windows 可运行外壳：WebView2 窗口 + 静态资源服务 + 通用 IPC 路由 + 兼容层 + Home 首页可用 + iframe 标签宿主结论 | 本文件 |
| P2 | 宿主服务对齐 | 278 通道中的 shell 域通道全通：标签条、菜单、托盘、对话框、最近文件、设置、单实例、文件关联、拖放 | `2026-11-XX-...phase2-host-services.md` |
| P3 | 文件系统与索引 | 原子写、路径授权、文件夹树、FTS5 中文分词索引（Go 实现）与搜索 | `2026-11-XX-...phase3-fs-index.md` |
| P4 | 编辑器宿主 | 5 个编辑器在标签内可用；`slidesApi` / `desktop` / `desktopApi` / `pdfApi` / `markdownApi` 桥接；Rust xlsx sidecar 接入 | `2026-XX-XX-...phase4-editors.md` |
| P5 | 导出与无头 | PDF 导出替代方案落地；`--headless-export` CLI 对齐 | `2026-XX-XX-...phase5-export.md` |
| P6 | 打包与更新 | MSIX/NSIS 安装包、自动更新、文件关联注册、代码签名 | `2026-XX-XX-...phase6-packaging.md` |
| P7 | 加固与验收 | 性能预算、E2E 对照、崩溃恢复、灰度 | `2026-XX-XX-...phase7-hardening.md` |

### 阶段门（Gate）

- **G1（P1 出口）**：`go test ./...` 全绿；`npm run test` 全绿；`wails3 build` 产出 exe；冷启动 < 2.5s；Home 页显示版本号/主题切换生效；docs 编辑器能在 iframe 标签内打开且能读到桥。
- **G2**：Home 与标签条所有交互无 `unknown channel` 错误（Go 侧记录未实现通道清单为空）。
- **G3**：搜索 1 万份文档的 P95 < 150ms；索引库与 Electron 版本可互换读取（同一 schema）。
- **G4**：5 个编辑器打开同一批 fixtures 的渲染差异为 0（像素对比基线）。
- **G5**：`--headless-export docx→pdf` 输出与 Electron 版本页面尺寸/分页一致。
- **G6**：安装包在干净 Windows 11 虚拟机上安装即用，WebView2 缺失时引导安装。

---

## 3. 目标仓库结构（Phase 1 结束后）

```text
E:\Dev\YiiOffice-WailsV3\
├── go.mod                                  # module gitee.com/ethanbourne789/yiioffice
├── main.go                                 # Wails V3 入口（windows only）
├── Taskfile.yml                            # 构建/测试/打包任务
├── .gitignore
├── docs/
│   └── superpowers/
│       ├── plans/2026-10-29-...phase1-foundation.md
│       └── notes/wails-v3-api.md           # beta API 实测记录（任务 2 产出）
├── internal/
│   ├── platform/
│   │   ├── app.go                          # Wails API 适配（唯一直接依赖 application 包的文件）
│   │   └── guard_windows.go                # 绑定 windows 构建标签 + GOOS 运行时断言
│   ├── buildinfo/buildinfo.go              # 版本号，ldflags 注入
│   ├── assets/
│   │   ├── server.go                       # 静态资源路由 + CSP + 目录穿越防护
│   │   └── server_test.go
│   ├── bridge/
│   │   ├── router.go                       # 通用通道注册/分发
│   │   ├── router_test.go
│   │   ├── service.go                      # 暴露给 Wails 的 Service.Invoke
│   │   ├── service_test.go
│   │   ├── channels.go                     # 通道名常量（与 Electron 共享常量一致）
│   │   ├── home.go                         # home:* 首批通道
│   │   ├── home_test.go
│   │   ├── tabs.go                         # tabs:list / tabs:activate（其余 P2）
│   │   ├── tabs_test.go
│   │   ├── openexternal.go                 # 外链白名单
│   │   └── openexternal_test.go
│   ├── fsutil/
│   │   ├── atomicwrite.go
│   │   ├── atomicwrite_test.go
│   │   ├── pathguard_windows.go
│   │   └── pathguard_test.go
│   └── host/
│       ├── dirs_windows.go                 # %APPDATA%\YiiOffice
│       ├── settings.go                     # 设置持久化（原子写）
│       └── settings_test.go
└── frontend/
    ├── package.json                        # npm workspaces: apps/*, packages/*
    ├── tsconfig.base.json
    ├── vite.shared.ts                      # 共享构建配置（base:'./'、outDir）
    ├── apps/
    │   ├── shell/
    │   │   ├── package.json
    │   │   ├── vite.config.ts
    │   │   ├── tsconfig.json
    │   │   └── src/{renderer,shared}/...   # 从 Electron 仓库复制
    │   └── docs/
    │       ├── package.json
    │       ├── vite.config.ts
    │       ├── tsconfig.json
    │       └── src/{renderer,shared}/...
    ├── packages/
    │   ├── wails-bridge/                   # 新增：preload 兼容层
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   │   ├── vitest.config.ts
    │   │   └── src/{index.ts,transport.ts,home.ts,tabs.ts,types.ts,index.test.ts}
    │   └── ...                             # 从 Electron 仓库复制其余共享包
    └── dist/                               # Vite 输出（gitignore，go:embed 输入）
        ├── shell/
        └── docs/
```

**职责边界**

- `internal/platform` 是唯一 import `github.com/wailsapp/wails/v3/pkg/application` 的包；beta 升级只改这一个文件。
- `internal/bridge` 只做参数解码、校验、调用下层服务，不直接 `os` 操作。
- `internal/fsutil` / `internal/host` 不感知 Wails。
- `frontend/packages/wails-bridge` 是唯一知道「通道 → Go」映射的前端代码，编辑器只看 `window.aiOffice` 等全局对象。

---

## 4. 关键决策

| ID | 决策 | 理由 | 回退 |
| --- | --- | --- | --- |
| D1 | 单入口通用路由器 `Service.Invoke(channel, args)` | 278 个通道若逐个生成绑定会产生 278 个 JS 模块与巨大绑定代码；单路由器 1 个绑定即可，且通道名与 Electron 常量表完全一致 | 热路径通道（如搜索翻页）后续可单独生成强类型绑定 |
| D2 | 兼容层以 npm 包形式被 6 个 renderer 入口 import | 不依赖 preload 注入时机；Vite 打包进每个应用，顺序可控 | 若 iframe 内 `window.top.wails` 不可达，改用 postMessage 中继（任务 9 门） |
| D3 | 所有编辑器与 shell 同源（同一 host 下的 `/docs/`、`/sheets/` 等） | iframe 同源才能直接访问 `window.top.wails`；也避免 CORS | 改为独立 webview 窗口（牺牲标签模型） |
| D4 | 静态资源用 `embed.FS` + 自定义 `http.Handler` | 单文件分发；路由、CSP、目录穿越校验都在 Go 侧可控 | 改为磁盘目录（便于热更新与调试） |
| D5 | Wails beta 版本固定为 `v3.0.0-beta.28`，升级需过 G1 | beta 期间 API 可能变动，锁定版本避免漂移 | 无 |
| D6 | Phase 1 不实现 `printToPDF` | Electron `webContents.printToPDF` 无等价物，需专用方案（P5 决策门） | P5 用 WebView2 `PrintToPdf` COM 或 Go PDF 库 |

---

## 5. Phase 1 详细任务（可执行）

> 约定：所有命令在 PowerShell 中执行，工作目录为 `E:\Dev\YiiOffice-WailsV3`，除非显式 `cwd`。
> 每个任务结束都要提交一次，提交信息用英文 `feat:` / `chore:` / `test:` 前缀。

### Task 0: 环境准备与仓库初始化

**Files:**
- Create: `E:\Dev\YiiOffice-WailsV3\.gitignore`
- Create: `E:\Dev\YiiOffice-WailsV3\docs\superpowers\notes\wails-v3-api.md`（Task 2 起填充）

- [ ] **Step 1: 安装并校验 Go 工具链**

当前机器 `go` 不在 PATH（已实测：`go : 无法将"go"项识别`）。

```powershell
winget install --id GoLang.Go -e --accept-source-agreements --accept-package-agreements
$env:Path = "C:\Program Files\Go\bin;$env:Path"
go version
```

Expected: `go version go1.24.x windows/amd64`（1.24 或更高）。

- [ ] **Step 2: 安装并校验 Wails V3 CLI（锁定 beta.28）**

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28
$env:Path = "$env:USERPROFILE\go\bin;$env:Path"
wails3 version
```

Expected: 输出包含 `v3.0.0-beta.28`。
若 `wails3` 仍不可用，检查 `%USERPROFILE%\go\bin` 是否在用户 PATH 中并重开终端。

- [ ] **Step 3: 校验 WebView2 运行时**

```powershell
$key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
(Get-ItemProperty $key -ErrorAction SilentlyContinue).pv
```

Expected: 输出形如 `141.0.3537.85`。为空则安装 <https://developer.microsoft.com/microsoft-edge/webview2/> 的 Evergreen Bootstrapper。

- [ ] **Step 4: 初始化 git 与目录骨架**

```powershell
git init
mkdir internal\platform, internal\buildinfo, internal\assets, internal\bridge, internal\fsutil, internal\host
mkdir frontend\apps, frontend\packages
mkdir docs\superpowers\plans, docs\superpowers\notes
```

- [ ] **Step 5: 写 `.gitignore`**

```gitignore
# Go
/bin/
*.exe
*.test
*.out

# Wails
/build/bin/
/build/windows/*.syso
/build/windows/nsis/

# Frontend
frontend/node_modules/
frontend/dist/
frontend/**/node_modules/

# Editor
.vscode/
.idea/
*.log
```

- [ ] **Step 6: 提交**

```powershell
git add .gitignore
git commit -m "chore: bootstrap Windows-only Wails v3 workspace"
```

---

### Task 1: 前端工作区迁移与独立 Vite 构建

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.base.json`（复制自源仓库同名文件）
- Create: `frontend/vite.shared.ts`
- Create: `frontend/apps/shell/vite.config.ts`
- Create: `frontend/apps/docs/vite.config.ts`
- Copy: `apps/shell/src/{renderer,shared}` → `frontend/apps/shell/src/`
- Copy: `apps/docs/src/{renderer,shared}` → `frontend/apps/docs/src/`
- Copy: `packages/*` → `frontend/packages/`（保留目录结构）

- [ ] **Step 1: 复制前端源码（只复制渲染层需要的部分）**

```powershell
$src = 'E:\Dev\YiiOffice-Electron'
$dst = 'E:\Dev\YiiOffice-WailsV3\frontend'

Copy-Item "$src\tsconfig.base.json" "$dst\tsconfig.base.json"
Copy-Item "$src\packages\*" "$dst\packages\" -Recurse

foreach ($app in @('shell','docs')) {
  New-Item -ItemType Directory -Force "$dst\apps\$app\src" | Out-Null
  Copy-Item "$src\apps\$app\src\renderer" "$dst\apps\$app\src\renderer" -Recurse
  Copy-Item "$src\apps\$app\src\shared"   "$dst\apps\$app\src\shared" -Recurse
  Copy-Item "$src\apps\$app\src\renderer\index.html" "$dst\apps\$app\src\renderer\index.html"
}
```

说明：**不复制** `src/main`、`src/preload`、`electron.vite.config.ts`、`electron-builder` 配置、`tests`（渲染层单测在 Phase 1 暂不迁移，随各编辑器在 P4 迁移）。`packages/electron-utils` 需复制但**不得被 renderer 入口 import**（它依赖 `node:` 内置模块，Phase 2 由 Go 重写其宿主部分）。

- [ ] **Step 2: 建立 `frontend/package.json`**

```json
{
  "name": "yiioffice-frontend",
  "version": "0.13.0",
  "private": true,
  "license": "Apache-2.0",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "node tools/build-renderers.mjs shell docs",
    "test": "npm run test -w @yiioffice/wails-bridge",
    "typecheck": "npm run typecheck -w @yiioffice/wails-bridge"
  },
  "devDependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "typescript": "npm:@typescript/typescript6@^6.0.2",
    "vite": "^8.3.5",
    "vitest": "^5.0.5"
  }
}
```

- [ ] **Step 3: 写 `frontend/vite.shared.ts`**

```ts
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'

export interface RendererConfigOptions {
  app: string
  port: number
}

/** Shared renderer build settings: relative asset URLs so /docs/ can be served under any host prefix. */
export function rendererConfig({ app, port }: RendererConfigOptions): UserConfig {
  return defineConfig({
    root: 'src/renderer',
    base: './',
    plugins: [react()],
    server: { port, strictPort: true },
    build: {
      outDir: `../../dist/${app}`,
      emptyOutDir: true,
      target: 'chrome120',
      sourcemap: false,
    },
  })
}
```

- [ ] **Step 4: 写两个应用的 Vite 配置**

`frontend/apps/shell/vite.config.ts`:

```ts
import { rendererConfig } from '../../vite.shared'

export default rendererConfig({ app: 'shell', port: 5178 })
```

`frontend/apps/docs/vite.config.ts`:

```ts
import { rendererConfig } from '../../vite.shared'

export default rendererConfig({ app: 'docs', port: 5173 })
```

- [ ] **Step 5: 写批量构建脚本 `frontend/tools/build-renderers.mjs`**

```js
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const apps = process.argv.slice(2)

if (apps.length === 0) {
  console.error('usage: node tools/build-renderers.mjs <app...>')
  process.exit(1)
}

for (const app of apps) {
  const result = spawnSync('npx', ['vite', 'build'], {
    cwd: join(root, 'apps', app),
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
```

并把 `frontend/package.json` 的 `build` 改为 `node tools/build-renderers.mjs shell docs`。

- [ ] **Step 6: 安装依赖并构建**

```powershell
npm install --prefix frontend
node frontend/tools/build-renderers.mjs shell docs
```

Expected: `frontend/dist/shell/index.html` 与 `frontend/dist/docs/index.html` 均存在。
若 docs 构建报 Node 内置模块缺失（`node:fs` / `Buffer`），说明该文件属于主进程代码：在该文件的 renderer 引用处改走桥接（记录到 `docs/superpowers/notes/wails-v3-api.md` 的「Renderer 构建问题」小节），不要引入 `vite-plugin-node-polyfills`。

- [ ] **Step 7: 校验相对资源路径**

```powershell
Select-String -Path frontend\dist\docs\index.html -Pattern 'src="\./assets/'
```

Expected: 至少 1 处匹配（说明 `base: './'` 生效，`/docs/` 前缀下可加载）。

- [ ] **Step 8: 提交**

```powershell
git add frontend
git commit -m "feat: migrate renderer workspaces to standalone vite build"
```

---

### Task 2: Go 模块与 Wails V3 骨架

**Files:**
- Create: `go.mod`
- Create: `main.go`
- Create: `Taskfile.yml`
- Create: `internal/buildinfo/buildinfo.go`
- Modify: `docs/superpowers/notes/wails-v3-api.md`（记录实测 API）

- [ ] **Step 1: 生成并比对脚手架，确认 beta.28 API 签名**

```powershell
wails3 init -n scaffold -t vanilla
Get-ChildItem .\scaffold -Recurse -File | Select-Object -First 40 FullName
Get-Content .\scaffold\main.go
```

把 `main.go` 中实际使用的构造函数与字段名抄进 `docs/superpowers/notes/wails-v3-api.md`（尤其 `application.Options`、`WebviewWindowOptions`、`AssetOptions.Handler` 的真实字段名）。后续代码以该记录为准。

- [ ] **Step 2: 建立 `go.mod` 并锁定版本**

```powershell
go mod init gitee.com/ethanbourne789/yiioffice
go get github.com/wailsapp/wails/v3@v3.0.0-beta.28
```

`go.mod` 应包含：

```go
module gitee.com/ethanbourne789/yiioffice

go 1.24

require github.com/wailsapp/wails/v3 v3.0.0-beta.28
```

- [ ] **Step 3: 写 `internal/buildinfo/buildinfo.go`**

```go
// Package buildinfo exposes compile-time identity for the desktop binary.
package buildinfo

// Version is overridden at link time: -X .../internal/buildinfo.Version=0.13.0.
var Version = "0.0.0-dev"
```

- [ ] **Step 4: 写 `main.go`（只做窗口 + 空服务，先验证能启动）**

```go
//go:build windows

package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitee.com/ethanbourne789/yiioffice/internal/buildinfo"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

func main() {
	app := application.New(application.Options{
		Name:        "YiiOffice",
		Description: "YiiOffice desktop office suite",
	})

	platform.Set(app)

	// Signature verified against v3.0.0-beta.28 in Step 1; adapt if it returns no value.
	app.NewWebviewWindowWithOptions(application.WebviewWindowOptions{
		Title:  "YiiOffice " + buildinfo.Version,
		Width:  1280,
		Height: 800,
		URL:    "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
```

> `Assets`、`Services`、`//go:embed` 在 Task 3/Task 4 接入。

- [ ] **Step 5: 写 `internal/platform/app.go`**

```go
// Package platform isolates every direct dependency on the Wails V3 beta API.
package platform

import "github.com/wailsapp/wails/v3/pkg/application"

var current *application.App

// Set stores the application handle. Called once from main.
func Set(app *application.App) { current = app }

// App returns the live application handle, or nil before Set.
func App() *application.App { return current }

// RunOnMain dispatches fn on the UI thread. Falls back to direct call in tests.
func RunOnMain(fn func()) {
	if current == nil {
		fn()
		return
	}
	current.RunOnMainThread(fn)
}

// Emit sends a named event to all frontends. No-op in unit tests.
func Emit(name string, data ...any) {
	if current == nil {
		return
	}
	current.EmitEvent(name, data...)
}
```

- [ ] **Step 6: 写 `internal/platform/guard_windows.go`**

```go
//go:build windows

package platform

import (
	"fmt"
	"runtime"
)

// RequireWindows aborts startup on unsupported platforms. Windows is the only supported target.
func RequireWindows() error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("YiiOffice supports Windows only; got %s", runtime.GOOS)
	}
	return nil
}
```

- [ ] **Step 7: 写 `Taskfile.yml`**

```yaml
version: '3'
tasks:
  frontend:
    desc: Build all renderer bundles
    dir: frontend
    cmds:
      - npm install
      - node tools/build-renderers.mjs shell docs

  test:
    desc: Run Go and frontend unit tests
    cmds:
      - go test ./...
      - npm --prefix frontend run test

  build:
    desc: Build Windows desktop binary
    deps: [frontend]
    cmds:
      - wails3 build

  dev:
    desc: Run the app with disk assets (no rebuild of frontend)
    deps: [frontend]
    cmds:
      - wails3 dev
```

- [ ] **Step 8: 构建并运行冒烟**

```powershell
wails3 build
.\build\bin\YiiOffice.exe
```

Expected: 弹出 1280x800 的空窗口，标题为 `YiiOffice 0.0.0-dev`；关闭窗口进程退出（退出码 0）。

- [ ] **Step 9: 清理脚手架并提交**

```powershell
Remove-Item -Recurse -Force .\scaffold
git add go.mod go.sum main.go Taskfile.yml internal docs
git commit -m "feat: add wails v3 windows shell bootstrap"
```

---

### Task 3: 资产服务器（路由 / CSP / 目录穿越防护）

**Files:**
- Create: `internal/assets/server.go`
- Test: `internal/assets/server_test.go`
- Modify: `main.go`（接入 `Assets`）

- [ ] **Step 1: 先写失败测试**

```go
package assets

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testRoot() fstest.MapFS {
	return fstest.MapFS{
		"shell/index.html":      {Data: []byte("<html>shell</html>")},
		"docs/index.html":       {Data: []byte("<html>docs</html>")},
		"docs/assets/app.js":    {Data: []byte("console.log('docs')")},
		"shell/assets/main.css": {Data: []byte("body{}")},
	}
}

func do(t *testing.T, fsys fs.FS, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	New(fsys).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestRootServesShellIndex(t *testing.T) {
	rec := do(t, testRoot(), "/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "shell") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestAppPrefixServesItsIndex(t *testing.T) {
	rec := do(t, testRoot(), "/docs/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "docs") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestAppAssetServedWithContentType(t *testing.T) {
	rec := do(t, testRoot(), "/docs/assets/app.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestSPAFallbackToIndex(t *testing.T) {
	rec := do(t, testRoot(), "/docs/deep/link")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "docs") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestRejectsDotDotTraversal(t *testing.T) {
	rec := do(t, testRoot(), "/docs/../../go.mod")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestSetsSecurityHeaders(t *testing.T) {
	rec := do(t, testRoot(), "/")
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Fatalf("csp = %q", csp)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
}

func TestUnknownAppReturns404(t *testing.T) {
	rec := do(t, testRoot(), "/nope/index.html")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d", rec.Code)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
go test ./internal/assets/ -v
```

Expected: `FAIL ... undefined: New`。

- [ ] **Step 3: 实现 `internal/assets/server.go`**

```go
// Package assets serves the bundled renderer bundles over a single origin.
package assets

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'wasm-unsafe-eval'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self' data: blob:; " +
	"connect-src 'self'; " +
	"worker-src 'self' blob:; " +
	"frame-src 'self'; " +
	"object-src 'none'; base-uri 'none'; form-action 'none'"

// apps lists the renderer bundles mounted under /<name>/.
var apps = []string{"shell", "docs"}

// Server maps URL prefixes to embedded bundle directories.
type Server struct {
	root fs.FS
	apps map[string]struct{}
}

// New builds a handler over the given bundle root (normally frontend/dist).
func New(root fs.FS) *Server {
	set := make(map[string]struct{}, len(apps))
	for _, name := range apps {
		set[name] = struct{}{}
	}
	return &Server{root: root, apps: set}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if hasDotDot(r.URL.Path) {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}

	clean := path.Clean("/" + r.URL.Path)
	if clean == "/" {
		s.serveApp(w, r, "shell", "/index.html")
		return
	}

	trimmed := strings.TrimPrefix(clean, "/")
	app, rest, _ := strings.Cut(trimmed, "/")
	if _, ok := s.apps[app]; !ok {
		http.NotFound(w, r)
		return
	}
	if rest == "" {
		rest = "/index.html"
	} else {
		rest = "/" + rest
	}
	s.serveApp(w, r, app, rest)
}

func (s *Server) serveApp(w http.ResponseWriter, r *http.Request, app, rest string) {
	sub, err := fs.Sub(s.root, app)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	target := path.Clean(rest)
	if !exists(sub, target) {
		if !strings.Contains(path.Base(target), ".") {
			target = "/index.html"
		}
	}
	clone := r.Clone(r.Context())
	clone.URL.Path = target
	http.FileServer(http.FS(sub)).ServeHTTP(w, clone)
}

func exists(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, strings.TrimPrefix(name, "/"))
	return err == nil && !info.IsDir()
}

func hasDotDot(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: 运行测试确认通过**

```powershell
go test ./internal/assets/ -v
```

Expected: 7 个测试全部 `PASS`。

- [ ] **Step 5: 接入 `main.go`（embed frontend/dist）**

```go
//go:embed all:frontend/dist
var embeddedAssets embed.FS

func main() {
	if err := platform.RequireWindows(); err != nil {
		log.Fatal(err)
	}

	dist, err := fs.Sub(embeddedAssets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}

	app := application.New(application.Options{
		Name:        "YiiOffice",
		Description: "YiiOffice desktop office suite",
		Assets: application.AssetOptions{
			Handler: assets.New(dist),
		},
	})
	platform.Set(app)
	// window creation stays as in Task 2
}
```

同时补齐 import：`embed`、`io/fs`、`gitee.com/ethanbourne789/yiioffice/internal/assets`（`platform.RequireWindows` 来自 Task 2 已创建的 `guard_windows.go`）。

- [ ] **Step 6: 构建并验证页面加载**

```powershell
wails3 build
.\build\bin\YiiOffice.exe
```

Expected: 窗口内显示 `dist/shell/index.html` 的实际内容（P1 阶段 shell 渲染层尚未安装兼容层，可能因 `window.aiOffice` 缺失而报错——属预期，Task 5 安装兼容层后修复）。DevTools（F12）中 Network 显示 `/` 200、`/assets/*.js` 200，且响应头含 CSP。

- [ ] **Step 7: 提交**

```powershell
git add main.go internal/assets
git commit -m "feat: serve embedded renderer bundles with CSP and traversal guard"
```

---

### Task 4: 通用 IPC 路由器

**Files:**
- Create: `internal/bridge/router.go`
- Create: `internal/bridge/service.go`
- Create: `internal/bridge/channels.go`
- Test: `internal/bridge/router_test.go`
- Test: `internal/bridge/service_test.go`

- [ ] **Step 1: 写失败测试 `router_test.go`**

```go
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestInvokeDispatchesRegisteredHandler(t *testing.T) {
	r := NewRouter()
	r.Handle("demo:echo", func(_ context.Context, args []json.RawMessage) (any, error) {
		v, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		return v + "!", nil
	})

	got, err := r.Invoke(context.Background(), "demo:echo", []json.RawMessage{json.RawMessage(`"hi"`)})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "hi!" {
		t.Fatalf("got %v", got)
	}
}

func TestInvokeUnknownChannel(t *testing.T) {
	r := NewRouter()
	_, err := r.Invoke(context.Background(), "missing", nil)
	if !errors.Is(err, ErrUnknownChannel) {
		t.Fatalf("got %v", err)
	}
}

func TestHandlePanicsOnDuplicateChannel(t *testing.T) {
	r := NewRouter()
	h := func(context.Context, []json.RawMessage) (any, error) { return nil, nil }
	r.Handle("dup", h)
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	r.Handle("dup", h)
}

func TestDecodeArgRejectsMissingIndex(t *testing.T) {
	if _, err := DecodeArg[string](nil, 0); err == nil {
		t.Fatal("expected error")
	}
}

func TestDecodeArgRejectsWrongType(t *testing.T) {
	_, err := DecodeArg[int]([]json.RawMessage{json.RawMessage(`"x"`)}, 0)
	if err == nil {
		t.Fatal("expected error")
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
go test ./internal/bridge/ -v
```

Expected: `undefined: NewRouter`。

- [ ] **Step 3: 实现 `router.go`**

```go
// Package bridge maps the Electron preload channel surface onto Go handlers.
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// ErrUnknownChannel means no Go handler was registered for the requested channel.
var ErrUnknownChannel = errors.New("unknown bridge channel")

// Handler receives already-parsed JSON arguments and returns a JSON-serialisable value.
type Handler func(ctx context.Context, args []json.RawMessage) (any, error)

// Router is a concurrency-safe channel registry.
type Router struct {
	mu       sync.RWMutex
	handlers map[string]Handler
}

// NewRouter returns an empty registry.
func NewRouter() *Router {
	return &Router{handlers: make(map[string]Handler)}
}

// Handle registers a handler. Duplicate registration panics: channel names must be unique.
func (r *Router) Handle(channel string, h Handler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.handlers[channel]; exists {
		panic("duplicate bridge channel: " + channel)
	}
	r.handlers[channel] = h
}

// Has reports whether a channel is registered. Used by parity tests.
func (r *Router) Has(channel string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.handlers[channel]
	return ok
}

// Channels lists registered channel names (unordered).
func (r *Router) Channels() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.handlers))
	for name := range r.handlers {
		out = append(out, name)
	}
	return out
}

// Invoke decodes and dispatches one call.
func (r *Router) Invoke(ctx context.Context, channel string, args []json.RawMessage) (any, error) {
	r.mu.RLock()
	h, ok := r.handlers[channel]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownChannel, channel)
	}
	return h(ctx, args)
}

// DecodeArg unmarshals the positional argument at index.
func DecodeArg[T any](args []json.RawMessage, index int) (T, error) {
	var zero T
	if index >= len(args) {
		return zero, fmt.Errorf("missing argument %d", index)
	}
	if err := json.Unmarshal(args[index], &zero); err != nil {
		return zero, fmt.Errorf("argument %d: %w", index, err)
	}
	return zero, nil
}
```

- [ ] **Step 4: 写 `service_test.go`**

```go
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestServiceInvokeDelegates(t *testing.T) {
	r := NewRouter()
	r.Handle("demo:ok", func(context.Context, []json.RawMessage) (any, error) { return 42, nil })

	s := NewService(r)
	got, err := s.Invoke("demo:ok", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 42 {
		t.Fatalf("got %v", got)
	}
}

func TestServiceInvokePropagatesUnknownChannel(t *testing.T) {
	s := NewService(NewRouter())
	_, err := s.Invoke("nope", nil)
	if !errors.Is(err, ErrUnknownChannel) {
		t.Fatalf("got %v", err)
	}
}
```

- [ ] **Step 5: 实现 `service.go`**

```go
package bridge

import (
	"context"
	"encoding/json"
)

// Service is the single Wails binding exposed to every renderer.
// JS calls it as bridge.Service.Invoke(channel, args).
type Service struct {
	router *Router
}

// NewService wraps a router for binding.
func NewService(r *Router) *Service { return &Service{router: r} }

// Invoke is the only exported binding method. args must be a JSON array.
func (s *Service) Invoke(channel string, args []json.RawMessage) (any, error) {
	if args == nil {
		args = []json.RawMessage{}
	}
	return s.router.Invoke(context.Background(), channel, args)
}
```

- [ ] **Step 6: 写 `channels.go`（与 Electron 常量逐字一致）**

```go
package bridge

// Channel names must stay byte-identical to the Electron shared constants
// (HOME_CHANNELS / TABS_CHANNELS) so renderer code keeps working without edits.

const (
	ChannelGetAppVersion = "home:get-app-version"
	ChannelGetLanguage   = "home:get-language"
	ChannelSetLanguage   = "home:set-language"
	ChannelGetTheme      = "home:get-theme"
	ChannelSetTheme      = "home:set-theme"

	ChannelTabsList     = "tabs:list"
	ChannelTabsActivate = "tabs:activate"

	ChannelOpenExternal = "shell:open-external"

	EventThemeChanged = "app:theme-changed"
	EventLanguageChanged = "app:language-changed"
)
```

- [ ] **Step 7: 运行测试确认通过**

```powershell
go test ./internal/bridge/ -v
```

Expected: 7 个测试全部 `PASS`。

- [ ] **Step 8: 绑定到 Wails 并从 JS 侧面确认绑定名**

`main.go` 中注册服务：

```go
router := bridge.NewRouter()

app := application.New(application.Options{
	// ...
	Services: []application.Service{
		application.NewService(bridge.NewService(router)),
	},
})
```

（`RegisterHome` 在 Task 7 接线，`RegisterTabs` 在 Task 8 接线；本步骤只注册路由器，保证编译与绑定生成。）

```powershell
wails3 generate bindings
Get-ChildItem .\bindings -Recurse -File | Select-Object FullName
```

把生成的 JS 模块路径与导出名记录到 `docs/superpowers/notes/wails-v3-api.md`。若运行时名不是 `bridge.Service`，以生成代码里的实际名为准并同步修改 `frontend/packages/wails-bridge/src/transport.ts` 的 `SERVICE` 常量。

- [ ] **Step 9: 提交**

```powershell
git add internal/bridge main.go bindings docs
git commit -m "feat: add single-entry ipc router and wails binding"
```

---

### Task 5: 前端兼容层 `@yiioffice/wails-bridge`

**Files:**
- Create: `frontend/packages/wails-bridge/package.json`
- Create: `frontend/packages/wails-bridge/tsconfig.json`
- Create: `frontend/packages/wails-bridge/vitest.config.ts`
- Create: `frontend/packages/wails-bridge/src/transport.ts`
- Create: `frontend/packages/wails-bridge/src/types.ts`
- Create: `frontend/packages/wails-bridge/src/home.ts`
- Create: `frontend/packages/wails-bridge/src/tabs.ts`
- Create: `frontend/packages/wails-bridge/src/index.ts`
- Test: `frontend/packages/wails-bridge/src/index.test.ts`

- [ ] **Step 1: 写 `package.json` / `tsconfig.json` / `vitest.config.ts`**

`package.json`:

```json
{
  "name": "@yiioffice/wails-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "^5.0.5"
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals"],
    "noEmit": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'jsdom', globals: true },
})
```

（需要在 `frontend/package.json` devDependencies 增加 `jsdom@^26`。）

- [ ] **Step 2: 写失败测试 `src/index.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from './index'
import { invoke } from './transport'

interface FakeRuntime {
  Call: { ByName: ReturnType<typeof vi.fn> }
  Events: { On: ReturnType<typeof vi.fn>; Off: ReturnType<typeof vi.fn> }
}

function installFakeRuntime(): FakeRuntime {
  const runtime: FakeRuntime = {
    Call: { ByName: vi.fn(async () => '0.13.0') },
    Events: { On: vi.fn(), Off: vi.fn() },
  }
  ;(window as unknown as { wails?: FakeRuntime }).wails = runtime
  return runtime
}

describe('wails bridge', () => {
  beforeEach(() => {
    delete (window as unknown as { wails?: FakeRuntime }).wails
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
    delete (window as unknown as { aiOfficeTabs?: unknown }).aiOfficeTabs
  })

  it('invokes the generic router with channel and args array', async () => {
    const runtime = installFakeRuntime()
    await invoke('demo:echo', 'a', 1)
    expect(runtime.Call.ByName).toHaveBeenCalledWith('bridge.Service.Invoke', 'demo:echo', ['a', 1])
  })

  it('throws a clear error when the runtime is missing', async () => {
    await expect(invoke('x')).rejects.toThrow(/Wails runtime is not available/)
  })

  it('installs aiOffice and aiOfficeTabs once', () => {
    installFakeRuntime()
    installBridge()
    installBridge()
    expect(typeof (window as unknown as { aiOffice: { getAppVersion: unknown } }).aiOffice.getAppVersion).toBe('function')
    expect(typeof (window as unknown as { aiOfficeTabs: { list: unknown } }).aiOfficeTabs.list).toBe('function')
  })

  it('reads the version through the shim', async () => {
    const runtime = installFakeRuntime()
    installBridge()
    const version = await (window as unknown as { aiOffice: { getAppVersion(): Promise<string> } }).aiOffice.getAppVersion()
    expect(version).toBe('0.13.0')
    expect(runtime.Call.ByName).toHaveBeenCalledWith(
      'bridge.Service.Invoke',
      'home:get-app-version',
      [],
    )
  })

  it('rejects an unknown theme value before hitting go', async () => {
    installFakeRuntime()
    installBridge()
    const api = (window as unknown as { aiOffice: { setTheme(t: string): Promise<void> } }).aiOffice
    await expect(api.setTheme('sepia')).rejects.toThrow(/Invalid theme/)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

```powershell
npm --prefix frontend install
npm --prefix frontend run test -w @yiioffice/wails-bridge
```

Expected: 失败于 `Cannot find module './index'`。

- [ ] **Step 4: 写 `src/transport.ts`**

```ts
export interface WailsRuntime {
  Call: {
    ByName(name: string, ...args: unknown[]): Promise<unknown>
  }
  Events: {
    On(name: string, cb: (data: unknown) => void): void
    Off?(name: string, cb: (data: unknown) => void): void
  }
}

/** Generated binding name; update together with wails3 generate bindings output. */
const SERVICE = 'bridge.Service'

/**
 * Resolves the Wails runtime. Editors run in same-origin iframes, so the top
 * frame's runtime object is preferred when the current frame has none.
 */
export function runtime(): WailsRuntime {
  const self = window as unknown as { wails?: WailsRuntime }
  if (self.wails) return self.wails
  const top = window.top as unknown as { wails?: WailsRuntime } | null
  if (top && top !== self && top.wails) return top.wails
  throw new Error('Wails runtime is not available')
}

export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return (await runtime().Call.ByName(`${SERVICE}.Invoke`, channel, args)) as T
}

export function on(channel: string, handler: (data: unknown) => void): () => void {
  const rt = runtime()
  rt.Events.On(channel, handler)
  return () => rt.Events.Off?.(channel, handler)
}
```

- [ ] **Step 5: 写 `src/types.ts`**

```ts
export type UiLanguage = 'zh' | 'en'
export type AppTheme = 'light' | 'dark' | 'system'

export const UI_LANGUAGES: readonly UiLanguage[] = ['zh', 'en']
export const APP_THEMES: readonly AppTheme[] = ['light', 'dark', 'system']

export function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.includes(value as AppTheme)
}
```

- [ ] **Step 6: 写 `src/home.ts`**

```ts
import { invoke, on } from './transport'
import { isAppTheme, isUiLanguage, type AppTheme, type UiLanguage } from './types'

/** Subset of the Electron HomeApi required by the shell home screen in Phase 1. */
export interface HomeBridge {
  getAppVersion(): Promise<string>
  getTheme(): Promise<AppTheme>
  setTheme(theme: AppTheme): Promise<void>
  getLanguage(): Promise<UiLanguage>
  setLanguage(lang: UiLanguage): Promise<void>
  onThemeChanged(handler: (theme: AppTheme) => void): () => void
}

export function createHomeApi(): HomeBridge {
  return {
    async getAppVersion() {
      const value = await invoke<unknown>('home:get-app-version')
      return typeof value === 'string' ? value : ''
    },
    async getTheme() {
      const value = await invoke<unknown>('home:get-theme')
      return isAppTheme(value) ? value : 'system'
    },
    async setTheme(theme) {
      if (!isAppTheme(theme)) throw new Error('Invalid theme.')
      await invoke('home:set-theme', theme)
    },
    async getLanguage() {
      const value = await invoke<unknown>('home:get-language')
      return isUiLanguage(value) ? value : 'zh'
    },
    async setLanguage(lang) {
      if (!isUiLanguage(lang)) throw new Error('Invalid language.')
      await invoke('home:set-language', lang)
    },
    onThemeChanged(handler) {
      return on('app:theme-changed', (data) => {
        if (isAppTheme(data)) handler(data)
      })
    },
  }
}
```

- [ ] **Step 7: 写 `src/tabs.ts`**

```ts
import { invoke, on } from './transport'

export interface TabSummary {
  id: string
  kind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'home'
  title: string
  active: boolean
}

/** Phase 1 subset: the strip renders an empty list until Phase 2 adds the tab host. */
export interface TabsBridge {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  onChanged(handler: (tabs: TabSummary[]) => void): () => void
}

export function createTabsApi(): TabsBridge {
  return {
    async list() {
      const value = await invoke<unknown>('tabs:list')
      return Array.isArray(value) ? (value as TabSummary[]) : []
    },
    async activate(id) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid tab id.')
      await invoke('tabs:activate', id)
    },
    onChanged(handler) {
      return on('tabs:changed', (data) => {
        if (Array.isArray(data)) handler(data as TabSummary[])
      })
    },
  }
}
```

- [ ] **Step 8: 写 `src/index.ts`**

```ts
import { createHomeApi } from './home'
import { createTabsApi } from './tabs'

export { invoke, on, runtime } from './transport'
export type { HomeBridge } from './home'
export type { TabsBridge, TabSummary } from './tabs'
export type { AppTheme, UiLanguage } from './types'

declare global {
  interface Window {
    aiOffice?: unknown
    aiOfficeTabs?: unknown
  }
}

/**
 * Installs the Electron-compatible globals exactly once. Called from every
 * renderer entry before React mounts.
 */
export function installBridge(): void {
  if (window.aiOffice) return
  window.aiOffice = createHomeApi()
  window.aiOfficeTabs = createTabsApi()
}
```

- [ ] **Step 9: 运行测试确认通过**

```powershell
npm --prefix frontend run test -w @yiioffice/wails-bridge
```

Expected: 5 个测试 `PASS`。

- [ ] **Step 10: 在 shell 与 docs 入口安装兼容层**

在 `frontend/apps/shell/package.json` 与 `frontend/apps/docs/package.json` 的 `dependencies` 增加：

```json
"@yiioffice/wails-bridge": "*"
```

`frontend/apps/shell/src/renderer/src/main.tsx` 顶部（必须在任何 React import 之前执行）：

```tsx
import { installBridge } from '@yiioffice/wails-bridge'
installBridge()

import { StrictMode } from 'react'
// ...existing imports unchanged
```

`frontend/apps/docs/src/renderer/src/main.tsx` 同样在首行插入这两行。
（import 顺序会被 ESLint `import/first` 规则报警——在本仓库该规则已按需关闭；若报错，改用 `frontend/apps/<app>/src/renderer/src/bridge-bootstrap.ts` 只做 `installBridge()` 调用并在 `main.tsx` 首行 `import './bridge-bootstrap'`。）

- [ ] **Step 11: 重新构建并确认无运行时错误**

```powershell
npm --prefix frontend install
node frontend/tools/build-renderers.mjs shell docs
wails3 build
.\build\bin\YiiOffice.exe
```

Expected: Home 页正常渲染（不再是白屏/报错），DevTools Console 无 `Wails runtime is not available`。

- [ ] **Step 12: 提交**

```powershell
git add frontend
git commit -m "feat: add electron-compatible wails bridge shim"
```

---

### Task 6: 设置存储、原子写与路径守卫

**Files:**
- Create: `internal/fsutil/atomicwrite.go`
- Test: `internal/fsutil/atomicwrite_test.go`
- Create: `internal/fsutil/pathguard_windows.go`
- Test: `internal/fsutil/pathguard_test.go`
- Create: `internal/host/dirs_windows.go`
- Create: `internal/host/settings.go`
- Test: `internal/host/settings_test.go`

- [ ] **Step 1: 写失败测试 `atomicwrite_test.go`**

```go
package fsutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileAtomicReplacesExistingContent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteFileAtomic(path, []byte("new"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new" {
		t.Fatalf("got %q", got)
	}
}

func TestWriteFileAtomicLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.txt")
	if err := WriteFileAtomic(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "a.txt" {
		t.Fatalf("unexpected entries: %v", entries)
	}
}

func TestWriteFileAtomicCreatesParentDirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "deep", "a.txt")
	if err := WriteFileAtomic(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

func TestWriteFileAtomicEmptyData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	if err := WriteFileAtomic(path, nil, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() != 0 {
		t.Fatalf("size = %d", info.Size())
	}
}
```

- [ ] **Step 2: 运行确认失败**

```powershell
go test ./internal/fsutil/ -v
```

Expected: `undefined: WriteFileAtomic`。

- [ ] **Step 3: 实现 `atomicwrite.go`**

```go
// Package fsutil holds Windows-safe file primitives shared by every host service.
package fsutil

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// WriteFileAtomic replaces path with data using write-temp-then-rename.
// On Windows os.Rename maps to MoveFileEx(MOVEFILE_REPLACE_EXISTING), so an
// existing destination is replaced without a delete window.
func WriteFileAtomic(path string, data []byte, perm fs.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() {
		tmp.Close()
		os.Remove(tmpName)
	}

	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("sync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("chmod temp: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("rename temp: %w", err)
	}
	return nil
}

// WriteJSONAtomic marshals and atomically writes a JSON document with a trailing newline.
func WriteJSONAtomic(path string, value any, perm fs.FileMode) error {
	data, err := MarshalIndent(value)
	if err != nil {
		return err
	}
	return WriteFileAtomic(path, data, perm)
}
```

`MarshalIndent` 需要单独实现（避免 `encoding/json` 在调用处重复）：

```go
// MarshalIndent renders value as indented JSON with a trailing newline.
func MarshalIndent(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal json: %w", err)
	}
	return append(data, '\n'), nil
}
```

（在 `atomicwrite.go` 顶部 import `encoding/json`。）

- [ ] **Step 4: 运行测试确认通过**

```powershell
go test ./internal/fsutil/ -v -run TestWriteFileAtomic
```

Expected: 4 个测试 `PASS`。

- [ ] **Step 5: 写失败测试 `pathguard_test.go`**

```go
package fsutil

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mustGuard(t *testing.T, roots ...string) *Guard {
	t.Helper()
	g, err := NewGuard(roots)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestAuthorizeAcceptsNestedPathUnderRoot(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "a", "b", "c.docx")
	g := mustGuard(t, root)
	got, err := g.Authorize(nested)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.EqualFold(got, nested) {
		t.Fatalf("got %q", got)
	}
}

func TestAuthorizeRejectsEscapeWithDotDot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(root, "..", "evil.docx")
	_, err := mustGuard(t, root).Authorize(outside)
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsAbsoluteOutsideRoot(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	_, err := mustGuard(t, root).Authorize(filepath.Join(other, "x.docx"))
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsAlternateDataStream(t *testing.T) {
	root := t.TempDir()
	_, err := mustGuard(t, root).Authorize(filepath.Join(root, "a.docx:secret"))
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsReservedDeviceName(t *testing.T) {
	root := t.TempDir()
	_, err := mustGuard(t, root).Authorize(filepath.Join(root, "CON.docx"))
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsEmptyPath(t *testing.T) {
	root := t.TempDir()
	if _, err := mustGuard(t, root).Authorize(""); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeFollowsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	target := filepath.Join(outside, "x.docx")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := mustGuard(t, root).Authorize(link); err == nil {
		t.Fatal("expected rejection after resolving symlink")
	}
}
```

- [ ] **Step 6: 实现 `pathguard_windows.go`**

```go
//go:build windows

package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Guard authorises file accesses against a fixed set of roots.
type Guard struct {
	roots []string
}

var reservedNames = map[string]struct{}{
	"CON": {}, "PRN": {}, "AUX": {}, "NUL": {},
	"COM1": {}, "COM2": {}, "COM3": {}, "COM4": {}, "COM5": {}, "COM6": {}, "COM7": {}, "COM8": {}, "COM9": {},
	"LPT1": {}, "LPT2": {}, "LPT3": {}, "LPT4": {}, "LPT5": {}, "LPT6": {}, "LPT7": {}, "LPT8": {}, "LPT9": {},
}

// NewGuard canonicalises roots once. Roots must exist.
func NewGuard(roots []string) (*Guard, error) {
	if len(roots) == 0 {
		return nil, errors.New("guard requires at least one root")
	}
	out := make([]string, 0, len(roots))
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			return nil, fmt.Errorf("abs %s: %w", root, err)
		}
		resolved, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", root, err)
		}
		out = append(out, strings.ToLower(filepath.Clean(resolved)))
	}
	return &Guard{roots: out}, nil
}

// Authorize returns the canonical absolute path when it stays inside a root.
func (g *Guard) Authorize(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", errors.New("empty path")
	}
	if strings.ContainsRune(raw, 0) {
		return "", errors.New("path contains NUL")
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", fmt.Errorf("abs: %w", err)
	}
	if err := checkWindowsName(abs); err != nil {
		return "", err
	}
	canonical := abs
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		canonical = resolved
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("resolve: %w", err)
	}
	lower := strings.ToLower(filepath.Clean(canonical))
	for _, root := range g.roots {
		if lower == root || strings.HasPrefix(lower, root+string(filepath.Separator)) {
			return canonical, nil
		}
	}
	return "", fmt.Errorf("path outside authorised roots: %s", raw)
}

func checkWindowsName(abs string) error {
	rest := strings.TrimPrefix(abs, filepath.VolumeName(abs))
	if strings.ContainsRune(rest, ':') {
		return errors.New("alternate data stream not allowed")
	}
	base := filepath.Base(abs)
	stem := strings.ToUpper(strings.TrimSuffix(base, filepath.Ext(base)))
	if _, bad := reservedNames[stem]; bad {
		return fmt.Errorf("reserved device name: %s", base)
	}
	if strings.HasSuffix(base, " ") || strings.HasSuffix(base, ".") {
		return errors.New("trailing space or dot not allowed")
	}
	return nil
}
```

- [ ] **Step 7: 运行测试确认通过**

```powershell
go test ./internal/fsutil/ -v
```

Expected: 全部 `PASS`（符号链接用例在无权限时 `SKIP`）。

- [ ] **Step 8: 写 `host/dirs_windows.go`**

```go
//go:build windows

package host

import (
	"os"
	"path/filepath"
)

// AppDataDir returns %APPDATA%\YiiOffice, creating it when missing.
func AppDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "YiiOffice")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
```

- [ ] **Step 9: 写失败测试 `settings_test.go` 并实现 `settings.go`**

测试：

```go
package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsDefaults(t *testing.T) {
	s, err := NewSettingsStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got := s.Snapshot()
	if got.Language != "zh" || got.Theme != "system" {
		t.Fatalf("unexpected defaults: %+v", got)
	}
}

func TestSettingsPersistAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetLanguage("en"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTheme("dark"); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Snapshot()
	if got.Language != "en" || got.Theme != "dark" {
		t.Fatalf("got %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
}

func TestSettingsRejectInvalidValues(t *testing.T) {
	s, _ := NewSettingsStore(t.TempDir())
	if err := s.SetLanguage("fr"); err == nil {
		t.Fatal("expected rejection")
	}
	if err := s.SetTheme("sepia"); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestSettingsRecoversFromCorruptFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Snapshot(); got.Language != "zh" {
		t.Fatalf("got %+v", got)
	}
}
```

实现：

```go
// Package host implements desktop services independent of any UI framework.
package host

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
)

// Settings is the persisted preference document.
type Settings struct {
	Language string `json:"language"`
	Theme    string `json:"theme"`
}

var (
	validLanguages = map[string]bool{"zh": true, "en": true}
	validThemes    = map[string]bool{"light": true, "dark": true, "system": true}
)

// SettingsStore serialises reads and writes of settings.json.
type SettingsStore struct {
	mu   sync.Mutex
	path string
	data Settings
}

// NewSettingsStore loads (or initialises) settings from dir.
// A corrupt file is discarded rather than fatal.
func NewSettingsStore(dir string) (*SettingsStore, error) {
	s := &SettingsStore{
		path: filepath.Join(dir, "settings.json"),
		data: Settings{Language: "zh", Theme: "system"},
	}
	raw, err := os.ReadFile(s.path)
	switch {
	case err == nil:
		var loaded Settings
		if jsonErr := unmarshalSettings(raw, &loaded); jsonErr == nil {
			s.data = mergeDefaults(loaded)
		}
	case os.IsNotExist(err):
	default:
		return nil, fmt.Errorf("read settings: %w", err)
	}
	return s, nil
}

// Snapshot returns a copy of the current settings.
func (s *SettingsStore) Snapshot() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data
}

// SetLanguage validates and persists the UI language.
func (s *SettingsStore) SetLanguage(lang string) error {
	if !validLanguages[lang] {
		return fmt.Errorf("invalid language: %s", lang)
	}
	return s.update(func(d *Settings) { d.Language = lang })
}

// SetTheme validates and persists the application theme.
func (s *SettingsStore) SetTheme(theme string) error {
	if !validThemes[theme] {
		return fmt.Errorf("invalid theme: %s", theme)
	}
	return s.update(func(d *Settings) { d.Theme = theme })
}

func (s *SettingsStore) update(mutate func(*Settings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.data
	mutate(&next)
	if err := fsutil.WriteJSONAtomic(s.path, next, 0o644); err != nil {
		return err
	}
	s.data = next
	return nil
}

func mergeDefaults(loaded Settings) Settings {
	out := Settings{Language: "zh", Theme: "system"}
	if validLanguages[loaded.Language] {
		out.Language = loaded.Language
	}
	if validThemes[loaded.Theme] {
		out.Theme = loaded.Theme
	}
	return out
}

func unmarshalSettings(raw []byte, dst *Settings) error {
	return json.Unmarshal(raw, dst)
}
```

（import `encoding/json`；`unmarshalSettings` 只是把 `encoding/json` 的使用集中到一处，便于后续替换。）

- [ ] **Step 10: 运行全部 Go 测试**

```powershell
go test ./... -v
```

Expected: 全部 `PASS`。

- [ ] **Step 11: 提交**

```powershell
git add internal
git commit -m "feat: add atomic write, windows path guard and settings store"
```

---

### Task 7: 注册 Home 通道（版本 / 主题 / 语言）

**Files:**
- Create: `internal/bridge/home.go`
- Test: `internal/bridge/home_test.go`
- Modify: `main.go`

- [ ] **Step 1: 写失败测试 `home_test.go`**

```go
package bridge

import (
	"context"
	"encoding/json"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func newTestRouter(t *testing.T) (*Router, *host.SettingsStore) {
	t.Helper()
	store, err := host.NewSettingsStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	r := NewRouter()
	RegisterHome(r, store, "1.2.3")
	return r, store
}

func call(t *testing.T, r *Router, channel string, args ...any) any {
	t.Helper()
	raw := make([]json.RawMessage, 0, len(args))
	for _, arg := range args {
		data, err := json.Marshal(arg)
		if err != nil {
			t.Fatal(err)
		}
		raw = append(raw, data)
	}
	got, err := r.Invoke(context.Background(), channel, raw)
	if err != nil {
		t.Fatalf("%s: %v", channel, err)
	}
	return got
}

func TestGetAppVersionReturnsInjectedVersion(t *testing.T) {
	r, _ := newTestRouter(t)
	if got := call(t, r, ChannelGetAppVersion); got != "1.2.3" {
		t.Fatalf("got %v", got)
	}
}

func TestThemeRoundTrip(t *testing.T) {
	r, store := newTestRouter(t)
	call(t, r, ChannelSetTheme, "dark")
	if got := call(t, r, ChannelGetTheme); got != "dark" {
		t.Fatalf("got %v", got)
	}
	if store.Snapshot().Theme != "dark" {
		t.Fatal("store not updated")
	}
}

func TestSetThemeRejectsInvalidValue(t *testing.T) {
	r, _ := newTestRouter(t)
	if _, err := r.Invoke(context.Background(), ChannelSetTheme, []json.RawMessage{json.RawMessage(`"sepia"`)}); err == nil {
		t.Fatal("expected error")
	}
}

func TestLanguageRoundTrip(t *testing.T) {
	r, store := newTestRouter(t)
	call(t, r, ChannelSetLanguage, "en")
	if got := call(t, r, ChannelGetLanguage); got != "en" {
		t.Fatalf("got %v", got)
	}
	if store.Snapshot().Language != "en" {
		t.Fatal("store not updated")
	}
}
```

- [ ] **Step 2: 运行确认失败**

```powershell
go test ./internal/bridge/ -run TestGetAppVersion -v
```

Expected: `undefined: RegisterHome`。

- [ ] **Step 3: 实现 `home.go`**

```go
package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// RegisterHome wires the Phase 1 subset of home:* channels.
func RegisterHome(r *Router, store *host.SettingsStore, version string) {
	r.Handle(ChannelGetAppVersion, func(context.Context, []json.RawMessage) (any, error) {
		return version, nil
	})

	r.Handle(ChannelGetTheme, func(context.Context, []json.RawMessage) (any, error) {
		return store.Snapshot().Theme, nil
	})

	r.Handle(ChannelSetTheme, func(_ context.Context, args []json.RawMessage) (any, error) {
		theme, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if err := store.SetTheme(theme); err != nil {
			return nil, err
		}
		platform.Emit(EventThemeChanged, theme)
		return nil, nil
	})

	r.Handle(ChannelGetLanguage, func(context.Context, []json.RawMessage) (any, error) {
		return store.Snapshot().Language, nil
	})

	r.Handle(ChannelSetLanguage, func(_ context.Context, args []json.RawMessage) (any, error) {
		lang, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if err := store.SetLanguage(lang); err != nil {
			return nil, err
		}
		platform.Emit(EventLanguageChanged, lang)
		return nil, nil
	})
}
```

- [ ] **Step 4: 运行测试确认通过**

```powershell
go test ./internal/bridge/ -v
```

Expected: 全部 `PASS`。

- [ ] **Step 5: 在 `main.go` 接线**

```go
dataDir, err := host.AppDataDir()
if err != nil {
	log.Fatal(err)
}
store, err := host.NewSettingsStore(dataDir)
if err != nil {
	log.Fatal(err)
}

router := bridge.NewRouter()
bridge.RegisterHome(router, store, buildinfo.Version)
bridge.RegisterTabs(router)
```

- [ ] **Step 6: 端到端验证**

```powershell
wails3 build
.\build\bin\YiiOffice.exe
```

Expected（DevTools Console 逐条执行）：

```js
await window.wails.Call.ByName('bridge.Service.Invoke', 'home:get-app-version', [])
// → "0.0.0-dev"
await window.wails.Call.ByName('bridge.Service.Invoke', 'home:set-theme', ['dark'])
// → null，窗口主题事件已发出；Home 页主题切换按钮生效
```

同时确认 `%APPDATA%\YiiOffice\settings.json` 内容为：

```json
{
  "language": "zh",
  "theme": "dark"
}
```

- [ ] **Step 7: 提交**

```powershell
git add internal/bridge main.go
git commit -m "feat: wire home version, theme and language channels"
```

---

### Task 8: 标签宿主 Spike（同源 iframe + 桥可达性）

**Files:**
- Create: `internal/bridge/tabs.go`
- Test: `internal/bridge/tabs_test.go`
- Create: `docs/superpowers/notes/tab-host-spike.md`（记录测量与结论）
- Modify: `frontend/apps/shell/src/renderer/src/AppFrame.tsx`（临时挂载 iframe 入口，P2 由正式 TabBar 替换）

- [ ] **Step 1: 实现最小 `tabs.go` 与测试**

```go
package bridge

import (
	"context"
	"encoding/json"
)

// RegisterTabs wires the Phase 1 subset of tabs:* channels.
func RegisterTabs(r *Router) {
	r.Handle(ChannelTabsList, func(context.Context, []json.RawMessage) (any, error) {
		return []any{}, nil
	})
	r.Handle(ChannelTabsActivate, func(_ context.Context, args []json.RawMessage) (any, error) {
		if _, err := DecodeArg[string](args, 0); err != nil {
			return nil, err
		}
		return nil, nil
	})
}
```

测试：

```go
package bridge

import (
	"context"
	"encoding/json"
	"testing"
)

func TestTabsListReturnsEmptyArray(t *testing.T) {
	r := NewRouter()
	RegisterTabs(r)
	got, err := r.Invoke(context.Background(), ChannelTabsList, nil)
	if err != nil {
		t.Fatal(err)
	}
	tabs, ok := got.([]any)
	if !ok || len(tabs) != 0 {
		t.Fatalf("got %#v", got)
	}
}

func TestTabsActivateRequiresId(t *testing.T) {
	r := NewRouter()
	RegisterTabs(r)
	if _, err := r.Invoke(context.Background(), ChannelTabsActivate, nil); err == nil {
		t.Fatal("expected error")
	}
	if _, err := r.Invoke(context.Background(), ChannelTabsActivate, []json.RawMessage{json.RawMessage(`"t1"`)}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

运行：

```powershell
go test ./internal/bridge/ -v
```

Expected: `PASS`。

- [ ] **Step 2: 在 shell 渲染层加临时 iframe 探针**

`frontend/apps/shell/src/renderer/src/AppFrame.tsx` 顶部加一个仅用于 spike 的组件（P2 删除）：

```tsx
function TabHostSpike() {
  return (
    <iframe
      title="docs-spike"
      src="/docs/index.html"
      style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
    />
  )
}
```

在 `AppFrame` 的返回结构中，用一个 `?spike=1` 查询参数切换渲染 `TabHostSpike`：

```tsx
const spike = new URLSearchParams(window.location.search).get('spike') === '1'
// ...
return spike ? <TabHostSpike /> : <OriginalLayout />
```

- [ ] **Step 3: 构建并测量**

```powershell
node frontend/tools/build-renderers.mjs shell docs
wails3 build
.\build\bin\YiiOffice.exe
```

在应用窗口内按 F12 打开 DevTools，切到 Console，选中 `docs-spike` 帧后逐条执行：

```js
window.top.wails !== undefined
// 期望 true
typeof window.top.wails.Call.ByName
// 期望 "function"
await window.top.wails.Call.ByName('bridge.Service.Invoke', 'home:get-app-version', [])
// 期望返回 "0.0.0-dev"
window.aiOffice !== undefined
// 期望 true（docs 入口已安装兼容层）
performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd
// 记录 docs 首屏耗时
```

- [ ] **Step 4: 记录测量与判定**

在 `docs/superpowers/notes/tab-host-spike.md` 写入下表实测值：

| 指标 | 目标 | 实测 |
| --- | --- | --- |
| iframe 内 `window.top.wails` 可达 | true | |
| iframe 内 `aiOffice.getAppVersion()` 可用 | true | |
| docs 首屏 DOMContentLoaded | < 2500ms | |
| 进程数（Task Manager 中 `YiiOffice.exe` + `msedgewebview2.exe`） | ≤ 12 | |
| 常驻内存（Home + 1 个 docs 标签） | < 600MB | |
| 编辑器键盘输入延迟（人工手感） | 无明显延迟 | |
| 第二个 docs 标签复用 iframe 还是新建 | 新建 | |

**判定规则**：`window.top.wails` 与 `aiOffice` 两项任一为 false，则 Phase 2 改用 postMessage 中继方案（shell 渲染层作为总线，转发 `invoke`/`on` 到顶层），并在计划中升级为 D2 回退分支；其余指标仅记录基线，作为 P7 性能预算输入。

- [ ] **Step 5: 提交**

```powershell
git add internal/bridge frontend/apps/shell docs/superpowers/notes
git commit -m "spike: verify same-origin iframe tab host bridge reachability"
```

---

### Task 9: 外链与导航安全

**Files:**
- Create: `internal/bridge/openexternal.go`
- Test: `internal/bridge/openexternal_test.go`
- Modify: `frontend/packages/wails-bridge/src/index.ts`（劫持 `window.open` 与 `target=_blank`）
- Test: `frontend/packages/wails-bridge/src/index.test.ts`（新增用例）

- [ ] **Step 1: 写失败测试 `openexternal_test.go`**

```go
package bridge

import (
	"context"
	"encoding/json"
	"testing"
)

func TestValidateExternalURL(t *testing.T) {
	cases := []struct {
		url  string
		ok   bool
	}{
		{"https://example.com/doc", true},
		{"http://example.com", true},
		{"javascript:alert(1)", false},
		{"file:///C:/Windows/System32", false},
		{"https://user:pass@example.com", false},
		{"", false},
		{"https://example.com/" + string(make([]byte, 3000)), false},
	}
	for _, tc := range cases {
		err := ValidateExternalURL(tc.url)
		if tc.ok && err != nil {
			t.Fatalf("%q: unexpected error %v", tc.url, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("%q: expected rejection", tc.url)
		}
	}
}

func TestOpenExternalRejectsUnsafeScheme(t *testing.T) {
	r := NewRouter()
	RegisterOpenExternal(r, func(string) error { return nil })
	_, err := r.Invoke(context.Background(), ChannelOpenExternal, []json.RawMessage{json.RawMessage(`"javascript:alert(1)"`)})
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestOpenExternalInvokesOpener(t *testing.T) {
	var opened string
	r := NewRouter()
	RegisterOpenExternal(r, func(u string) error { opened = u; return nil })
	if _, err := r.Invoke(context.Background(), ChannelOpenExternal, []json.RawMessage{json.RawMessage(`"https://example.com"`)}); err != nil {
		t.Fatal(err)
	}
	if opened != "https://example.com" {
		t.Fatalf("got %q", opened)
	}
}
```

- [ ] **Step 2: 实现 `openexternal.go`**

```go
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// maxExternalURLLength keeps clipboard/URL-bar abuse out of the shell opener.
const maxExternalURLLength = 2048

// ValidateExternalURL accepts only plain http(s) URLs with no embedded credentials.
func ValidateExternalURL(raw string) error {
	if raw == "" {
		return errors.New("empty url")
	}
	if len(raw) > maxExternalURLLength {
		return fmt.Errorf("url too long: %d", len(raw))
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("scheme not allowed: %s", parsed.Scheme)
	}
	if parsed.User != nil {
		return errors.New("credentials in url not allowed")
	}
	if parsed.Host == "" {
		return errors.New("missing host")
	}
	if strings.ContainsAny(raw, "\r\n\t") {
		return errors.New("control characters not allowed")
	}
	return nil
}

// RegisterOpenExternal wires the shell:open-external channel.
func RegisterOpenExternal(r *Router, opener func(string) error) {
	r.Handle(ChannelOpenExternal, func(_ context.Context, args []json.RawMessage) (any, error) {
		raw, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if err := ValidateExternalURL(raw); err != nil {
			return nil, err
		}
		return nil, opener(raw)
	})
}
```

`main.go` 中接线：

```go
bridge.RegisterOpenExternal(router, func(u string) error {
	return platform.OpenExternal(u)
})
```

`internal/platform/app.go` 追加（符号名以 Task 2 实测为准）：

```go
// OpenExternal opens a URL in the user's default browser.
func OpenExternal(rawURL string) error {
	if current == nil {
		return nil
	}
	return current.OpenInBrowser(rawURL)
}
```

- [ ] **Step 3: 运行 Go 测试**

```powershell
go test ./internal/bridge/ -v -run 'External'
```

Expected: `PASS`。

- [ ] **Step 4: 前端兜底：劫持 window.open 与 target=_blank**

在 `frontend/packages/wails-bridge/src/index.ts` 追加：

```ts
const EXTERNAL_ATTR = 'data-wails-external'

/**
 * Routes every external navigation attempt through Go so the shell can validate
 * the URL and open the system browser instead of navigating the WebView.
 */
export function installExternalLinkGuard(): void {
  window.open = (url?: string | URL): Window | null => {
    const raw = typeof url === 'string' ? url : url?.toString() ?? ''
    void invoke('shell:open-external', raw).catch(() => undefined)
    return null
  }

  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      const isExternal = /^https?:/i.test(href) && (anchor.getAttribute('target') === '_blank' || anchor.hasAttribute(EXTERNAL_ATTR))
      if (!isExternal) return
      event.preventDefault()
      void invoke('shell:open-external', href).catch(() => undefined)
    },
    true,
  )
}
```

并在 `installBridge()` 末尾调用 `installExternalLinkGuard()`（只调用一次，利用 `window.aiOffice` 已存在则提前返回的逻辑）。

- [ ] **Step 5: 补前端测试**

在 `frontend/packages/wails-bridge/src/index.test.ts` 追加：

```ts
it('routes https links through shell:open-external and blocks navigation', async () => {
  const runtime = installFakeRuntime()
  installBridge()

  const anchor = document.createElement('a')
  anchor.href = 'https://example.com/x'
  anchor.target = '_blank'
  document.body.append(anchor)

  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  anchor.dispatchEvent(event)

  expect(event.defaultPrevented).toBe(true)
  expect(runtime.Call.ByName).toHaveBeenCalledWith(
    'bridge.Service.Invoke',
    'shell:open-external',
    ['https://example.com/x'],
  )
  anchor.remove()
})
```

- [ ] **Step 6: 运行前端测试并构建验证**

```powershell
npm --prefix frontend run test -w @yiioffice/wails-bridge
node frontend/tools/build-renderers.mjs shell docs
wails3 build
```

Expected: 测试全绿；应用内点击外链不会在窗口内跳走，系统浏览器打开。

- [ ] **Step 7: 提交**

```powershell
git add internal frontend
git commit -m "feat: guard external navigation behind validated opener"
```

---

### Task 10: Phase 1 验收

**Files:**
- Modify: `docs/superpowers/notes/wails-v3-api.md`（补充 G1 验收数据）
- Modify: `Taskfile.yml`（增加 `verify` 任务）

- [ ] **Step 1: 增加一键校验任务**

```yaml
  verify:
    desc: Gate G1 checks
    cmds:
      - go vet ./...
      - go test ./...
      - npm --prefix frontend run test
      - node frontend/tools/build-renderers.mjs shell docs
      - wails3 build
```

- [ ] **Step 2: 执行 G1 检查**

```powershell
task verify
```

Expected 全部通过。逐项手工核对：

| 检查项 | 方法 | 通过标准 |
| --- | --- | --- |
| 冷启动 | 任务管理器计时，双击 exe 到 Home 可交互 | < 2.5s |
| 窗口 | 打开/关闭/最小化/最大化 | 无异常、退出干净（无残留进程） |
| 版本号 | Home 页显示 | `0.0.0-dev` |
| 主题 | 点击切换深/浅色 | 立即生效，重启后保持 |
| 语言 | 切换中/英 | 立即生效，重启后保持 |
| 设置文件 | `%APPDATA%\YiiOffice\settings.json` | 存在且格式正确 |
| CSP | DevTools Console | 无 CSP violation 报错 |
| iframe 标签 | Task 8 探针 | `window.top.wails` 可达 |
| 未知通道 | Console 调用 `bridge.Service.Invoke('nope', [])` | 返回 `unknown bridge channel` |

- [ ] **Step 3: 记录结果并提交**

在 `docs/superpowers/notes/wails-v3-api.md` 追加「G1 验收」小节，写入实测值与偏差。

```powershell
git add docs Taskfile.yml
git commit -m "chore: add phase 1 gate verification"
```

---

## 6. 后续阶段计划大纲

以下为 Phase 2–7 的任务骨架。每阶段开始前须按本文件同样格式（文件路径 + 逐步代码 + 验证命令 + 提交）展开为独立计划文件。

### Phase 2：宿主服务对齐（`phase2-host-services.md`）

- 窗口服务：`internal/host/window.go`（创建/激活/关闭/全屏/最小化），对应 `tabs:*` 21 个通道
- 标签条：`internal/host/tabs.go` + `internal/host/tabs_detached.go`（撕裂出窗，仅多窗口方案，不做 macOS child window）
- 原生菜单：`internal/host/menu.go`（`shell-menus.ts` 等价），含标签右键菜单、应用菜单
- 托盘：`internal/host/tray.go`（最小化到托盘/退出策略）
- 对话框：`internal/host/dialog.go` 移植 `dialog-memory.ts`（记住上次目录）
- 最近文件：`internal/host/recent.go` 移植 `recent-files.ts`（原子写 JSON）
- 单实例：`internal/host/singleinstance.go`（第二实例把启动路径交给首实例）
- 文件关联：`internal/host/associations.go`（注册 `.docx/.xlsx/.pptx/.pdf/.md`）
- 拖放：`internal/host/drop.go`（对应 `dropped-files.ts` + `drop-open-bridge.ts`）
- 设置扩展：`settings.go` 增加 `autoSaveDefault / defaultSaveDir / documentTheme`
- 出口 G2：未实现通道清单为空；`npm run typecheck` 通过

### Phase 3：文件系统与索引（`phase3-fs-index.md`）

- `internal/fsutil/pathguard` 扩展：默认根（文档目录、最近目录、用户选择目录）
- `internal/index/store.go`：modernc.org/sqlite + FTS5，schema 与 Electron `file-index/store.ts` 保持一致
- `internal/index/tokenize.go`：CJK bigram + unigram 与 JS 版分词结果对齐（对照测试用同一批语料）
- `internal/index/scan.go` / `extract.go` / `indexer.go` / `status.go` / `snippet.go`：逐文件移植
- `internal/bridge/search.go`：`home:search-files` 分页
- 出口 G3：1 万文档 P95 < 150ms；索引文件双向可读

### Phase 4：编辑器宿主（`phase4-editors.md`）

- 标签容器：`frontend/apps/shell/src/renderer/src/Tabs.tsx` + `TabFrame.tsx`（iframe + `keep-alive` 池）
- 兼容层扩展：`@yiioffice/wails-bridge` 增加 `desktop`（docs）、`slidesApi`/`desktop`（slides）、`desktopApi`（sheets）、`pdfApi`、`markdownApi`
- Go 侧按通道拆分：`internal/bridge/docs.go`、`slides.go`、`sheets.go`、`pdf.go`、`markdown.go`
- Rust xlsx sidecar：`internal/sidecar/xlsx.go`（`os/exec` + stdin/stdout JSON-RPC，取消 `--headless-export` 依赖）
- PDFium WASM 与 `officecrypto-tool`：评估 Go 侧替代（`github.com/pdfcpu/pdfcpu` 只做结构操作，加密 OOXML 需专门实现）→ 决策门 D7
- 出口 G4：5 个编辑器 fixtures 像素对比无差异

### Phase 5：导出与无头（`phase5-export.md`）

- 决策门 D6：`printToPDF` 替代方案三选一（WebView2 `PrintToPdf` COM / 外部 Chromium / Go PDF 渲染）
- `internal/export/headless.go`：`--headless-export <input> --to <fmt> --out <path> [--json]`，退出码与 Electron 对齐（`HEADLESS_EXIT` 常量表逐条对齐）
- `internal/export/print.go`：HTML→PDF 打印窗口
- 出口 G5：docx→pdf 分页一致

### Phase 6：打包与更新（`phase6-packaging.md`）

- `build/windows/`：图标、`wails.exe.manifest`、版本资源
- NSIS/MSIX 安装包（`wails3 package`），仅 Windows 目标
- 文件关联写入注册表 + 默认应用状态查询（对应 `default-app.ts`）
- 自动更新：Wails V3 内置 updater 或自建（决策门 D8）
- 代码签名（如具备证书）
- 出口 G6：干净 Windows 11 安装即用

### Phase 7：加固（`phase7-hardening.md`）

- 性能预算：冷启动、标签切换、内存、索引搜索
- 崩溃恢复：渲染进程 watchdog（`renderer-watchdog.ts` 等价）、窗口关闭守卫（`window-close-guard.ts`）
- E2E：Playwright 对 `http://wails.localhost` 跑既有 e2e 场景（可在 dev 模式）
- 日志与诊断包

---

## 7. 风险与回退

| 风险 | 触发信号 | 回退动作 |
| --- | --- | --- |
| iframe 内无法访问 `window.top.wails` | Task 8 判定规则失败 | 启用 postMessage 中继：shell 渲染层做总线，暴露 `invoke/on` 给子帧 |
| Wails beta API 变动 | `go build` 失败 | 仅修改 `internal/platform`；版本锁定 beta.28，升级需过 G1 |
| 渲染层出现 Node 内置模块依赖 | docs/shell Vite 构建报 `node:fs` | 该逻辑改走 Go 通道；禁止引入 polyfill |
| 标签内存过高 | Task 8 内存 > 800MB / 2 标签 | 采用 `keep-alive` 上限（如最多 5 个活跃 iframe）+ 非活跃标签 `src` 回收 |
| `printToPDF` 无等价物 | Phase 5 决策门 | 外部 Chromium 无头导出（复用现有 PDF 引擎） |
| 大量 `ipcMain.handle` 移植工作量 | Phase 2 通道清单收敛慢 | 按域分批交付，未实现通道统一返回结构化错误并在 Home 页提示 |

---

## 8. 自检清单（计划作者已执行）

- [x] 覆盖度：可行性评估中列出的 10 个方向全部映射到阶段（骨架→P1、桥接→P1/P4、宿主服务→P1/P2、标签架构→P1/P2、索引→P3、electron-utils→P2/P3、Rust sidecar→P4、打印/PDF→P5、编辑器迁移→P4、打包→P6）
- [x] 无占位符：每个任务含真实代码、真实命令、明确 Expected
- [x] 类型一致性：`Router.Handle/Invoke`、`DecodeArg[T]`、`Service.Invoke`、`SettingsStore` 方法在各任务间签名一致；前端 `invoke/on/runtime` 与 Go 侧 `Channel*` 常量逐项对应
- [x] 通道名与 Electron `HOME_CHANNELS` / `TABS_CHANNELS` 字面一致
- [x] Windows-only：无 mac/linux 文件、无跨平台构建目标、`RequireWindows()` 启动断言
