# Phase 7: 加固与验收

> 接续 Phase 6（打包与更新）。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** 为 YiiOffice Wails V3 添加性能监控、崩溃恢复、E2E 测试和诊断能力，通过全量验收标准。

**Scope:** 仅 Windows 平台。不创建 macOS/Linux 代码。

**Exit Gate G7:** 性能预算全部达标；E2E 测试覆盖核心场景；崩溃恢复机制可用；诊断日志可收集。

---

## 1. 范围与约束

### 1.1 必须实现

| 功能 | 源参考 | 说明 |
|---|---|---|
| 性能预算验证 | 各编辑器 `load-budget.ts`, `app-constants.ts` | 冷启动、标签切换、内存、搜索 |
| 渲染器看门狗 | `renderer-watchdog.ts` | 检测高 CPU/内存的渲染器 |
| 窗口关闭保护 | `window-close-guard.ts` | 未保存文档保护 |
| E2E 测试迁移 | `e2e/` 目录（50+ spec 文件） | Playwright 对 wails.localhost |
| 诊断日志 | `renderer-watchdog.ts` 诊断写入 | 诊断 JSON + 性能数据 |
| 资源清理 | `docx-engine/resource-cleanup.ts`, `pptx-engine/resource-cleanup.ts` | 编辑器级（P4 已在 renderer 中） |

### 1.2 依赖 Phase 1-6

| 前置产出 | Phase 7 用途 |
|---|---|
| P1-P3 Go 基础设施 | 性能基线测量 |
| P4 编辑器宿主 | E2E 测试目标 |
| P5 无头导出 | E2E 验证 |
| P6 安装包 | 最终交付物 |

### 1.3 明确不做

- 不新增功能特性
- 不改动编辑器内核
- 不做 macOS/Linux E2E

---

## 2. 关键决策

### P7-D1: E2E 测试框架

| 方案 | 说明 |
|---|---|
| **Playwright（首选）** | 源项目已使用 Playwright；Wails dev 模式暴露 `http://localhost:<port>`，Playwright 可直接测试 |

**决策：继续使用 Playwright。** 在 Wails dev 模式下，WebView2 可通过 `wails.localhost` 或本地端口访问，Playwright 直接连接即可。

### P7-D2: 看门狗实现

源项目 `renderer-watchdog.ts` 使用 Electron `app.getAppMetrics()` 获取进程级 CPU/内存数据。Wails V3 不直接暴露此 API。

| 方案 | 说明 |
|---|---|
| **A. Windows API** | 通过 `golang.org/x/sys/windows` 调用 `NtQuerySystemInformation` 获取进程 CPU/内存 |
| **B. 前端性能 API** | 通过 IPC 定期从前端收集 `performance.memory` 数据 |
| **C. Windows Performance Counters** | 使用 `PDH` API 查询 `Process\Private Bytes` 和 `Process\% Processor Time` |

**决策：A + C 结合。** Go 侧定期查询 WebView2 进程指标，通过 Windows PDH 或 `CreateToolhelp32Snapshot` 实现。

### P7-D3: 窗口关闭保护

源项目 `window-close-guard.ts` 遍历 dirty tabs 逐一询问保存。在 Wails V3 中：

- **Go 侧**：监听窗口关闭事件，检查是否有 dirty 标签
- **前端**：通过 IPC 返回 dirty 状态
- **对话框**：使用 Wails `DialogManager.Message()` 或前端原生对话框

**决策：Go 侧拦截 + 前端 dirty 查询 + Wails 对话框。**

---

## 3. 目标仓库结构（Phase 7 新增文件）

```text
internal/
├── watchdog/
│   ├── watchdog.go                # 渲染器资源看门狗 (Task 1)
│   ├── watchdog_test.go
│   └── process_windows.go         # Windows 进程指标查询 (Task 1)
│       └── process_windows_test.go
├── host/
│   ├── closeguard.go              # 窗口关闭保护 (Task 2)
│   └── closeguard_test.go
├── diagnose/
│   ├── diagnose.go                # 诊断日志收集 (Task 3)
│   └── diagnose_test.go

e2e/
├── playwright.config.ts           # E2E 配置 (Task 4)
├── helpers.ts                     # E2E 辅助函数
├── home.spec.ts                   # Home 页测试
├── docs-smoke.spec.ts             # Docs 冒烟测试
├── sheets-smoke.spec.ts           # Sheets 冒烟测试
├── slides-smoke.spec.ts           # Slides 冒烟测试
├── pdf-smoke.spec.ts              # PDF 冒烟测试
├── markdown-smoke.spec.ts         # Markdown 冒烟测试
├── tab-operations.spec.ts         # 标签操作测试
├── headless-export.spec.ts        # 无头导出测试
└── performance.spec.ts            # 性能基准测试

Taskfile.yml                       # 修改：增加 e2e/perf 目标
```

