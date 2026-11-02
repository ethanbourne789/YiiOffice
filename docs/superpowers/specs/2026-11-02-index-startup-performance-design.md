# 子项目 1 设计：增量索引与启动性能

- 日期：2026-11-02
- 状态：设计已获用户批准，待评审本文档
- 范围：文件索引实时化（fsnotify 增量）、全量扫描并行化、Go 堆软上限

## 背景与动机

- 搜索索引（SQLite FTS5 + CJK 分词）目前只有全量扫描，且仅 `internal/bridge/docsservice.go` 两处触发 `Refresh()`；侧栏文件树与搜索结果不是实时的。
- Phase 2 计划（`docs/superpowers/plans/2026-10-29-yiioffice-wailsv3-phase2-host-services.md` L771）原设想用 fsnotify 监听已添加文件夹并通过 `home:folder-changed` 通知前端，**从未实现**：前端 `home-bridge.ts` L474 已有订阅代码，Go 侧无任何 `Emit("home:folder-changed")` 调用点。
- `index.Init` 已将全量扫描放后台（`internal/index/lifecycle.go` L26-30），启动同步部分只有打开 SQLite（毫秒级），无需重构启动顺序；但扫描本身是单线程顺序 walk，`ExtractText`（zip 解压 + 文本清洗）为 CPU 密集。
- excelize 工作簿会话全量驻留内存，多标签大文件场景与 WebView2 争抢物理内存。

## 目标

1. 侧栏 roots 内文件创建/修改/重命名/删除在秒级内反映到搜索索引（FTS 命中）。
2. 启用 `home:folder-changed` 事件：Go 侧开始 Emit，前端现有订阅自然生效。
3. 冷启动全量扫描并行化，多核机器显著缩短索引时间。
4. 设置 Go 堆软上限（GOMEMLIMIT），降低大文件场景整机卡顿概率。

## 非目标

- 不扩大监听范围到系统常用目录或全盘（仅侧栏 roots）。
- 不改动 bindings 层与前端 IPC 协议（复用既有事件通道，前端零改动）。
- 不实现跨平台监听（项目 Windows-only，`main.go` 带 `//go:build windows`）。
- 不新增设置 UI（GOMEMLIMIT 与去抖时长为代码常量）。

## 已确认决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 监听范围 | 仅 `fm.RootPaths()` | 与现有索引 roots、本地图片授权边界一致，改动最小 |
| 监听实现 | `github.com/fsnotify/fsnotify` | ReadDirectoryChangesW 的成熟封装；裸 Win32 overlapped IO 需手写缓冲区回绕/目录重开，坑多 |
| 事件通道 | 复用 `home:folder-changed` | 前端已订阅（home-bridge.ts L474、home-api.ts L307），零迁移成本 |

## 架构与组件

### 1. `internal/index/watcher.go`（新增）

- `Watcher` 结构：持有 `*fsnotify.Watcher`、`watchedDirs map[string]struct{}`、去抖队列、`sync.Mutex`。
- `SyncRoots(roots []string)`：diff 旧新 roots；对每个 root 按 `ScanDir` 相同规则（跳过隐藏项、symlink 目录、深度 ≤ `ScanMaxDepth`）walk 出全部子目录并注册监听；新增子目录事件到达时动态 `Add`。由 FolderManager 增删侧栏文件夹时调用（经 Lifecycle 转发）。
- 事件循环：`Events` → 过滤（`supportedExts` 之外、隐藏项跳过）→ 去抖队列。
- 去抖：按路径合并，400ms 窗口（Windows 写事件会连续触发多次）；批量出队后调用增量索引接口。
- `Errors`：记 warn；`Events` channel 溢出或大批量变动 → 对受影响 root 退化为一次 `Refresh()`（正确性优先）。

### 2. `FileIndexer` 新增方法（`internal/index/indexer.go`）

- `IndexOne(path string) error`：`os.Stat` → ENOENT 转 `RemoveIndexed`；否则 `ExtractText` + 现有 prepared `Upsert`（WAL 事务）。
- `RemoveIndexed(path string) error`：删除 `files` 行与对应 FTS5 行。
- 既有 `Refresh()` 全量语义保留，作为兜底与冷启动路径。

### 3. Lifecycle 接线（`internal/index/lifecycle.go`）

- `Init` 创建并启动 `Watcher`（初始 `SyncRoots`）；`Shutdown` 停止。
- 暴露 `Watcher()` 或在 `Refresh` 同级提供 `SyncRoots`，由 `HomeService` 的文件夹增删方法调用。

### 4. 并行全量扫描（`internal/index/indexer.go` `run()`）

- 每个 root 按一级子目录切分为任务，`golang.org/x/sync/errgroup` + `SetLimit(4)` 并行 walk + extract；合并结果后走既有 diff/删除/更新流程。
- 新增依赖 `golang.org/x/sync`（官方扩展库，与现有 x/sys、x/text 同源）。

### 5. `main.go`

- 启动早期 `debug.SetMemoryLimit(2 << 30)`（常量定义于 main，注释说明可调）。

## 数据流

```
ReadDirectoryChangesW
  → fsnotify.Events → 过滤 → 去抖(400ms/路径)
  → IndexOne / RemoveIndexed（SQLite WAL 事务）
  → platform.Emit("home:folder-changed", {path})
  → 前端 home-bridge 订阅 → 文件树/搜索刷新
```

事件 payload 形状以实现时 `home-bridge.ts` L474 处理器与 `Home.tsx` 消费端期望为准（若前端仅做"重新拉取"式刷新，payload 可只含变更路径）。

## 错误处理与边界

- **rename/delete 竞态**：`IndexOne` 前 `Stat`，ENOENT → 删除索引行。
- **目录权限丢失**：fsnotify 报错 → warn 日志 + 移除该目录监听，不影响其余目录。
- **事件溢出**：丢弃积压事件，对受影响 root 触发 `Refresh()` 兜底。
- **并发安全**：`SyncRoots` 与事件循环经互斥锁串行化；`FileIndexer` 既有锁语义不变。
- **规则一致性**：隐藏项/symlink/深度/扩展名过滤全部复用 `scan.go` 现有常量与判断，避免监听集合与索引集合不一致。

## 测试与验证

- 单测 `internal/index/watcher_test.go`：临时目录 + 可注入短去抖，覆盖 create/write/rename/delete、不支持扩展名过滤、`SyncRoots` 增删。
- 单测：并行 `run()` 与顺序实现结果一致性（golden 对比）。
- 回归命令（全部须 exit 0）：
  - `go test ./internal/index/... ./internal/bridge/...`
  - `go build -tags production ./...`
  - `npm test`（frontend，确认零改动不破坏现有套件）
- 手动验证（桌面构建）：侧栏添加文件夹 → 资源管理器新建/重命名 docx → 秒级搜索命中、文件树刷新。

## 成功标准

- 监听目录内新建受支持文档后，≤1s 可被 FTS 搜索命中（常规大小文件）。
- 冷启动扫描在 ≥4 个一级子目录的目录上，多核机器耗时较顺序版降低 ≥60%。
- 前端代码零改动；不新增 bindings。

## 风险

- fsnotify Windows 非递归监听，子目录集合需自维护；"新子目录创建"到"其内文件事件"存在窗口，靠 Create dir 事件即时 `Add` + 溢出兜底 `Refresh` 覆盖。
- `SetMemoryLimit(2GiB)` 为经验起点，低内存机器可能偏紧；先以常量交付，若观测有问题再调参或引入按物理内存自适应。
