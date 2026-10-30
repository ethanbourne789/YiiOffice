# Wails3 官方绑定路线迁移方案（Bindings Migration Plan）

> 目标：从「单方法 `bridge.Service.Invoke(channel,args)` + 手写 wails-bridge + `Call.ByName`」
> 迁移到「官方命名方法绑定 + `wails3 generate bindings` + 前端 `Call.ByID`」。
> 由只读盘点（审计结论）沉淀，供分批执行使用。

## 迁移完成 ✅ (2026-10-29)

### 完成的服务 (9 个，109 个方法)

| 服务 | 文件 | 方法数 | Go 侧 | 前端桥 | 状态 |
|---|---|---|---|---|---|
| ShellService | `shellservice.go` | 2 | ✅ | `shell-bridge.ts` | ✅ |
| TabService | `tabservice.go` | 10 | ✅ | `tabs-bridge.ts` | ✅ |
| HomeService | `homeservice.go` | ~40 | ✅ | `home-bridge.ts` | ✅ |
| DocsService | `docsservice.go` | 6 | ✅ | `docs-bridge.ts` | ✅ |
| SlidesService | `slideservice.go` | 7 | ✅ | `slides-bridge.ts` | ✅ |
| PdfService | `pdfservice.go` | 18 | ✅ | `pdf-bridge.ts` | ✅ |
| MarkdownService | `markdownservice.go` | 8 | ✅ | `markdown-bridge.ts` | ✅ |
| WorkbookService | `workbookservice.go` | 16 | ✅ | `workbook-bridge.ts` | ✅ |
| Service (legacy) | `service.go` | 1 | 保留 | — | 双轨 |

### 验证结果

| 检查项 | 结果 |
|---|---|
| `go build -tags production ./...` | ✅ exit 0 |
| `go test ./internal/bridge/...` | ✅ ok |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` (vitest) | ✅ 6/6 passed |
| `node tools/build-renderers.mjs shell` | ✅ ✓ built |

### 关键经验教训

- **`wails3 generate bindings` 会删除手写 `.d.ts`**（含 -clean 和不含 -clean）→ 每次生成后重建 8 个 d.ts 文件
- **Vitest 不识别 vite/tsconfig 别名** → 需在 `vitest.config.ts` 中加 `resolve.alias @bindings`
- **测试断言需更新** → `Call.ByName('bridge.Service.Invoke', 'chan', [...])` 改为 mock 生成绑定
- **stub 通道保留在旧 Router** → export-pdf/print/edit-*/undo/redo/dirty-changed 等为 no-op，前端仍走 `invoke`
- **共享设置通道（getLanguage/getTheme/getDocumentTheme）只声明一次** → 在 HomeService，所有 editor 通过绑定调用

### 服务拆分草案与执行对照

**实际拆分比草案略有调整**：
- App 服务未单独创建（共享设置归入 HomeService）
- Update 通道并入 HomeService（与草案一致）
- PdfService 额外包含了 14 个 PDFengine 结构操作（原草案低估）
- WorkbookService 包含了 sheets:user 通道（readFormulas, findCells, displayName 等）

### 剩余工作（低优先级）

- **清理旧 `Invoke` 兼容层**：待所有 stub 通道废弃后删除 `service.go` 中的 Invoke + transport.ts 中的 ByName
- **e2e 测试更新**：Playwright 断言依赖 bridge channel 的需对照新方法更新