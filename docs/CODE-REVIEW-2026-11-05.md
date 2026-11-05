# YiiOffice 全面代码评审报告

| 项 | 说明 |
| --- | --- |
| 评审日期 | 2026-11-05 |
| 评审对象 | `E:/Dev/YiiOffice-WailsV3`（Wails v3 桌面 Office 套件，v0.13.0） |
| 评审范围 | 顶层入口与配置、`internal/` 全部 Go 代码、`frontend/` 自身源码（排除 node_modules/dist/bindings 生成物）、`e2e/`、`docs/`、`build/`、`dist/`、`docker/`、`site/`、`.github/`、`.gitignore` |
| 评审方式 | 三路并行子域审阅 + 关键结论逐条回读源码复核 + git 跟踪状态/数量统计核对；**全程只读，未修改任何项目文件** |
| 路径约定 | 除特别标注外，文中路径均**相对于仓库根** `E:/Dev/YiiOffice-WailsV3` |
| 严重度 | **高**＝可直接导致越权读写、数据损坏、白屏、供应链/远程风险；**中**＝特定条件下触发的功能错误、竞态、资源或性能缺陷、工程质量缺口；**低**＝可维护性、命名、死代码、文档细节 |

> 统计口径（本次实测）：`internal/` 139 个 `.go`（其中 62 个 `*_test.go`）；`frontend/apps` + `frontend/packages` 共 1528 个 `.ts/.tsx`（其中 425 个 `*.test.*`）；`e2e/specs` 13 个 `.spec.ts`（79 处 `test`/`test.fixme` 定义，其中 6 个 `fixme`）；`docs/` 2 篇；CI 5 个 job。

---

## 一、技术栈与运行方式

### 1.1 技术栈

| 层 | 选型 | 依据 |
| --- | --- | --- |
| 桌面运行时 | **Wails v3.1.0**（Go 后端 + 系统 WebView2），仅 Windows（`main.go:1` `//go:build windows`） | `go.mod:9`、`main.go`、`config.yml` |
| 后端 | **Go 1.27**；10 个直接依赖：`wails/v3`、`excelize/v2 2.11.1`、`pdfcpu 0.16.4`、`modernc.org/sqlite 1.61.1`（FTS5）、`fsnotify 1.10.1`、`go-toast/v2`、`golang.org/x/{mod,sync,sys,text}` | `go.mod` |
| 前端 | **React 19.3 + TypeScript 7.0 + Vite 8.3.5**，npm workspaces monorepo（6 apps / 12 packages），`tsconfig.base.json` 开启 `strict` | `frontend/package.json`、`tsconfig.base.json` |
| 编辑器内核 | Docs/Markdown：Tiptap 3 + docx-engine；Sheets：Univer 1.3 + xlsx-gateway + Go excelize；Slides：Konva 10 + pptx-engine/ops/render；PDF：pdf.js 6.5 + Go pdfcpu；源码视图：CodeMirror 6 | `frontend/apps/*/package.json` |
| 数据/配置 | SQLite FTS5 全文索引（`file-index.db`）、JSON 原子写持久化（settings/recent/starred/folder-roots）、无账号体系、无云端 | `internal/index`、`internal/host`、`internal/fsutil` |
| 工程化 | Task（go-task）编排、NSIS 安装包 + SHA-256 sidecar、GitHub Actions CI（5 job）、Vitest 5 + Playwright E2E、distroless Docker | `Taskfile.yml`、`.github/workflows/ci.yml` |

### 1.2 运行与构建方式

```bash
# 开发（生成 bindings → Vite :5178 → 热重建 → 运行）
cd frontend && npm install && cd .. && wails3 dev

# 生产构建与打包
task build                    # build/bin/YiiOffice.exe，-tags production，ldflags 注入版本
task package:windows          # NSIS 安装包 + dist/*.sha256
task build:server             # -tags server 纯 HTTP（无 GUI）
task build:docker             # distroless 镜像
task run:docker               # -p 8080:8080
task e2e                      # Playwright 驱动 server 构建（真实 Go 后端）

# 无界面导出（复用桌面二进制的 CLI 分支，退出码 0/1/2/3）
YiiOffice.exe --headless-export <输入> --to pdf|html --out <输出> [--json]

# 测试与门禁
go vet ./... && go test ./internal/...
npm --prefix frontend run typecheck && npm --prefix frontend test && npm --prefix frontend run build
```

### 1.3 三种构建形态

| 形态 | 开关 | 用途 | 关键差异 |
| --- | --- | --- | --- |
| Desktop | 默认（+ `production`） | 正式 GUI | 单实例、系统托盘、拖放、WebView2 预检；`production` 关闭 DevTools、日志提到 Warn（`devtools_*.go`、`main.go:40-48`） |
| Server | `-tags server` | E2E / CI / Docker | 无 WebView2、无原生窗口；全部 bindings 以 HTTP 暴露（`main.go:236-287`） |
| Headless export | 运行时 `--headless-export` | 命令行格式转换 | 跳过冷索引扫描、跳过单实例、预授权输入/输出路径、隐藏窗口 + ready/done 握手与超时（`main.go:84-101,400-417`） |

---

## 二、项目整体结构与目录组织

### 2.1 结构地图

```
main.go                     Wails 入口：装配、窗口/托盘、单实例、headless 分支
internal/
  bridge/       13 个 Wails 绑定服务 + 写授权 + 原子保存 + 错误码/事件
  host/         设置、最近文件、文件夹树、标签宿主、关闭守卫、文件关联
  index/        SQLite FTS5 索引 + fsnotify 监听 + CJK 分词 + 摘要
  workbook/     excelize 工作簿引擎（会话、加密容器、读写、Recalc）
  pdfengine/    pdfcpu 页面操作（合并/拆分/裁剪/插图/N-Up）
  export/       headless CLI 参数、调度、结果信封、退出码
  update/       Gitee/GitHub 更新通道、SHA-256 sidecar、只读版本检查
  platform/     Win32 能力（打印、通知、MessageBox、AUMID、语言判定）
  fsutil/       原子写、路径守卫（设备名/ADS/符号链接）
  assets/       内嵌前端 HTTP 服务、CSP、/md-asset 本地图片
  servmode/     server build tag 开关；watchdog/ diagnose/ buildinfo/ 基础设施
frontend/       apps/{shell,docs,sheets,slides,pdf,markdown} + packages/* + bindings/(生成物)
e2e/           Playwright，13 spec，驱动 server 构建
build/ docker/ site/ docs/ .github/   构建资产、容器、静态官网、文档、CI
```

### 2.2 评价

**总体良好**：`internal/` 14 个包职责单一、依赖方向清晰（bridge → host/workbook/index → fsutil/platform）；前端按「app 垂直切分 + package 领域抽取」组织，`packages/*` 无框架依赖、源码级共享；`.gitignore` 分类清晰并带解释性注释；CI 有 bindings 漂移检查。

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| S-01 | `frontend/apps/pdf/src/renderer/App.tsx`(9106)、`apps/sheets/src/renderer/univer-sync.ts`(7812)、`apps/docs/src/renderer/App.tsx`(7399)、`apps/docs/src/renderer/editor/extensions.ts`(6832)、`apps/sheets/src/renderer/WorkbookVisuals.tsx`(5222)、`apps/slides/src/renderer/App.tsx`(4381)、`apps/shell/src/renderer/src/Home.tsx`(3243) | 高 | 单文件 3000–9100 行，混合状态、副作用、事件订阅、渲染与业务算法；已事实阻断评审与并行重构（源码中 20+ 处 `eslint-disable react-hooks/exhaustive-deps` 是副作用难以推理的征兆） | 按「容器/视图 → 功能域 hook → 纯函数模块」三层拆分；先以现有 `useEffect` 边界为切口抽出文件动作、分页、导出、对话框状态，目标 ≤500 行；`univer-sync.ts`/`extensions.ts` 按命令/扩展注册表拆为多模块 |
| S-02 | `frontend/apps/shell/src/renderer/src/` vs 其余 5 个 `frontend/apps/*/src/renderer/` | 低 | shell 多一层 `src`，导致其 `index.html` 用 `/src/main.tsx`，其余用 `./main.tsx`，入口约定不统一 | 上移一层并同步 `tsconfig.include` 与 HTML 引用 |
| S-03 | `frontend/apps/*/i18n/locale.tsx`（6 份）、`internal/host/menus.go`、`internal/platform/closeconfirm_windows.go`、`main.go:159,439,450-458` | 中 | 文案字典分散在 6 个 app，后端**完全没有 i18n 层**：菜单、MessageBox、托盘、对话框硬编码英文；`internal/bridge/filesdrop.go:104-127` 却又内嵌 zh/en 双语文案，`errcodes.go` 把翻译全推给前端但 Go 侧文案前端无法覆盖 | 建立单一 `internal/i18n` 资源 + 前端统一字典；所有用户可见文案（含错误码 detail）经 `GetLanguage()` 取词 |
| S-04 | `ERROR-LOCALIZATION-REPORT.md`、`build/verification/` | 中 | `git status --short` 仅有的两项未跟踪内容；前者是一次性审计报告且 `:81-116` 含约 30 处 `file:///e:/Dev/YiiOffice-WailsV3/...` 绝对路径（跨平台全部失效），后者是 headless 导出验证产物；均未被 `.gitignore` 覆盖，`git add -A` 会误提交 | 报告归档到 `docs/archive/` 并改仓库相对链接；`.gitignore` 补 `/build/verification/` 与 `*-REPORT.md` 类规则 |
| S-05 | `.gitignore:20`、`README.md:118,128`、`README.en.md:118,128`、`site/index.html:527` | 中 | 文档声称安装包「在仓库内 `dist/...`，26,625,923 字节」，但 `/dist/` 被忽略、`git ls-files dist` 为 0；官网还宣传「便携版 zip」而 `Taskfile` 无对应打包任务 | 改为「以 Release 资产为准 / 由 `task package:windows` 本地产出」，体积数据由发布流水线注入；实现 `package:portable` 或移除 zip 入口 |