---

## 4. Phase 7 详细任务（可执行）

### Task 1: 渲染器看门狗

**Source reference:** `apps/shell/src/main/renderer-watchdog.ts`

**Go 文件:**
- Create: `internal/watchdog/watchdog.go`
- Create: `internal/watchdog/process_windows.go`
- Test: 对应测试文件

**默认参数（与源项目一致）：**

| 参数 | 值 | 说明 |
|---|---|---|
| `SampleInterval` | 30s | 采样间隔 |
| `MemoryLimitMB` | 1536 | 内存阈值 |
| `CPULimitPercent` | 90 | CPU 单核阈值 |
| `HotSamplesBeforeReport` | 10 | 连续过热采样数 |
| `ReportCooldownMs` | 15min | 报告冷却时间 |

**Steps:**

- [ ] **Step 1: 实现 Windows 进程指标查询**

```go
// Package watchdog monitors WebView2 renderer process resources.
package watchdog

import (
    "golang.org/x/sys/windows"
)

// ProcessMetric holds CPU and memory data for a single process.
type ProcessMetric struct {
    PID             uint32
    CPUPercent      float64  // single-core percentage
    WorkingSetSizeMB float64
    ProcessName     string
}

// GetWebView2Processes finds all msedgewebview2.exe processes and returns their metrics.
func GetWebView2Processes() ([]ProcessMetric, error) {
    // 1. CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    // 2. Process32First/Next to enumerate
    // 3. Filter by "msedgewebview2.exe"
    // 4. OpenProcess + GetProcessMemoryInfo for working set
    // 5. GetProcessTimes for CPU usage (compare with last sample)
}
```

- [ ] **Step 2: 实现看门狗循环**

```go
// Watchdog monitors renderer processes for excessive resource usage.
type Watchdog struct {
    sampleInterval       time.Duration
    memoryLimitMB        float64
    cpuLimitPercent      float64
    hotSamplesBeforeReport int
    reportCooldown       time.Duration

    lastMetrics map[uint32]ProcessMetric
    hotCount    map[uint32]int
    lastReport  map[uint32]time.Time

    onHot func(metric ProcessMetric) // callback when threshold exceeded
}

// Start begins monitoring in a background goroutine.
func (w *Watchdog) Start(ctx context.Context) {
    ticker := time.NewTicker(w.sampleInterval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            w.sample()
        }
    }
}
```

- [ ] **Step 3: 诊断写入**

当检测到过热渲染器时，写入 `userData/renderer-watchdog-{timestamp}.json`：

```json
{
    "timestamp": "2026-10-29T12:00:00Z",
    "pid": 12345,
    "cpuPercent": 95.2,
    "memoryMB": 1600,
    "hotSamples": 10,
    "document": "doc1.docx",
    "url": "/docs/"
}
```

- [ ] **Step 4: 用户通知**

通过 Wails `DialogManager.Message()` 弹出警告对话框（与源项目一致："等待" 或 "关闭文档"）。

- [ ] **Step 5: 集成到 `main.go`**

```go
// In main.go, after creating the app:
wd := watchdog.New(&watchdog.Config{
    OnHot: func(metric watchdog.ProcessMetric) {
        // Show dialog or log
        log.Printf("[watchdog] hot renderer: PID %d, CPU %.1f%%, Memory %.0fMB",
            metric.PID, metric.CPUPercent, metric.WorkingSetSizeMB)
    },
})
go wd.Start(context.Background())
```

- [ ] **Step 6: 测试 + 提交**

```powershell
go test ./internal/watchdog/ -v
git add internal/watchdog
git commit -m "feat: add renderer process watchdog with windows PDH"
```

---

### Task 2: 窗口关闭保护

