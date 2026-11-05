# 错误码本地化报告

> 范围：`internal/bridge` 的 bridge 出口 + `internal/update/latest.go` 的 `Message`；前端 6 个应用（shell / docs / slides / pdf / markdown / sheets）。
> 本轮未生成 bindings、未新增绑定方法、未改绑定签名、未新增结构体。

## 一、结论

### 已经不会再看到英文错误串的场景

| 场景 | 覆盖位置 | 用户看到的 |
| --- | --- | --- |
| 检查更新：网络不可达 / HTTP 500 / JSON 异常 / 无 tag / 版本不可比 | `internal/update/latest.go` → shell `SettingsModal` | 中文/英文原因；原始串收进「详情」 |
| 打开文件：路径无效、未授权、读取失败、类型不支持、选择器失败 | docs / slides / sheets / markdown / pdf / shell | `err_open_*` 本地化文案 |
| 保存文件：路径无效、未授权、内容解码失败、建目录失败、写失败、对话框失败 | docs / slides / sheets / markdown / pdf / shell | `err_save_*` 本地化文案 |
| 导出：空文档、目标未授权、对话框、解码、写入、渲染、合并、源不可读 | docs / slides / markdown / sheets / pdf | `err_export_*` 本地化文案 |
| PDF 页面操作：未授权、对话框、页面解码、引擎失败 | pdf | `err_pdf_op_*` 本地化文案 |
| Shell 首页：打开、加载、图标、添加根目录、打开本地文件 | shell `Home.tsx` | 本地化文案 |

典型例子：Gitee 返回 500 时，`Message` 现在是 `update_feed_http_error: HTTP 500: …`，界面显示「更新服务暂时不可用，请稍后重试」；`cannot order "YiiOffice" against "0.13.0"` 变为「当前版本与最新版本无法比较」。

### 仍可能看到英文错误串的场景（本轮未覆盖）

- Shell 文件管理：重命名 / 移动 / 复制 / 删除 / 移动冲突（`Home.tsx` 与 `TabBar.tsx` 直接展示 `result.error`）。
- Shell 恢复副本（`docsservice.go` 的 `WriteRecoveryCopy`）、文件浏览器未配置、`revealPath` 未配置、批量移动计数、`resolve executable`。
- Shell 设置保存、搜索失败、`shellservice.go` 打开外部程序/读本地图片的部分内部错误。
- workbook：pivot 不支持、`CreateDocument` 的解码/写入失败、未知导出类型。
- sheets 内部引擎错误（Univer / 操作执行器 / 数据工具 / 图表等），多数不是 Go 出口。
- `internal/export` 渲染内部逻辑与 `internal/update` 下载安装逻辑（按约束未碰）。
- Markdown 大纲/重载等 headless 内部错误。

## 二、清点与覆盖面

清点方式：按 bridge 方法的 `error` 返回值、`Status`/`Reason`/`Error` 字符串字段、`internal/update` 的 `Message` 三类出口逐一核查；workbook 已有的稳定错误码全部沿用。

- 新增 Go 错误码：**29 个**（open 5 + save 5 + export 8 + pdf_op 4 + update 5 + `app_unavailable` 1）。
- 改造文件：`internal/bridge` 11 个 + `internal/update` 1 个；新增 `errcodes.go` / `errcodes_test.go`。
- 前端接线：6 个应用、21 个文件、78 处调用 `bridgeErrorText`。
- 既有 workbook 码（`workbook_password_required` 等）**未重命名**，由 `codedError` 幂等透传。

## 三、错误码表