---

## 三、依赖与配置文件的合理性

### 3.1 后端依赖（`go.mod`）

`go 1.27`、10 个直接依赖**均有实际引用**，`go.sum` 存在，无 vendor；间接依赖中 `xuri/efp`、`xuri/nfp`、`bigfft` 为伪版本（指向未打 tag 的 commit）。整体健康，建议 CI 增加 `go mod tidy` 一致性检查与 `govulncheck`；`go.mod:3` 未声明 `toolchain`，应确保 CI/发布镜像的补丁版本一致。

### 3.2 前端依赖（`frontend/package.json` 及各 workspace）

`workspaces: ["apps/*","packages/*"]`、`package-lock.json`（lockfileVersion 3）、`allowScripts`/`overrides` 使用较新且合理；`vite.shared.ts` 统一 `base:'./'`、`target:'chrome120'`、**`sourcemap: false`**（生产不泄露源码）；`tools/build-renderers.mjs` 的 `dedupeSharedAssets()` 与 `pruneUniverHyphenation()` 是有意识的体积治理。

### 3.3 构建与配置

`Taskfile.yml`（422 行）质量较高：`run: once` 防并发重建 bindings 竞态、`preconditions` 校验工具链、`-trimpath -buildvcs=false`、版本经 `-ldflags -X` 注入、`makensis -DAPP_VERSION` 透传、SHA-256 sidecar（`dist/YiiOffice_0.13.0_setup.exe.sha256` 实测与 exe 哈希一致）。`config.yml` 无敏感信息；`build/config.yml` 的 `certificatePassword: "change-me"` 为**被注释的占位符**，非凭据泄露。

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| C-01 | `Taskfile.yml:8`、`config.yml:14`、`build/windows/info.json`、`build/windows/wails.exe.manifest`、`build/windows/nsis/installer.nsi:18,20`、`docker/Dockerfile.server:20`、`frontend/package.json:3` 及 6 个 app `package.json`、`package-lock.json`、`site/index.html`/`en/index.html`、`README.md:118`/`README.en.md:118` | **高** | 版本号 `0.13.0` 实测散落 **18+ 文件**；`Taskfile.yml:5-9` 注释自称 "Single source of truth"，但只是 Taskfile 默认值，`docs/releasing.md:11` 也把「各处一致」列为发布前置条件，**CI 无任何一致性校验**。漏改即产出「二进制 0.14.0 / 安装包 0.13.0 / 官网 0.13.0」错版 | 以 `config.yml info.version` 或单一 `VERSION` 文件为唯一源；新增 `task version:check` 抽取所有位置比对并接入 CI；新增 `task version:bump` 自动改写；NSIS/Docker/info.json/manifest 删除各自 fallback 常量，一律由 Taskfile 传参 |
| C-02 | 仓库根、`frontend/`、`.github/workflows/ci.yml` | 中 | **全仓无** `.editorconfig`、`.golangci.yml`、ESLint/Prettier 配置、`codecov.yml`；CI 只有 `go vet` 与 `tsc`，无 `golangci-lint`/`gosec`/前端 lint；但源码存在 20+ 处 `eslint-disable-*`（`apps/slides/src/renderer/App.tsx:2978` 等），抑制注释实际**不生效**，陈旧闭包风险无工具保障 | 补 flat-config ESLint（typescript-eslint + react-hooks + react-refresh）与 `.golangci.yml`（含 gosec），根加 `lint`/`format:check` 脚本并接入 CI；逐条复核 `exhaustive-deps` 抑制 |
| C-03 | `frontend/packages/xlsx-gateway/tsconfig.json`、`packages/pptx-ops/tsconfig.json:6-12`、`packages/pptx-render/tsconfig.json:6-11`、`apps/sheets/tsconfig.json` | 中 | `xlsx-gateway` 完全不 `extends` base（缺 `noUnusedLocals`、`@bindings/*`）；`tsconfig.base.json:16-19` 明确警告「声明自己的 `paths` 必须重复 `@bindings/*`」，但 pptx-ops/pptx-render 正是漏掉的情形；仅 sheets 开启 `noUncheckedIndexedAccess` 等，同一 monorepo 类型严格度分三档 | `xlsx-gateway` 改为继承；补齐 `paths`；把严格选项下沉到 base 统一开启并修正编译错误（或显式记录例外） |
| C-04 | `frontend/apps/pdf/package.json`（`pdfjs-dist` 在 devDependencies）vs `apps/docs`/`apps/markdown`（dependencies）；6 份 react/vite/typescript、11 份 vitest 重复声明；6 个 app 各 4 条相同 scripts | 中 | 运行时必需依赖归类错误；公共工具链版本靠人工同步 | 公共工具链提升到根 `devDependencies`，workspace 只声明特有依赖；`pdfjs-dist` 移入 pdf 的 dependencies；`npm dedupe` + CI 版本一致性检查 |
| C-05 | `docker/Dockerfile.server:16-17,41,44` | 中 | 基础镜像仅滚动 tag 无固定 digest；镜像内 `go mod tidy` 改写依赖解析；`sed -i '/^replace/d' go.mod \|\| true` **静默删除 replace 指令**，使容器构建输入与本地/CI 不同 | 固定镜像 digest；用 `go mod download` + 校验 `go.sum` 替代 tidy；删除 sed，改为 CI 检测 `go.mod` 含 replace 即失败 |
| C-06 | `build/windows/nsis/installer.nsi:39,324-326` | 低 | 默认安装目录硬编码 `D:\YiiOffice`（按有无 D 盘回退 `$LOCALAPPDATA`），与 `RequestExecutionLevel user` 惯例不符、行为随机器变化 | 默认改 `$LOCALAPPDATA\Programs\YiiOffice` |
| C-07 | `config.yml:2`、`docs/e2e-test-strategy.md:111,243,368,282`、`docker/Dockerfile.server:11` | 低 | 注释/文档与代码不一致：`common:update:build-assets`（实际 `update:build-assets`）、`wails3@v3.0.0`（实际 v3.1.0）、「playwright 双 project」（实际单 `real`）、「`./ios` 缺 main」（目录已不存在）、Dockerfile 示例路径写错 | 一次性校准文档；过时问题标注「历史问题，已修复」 |
| C-08 | `.github/workflows/`（仅 `ci.yml`、`deploy-site.yml`、`dependabot.yml`） | 中 | **无 tag 触发的发布工作流**；`go build` 产物不上传 artifact；发布完全依赖本机 `task package:windows` 手工上传，`docs/releasing.md:4,30` 自述 `release:prepare` 不存在、资产命名不符合 updater 契约 | 新增 `release.yml`（`on: push tags: ['v*.*.*']`）：`version:check → package:windows → 上传 exe + .sha256 → 校验文件名与哈希` |