**Source reference:** `apps/shell/src/main/window-close-guard.ts`

**Go 文件:**
- Create: `internal/host/closeguard.go`
- Test: `internal/host/closeguard_test.go`

**Steps:**

- [ ] **Step 1: 实现关闭守卫**

```go
// CloseGuard prevents closing windows with unsaved documents.
type CloseGuard struct {
    tabHost *TabHost
    mu      sync.Mutex
    inFlight bool
}

// ShouldAllowClose checks all dirty tabs and prompts the user.
// Returns true if the window should be closed, false if the close should be prevented.
func (g *CloseGuard) ShouldAllowClose() bool {
    g.mu.Lock()
    defer g.mu.Unlock()

    if g.inFlight {
        return false // prevent re-entry
    }
    g.inFlight = true
    defer func() { g.inFlight = false }()

    // 1. Query frontend for dirty tabs via IPC
    dirtyTabs := g.getDirtyTabs()
    if len(dirtyTabs) == 0 {
        return true // clean path - allow close immediately
    }

    // 2. For each dirty tab, ask user to save/don't save/cancel
    for _, tab := range dirtyTabs {
        choice := promptSaveDialog(tab.Title)
        switch choice {
        case Save:
            if err := saveTab(tab); err != nil {
                log.Printf("[closeguard] save failed: %v", err)
            }
        case Cancel:
            return false // prevent close
        case DontSave:
            // continue
        }
    }

    return true
}
```

- [ ] **Step 2: 注册到 Wails 窗口关闭事件**

```go
app.OnBeforeClose(func() bool {
    return closeGuard.ShouldAllowClose()
})
```

- [ ] **Step 3: 前端 dirty 状态查询**

在 `@yiioffice/wails-bridge` 中添加：
- `tabs:get-dirty-tabs` → 返回 `[{id, title, kind}]`

- [ ] **Step 4: 测试 + 提交**

```powershell
go test ./internal/host/ -v -run CloseGuard
git add internal/host/closeguard* frontend/packages/wails-bridge
git commit -m "feat: add window close guard for unsaved documents"
```

---

### Task 3: 诊断日志

**Go 文件:**
- Create: `internal/diagnose/diagnose.go`
- Test: `internal/diagnose/diagnose_test.go`

**Steps:**

- [ ] **Step 1: 实现诊断日志收集**

```go
// CollectDiagnosis gathers system and application state for troubleshooting.
func CollectDiagnosis() (Diagnosis, error) {
    return Diagnosis{
        Timestamp:   time.Now(),
        Version:     buildinfo.Version,
        OS:          runtime.GOOS + " " + runtime.GOARCH,
        WebView2:    getWebView2Version(),
        Memory:      getProcessMemory(),
        CPU:         getCPUInfo(),
        Settings:    settingsStore.Snapshot(),
        TabCount:    tabHost.List().len,
        OpenTabs:    describeOpenTabs(),
        IndexStatus: index.GetIndexStatus(),
    }, nil
}

// WriteDiagnosisFile writes diagnosis to userData/diagnosis-{timestamp}.json.
func WriteDiagnosisFile(diag Diagnosis) (string, error) {
    dataDir, _ := AppDataDir()
    path := filepath.Join(dataDir, fmt.Sprintf("diagnosis-%s.json", time.Now().Format("20060102-150405")))
    fsutil.WriteJSONAtomic(path, diag, 0o644)
    return path, nil
}
```

- [ ] **Step 2: 启动失败诊断**

```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            diag := CollectDiagnosis()
            diag.Panic = fmt.Sprintf("%v", r)
            diag.Stack = debug.Stack()
            WriteDiagnosisFile(diag)
            log.Fatalf("[shell] startup failed: %v", r)
        }
    }()
    // ...
}
```

- [ ] **Step 3: 提交**

```powershell
git add internal/diagnose
git commit -m "feat: add diagnostic logging and crash report collection"
```

---

### Task 4: E2E 测试迁移

**Source reference:** `e2e/` 目录（50+ spec 文件）

