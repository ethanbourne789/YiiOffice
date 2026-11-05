# P1 缺陷修复报告（2026-11-05）

> 依据：`docs/CODE-REVIEW-2026-11-05.md` 第九节「P1 · 本迭代」。
> 原则：只做与缺陷直接相关的最小改动，不做无关重构；`wails3 dev` / `task build` / `task run:docker` 的运行方式不变。

## 一、修复范围与验收标准

| 编号 | 问题 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| C-01 | 版本号 `0.13.0` 硬编码 18+ 文件，无一致性校验 | `task version:check` 全绿；CI 有独立 job 把关 | ✅ |
| C-08 | 无 `release.yml`，发布流程不可复现 | tag 触发即可产出安装包 + SHA-256 | ✅ |
| C-02 | 无 lint 门禁（ESLint / golangci） | `npm run lint` 零错误并接入 CI | ⚠️ 部分（golangci 见「剩余风险」） |
| F-01 | 关闭提示只有「放弃/取消」，「保存」分支不可达 | 三态提示；选「保存」后真正落盘再退出 | ✅ |
| V-M1/M2/F-02 | SettingsStore / TabHost / Index Lifecycle 共享状态竞态 | 竞态用例覆盖；`-race` 可跑的包无告警 | ✅ |
| Q-05/Q-06/V-M3 | 持久化与查询错误被丢弃 | 写盘/`rows.Err()`/`GetBody` 错误上抛或结构化记录 | ✅ |
| V-M4/M5 | `context.Background()` 无超时、打印机枚举阻塞 | 统一超时；子进程受 `CommandContext` 约束 | ✅ |
| T-02/T-06 | `apps/shell`、`apps/slides` 零测试且被静默跳过 | 两个 workspace 有测试与配置，根 `test` 不再 `--if-present` | ✅ |
| S-04 | 未跟踪一次性产物 + `.gitignore` 缺口 | `git status --short` 只剩有意交付物 | ✅ |

## 二、已修复项与改动摘要

### 2.1 版本单一来源与发布门禁（C-01 / C-08）

- 新增 `VERSION`：唯一权威版本号。
- 新增 `tools/version.mjs`：显式槽位校验/改写（`check` / `bump` / `check-tag`）。**不做全仓正则替换**——`package-lock.json` 里有数百个形如 `x.y.z` 的依赖版本，全局替换会误伤。当前覆盖 18 个文件、38 个槽位。
- `Taskfile.yml`：新增 `version:check`、`version:bump`；`VERSION` 默认值改为读 `VERSION` 文件；`package:windows` 与 `build:server` 的版本经由同一变量下传（NSIS 不再自行取默认值）。
- `.github/workflows/ci.yml`：新增独立的 `version` job；`tags: ['v*.*.*']` 触发。
- 新增 `.github/workflows/release.yml`：tag 触发 → 校验 `VERSION`/tag 一致性 → 构建安装包与 `.sha256` → 发布。

### 2.2 关闭保存三态（F-01）

根因是**协议缺失而非逻辑缺陷**：前端 5 个编辑器早已实现 `onCloseSaveRequest` / `reportCloseSaveResult` 的保存与回报逻辑（`docs/.../App.tsx`、`sheets/desktop-api-bridge.ts` 等，注释里标着 "stub: Phase 5"），但 Go 侧从未发射过请求、也没有接收回报的通道，`platform.ConfirmDiscardChanges` 又只有 YES/NO 两态，于是 `host/closeguard.go` 的 `case Save` 成了死代码。

本次把这条协议接通，并采用「两阶段关闭」避免 UI 线程死锁（关闭守卫跑在 UI 线程，同步等待渲染器保存会阻塞消息循环）：