> **澄清三项常见误判**：`.gitignore` 存在且覆盖全面（`git ls-files`/`git check-ignore` 逐项核对，`e2e/node_modules`、`playwright-report`、`build/bin`、`dist`、`.task` 的跟踪数均为 **0**）；CI 存在且为 5 个 job（go / bindings drift / race / frontend / e2e）；全仓凭据扫描**未发现真实密钥、token、私钥泄露**（`s3cret`、`change-me` 均为测试夹具/注释占位）。

---

## 四、核心模块与关键执行流程

### 4.1 模块地图

| 包 | 职责 | 关键文件 |
| --- | --- | --- |
| `internal/bridge` | 13 个 Wails 服务（Home/Docs/Slides/PDF/Workbook/Markdown/Export/Tab/Window/Shell/Notification/Internal）+ 会话写授权 + 唯一原子保存收口 + 稳定错误码 | `homeservice.go`、`fileops.go`、`pathgrants.go`、`errcodes.go` |
| `internal/host` | 设置/最近文件/星标/文件夹树/标签宿主/分离窗口/关闭守卫/文件关联/数据目录 | `settings.go`、`recentfiles.go`、`tabhost.go`、`closeguard.go` |
| `internal/index` | SQLite FTS5 存储、CJK bigram 分词、文本抽取、fsnotify 递归监听与去抖、生命周期编排 | `store.go`、`indexer.go`、`watcher.go`、`lifecycle.go` |
| `internal/workbook` / `pdfengine` | excelize 会话引擎 / pdfcpu 页面操作 | `engine.go`、`reads.go`、`pdfengine.go`、`appops.go` |
| `internal/export` / `update` | headless CLI 与结果信封 / 更新通道、校验、Gitee 兼容层 | `cli.go`、`headless.go`、`provider.go`、`latest.go` |
| `internal/platform` / `fsutil` / `assets` | Win32 能力与全局 App 句柄 / 原子写与路径守卫 / 内嵌静态服务与 CSP | `print_windows.go`、`atomicwrite.go`、`pathguard.go`、`server.go` |
| `frontend/packages/wails-bridge` | `installBridge()` 发布 Electron 兼容全局 API、事件传输、外部链接守卫、拖放桥 | `index.ts`、`transport.ts`、`slides-bridge.ts` |

### 4.2 启动流程（`main.go:50-422`）

1. `debug.SetMemoryLimit(2<<30)`（Go 堆软上限，避免与 WebView2 抢内存）→ dev 可选 `WAILS_TRACE`
2. 启动期 `defer recover` + `diagnose.WriteCrashReport`
3. **headless 分支优先**：参数解析、路径校验、`GrantFile(input/out)`
4. `platform.RequireWindows()` → `ApplyAppUserModelID()` → WebView2 预检（server 模式跳过）→ `fs.Sub(embeddedAssets, "frontend/dist")`
5. `AppDataDir()` → `bridge.InitManagedGrants()` → 构造 SettingsStore / RecentManager / FolderManager / TabHost / DetachedHost / FileOps / DefaultAppManager / CloseGuard
6. `go wd.Start(wdCtx)` 渲染进程看门狗 → `index.Init(dataDir, rootPaths)`（冷扫描另起 goroutine，headless 跳过）
7. `workbook.NewEngine()` → 构造 13 个服务 → `RefreshEnabledAssociations()`
8. `application.New(Options{...})` 注册 `Services`、`ErrorHandler`、`PanicHandler`、`Assets.Handler`（含 `/md-asset` 授权）、`SingleInstance`、`ShouldQuit` → `platform.Set(app)`
9. `update.New()` + `RegisterService` → 主窗口（frameless/maximised/文件拖放）+ 系统托盘 + `openFilesFromArgs`
10. `app.Run()`；headless 时并发跑 `RunHeadlessExport` 并按结果 `headlessExit`

### 4.3 关键调用链

- **绑定链路**：renderer `installBridge()` → `@wailsio/runtime` / `@bindings/*` 生成 TS → `bridge.*Service` 方法 → `authoriseLocalFileRead` / `AuthoriseWrite`（`fsutil.Guard` + `PathGrants`）→ 读写 → `platform.Emit` 回推事件（`tabs:changed`、`home:file-renamed`）。
- **保存链路（唯一收口）**：`bridge/atomicSaveBytes`（`AuthoriseWrite` → `MkdirAll` → `CreateTemp` → Write/Close → `os.Rename`），配合 `fsutil.WriteJSONAtomic` 持久化配置态；但 `exportservice.go`、`markdownservice.go:398` 等仍有 `os.WriteFile` 非原子写旁路。
- **索引链路**：fsnotify 事件 → 按路径 debounce → `ExtractText` → `Tokenize`（CJK bigram/unigram）→ SQLite FTS5 `Upsert`；**关键缺口**：`internal/index/extract.go:52` 对 `.docx/.xlsx/.pptx/.pdf` 一律返回 `name-only`，即 Office/PDF **正文永远搜不到**，而 `scan.go` 的 `supportedExts` 却收录了它们，`MaxExtractBytes=64MB`、百万字符分词等整套机制对主要文档类型形同虚设。
- **导出链路**：CLI 解析与扩展名白名单 → 预授权 → 隐藏窗口 → 等待渲染 ready/done（首屏 20s、整体 45–90s 超时）→ Edge headless / pdfcpu → `verifyOutputFile` → stdout 信封 + 退出码 0/1/2/3。
- **停机链路**：`InternalService.ServiceShutdown`（首个注册＝最后停机）→ `cancelWd()` → `wbEngine.CloseAll()` → `idxLifecycle.Shutdown()`（watcher → indexer → store.Close）。

### 4.4 流程设计缺陷

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| F-01 | `main.go:170-194`、`internal/host/closeguard.go:90-104` | 中 | `CloseGuardConfig` 未提供 `SaveTab`（默认 no-op），`PromptSave` 只返回 `Cancel`/`DontSave`，`Save` 分支**永远不可达**：有未保存文档时用户只能「放弃」或「取消」，无法保存；`saveTab` 失败仅用标准库 `log.Printf` | 提供真实 `SaveTab`（经各编辑器保存绑定），`ConfirmDiscardChanges` 改三态 Yes/No/Cancel，统一 `platform.Logger()` |
| F-02 | `internal/index/lifecycle.go:54-98` | 中 | `SyncRoots` 的 indexer/watcher 两步无跨对象串行化（注释自认「low-probability, self-healing risk」），但 `HomeService.AddFolderRoot/DropFolderRoots/...` 是可并发绑定；首次扫描 goroutine 未纳入 WaitGroup、无 `recover`，`Shutdown` 先 `store.Close()` 会导致其访问已关闭 DB | `Lifecycle` 加 `sync.Mutex` 串行化；首次扫描纳入 WaitGroup 并在 Shutdown 等待；所有长生命周期 goroutine 统一 `defer recover` + 崩溃报告 |
| F-03 | `internal/bridge/errcodes.go:80-103` | 低 | `hasErrorCode` 用「首 token 全小写且含下划线」启发式判断是否已有错误码，任何形如 `foo_bar: ...` 的底层 error 会被误判从而不再加码 | 改为显式错误类型断言 |

---

## 五、代码质量与可维护性

### 5.1 重复代码

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| Q-01 | `internal/bridge/{docsservice.go:47-75,slideservice.go:29-56,pdfservice.go:58-92,workbookservice.go:228-289,markdownservice.go:112-149}` | 中 | 5 个编辑器的 `OpenPath/FilesRead/Save/SaveAs/SaveTo` 近乎逐字复制；`docsFileSave`/`slidesFileSave`/`atomicBase64Save` 三个包装做同一件事；4 处 `Renamed` 事件 emit 写死字面量 `"home:file-renamed"`，而常量 `EventHomeFileRenamed` 已定义却未使用 | 抽 `editorIO` 公共组合，统一错误码包装与事件常量 |
| Q-02 | `frontend/apps/{docs,markdown,pdf,sheets,slides}/src/renderer/main.tsx`、`apps/shell/src/renderer/src/main.tsx:27-48` | 中 | 6 份几乎相同的 `bootstrap()`（读语言/主题 → `setModuleLang` → 写 `lang`/`dir` → `applyTheme` → `createRoot`），差异（是否 try/catch、StrictMode、getDocumentTheme）已直接导致 V-H7 与 StrictMode 不一致 | 抽 `bootstrapRenderer({getPrefs, render, extra})` 到共享包；统一开启 `StrictMode`（现仅 slides/shell 使用） |
| Q-03 | `internal/export/envelope.go:58-91`、`internal/index/tokenize.go:117-211`、`internal/index/store.go:187` | 低 | `toLower`/`containsLower` 手写替代 `strings` 标准库（注释称 hot path，但仅 CLI 退出时调用一次）；`ParseQuery`/`BuildMatchExpr` 整套查询解析只被测试引用，与 `store.go:307` 的 `escapeFTS` 两套逻辑并存且转义规则不一致；`Upsert` 的 3 个 token 参数完全未使用 | 删除死代码；统一查询构造入口；`Tokenize(name)` 一次计算复用 |
| Q-04 | `frontend/apps/*/package.json`（24 条相同 scripts）、6 份 `i18n/locale.tsx`、6 份 `applyTheme` | 低 | 模板化重复，靠人工同步 | 根级封装 + `syncpack` 类工具；文案集中 |