| 错误码 | 中文 | English |
| --- | --- | --- |
| `open_path_invalid` | 文件路径无效 | The file path is invalid |
| `open_path_not_authorised` | 无法读取该文件，请通过“打开”重新选择 | Cannot read this file; choose it again with Open |
| `open_read_failed` | 读取文件失败，文件可能已被移动或损坏 | Could not read the file; it may have been moved or damaged |
| `open_unsupported_type` | 不支持打开该类型的文件 | This file type is not supported |
| `open_dialog_failed` | 无法打开文件选择器 | Could not open the file picker |
| `app_unavailable` | 应用窗口不可用 | The application window is not available |
| `save_path_invalid` | 保存路径无效 | The save path is invalid |
| `save_path_not_authorised` | 无法写入该位置，请使用“另存为”重新选择保存位置 | Cannot write to this location; choose another location with Save As |
| `save_decode_failed` | 文件内容损坏，无法保存 | The file content is damaged and cannot be saved |
| `save_directory_failed` | 无法创建保存文件夹 | Could not create the save folder |
| `save_write_failed` | 保存失败，请检查磁盘空间或文件权限 | Save failed; check disk space or file permissions |
| `save_dialog_failed` | 无法打开保存对话框 | Could not open the save dialog |
| `export_empty_document` | 没有可导出的内容 | There is nothing to export |
| `export_target_not_authorised` | 无法写入导出位置，请重新选择保存位置 | Cannot write to the export location; choose another location |
| `export_dialog_failed` | 无法打开导出对话框 | Could not open the export dialog |
| `export_decode_failed` | 导出内容损坏，无法写入 | The export content is damaged and cannot be written |
| `export_write_failed` | 写入导出文件失败，请检查磁盘空间或权限 | Could not write the export file; check disk space or permissions |
| `export_render_failed` | 渲染 PDF 失败，请稍后重试 | PDF rendering failed; try again later |
| `export_merge_failed` | 合并 PDF 失败 | Could not merge the PDF parts |
| `export_source_unreadable` | 无法读取导出源文件 | Could not read the export source file |
| `pdf_op_not_authorised` | 无法写入所选位置，请重新选择 | Cannot write to the selected location; choose another one |
| `pdf_op_dialog_failed` | 无法打开文件选择器 | Could not open the file picker |
| `pdf_op_decode_failed` | 页面数据损坏，无法写入 | Page data is damaged and cannot be written |
| `pdf_op_failed` | PDF 操作失败，文件可能已损坏 | The PDF operation failed; the file may be damaged |
| `update_feed_unreachable` | 无法连接更新服务，请检查网络后重试 | Cannot reach the update service; check your network and try again |
| `update_feed_http_error` | 更新服务暂时不可用，请稍后重试 | The update service is temporarily unavailable; try again later |
| `update_feed_invalid` | 更新服务返回了无法识别的数据 | The update service returned an unrecognized response |
| `update_feed_no_tag` | 更新服务未提供版本信息 | The update service did not report a version |
| `update_version_incomparable` | 当前版本与最新版本无法比较 | The current and latest versions cannot be compared |
| 兜底 `errGeneric` | 操作失败，请稍后重试 | Something went wrong. Please try again later. |

原有 workbook 码保持不变（如 `workbook_password_required`），前端继续按原码映射。

## 四、改动位置

### Go 后端