1. `internal/platform/closeconfirm_windows.go`：`ConfirmDiscardChanges` → `ConfirmCloseWithSave`，`MB_YESNOCANCEL`，返回 `CloseSave / CloseDiscard / CloseCancel`。默认按钮改为 **Yes**——原实现的默认是「放弃」，误按回车即丢数据。
2. `internal/host/closeguard.go`：`ShouldAllowClose` 先收集所有选「保存」的标签页，再一次性交给 `OnSaveRequested` 并**拒绝本次关闭**。未配置该回调时仍走原来的同步 `SaveTab`，既有语义与测试不变。
3. 新增 `internal/host/closeflow.go`：`CloseFlow` 管理请求序号、挂起状态与退出重试。**过期应答被丢弃**（用户重试关闭时，旧请求的迟到答复不能关窗）；保存失败不退出，窗口保留供用户重试或改选「不保存」。
4. `main.go`：`RequestSave` 通过 `app:close-save-request` 发给前端；`OnEvent("app:close-save-result")` 收到 `ok:true` 后重试 `app.Quit()`，此时脏标记已清空，`ShouldQuit` 直接放行。
5. `frontend/apps/shell/src/renderer/src/close-save.ts`：收到请求后**直接调用**各 iframe 暴露的 `__yiiofficeCloseSave`（同源 iframe，`contentWindow` 直调。事件是广播到窗口的，无法确定落在哪个 iframe，直接调用更可靠），逐个顺序保存（避免同一文档双开时并发写同一文件），汇总后回报。
6. 5 个编辑器（docs / sheets / slides / pdf / markdown）各注册一个 `__yiiofficeCloseSave`，内部复用各自既有的保存实现（docs 的 `saveUntilPersisted`、sheets 的 `closeSaveRef`、pdf 的 `save()` 等），**未新增保存逻辑**。

关键取舍：iframe 找不到保存钩子时按**失败**处理（关窗被拒绝），而不是当作「没什么要保存的」——后者正是这个握手要防的静默丢失。

### 2.3 并发竞态（V-M1 / V-M2 / F-02）

- `internal/host/settings.go`：`Snapshot` 返回深拷贝（map 字段同步克隆），`update` 在锁内构造不可变快照后再写盘，避免调用方读到正在被改写的 map。
- `internal/host/tabhost.go`：`ActiveTab` / `GetByID` 返回副本而非内部指针，锁外调用方无法改宿主状态。
- `internal/index/lifecycle.go`：加互斥保护 `SyncRoots` 与 `Shutdown` 的交错；首次扫描 goroutine 加 `recover`，并纳入 `WaitGroup`，`Shutdown` 会等待其退出。

### 2.4 错误上抛（Q-05 / Q-06 / V-M3）

- `internal/host/recentfiles.go`、`foldertree.go`：`fsutil.WriteJSONAtomic` 的返回值不再丢弃，统一 `reportPersistError`（结构化日志 + 一次用于提示的失败标记）；反序列化失败从 `fmt.Printf` 改为 `platform.Logger()`。
- `internal/index/store.go`：`Search` / `ListFiles` 补 `rows.Err()` 检查，游标中途失败不再当成「没有更多结果」。
- `internal/bridge/homeservice.go`：`CountFiles` / `GetBody` 错误不再静默降级为 0 / 空串。
- `internal/workbook/reads.go`：`fillValue` 返回错误，批量填充失败不再静默跳过。
- `internal/host/recentfiles.go`：`GetStarredGroups` 返回副本（原返回内部切片，调用方可无锁改写）。

### 2.5 超时与取消（V-M4 / V-M5）

- `internal/bridge/pdfservice.go`：12 处 `context.Background()` 改为统一的 `pdfOpTimeout` 上下文。
- `internal/update/service.go`：`Check` / `DownloadAndInstall` / `Restart` 分别加超时上下文（下载用更长的超时）。
- `internal/platform/print_windows.go`：PowerShell 打印机枚举改用 `exec.CommandContext` + 超时，并缓存结果。

### 2.6 测试与覆盖率（T-02 / T-06）

- 新增 `frontend/apps/shell/vitest.config.ts`、`frontend/apps/slides/vitest.config.ts` 与首批单测（`search-state.test.ts`、`recent-colors.test.ts`、`close-save.test.ts`）。
- 根 `test` / `typecheck` 去掉 `--if-present`：缺测试脚本的 workspace 现在会显式失败，而不是被静默跳过。
- 接入 `@vitest/coverage-v8`，`test:coverage` 可产出基线。
- 前端 lint：新增 `frontend/eslint.config.mjs`（ESLint 10 flat config），覆盖 JS/MJS 工具脚本；TS 仍由 `tsc --noEmit` 把关（原因见下）。

### 2.7 产物清理（S-04）