### 5.2 命名与风格

`internal/platform/closeconfirm_windows.go` 与 `host/closeguard.go` 用标准库 `log`，全项目其余用 `slog`；`internal/export/runner.go:16-17` 注释写 `MTIME_SLACK_MS` 而常量名为 `mtimeSlackMS`；`bridge/util.go:453` `resolversListPrinters` 语义含糊；`host/recentfiles.go` 同时存在 `GetRecents` 与 `RecentsSnapshot` 两套读法；`diagnose.go:72` 字符串拼路径而非 `filepath.Join`；`frontend/packages/{font-metrics,i18n,pptx-ops,xlsx-gateway}/package.json` 描述仍写 "Electron"（项目实为 Wails）。**统一日志门面与命名，清理迁移遗留描述。**

### 5.3 异常处理

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| Q-05 | `internal/host/recentfiles.go:77,88,97-107`、`internal/host/foldertree.go:91` | 中 | `saveRecents()`/`saveStarred()`/`saveRoots()` **丢弃原子写返回值**，写盘失败静默丢失数据；错误用 `fmt.Printf` 而非结构化日志 | 持久化返回 error 并上抛或 `platform.Logger().Warn` |
| Q-06 | `internal/index/store.go:288-303,362-375`、`internal/bridge/homeservice.go:626-628,667`、`internal/workbook/reads.go:738-757` | 中 | `rows` 循环结束未检查 `rows.Err()`；`GetBody` 错误被忽略；`CountFiles()` 出错被吞成 `indexed=0`；`fillValue` 丢弃所有 `SetCell*` 错误 | 补 `rows.Err()`；错误上抛；`SetCell*` 错误累加返回 |
| Q-07 | `internal/bridge/exportservice.go:92-99,190-191,228`、`internal/fsutil/atomicwrite.go:26-49`、`internal/bridge/pdfops.go:82-83`、`internal/export/envelope.go:12-15` | 低 | 大量 `tmp.Close()`/`os.Remove()` 返回值被忽略；`json.Marshal` 失败时手工拼 JSON，`err.Error()` 含引号会产出非法 JSON | 统一检查关闭/删除错误；错误对象仍用 `json.Marshal` 构造 |
| Q-08 | `frontend/packages/ui/src/auto-save-pref.ts:82`、`apps/slides/src/renderer/edit-handlers.ts:271,515`、`apps/pdf/src/renderer/usePdfDocument.ts:97,102`、`packages/xlsx-gateway/src/gateway/xlsx-package-io.ts:402,443,448,465` 等 20+ 处 | 中 | `.catch(() => {})` / `catch { /* ignore */ }` 静默吞错：自动保存偏好写入失败用户无感知、剪贴板失败不可见、临时文件删除失败残留；约 15 处带注释的降级属可接受 | 统一 `console.warn('[context]', err)` 或上报 logger；自动保存失败反馈到 UI；删除失败记录路径 |

### 5.4 边界情况

`internal/bridge/homeservice.go:239-249` 的 `limit==0` 返回空页，与 `host/recentfiles.go:185-187` 的 `limit<=0` 取默认语义不一致；`internal/index/snippet.go:84-89` 在 `parts` 为空时 `parts[0]`/`parts[len-1]` 越界；`internal/workbook/reads.go:214-216` 在 `cols > scanLimit` 时算出 `rows=0` 静默跳过整表；`internal/workbook/engine.go:570-599` `parseArea` 丢弃 `:` 的第 3 段之后内容；`pdfengine/pdfengine.go:382-397` 的 `cropArea` 未校验 NaN/Inf/负值；`internal/platform/webview2.go:16-22` HKCU 分支只 `OpenKey` 成功即判定已安装，不检查 `pv`（HKLM 两分支都检查）；`internal/host/foldertree.go:138-158` 在 `GetRoots()` 只读查询里 `MkdirAll` 产生副作用。

### 5.5 巨型文件（见 S-01，实测行数）

`App.tsx` 7000–9100 行、`univer-sync.ts` 7812 行，是本仓**架构级可维护性债务**，建议列为专门重构专项而非顺手修改。

### 5.6 类型安全

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| Q-09 | `frontend/packages/wails-bridge/src/slides-bridge.ts:33,41,67-116` | 中 | `EditHandler`/`callEdit` 及 `SlidesDesktopApi` 全部方法为 `(...args: any[]) => Promise<any>`（约 120 处），整个 slides 编辑器与 Go 的 API 面无类型，与 `strict: true` 严重不匹配 | 用泛型 `callEdit<TArgs, TResult>` 收敛，从 `apps/slides/src/shared/ipc.ts` 复用 DTO，优先补 `editText`/`editTransform`/`savePicture` |
| Q-10 | `frontend/apps/sheets/src/renderer/main.tsx:5`、`apps/shell/src/renderer/src/error-boundary.tsx:17`、`apps/sheets/src/renderer/i18n/locale.tsx:69-72`、`apps/slides/src/renderer/main.tsx:45` | 中 | `as any` 绕过全局声明；连续 4 处 `next as any` 而 `packages/i18n` 已导出 `isLang()` 守卫；slides 的 `l as Lang` 未做 `'zh'/'en'` 校验 | `declare global { interface Window {...} }`；统一用 `isLang()` 收窄；`useRef<T>(null as unknown as T)` 改 `useRef<T｜null>(null)` |

---

## 六、潜在缺陷与安全风险