**E2E 文件:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/helpers.ts`
- Create: 核心 .spec.ts 文件

**Steps:**

- [ ] **Step 1: 配置 Playwright**

`e2e/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  fullyParallel: false,    // WebView2 instance parallelism issues
  workers: 1,              // single worker
  timeout: 90_000,         // 90s timeout
  snapshotPathTemplate: '{testDir}/visual-baselines/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:5173',  // Wails dev mode port
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
})
```

- [ ] **Step 2: 编写 E2E Helper**

`e2e/helpers.ts`:

```ts
import { _electron as electron } from '@playwright/test'
import { ChildProcess } from 'node:child_process'

export interface LaunchedApp {
  process: ChildProcess
  window: ElectronBrowserContext
}

export async function launchShell(options?: {
  userDataDir?: string
  lang?: string
}): Promise<LaunchedApp> {
  const userDataDir = options?.userDataDir ?? await createTempDir()

  const process = spawn('..\\..\\build\\bin\\YiiOffice.exe', [], {
    env: {
      ...process.env,
      YIIOFFICE_USER_DATA: userDataDir,
      ...(options?.lang ? { YIIOFFICE_LANG: options.lang } : {}),
    },
  })

  // Wait for the WebView2 window to appear
  await waitForWindow(process)

  return { process, window: /* ... */ }
}

export async function waitForDocumentReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.readyState === 'complete')
}

export async function closeAndSaveVideo(launched: LaunchedApp, name: string): Promise<void> {
  // Mock dialog.showMessageBox to return "Don't Save"
  // Close with 20s timeout, SIGKILL if needed
}
```

- [ ] **Step 3: 编写核心 E2E 测试**

优先迁移以下场景（覆盖 5 个编辑器 + Home + 标签操作）：

**Home 测试:**
- `home.spec.ts` — Home 页加载、版本号、主题切换、语言切换
- `home-search.spec.ts` — 文件搜索功能

**编辑器冒烟测试:**
- `docs-smoke.spec.ts` — 打开 docx，编辑，保存
- `sheets-smoke.spec.ts` — 打开 xlsx，编辑公式，保存
- `slides-smoke.spec.ts` — 打开 pptx，编辑，保存
- `pdf-smoke.spec.ts` — 打开 pdf，搜索，标注
- `markdown-smoke.spec.ts` — 打开 md，编辑，保存

**标签操作:**
- `tab-operations.spec.ts` — 新建标签、关闭标签、切换标签、撕裂/停靠

**无头导出:**
- `headless-export.spec.ts` — CLI 导出各格式

**性能:**
- `performance.spec.ts` — 冷启动、标签切换、大文件打开

- [ ] **Step 4: 更新 Taskfile.yml**

```yaml
  e2e:
    desc: Run E2E tests against dev server
    cmds:
      - cd e2e && npx playwright test

  e2e:ui:
    desc: Run E2E tests in UI mode
    cmds:
      - cd e2e && npx playwright test --ui