- `.gitignore` 新增 `frontend/**/coverage/`、`/build/verification/`。
- `ERROR-LOCALIZATION-REPORT.md` → `docs/archive/ERROR-LOCALIZATION-REPORT.md`，31 处 `file:///e:/Dev/YiiOffice-WailsV3/...` 绝对链接改写为仓库相对路径。

## 三、验证结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Go 静态检查 | `go vet ./...` | ✅ 通过 |
| Go 全量测试 | `go test ./internal/...` | ✅ 13 个包全绿 |
| Go 构建（桌面） | `go build .` | ✅ |
| Go 构建（server+production） | `go build -tags server,production .` | ✅ |
| 前端类型检查 | `npm run typecheck`（17 个 workspace） | ✅ 全通过 |
| 前端单测 | `npm test`（全 workspace） | ✅ 全通过（约 4100 例，含新增 6 例 shell 用例） |
| 前端 lint | `npm run lint` | ✅ 0 错误 |
| 版本一致性 | `task version:check` | ✅ 18 文件 / 38 槽位 |
| YAML 语法 | `js-yaml` 解析 ci.yml / release.yml / Taskfile.yml | ✅ |
| 空白检查 | `git diff --check` | ✅ 无问题 |
| `go test -race` | — | ⚠️ **未执行**：本机 `CGO_ENABLED=1` 缺 gcc（环境限制，非代码失败）。CI 的 race job 覆盖 `internal/workbook`，本轮改动的 `host` / `index` 尚未纳入 |

本轮新增测试：Go 侧 7 个用例（`internal/host/closeflow_test.go`，覆盖延迟保存、取消、过期应答、畸形载荷、失败不退出）+ 前端 6 个用例（`close-save.test.ts`，覆盖成功/失败/缺钩子/抛异常/非法载荷）。P1 全量累计新增 Go 测试函数 19 个、前端用例 12 个。

## 四、剩余风险

1. **关闭保存未在真实 GUI 上跑通**：本机无法启动 WebView2 桌面实例，握手链路只经单测与类型检查覆盖。首次发版前需人工验一遍「改文档 → 关窗 → 选保存 → 文件落盘 → 退出」。
2. **C-02 只落地一半**：ESLint 已进 CI，但 `golangci-lint` 未接入。原因是仓库没有历史基线，直接开 `errcheck`/`staticcheck` 大概率一次性报出数百条既存问题，会让 CI 立刻变红。建议先本地跑一遍收集基线，再分批收敛后开闸。
3. **TypeScript 侧的 lint 是空白**：`typescript-eslint@8` 硬性要求 TypeScript `<6.1.0`，而项目在 TS 7.0.2。强装会破坏依赖树，因此 TS 源码目前只靠 `tsc --noEmit` 把关。等 typescript-eslint 支持 TS 7 后再补。
4. **保存握手依赖 iframe 暴露钩子**：钩子缺失 = 关窗被拒（安全侧），但如果某个编辑器将来换了挂载方式而忘记注册钩子，用户会反复遇到「关不掉」。`close-save.ts` 里已有 `console.warn` 便于定位。
5. **`go test -race` 覆盖缺口**：本轮改动的 `internal/host`、`internal/index` 不在 CI 的 race job 内（该 job 目前只跑 `internal/workbook`，因为 Windows runner 没有 gcc）。建议在 Linux runner 上扩大范围。
6. **版本号仍是 `0.13.0`**：本轮只建立机制，未改版本。发版时用 `task version:bump 0.14.0` 一次性改写全部槽位。

## 五、待确认信息

- `golangci-lint` 是否接受「先建基线、再分批收敛」的节奏？还是要求本轮就开闸并一次性修完？
- `release.yml` 的资产命名（`YiiOffice-Setup-<ver>.exe` + `.sha256`）是否与现有 updater 的期望一致？`docs/releasing.md` 里描述的旧资产名与之不同，需要确认以哪个为准。
- 关闭保存时，若某个文档是**从未保存过的新文档**，`save()` 会弹出原生「另存为」对话框。这是期望行为，还是应当静默存到默认目录？（docs 目前是静默落盘，其余应用会弹框，两种行为不一致。）
- `docs/archive/` 下归档的一次性报告是否保留在仓库？如果不希望长期留存，可以在下次清理中移除。