### 6.1 高危（已逐条回读源码复核）

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| V-H1 | `internal/index/store.go:247,261-278,306-309`；`internal/index/tokenize.go:203`；入口 `internal/bridge/homeservice.go:651-660` | **高** | **FTS5 查询注入**。`escapeFTS` 用 `strings.NewReplacer("\\","\\\\", "'","\\'")` 转义后，把 `matchExpr` 直接 `fmt.Sprintf` 拼进 `WHERE file_fts MATCH %s%s`。SQLite 字符串字面量的单引号转义是 `''`，反斜杠不是转义符，`\'` 会提前结束字符串使后续内容变成 SQL 片段。搜索框输入仅被截断到 200 rune，可构造 `'` 令所有搜索报错，或构造 `OR` 表达式绕过 `extFilter` 返回索引内全部文件路径（信息泄露/DoS） | 改参数化 `WHERE file_fts MATCH ?`；用户输入按 FTS5 词法逐 token 用双引号包裹并转义 `"`；统一 `BuildMatchExpr` 与 `escapeFTS` 为单一构造入口；补注入回归用例与 Fuzz |
| V-H2 | `main.go:236-251,277-287`；`internal/assets/server.go:111-190`；`docker/Dockerfile.server:67`；`Taskfile.yml:361`；`docs/e2e-test-strategy.md:98` | **高** | **无认证 HTTP 全量暴露**。`main.go` 注释自认「server 模式把全部 bridge 绑定与已授权本地文件读取暴露在无认证 HTTP 上」；非环回绑定**只打一条 Warn 日志仍照常启动**。Dockerfile 预设 `ENV WAILS_SERVER_HOST=0.0.0.0`，`run:docker` 用 `-p 8080:8080`（宿主机全网卡），而项目文档自己警告不要暴露到不可信网络。可远程调用文件读写、导出、更新安装及 `/md-asset` | `run:docker` 默认 `-p 127.0.0.1:8080:8080`；Dockerfile 不预设 `0.0.0.0`；非环回绑定必须显式开关（如 `YIIOFFICE_ALLOW_REMOTE=1`）否则拒绝启动，并加 token/反向代理认证；校验 `Origin`/`Host` |
| V-H3 | `internal/bridge/pathgrants.go:205-215`（`GrantDir(os.TempDir())`）；`pathgrants.go:151-172`；`main.go:99-100,136` | **高** | **写授权被整体放宽**。`PathGrants.Allowed` 对目录授权是「子树全覆盖」，因此 `AuthoriseWrite`（`atomicSaveBytes` 唯一门禁）放行**系统临时目录下任意路径**；headless 模式还把本应只读的 `--headless-export <input>` 也加入写集 | 只授权应用自建固定子目录（如 `AppDataDir/temp`），永不授权 `os.TempDir()` 根；headless 输入只加读授权；定期审计授权范围 |
| V-H4 | `internal/pdfengine/pdfengine.go:467-485`；`internal/bridge/pdfops.go:322-347` | **高** | **PDF 内部对象名导致路径穿越任意写**。`img.Name` 来自不可信 PDF 资源名，只 `ReplaceAll(" ", "_")` 就 `filepath.Join(targetPath, "image_%d_%s%s")` 后 `os.WriteFile`，且此处未再 `AuthoriseWrite`。恶意 PDF 可用 `..\..\...` 或盘符路径写到任意位置覆盖文件；`ExportImagesToFolder` 直接使用渲染器给的 `dir` | 对 `img.Name` 强制 `filepath.Base` + 字符白名单，对最终输出路径再做一次授权/前缀校验；下沉公共消毒函数 |
| V-H5 | `internal/update/provider.go:112-131`、`checksum.go:144-150`、`service.go:64-81`、`giteecompat.go:95-99` | **高** | **更新链路供应链风险**。`checksum()` 从 release feed 取 `asset.URL` 后直接 `http.Get`，**无 host allowlist**（对比同包 `latest.go:287-314` 的 `sanitizeReleaseURL` 已实现白名单）；完整性仅依赖同一 feed 上的 SHA-256 sidecar，能篡改 feed 者可同时替换安装包与摘要；`provider.go:96-101` 明确允许「无 sidecar 时未校验安装」 | 下载/校验 URL 统一强制 `gitee.com`/`github.com` 白名单；改用发布者签名（minisign/GPG）或独立可信通道校验摘要；无签名/无摘要默认拒绝自动安装 |
| V-H6 | `internal/bridge/markdownservice.go:124-131`；同类 `internal/bridge/workbookservice.go:249-255` | **高** | **启发式解码静默损坏用户文档**。`Save` 先尝试 `base64.StdEncoding.DecodeString(content)`，成功即用解码字节，失败才当纯文本。任何长度为 4 倍数且字符全在 base64 字母表内的纯文本（`test`、`markdown`、`abcd`、`2024`）都会被写成乱码；而 `SaveDocument` 恰恰传 base64，接口语义自相矛盾 | 拆 `SaveText`/`SaveBase64` 或加显式 `encoding` 参数，禁止猜编码；补纯文本回归测试 |
| V-H7 | `frontend/apps/shell/src/renderer/src/main.tsx:27-48` | **高** | **主窗口白屏**。`window.aiOffice.getLanguage()` **无 `.catch()`**（`getTheme()` 有），且整条 `Promise.all([...]).then(...)` **无终止 `.catch()`**；其余 5 个 app 都是「逐 promise catch + 外层 try/catch」双保险。绑定未就绪或 `getLanguage()` 拒绝时 `createRoot().render()`（:41）永不执行 | 补 `.catch(() => 'zh')` 与整链兜底渲染；按 Q-02 抽共享 bootstrap 根治 |
| V-H8 | `frontend/apps/docs/src/renderer/editor/hf-dom.ts:1061,1078` → `apps/docs/src/renderer/components/PaginationPreview.tsx:820,1659` | **高** | **不可信文档的属性注入**。`wordArtSvgMarkup()` 拼装 SVG，来自 OOXML 的 `wa.colorHex` 直接进 `fill="#${wa.colorHex}"`、`wa.opacity` 直入属性，均未转义/白名单（`wa.text` 已 `esc()`）；结果经 `dangerouslySetInnerHTML` 注入 DOM。CSP `script-src 'self'` 可挡 inline script 执行，**但挡不住属性注入、外链资源请求与 DOM 篡改/数据外带**，且输入是用户打开的外部 `.docx` | `colorHex` 用 `/^[0-9a-fA-F]{3,8}$/` 白名单、非法回退默认色；所有属性值走 `esc()` 并加引号；优先改 `createElementNS` + `textContent`；所有 `dangerouslySetInnerHTML` 汇入统一消毒网关（可复用 `sanitize-markdown-html.ts`） |