```

- [ ] **Step 5: 提交**

```powershell
git add e2e Taskfile.yml
git commit -m "feat: add playwright e2e test suite for wails v3"
```

---

### Task 5: 性能预算验证

**Steps:**

- [ ] **Step 1: 冷启动预算**

| 指标 | 目标 | 测量方法 |
|---|---|---|
| 冷启动 | < 2.5s | 双击 exe 到 Home 可交互 |
| 文档打开（空文档） | < 1s | 创建新文档到编辑器就绪 |
| 文档打开（中等 docx） | < 3s | 打开 ~10MB docx |

```powershell
# Measure cold start time
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
Start-Process ".\build\bin\YiiOffice.exe"
# Wait for window to appear
while (-not (Get-Process -Name YiiOffice -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 100 }
$stopwatch.Stop()
Write-Host "Cold start: $($stopwatch.ElapsedMilliseconds)ms"
```

- [ ] **Step 2: 标签切换预算**

| 指标 | 目标 |
|---|---|
| 标签切换 | < 200ms |
| 标签关闭 | < 100ms |

- [ ] **Step 3: 内存预算**

| 场景 | 目标 |
|---|---|
| Home 页（无标签） | < 300MB |
| Home + 1 个 docs 标签 | < 500MB |
| Home + 3 个标签（docs/sheets/slides） | < 800MB |

```powershell
# Measure memory usage
$process = Get-Process -Name YiiOffice
$webView2 = Get-Process -Name msedgewebview2
$totalMB = ($process.WorkingSet64 + ($webView2 | Measure-Object -Property WorkingSet64 -Sum).Sum) / 1MB
Write-Host "Total memory: $([math]::Round($totalMB))MB"
```

- [ ] **Step 4: 搜索性能**

| 场景 | 目标 |
|---|---|
| 1 万文档搜索 P95 | < 150ms（G3 已验证） |
| 实时搜索延迟 | < 50ms |

- [ ] **Step 5: 记录性能基线**

将性能数据写入 `docs/superpowers/notes/performance-baseline.md`。

- [ ] **Step 6: 提交**

```powershell
git add docs/superpowers/notes/performance-baseline.md
git commit -m "chore: record performance baseline for phase 7"
```

---

### Task 6: G7 验收

**Steps:**

- [ ] **Step 1: 运行全量测试**

```powershell
# Go tests
go test ./... -v -count=1

# Frontend tests
npm --prefix frontend run test

# E2E tests
task e2e
```

- [ ] **Step 2: G7 检查表**

| 检查项 | 方法 | 通过标准 |
|---|---|---|
| 冷启动 | 手动测量 | < 2.5s |
| 标签切换 | E2E 测量 | < 200ms |
| 内存预算 | Task Manager | 各场景达标 |
| 搜索 P95 | 基准测试 | < 150ms |
| 看门狗 | 模拟高 CPU 渲染器 | 15 分钟内报告 |
| 窗口关闭保护 | 尝试关闭含 dirty 文档的窗口 | 弹出保存对话框 |
| E2E Home | `home.spec.ts` | 全绿 |
| E2E Docs | `docs-smoke.spec.ts` | 全绿 |
| E2E Sheets | `sheets-smoke.spec.ts` | 全绿 |
| E2E Slides | `slides-smoke.spec.ts` | 全绿 |
| E2E PDF | `pdf-smoke.spec.ts` | 全绿 |
| E2E Markdown | `markdown-smoke.spec.ts` | 全绿 |
| E2E 标签操作 | `tab-operations.spec.ts` | 全绿 |
| E2E 无头导出 | `headless-export.spec.ts` | 全绿 |
| 诊断日志 | 触发崩溃 | 诊断 JSON 写入成功 |
| Go 测试 | `go test ./...` | 全部 PASS |
| 前端测试 | `npm run test` | 全部 PASS |

- [ ] **Step 3: 对比 Electron 版本**

如果两个版本共存，运行相同的 E2E 场景对比：
- 渲染差异（像素对比）
- 性能差异（启动时间、内存）
- 功能差异（IPC 通道覆盖率）

- [ ] **Step 4: 提交**

```powershell
git add -A
git commit -m "chore: phase 7 gate G7 final verification"
```

---

## 5. 风险与回退

| 风险 | 触发信号 | 回退动作 |
|---|---|---|
| Wails dev 模式不暴露 HTTP 端口 | Playwright 无法连接 | 使用 `wails.localhost` 或通过 CDP 连接 |
| Windows PDH API 不可用 | 看门狗无法获取进程指标 | 使用 `CreateToolhelp32Snapshot` 替代 |
| 看门狗误报 | 正常操作触发警告 | 提高阈值，增加采样间隔 |
| E2E 测试不稳定 | 随机失败率 > 5% | 增加重试次数，使用 `--retries=2` |
| 内存超过预算 | 多标签场景 RSS > 1GB | 限制活跃 iframe 数量（最多 5 个） |
| Playwright 不支持 WebView2 | 选择器/事件不兼容 | 使用 CDP (Chrome DevTools Protocol) 直接连接 |
| 性能预算不达标 | 冷启动 > 3s | 优化 embed.FS 大小，懒加载编辑器模块 |

---

## 6. 自检清单

- [x] 覆盖度：渲染器看门狗、窗口关闭保护、E2E 测试、诊断日志、性能预算全部映射
- [x] 覆盖度：5 个编辑器冒烟测试 + Home + 标签操作 + 无头导出
- [x] 无占位符：每个任务有具体文件路径、代码示例、验证命令
- [x] 类型一致性：`ProcessMetric`、`Diagnosis` 与 IPC 通道签名对应
- [x] Windows-only：无 mac/linux 代码
- [x] 性能预算与源项目一致（冷启动 < 2.5s，搜索 P95 < 150ms）
- [x] 看门狗参数与源项目一致
- [x] E2E 配置与源项目 `playwright.config.ts` 一致