- [errcodes.go](../../internal/bridge/errcodes.go#L22-L102)：错误码常量、`codedError` / `codedMessage` 幂等包装、码识别。
- [errcodes_test.go](../../internal/bridge/errcodes_test.go)：前缀、已有码透传、空 detail、英文误判。
- [latest.go](../../internal/update/latest.go#L168-L209)：`update_feed_no_tag`、`update_version_incomparable`、`update_feed_unreachable`、`update_feed_http_error`、`update_feed_invalid`。
- [latest_test.go](../../internal/update/latest_test.go#L148-L171)：httptest 500 / JSON 异常断言码前缀。
- [fileops.go](../../internal/bridge/fileops.go#L20-L59)：保存授权 / 建目录 / 临时文件写入改名 / decode。
- [exportservice.go](../../internal/bridge/exportservice.go#L52-L291)：ExportPdf / ExportHtml / RenderPdfBase64 / MergePdfParts / PickExportFolder / PickSaveFile / TakeTempPdf / WriteBase64File / resolveExportTarget。
- [docsservice.go](../../internal/bridge/docsservice.go#L50-L228)：OpenPath / PickFiles / PickImage / SaveImageAs / OpenDocx / SaveDocx。
- [slideservice.go](../../internal/bridge/slideservice.go#L32-L96)：OpenPath / PickFiles / FilesAdd。
- [pdfservice.go](../../internal/bridge/pdfservice.go#L30-L73)：读授权 / 写授权 / ReadFile / Save 路径校验。
- [pdfops.go](../../internal/bridge/pdfops.go#L35-L378)：选择器、临时文件、页面解码/写入、所有引擎操作。
- [markdownservice.go](../../internal/bridge/markdownservice.go#L37-L283)：保存、读文件、读图、导出 DOCX/PDF。
- [util.go](../../internal/bridge/util.go#L360-L418)：图片另存、应用托管副本写入。
- [workbookservice.go](../../internal/bridge/workbookservice.go#L94-L347)：打开/保存授权、对话框、CSV 导出、PDF 导出；workbook 码透传。
- [homeservice.go](../../internal/bridge/homeservice.go#L133-L148)：默认保存目录、添加根目录；`#L322` 不支持类型。

### 前端共享与各应用

- [error-code.ts](../../frontend/packages/i18n/src/error-code.ts#L24-L42)：`parseBridgeError`，纯字符串解析，不依赖 `window`。
- [i18n/index.ts](../../frontend/packages/i18n/src/index.ts)：导出 parser。
- 各应用 `bridgeErrorText`：shell [locale.tsx](../../frontend/apps/shell/src/renderer/src/locale.tsx#L61)、docs [locale.tsx](../../frontend/apps/docs/src/renderer/i18n/locale.tsx#L33)、slides [locale.tsx](../../frontend/apps/slides/src/renderer/i18n/locale.tsx#L33)、pdf [locale.tsx](../../frontend/apps/pdf/src/renderer/i18n/locale.tsx#L46)、markdown [locale.tsx](../../frontend/apps/markdown/src/renderer/i18n/locale.tsx#L42)、sheets [locale.tsx](../../frontend/apps/sheets/src/renderer/i18n/locale.tsx#L35)。
- 检查更新 UI：[SettingsModal.tsx](../../frontend/apps/shell/src/renderer/src/SettingsModal.tsx#L263-L279) 本地化原因，`#L476-L480` 「详情」展开原始串。
- 打开/保存/导出接线：
  - docs [file-actions.ts](../../frontend/apps/docs/src/renderer/file-actions.ts#L518-L1443)、[review-actions.ts](../../frontend/apps/docs/src/renderer/review-actions.ts#L377)
  - slides [file-actions.ts](../../frontend/apps/slides/src/renderer/file-actions.ts#L116-L276)、[App.tsx](../../frontend/apps/slides/src/renderer/App.tsx#L1237)、[PrintDialog.tsx](../../frontend/apps/slides/src/renderer/components/PrintDialog.tsx#L84-L168)、[style-actions.ts](../../frontend/apps/slides/src/renderer/style-actions.ts#L298)、[picture-edit-actions.ts](../../frontend/apps/slides/src/renderer/picture-edit-actions.ts#L181-L183)
  - pdf [App.tsx](../../frontend/apps/pdf/src/renderer/App.tsx#L3370-L3802)
  - markdown [App.tsx](../../frontend/apps/markdown/src/renderer/App.tsx#L649-L828)
  - sheets [save-actions.ts](../../frontend/apps/sheets/src/renderer/save-actions.ts#L418-L671)、[App.tsx](../../frontend/apps/sheets/src/renderer/App.tsx#L3235)、[csv-export.ts](../../frontend/apps/sheets/src/renderer/csv-export.ts#L169)
  - shell [Home.tsx](../../frontend/apps/shell/src/renderer/src/Home.tsx#L1006-L1822)
- 翻译键（zh/en 成对）：
  - shell [strings.ts](../../frontend/apps/shell/src/renderer/src/strings.ts#L199-L226) / `#L419-L446`（`update*` 既有行未改，仅追加）
  - docs [zh.ts](../../frontend/apps/docs/src/renderer/i18n/app/zh.ts#L531-L549) / [en.ts](../../frontend/apps/docs/src/renderer/i18n/app/en.ts#L513-L531)
  - slides [zh.ts](../../frontend/apps/slides/src/renderer/i18n/app/zh.ts#L250-L268) / [en.ts](../../frontend/apps/slides/src/renderer/i18n/app/en.ts#L265-L283)
  - pdf [strings.ts](../../frontend/apps/pdf/src/renderer/i18n/strings.ts#L498-L514) / `#L809-L825`
  - markdown [strings.ts](../../frontend/apps/markdown/src/renderer/i18n/strings.ts#L206-L224) / `#L438-L456`
  - sheets [zh.ts](../../frontend/apps/sheets/src/renderer/i18n/app/zh.ts#L1474-L1492) / [en.ts](../../frontend/apps/sheets/src/renderer/i18n/app/en.ts#L1524-L1542)
- 测试：[error-code.test.ts](../../frontend/packages/i18n/src/error-code.test.ts)、[locale.test.ts](../../frontend/apps/docs/src/renderer/i18n/locale.test.ts)。

## 五、兜底策略与原始串处理

- wire 格式统一为 `<code>: <detail>`；detail 仅用于诊断。
- 已知码：只显示本地化文案，**不显示 detail**（detail 是 `ENOENT`、HTTP 响应体等，对用户无意义且有泄露路径的风险）。
- 未知码 / 纯英文：显示 `errGeneric`（「操作失败，请稍后重试」/「Something went wrong. Please try again later.」），原始串 `console.warn('[bridge] unmapped error', …)` 供开发者排查。
- 检查更新面板额外提供 `<details>`「详情 / Details」展开原始 `Message`：设置页有稳定展示位，用户报错时可直接复制；而 toast/状态栏是瞬态、没有展开控件，因此不在那里展示原始串。
- `codedError` 对已带码的错误原样返回，避免 `workbook_*` 等既有码被二次加前缀；前端按 `err_<code>` 精确查表，未命中即兜底。

## 六、验证结果

全部本轮实测通过：

| 命令 | 结果 |
| --- | --- |
| `go build ./...` | exit 0 |
| `go test -count=1 ./internal/...` | exit 0（bridge 24.3s、update 0.259s 等全部 ok） |
| `npm --prefix frontend run typecheck` | exit 0（全部 workspace） |
| `npm --prefix frontend test` | exit 0（含新增 `error-code.test.ts`、docs `locale.test.ts`） |

后端失败构造验证（分层）：

1. `latest_test.go` 用 `httptest` 返回 **HTTP 500**（body「upstream is down」）和坏 JSON，断言 `Message` 分别以 `update_feed_http_error:` / `update_feed_invalid:` 开头，且保留 `HTTP 500` 诊断。
2. `locale.test.ts` 用同格式样例 `open_read_failed: ENOENT: no such file or directory` 断言输出等于 `strings.zh.err_open_read_failed`，且结果**不包含 `ENOENT`**；未知码与纯英文均落到 `errGeneric`（stderr 有预期的 unmapped warn）。

未执行：`wails3 generate bindings`、`task build`、`go build -o build/bin/`、NSIS、git 提交（遵守约束）。

## 七、留到下一轮

1. Shell 文件管理：`homeservice.go` 的重命名/移动/复制/删除/移动冲突错误（含 `failed to move %d items`、`not a directory`），以及 `Home.tsx` / `TabBar.tsx` 直接展示 `result.error` 的入口。
2. `docsservice.go` 的 `WriteRecoveryCopy`（`app data dir` / `create recovery dir` / `decode content`）。
3. `homeservice.go` 的 `file browser not configured`、`revealPath not configured`、`resolve executable`。
4. `internalservice.go` 关闭流程错误、`windowservice.go` 的 `errNoWindow`、`shellservice.go` 打开外部程序/本地图片的部分错误。
5. `workbookservice.go` 的 pivot 不支持、`CreateDocument` 解码/写入/未知类型。
6. `util.go` 的 URL 校验、扩展名白名单、`app not available` 直接返回处。
7. sheets 内部引擎错误（Univer / op-executor / 数据工具 / 图表）——非 Go 出口，建议单独评估是否也要本地化。
8. `internal/export` 渲染内部错误与 `internal/update` 下载安装错误（本轮按要求未碰）。