### 6.2 中危

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| V-M1 | `internal/host/settings.go:64-68,109-127`；`main.go:234` | 中 | `update()` 中 `next := s.data` 是值拷贝，`FileAssocEnabled` 仍是**同一 map**；`Snapshot()` 也带该引用，`RefreshEnabledAssociations` range 时可能与并发写碰撞（Go map 并发读写 fatal）；写盘失败时内存已被改、磁盘未变 | 深拷贝 map；`Snapshot()` 返回副本；改 `sync.RWMutex` + 不可变快照 |
| V-M2 | `internal/host/tabhost.go:192-213`；`internal/bridge/tabservice.go:66-74` | 中 | `ActiveTab()`/`GetByID()` 在释放 `RLock` 后返回内部 `*Tab` 指针，消费方在锁外读 `Kind`/`Title`，与 `SetDirty`/`Activate` 构成真实竞态 | 返回值拷贝 `Tab`/`TabSummary`，与 `List()` 一致 |
| V-M3 | `internal/host/recentfiles.go:97-133,279-283` | 中 | 见 Q-05；另 `GetStarredGroups()` 返回内部 slice 本体（可无锁改写内部状态）；`AddRecent` 在持锁时全量序列化 + 写盘，且每次 `append([]RecentEntry{...}, rm.recents...)` 复制并重写 2000 条 | 持久化上抛错误；返回副本；序列化移出临界区；增量追加 + 定期合并 |
| V-M4 | `internal/bridge/pdfservice.go:105,118,130,150,162,175,183,195,207,219,227,238` | 中 | 12 处 PDF 绑定用 `context.Background()` 且**无超时**；同批操作在 `pdfops.go` 均用 `context.WithTimeout(..., 120s)`。大 PDF 的 Crop/ExportImages/Merge 可无限期阻塞绑定线程 | 抽统一 `pdfOpContext()`（120s）；理想从 Wails 调用上下文传递取消 |
| V-M5 | `internal/update/service.go:111,136,144`；`internal/platform/print_windows.go:95-114` | 中 | 更新 Check/Download/Restart 无 context 超时（仅 `http.Client.Timeout=30s`，不覆盖解压/staging）；打印机枚举用 `exec.Command("powershell").Output()` 无 context，挂起即永久阻塞同步绑定，且每次调用起一个 PowerShell | `context.WithTimeout`；`exec.CommandContext` + 5–10s；缓存打印机列表/改用 EnumPrinters API |
| V-M6 | `internal/platform/print_windows.go:117-124` | 中 | Edge headless 打印固定加 `--no-sandbox` 渲染来自渲染器的 HTML，放大恶意 HTML 攻击面；`--print-to-pdf=` 拼接路径若以 `--` 开头可能被当新 flag | 移除 `--no-sandbox`（除非有环境证据并严格净化输入）；校验输出路径 |
| V-M7 | `internal/workbook/engine.go:41-64,79-103`（`:94-96` 已复核） | 中 | 会话 map 只增不减（前端不 `Close` 则 excelize 文件与内存永不释放）；`session.password` 明文 string 常驻无法清零；`newUUID()` 在 `crypto/rand.Read` 失败时返回**固定 UUID** `"00000000-..."`，会致会话互相覆盖 | 空闲 TTL + 上限淘汰；密码用 `[]byte` 用后清零；`newUUID` 返回 error；记录 `Close()` 错误 |
| V-M8 | `internal/pdfengine/pdfengine.go:301-332,382-429`；`appops.go:246-280` | 中 | `ReplacePages` 不像 `InsertPdf` 那样 clamp 页码，越界生成损坏 part；`cropInPlace` 把同一文件同时作为输入输出；`CropFractionInPlace` 循环内对每页重复「读整份 PDF → 裁剪 → 原地覆盖」，N 页 = N 次全量 IO 且中途失败无法回滚；`cropArea` 未校验 NaN/Inf/负值 | 统一页码 clamp 与数值校验；原地操作改「临时文件 + 一次性 rename」；批量裁剪一次完成 |
| V-M9 | `internal/update/giteecompat.go:24-82` | 中 | `/releases` 响应 `io.ReadAll(resp.Body)` **无大小上限**（`latest.go` 有限制）；`json.Unmarshal` 到 `map[string]any` 再 Marshal 回填，数字统一变 `float64` 使 asset id 等大整数精度丢失 | `io.LimitReader`；用 `json.RawMessage`/结构化 patch 避免全量反序列化 |
| V-M10 | `internal/assets/server.go:154-190`；`internal/bridge/util.go:73-132` | 中 | `/md-asset` 每个请求重建 Guard：`localReadRoots()` 对每个 root `os.Stat` → `fsutil.NewGuard` 逐段 `Lstat`+`EvalSymlinks`。多图 Markdown 页产生成百上千次系统调用；服务层本身不校验 `p` 长度/字符 | 根目录变更时失效并缓存规范化 roots（`sync.RWMutex`）；补请求级限流与 `p` 长度上限 |
| V-M11 | `internal/platform/app.go:116-121`；`internal/bridge/homeservice.go:344-350` | 中 | `RevealPath` 把渲染器路径直接 `exec.Command("explorer", "/select,"+path).Start()`，未经 Guard/授权、无非空与 NUL 校验；`Start()` 后从不 `Wait()`，进程句柄泄漏 | 先经 Guard 或 `filepath.Abs` + NUL 校验；`go cmd.Wait()` 回收 |
| V-M12 | `internal/host/foldertree.go:89-93,143-148,220-235,321-330`；`internal/host/fileops.go:43-59` | 中 | 写锁内做磁盘 IO；`GetRoots()`（只读）里 `MkdirAll`；`ListFolder` 对每个子目录再 `ReadDir` 呈 N+1；`MovePaths` 逐个 rename 且失败继续，与「一批不允许部分执行」注释矛盾；`Duplicate` 忽略 Close 错误且 Windows 上删除仍打开的 dst 会失败留下半截文件 | 序列化移出临界区；只读查询不建目录；批量预校验 + 事务式回滚；显式 `Sync/Close` 后再删除；去重循环加上限 |
| V-M13 | `frontend/packages/wails-bridge/src/transport.ts:36-40` | 中 | `on()` 在 runtime 不返回退订函数时回退 `Events.Off(channel)`，注释自认「移除该 channel 的**所有**监听器」；多组件订阅 `app:theme-changed`/`tabs:changed` 时，任一卸载会注销其他组件 | 桥接层维护 `Map<channel, Set<handler>>`，仅在集合为空时 `Off`；或强制断言官方 runtime 的 dispose 能力 |
| V-M14 | `frontend/apps/sheets/src/renderer/App.tsx:1011,3005-3016,3541`；`apps/docs/src/renderer/App.tsx:2485-2487`；`apps/pdf`/`apps/slides` 的 `__yiiofficeControl` | 中 | 生产构建残留调试全局钩子，暴露编辑日志（`__journal`）、Univer 运行时实例、命令分发与导出函数；sheets 部分有开关，`:3005-3010` 一组无条件写入，同源 iframe/注入脚本可直接调用 | 统一收进 `if (import.meta.env.DEV)` 或 `define` 剔除；e2e 钩子改受控测试通道 |
| V-M15 | `frontend/apps/shell/src/renderer/src/Home.tsx:304`、`apps/slides/src/renderer/recent-colors.ts:17`、`apps/docs/src/renderer/{autocorrect-pref.ts:28,components/NavPane.tsx:111,list-presets.ts:208}` | 中 | `JSON.parse(localStorage.getItem(...) ?? 'null')` 无 try/catch，键被写入损坏数据即抛错打断渲染；`apps/pdf/src/renderer/view-config.ts:22` 未校验 `NaN` | 封装 `readJson<T>(key, fallback)`（try/catch + 结构校验）；数值偏好加 `Number.isFinite` |
| V-M16 | `frontend/tools/build-renderers.mjs:139-149`；`frontend/vite.shared.ts:52-70` | 中 | 构建脚本用 `next.split(from).join(to)` 对 `dist/` 产物做**无上下文全局替换**（含裸 `"${name}"` 规则），可能误改日志/第三方常量且不可回滚；`spawnSync('npx', ..., {shell:true})` 无必要开 shell。Vite 插件用正则改写 `node_modules` 中 Univer 源码，第三方升级即构建失败 | 改带边界/命中数校验的替换并做前后 hash 快照；去掉 `shell:true`；插件改 Rollup 钩子或 `patch-package` + 版本断言测试 |
| V-M17 | `main.go:120,405-417`；`internal/export/headless.go:210-267`；`internal/export/runner.go:119-137` | 中 | `exec.Command(...).Start()` 忽略错误；headless 导出 goroutine 无 `recover`，panic 直接终止进程；`verifyOutputFile` 用 `startedAt - 2s` 宽松 mtime slack，2 秒内被复用的旧输出可能被误判成功 | headless goroutine 统一 `defer recover` + 崩溃报告；检查 `Start()`；输出校验改为导出前 mtime/size 快照并要求变化 |
| V-M18 | `internal/fsutil/pathguard.go:258-274` | 中 | Windows 保留设备名只检查 `filepath.Base`，中间目录段（如 `C:\root\CON\file.docx`）未查；ADS 检查对 UNC/扩展长度前缀边界需复核 | 逐段遍历所有路径组件校验；补 `%` 展开与 `\\?\` 前缀回归用例 |

### 6.3 低危（汇总）

- **死代码**：`internal/host/menus.go:107-129` `ValidateMenuID`、`recentfiles.go:331-336` `SortByTime`、`detached.go:60-69` `List()` 仅测试调用；`internal/workbook/engine.go:544-555` 自赋值空分支；`index/snippet.go:223-224` `var _ = unicode.IsSpace` 仅为消 unused import。
- **魔法数字**：`main.go:55`(2GiB)、`pathgrants.go:46`(512)、`index/scan.go:13,15`(32/200000)、`index/extract.go:11,13`(64MB/1M)、`workbook/reads.go:17,269`(500k/100k)、`export/runner.go:17`(2000ms)、`pdfops.go:29`(120s) 等散落各包，缺单位与取值依据。
- **资源/原子性**：`exportservice.go:92-99` `CreateTemp → Close → Remove → Edge 写回同路径` 存在全局临时目录 TOCTOU 抢占窗口；`MergePdfParts` 完成昂贵计算后才弹保存对话框，用户取消即白做；多处 `os.WriteFile` 非原子写旁路。
- **平台隔离**：`internal/host/fileassoc.go`、`internal/index/scan.go` 直接 import Windows 包且无 build tag，`host/dirs_default.go` 未定义 `AppDataDir`，与 `locale_other.go` 注释宣称「非 Windows 也能 `go test ./...`」矛盾。
- **watchdog**：`watchdog.go:43-45` `hotCount`/`lastReport` 无锁；`process_windows.go:77` 用 `h == 0` 判定 `CreateToolhelp32Snapshot` 失败（应为 `INVALID_HANDLE_VALUE`）；`globalCPUTracker` 条目只增不删。
- **i18n 反向问题**：`frontend/apps/pdf/src/renderer/main.tsx:41,67,84,90,95,100,106,113,120,136,142,148` 约 12 处英文错误文案直接作 `error` 返回 UI，中文界面不翻译（项目 `packages/i18n` 的 `defineStrings` 已具备编译期校验能力，未被使用）。

---

## 七、性能瓶颈

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| P-01 | `internal/workbook/engine.go:132,157,165,274,310-391`；`reads.go:399-427` | **高** | 打开单个工作簿**重复读盘 4 次**（`isEncryptedWorkbook` 读头、`hashFile` 全文流、`excelize.OpenFile` 全文、`countZipEntries` 再开 zip、`isReadOnly` 以写方式打开）；`sheetDimensions` 用 `iter.Rows()` 遍历所有行且 `iter.Columns()` 解析每行全部单元格推算维度，`columnWidths` 对每列 4 次调用；`Recalc` 每次 `WriteToBuffer` + `OpenReader` 克隆整簿，大表内存翻倍。百万行工作簿首开可长时间阻塞 | 复用一次句柄完成 hash/entry 统计；用 `GetSheetDimension` 或惰性维度；列宽只读已定义列；打开加超时与进度上报；Recalc 避免整簿克隆 |
| P-02 | `internal/index/snippet.go:32-45,152-174`；`internal/bridge/homeservice.go:665-679` | 中 | 搜索摘要对每个 hit 一次 `GetBody` SQL（N+1）；`BuildSnippet` 先做字节级 `findTextRanges` 判断非空、又做一次 rune 级重算且只用后者；`findTextRangesInRunes` 每次命中执行 `len([]rune(textLower[:i]))`，对最大 100 万字符 body 是 **O(n²)**；每页 50 hit 放大为明显卡顿 | 删字节级预计算；一次性转 `[]rune` 并用线性匹配；`GetBody` 改批量 `WHERE path IN (...)`；限制参与摘要的 body 长度 |
| P-03 | `internal/index/indexer.go:224-278`；`internal/index/store.go:82` | 中 | `errgroup.SetLimit(4)` 只用于目录扫描，`ExtractText + Tokenize + Upsert` 单 goroutine 串行；`GetIndexedFiles()` 把整张 files 表载入内存后在 Go 层建 map 做 diff；`SetMaxOpenConns(1)` 使所有 DB 操作串行。首次扫描大量文件时为主要瓶颈 | 提取阶段用有限并发 worker + channel 汇总批量事务；diff 下推 SQL/分块游标；评估 WAL 下放宽连接数 |
| P-04 | `internal/index/extract.go:52`（复核） | 中 | **功能与声明不符**：`supportedExts` 收录 Office/PDF，但 `ExtractText` 对二进制一律 `name-only`，正文索引、64MB 抽取上限、CJK 双流分词对主要文档类型全部空转 | 明确产品行为并在 UI 说明「仅文件名/路径搜索」；若需正文检索，用 excelize/pdfcpu/OOXML zip 抽取并限制单文件大小与超时；从 `supportedExts` 移除不支持的扩展名 |
| P-05 | `internal/pdfengine/appops.go:264-278`；`internal/assets/server.go:154-190`（V-M10）；`internal/platform/print_windows.go:148-176` | 中 | 循环内 N 次全量 PDF 读写；每图片请求重建 Guard；每次 `PrintHTMLToPdf` 都 `os.Stat` 6 个 Edge 路径 + `LookPath`；`workbook/engine.go:531-542` 每次调用重建 24 项 map | 一次性裁剪 + 替换；缓存规范化 roots、Edge 路径与包级常量 |
| P-06 | `internal/index/store.go:187`；`indexer.go:294-299` | 低 | `Upsert` 三个 token 参数完全未使用；`indexer.go` 仍计算并对同一个 `name` 调两次 `Tokenize` | 删死参数；复用一次分词结果 |

**正面**：`debug.SetMemoryLimit(2GiB)`、`sourcemap: false`、`pruneUniverHyphenation`（剪掉 Univer 断字 chunk）、`dedupeSharedAssets`（跨 app 资源去重）、docs 分页/分块渲染、sheets 用 Univer canvas 视口虚拟化、slides 用 Konva 画布——均未见「数千 DOM 行一次性渲染」或主线程同步大对象解析。

---

## 八、测试与文档现状

### 8.1 测试

| 维度 | 实测 | 评价 |
| --- | --- | --- |
| Go 单测 | `internal/` 139 个 `.go`，**62 个 `*_test.go`**（44.6%），约 517 个 `Test*` | `bridge`/`fsutil/pathguard`/`update`/`export`/`index` 覆盖较充分；`platform`（13 生产 / 7 测试）、`pdfengine`（6）、`workbook`（16）、`buildinfo`（**0**）薄弱 |
| 前端单测 | 1528 个 TS/TSX，**425 个 `*.test.*`**，约 4087 个用例；13 个 `vitest.config.ts` | 含 corpus fuzz、redaction、zip-bomb 等安全性测试；**`apps/shell` 与 `apps/slides` 为 0 测试、无 `test` script**，而根 `frontend/package.json:14` 用 `--workspaces --if-present` **静默跳过**它们——恰是主窗口与交互最复杂的编辑器 |
| E2E | 13 个 `spec.ts`、79 处测试定义、6 个 `test.fixme`；Playwright `--project=real` 驱动 `-tags server,production` 真实 Go 后端 | 设计水准高：动态空闲端口、`/health` 轮询就绪（不用 sleep）、每用例独立 `YIIOFFICE_USER_DATA`、`closeAllTabs` 清理、落盘/OOXML 包完整性断言、`harness.spec.ts` 自检真实后端、失败归档 trace/video/server.log |
| CI | 5 个 job：`go`(vet/test/build)、`bindings`(drift)、`race`(workbook)、`frontend`(typecheck/test/build)、`e2e` | bindings 漂移检查与 `go test -race` 超出常规；**但无覆盖率采集/阈值/上报**（CI 中 grep `coverage`、`lint`、`gosec` 均无命中），**无 Benchmark、无 Fuzz、无并发压力测试** |
| 发布门禁 | 无 `release.yml`，无覆盖率阈值，无版本一致性校验 | 见 C-01 / C-08 |

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| T-01 | `e2e/README.md:43-63`、`docs/e2e-test-strategy.md:183-197,302,318,325,351` | **高** | 文档声称「70 tests in 11 files / 3 fixme」，实测 **13 文件 / 79 处定义 / 6 fixme**；新增的 `home-recents.spec.ts`、`sheets-quality.spec.ts` 完全未登记，`sheets.spec.ts` 已从 3(+1) 扩到 5(+4)。改造报告作为回归决策依据的可信度被破坏 | 以 `npx playwright test --project=real --list` 重生成 Coverage 表；CI 加轻量一致性检查；或文档不再写死数量而指向 `--list` |
| T-02 | `frontend/apps/shell/package.json`、`apps/slides/package.json`、`frontend/package.json:14`、`apps/docs|sheets/vitest.config.ts:13` | 中 | shell/slides 零测试且被 `--if-present` 静默跳过，CI 看似全绿；`include: ['src/renderer/**/*.test.ts']` 漏 `.tsx`，未来新增组件测试不执行 | 补 `vitest.config.ts` + 关键单测；`include` 改 `.{ts,tsx}`；根 `test` 去掉 `--if-present` 或加 workspace 数量断言 |
| T-03 | `e2e/specs/real/sheets-quality.spec.ts:140-166,169,190`；对照 `e2e/README.md:30-34`、`docs/e2e-test-strategy.md:227` | 中 | `stubDesktopApi()` 用 `addInitScript` 替换 `window.desktopApi.exportPdf`，两个 `Ctrl+P` 用例只断言「前端调用了 stub」，未触达真实 Go 导出链路，与项目「Never stub the bridge」DoD 冲突且未登记为例外 | 显式登记「已批准的桩化例外」清单、理由与覆盖边界；打 `@bridge-stub` tag 单列；逐步改为监听真实 `/wails/runtime` 请求 |
| T-04 | `e2e/specs/real/sheets-quality.spec.ts:46,61,64,80,106,118,186,205`、`docs.spec.ts:35`；对照 `docs/e2e-test-strategy.md:420` | 中 | 大量界面文案断言（`/已保存｜Saved/`、`/Page Layout｜页面布局/` 等），其中 `waitForFullyLoaded()` 把文案当 45s 就绪门；违反项目自定义规范且换语言即误报 | 改 `data-testid`/状态属性/`expect.poll` 读状态；就绪改等具体 DOM 或网络信号 |
| T-05 | `e2e/specs/real/slides.spec.ts:22`；`playwright.config.ts:27` 与 `docs/e2e-test-strategy.md:232,326` | 低-中 | 固定 `waitForTimeout(1500)`（当前为 fixme，转正即成 flaky 点）；CI `retries: 1` 与文档「CI 红即真红、零重试」约定不一致 | 改 `expect.poll`/`toBeVisible`；统一配置与文档口径或把重试率作为 flaky 指标监控 |
| T-06 | `.github/workflows/ci.yml:34-35,131-134`、`frontend/package.json:10-16`、`e2e/README.md:41` | 中 | 无覆盖率采集与阈值；`e2e/README.md` 的 "Coverage" 章节实为「测试范围」，易被误读为代码覆盖率 | 加 `go test -coverprofile` + `vitest --coverage`，设基线阈值逐步提高；章节改名 "Test scope" |
| T-07 | `e2e/specs/real/home-recents.spec.ts:47-98,79,89`；`e2e/fixtures/server.ts:33,95` | 低 | 自建宿主绕过共享 `app` fixture（复制一套生命周期），`.nth(1)` 依赖按钮顺序；非 Windows 二进制名与 `Taskfile.yml:402` 硬编码 `.exe` 产物不一致，Linux 跑 `task e2e` 必失败 | 把自定义数据目录能力并入 fixture；加 `data-testid`；输出名用 `{{exeExt}}` 或 fixture 双名回退 |

### 8.2 文档

**优点**：`README.md` / `README.en.md` 各 274 行，结构逐行对齐、中英同步；含愿景、功能、技术栈、体积对比、快速开始、项目结构、测试门禁、FAQ、致谢、许可证；`docs/e2e-test-strategy.md`（428 行）是高质量的改造审计；`site/` 中英双语静态官网由 Pages 发布。

| 编号 | 路径 | 严重度 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |
| T-08 | 仓库根、`docs/` | 中 | 缺 `CHANGELOG.md`、`CONTRIBUTING.md`（开发环境/PR/commit 规范/如何跑测试）、issue/PR 模板、架构设计文档（ADR、进程/iframe/bindings 模型、server 模式边界）、API 参考（现仅有生成的 TS bindings）、`docs/index.md` 索引；`docs/` 仅 2 篇且 `releasing.md` 自述「非现行发布流程」 | 补齐协作与架构文档，把 README 的目录树升级为带流程图的架构说明 |
| T-09 | `README.md:212,227`、`README.en.md:212,227`、`config.yml:2`、`docs/releasing.md:4,30`、`build/windows/nsis/installer.nsi:6-7`、`site/index.html:132-137` | 中 | 文档与代码不一致汇总：CI 说「三段依次」实为 5 job 并行；`config.yml:2` 任务名写错；`docs/releasing.md` 自述资产命名与 updater 契约不兼容却无跟踪 issue；NSIS 注释称「二进制在仓库内」但 `build/bin` 被忽略；官网宣传不存在的便携版 zip | 一次性校准（见 C-07/S-05）；`releasing.md` 顶部加状态徽标并建跟踪 issue |
| T-10 | `e2e/specs/real/sheets-quality.spec.ts:20,120`、`internal/workbook/encrypted_test.go:177`、`docs/e2e-test-strategy.md:415` | 低 | 加密夹具密码 `s3cret` 散落两处、二进制夹具无生成脚本；文档却称「夹具全部运行时生成，仓库里没有二进制测试资源」 | 纳入生成脚本并写进 README；修正文档表述 |

---

## 九、改进优先级排序

| 优先级 | 范围 | 问题编号 | 验收标准 |
| --- | --- | --- | --- |
| **P0 · 立即**（安全 / 数据正确性） | 8 项，改动集中、收益最大 | **V-H2**（server 无认证 + Docker 全网卡）、**V-H1**（FTS 参数化）、**V-H4**（PDF 路径消毒）、**V-H6**（去掉编码猜测）、**V-H5**（更新 URL 白名单/签名）、**V-H3**（收紧写白名单）、**V-H7**（shell 启动兜底）、**V-H8**（SVG 属性转义） | 每条补一条最小复现测试；`go test ./internal/...` 与前端 typecheck/test 全绿；`nslookup`/端口扫描确认 8080 仅环回可达 |
| **P1 · 本迭代**（竞态 / 工程化门禁） | 约 12 项 | **C-01**（版本单一来源 + `version:check`）、**C-08**（`release.yml`）、**C-02**（ESLint/golangci + CI）、**F-01**（关闭保存三态）、**V-M1/M2/F-02**（SettingsStore/TabHost/Lifecycle 竞态，配 `go test -race`）、**Q-05/Q-06/V-M3**（错误上抛）、**V-M4/M5**（超时统一）、**T-02/T-06**（shell/slides 补测 + 覆盖率基线）、**S-04**（清理未跟踪项） | `task version:check` 与 CI 全绿；`git status --short` 干净；`go test -race ./internal/...` 无告警；覆盖率有基线数值与阈值 |
| **P2 · 随后 1–2 迭代**（性能 / 架构 / 一致性） | 约 15 项 | **P-01~P-05**（工作簿打开、摘要 O(n²)、索引串行、正文索引、原地裁剪）、**V-M7**（会话 TTL/密码）、**S-01**（巨型文件拆分，按功能域分批）、**Q-02**（共享 bootstrap）、**Q-09**（slides-bridge 类型化）、**V-M14**（调试钩子剔除）、**S-03/T-09**（i18n 与文档校准）、**T-01/T-03/T-04**（E2E 文档与稳定性） | 建立 Benchmark 基线并量化首开/搜索耗时改善；单文件行数上限 ≤500 的新增模块；`npx playwright test --list` 与文档一致 |
| **P3 · 清理** | 低危项 | Q-03/Q-04、V-M16~M18、6.3 全部低危、C-03~C-07、T-05/T-07、S-02/S-05 | 死代码删除、命名统一、魔法数字集中到各包 `limits.go`、文档零过时表述 |

**依赖顺序建议**：P0 的 V-H1/V-H3/V-H4 都涉及「授权/查询构造」这一条链路，可合并为一次「输入校验与授权收口」专项；C-01+C-08 应合并为「发布流水线」专项；S-01 巨型文件拆分必须在 Q-02（共享 bootstrap）与 C-02（lint 门禁）之后，否则重构没有安全网。

---

## 十、值得肯定的实践（保持）

1. **安全基线扎实**：全站 CSP、`script-src 'self'` 无第三方脚本、外部链接强制经 Go `ValidateExternalURL` 校验、`sanitize-markdown-html.ts` 协议白名单消毒、`zip-gate` 防 zip 炸弹、`mermaid securityLevel:'strict'`、`sourcemap: false`；`fsutil/pathguard` 对设备名/ADS/符号链接有专门测试用例。
2. **写授权模型设计正确**：`PathGrants` + `AuthoriseWrite` + `atomicSaveBytes`（temp + Sync + rename）是桌面应用处理不可信渲染器路径的正确范式——问题只在 V-H3 的授权范围放宽，而非模型本身。
3. **E2E 架构水准高**：真实 Go 后端、动态端口、`/health` 就绪门、隔离数据目录、落盘断言、`harness.spec.ts` 防「套件退化成 mock」。
4. **CI 质量门禁超常规**：bindings 漂移检查 + `go test -race` + `run: once` 防构建竞态。
5. **类型化 i18n**：`packages/i18n/src/index.ts:100-108` 的 `LangDicts<D>` 使漏翻译成为编译期错误，`format()` 用 `Object.hasOwn` 防原型污染。
6. **崩溃可观测**：启动期 `recover` + `PanicHandler` + `diagnose.WriteCrashReport` + 渲染进程 watchdog。
7. **打包与体积治理**：SHA-256 sidecar 实测与产物一致；剪枝与跨 app 资源去重均附详尽踩坑注释。
8. **文档同步**：中英 README 逐行对齐；`.gitignore` 带解释性注释（明确标注 NSIS 是源码必须保留）。

---

## 附录 A：核实说明与统计口径

**本次报告撰写前逐条回读源码复核的结论**（非二手推断）：`store.go:247,261-278,306-309`（FTS 拼接与 `\'` 转义）、`pathgrants.go:151-215`（TempDir 授权）、`pdfengine.go:467-485`（img.Name 拼接）、`markdownservice.go:124-131`（base64 猜测）、`shell/main.tsx:27-48`（无 catch）、`hf-dom.ts:1061,1078`（SVG 属性拼接）、`extract.go:47-54`（Office/PDF name-only）、`closeguard.go:55-104`（Save 分支）、`engine.go:92-103`（固定 UUID 降级）、`docker/Dockerfile.server:67`（0.0.0.0）、`e2e/README.md:43`（70/11 声明）、`.gitignore`、`frontend/package.json`、shell/slides `package.json`、CI job 清单、巨型文件行数、版本号 18+ 处、`git status --short`。

**数量统计**：`find` 实测（`internal` 139/62、`frontend/apps+packages` 1528/425、`e2e/specs` 13、docs 2、e2e 79 处 test 定义、6 fixme）；「约 517 个 Go Test / 约 4087 个前端用例」来自子域全文统计，属估算值，标注「约」。

**三项常见扣分项经核实不成立**：CI 不缺失（5 job）、node_modules 未入库（git 跟踪数 0）、无真实凭据泄露。
