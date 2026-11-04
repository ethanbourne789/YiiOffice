# 发布检查清单（自动更新恢复时的前置条件）

> **状态：自动更新当前为暂停开发。** 本清单不是现行发布流程，而是恢复该功能时必须先满足的约定。
> 当前 `task package:windows` 仍产出 `dist/YiiOffice_<version>_setup.exe`（不含平台/架构，发布后 updater 无法匹配），
> 也尚未新增 `release:prepare` 任务；下文标「恢复时」的条目均未落地。

应用内更新（`internal/update`）直接消费 Gitee Release 的 tag 与资产文件名。恢复开发时要让完整性校验真正被触发，逐条确认。

## 1. 版本与 tag（恢复时）

- 版本号保持单一来源 `VERSION`（Taskfile），与 `buildinfo.Version`、安装包版本、`config.yml`/`frontend/package.json` 一致。
- **tag 必须是 `vX.Y.Z`**（如 `v0.14.0`）。更新器用 `semver.IsNewer` 比较 tag；`YiiOffice` 这类非 semver tag 会被判为「没有更新」，自动安装链路不会触发（已用当前 Gitee release 实测确认）；应用内手动检查则会显示「有新发布但无法比较」（见第 6 节）。

## 2. 资产命名（恢复时必须先落地并验证）

Wails v3.1.0 `providers/github.DefaultAssetMatcher` 的规则（源码路径
`pkg/updater/providers/github/github.go` 的 `DefaultAssetMatcher`）：

1. 跳过 `.sig`/`.asc`、名字含 `-installer.`/`_installer.`、`.sha256`/`.sha512`/`.sums` 等校验文件，以及 `installer.exe`；
2. 文件名转小写后必须包含运行平台字符串（本应用 `windows`）；
3. 必须包含架构字符串（`amd64`，也接受 `x86_64`/`x64`）；
4. 取第一个命中的资产。

所以恢复时应把安装包改为 `YiiOffice-<version>-windows-amd64.exe`，并同步 Taskfile 的 `.sha256` 生成逻辑与
`installer.nsi` 的 `OutFile`（建议由 Taskfile 通过 `-DINSTALLER_FILE` 传入文件名，保留 nsi 内同规则 fallback，避免两处漂移）。
本次尝试的改名改动因未经干跑/真实打包验证已回退，恢复时需重新落地并验证。

## 3. 构建与产物（恢复时）

计划新增 `task release:prepare`（当前不存在）：内部调用 `package:windows`，产出两个文件并打印清单：

| 文件 | 说明 |
| --- | --- |
| `YiiOffice-<version>-windows-amd64.exe` | NSIS 安装包 |
| 同名 `.sha256` | `sha256sum` 格式：`<hex>  <filename>`，可整行贴入 release notes |

**不要手工改名其中一个而漏掉另一个。**（当前的 `.sha256` 任务已改为输出 `sha256sum` 风格，可直接复用。）

## 4. 上传与信任边界

Release 必须同时上传安装包与同名 `.sha256`。sidecar 与安装包使用同一发布凭据，因此这层校验防的是
**传输 / 镜像 / 截断 / 版本错配**，不防「发布账号被盗」。项目未购买代码签名证书，Windows 首次运行仍可能提示
「未知发布者」；用户可用 release notes 中的 SHA-256 自行比对。

## 5. 发布后自检（恢复时）

1. Release 资产列表里两个文件都存在，文件名完全一致（含 `.sha256` 后缀）。
2. 客户端「检查更新」返回 `available=true` 且 `integrity="sha256"`；`integrity="missing"` 说明 sidecar 未上传成功。
3. 故意提供错误哈希时，客户端应报 `update aborted: updater: digest mismatch` 并拒绝安装。

## 6. 应用内检查更新：走的官方流程与降级行为

设置页「关于」里的「检查更新」只读一次 feed，**不下载、不校验哈希、不安装**（方案 A）。实现要点：

- 请求：`GET https://gitee.com/api/v5/repos/<owner>/<repo>/releases/latest`（与 GitHub Releases API 同形），15s 超时；
  Gitee 的资产下载地址兼容补丁（`internal/update/giteecompat.go`）只影响安装路径，本检查直接读 `browser_download_url`。
- 版本比较复用 Wails 上游同一个 `golang.org/x/mod/semver`，语义与 `pkg/updater` 一致。
- **为什么没有直接调用 `updater.Check`**：v3.1.0 的 GitHub provider 在 `providers/github/github.go:131-133`
  硬编码了 `semver.IsNewer`，没有注入点。tag 非 semver（今天的 `YiiOffice`）时它返回 `(nil, nil)`，
  和「已是最新」无法区分；同一函数还在 `:135-139` 要求资产名含 `windows`/`amd64`，并会读取 `.sha256`
  sidecar（`internal/update/provider.go` 的 `checksumProvider`）。因此官方 Check 只能用于安装路径，
  手动检查另走一次只读解析。
- 可配置的部分（安装路径已使用）：provider 可换（`updater.Config.Providers`），资产匹配可换
  （`github.Config.AssetMatcher` → `internal/update/provider.go:matchInstallerAsset`，在平台/架构规则之后
  追加 `*_setup.exe` 兜底，使现有 `YiiOffice_<version>_setup.exe` 也能被官方 Check 选中）。
  **版本比较不可注入**，这是降级存在的唯一原因。

状态（`internal/update/latest.go` 的 `CheckNow`）：

| status | 含义 | 触发条件 |
| --- | --- | --- |
| `latest` | 已是最新 | tag 与当前版本都可比较且不比当前新；或 feed 无 release（HTTP 404） |
| `update-available` | 有新版本 | tag 与当前版本都可比较且更新 |
| `incomparable` | **有新发布，但无法判断新旧** | 有 release，但 tag（或当前版本）不是语义版本；`latestVersion` 给原始 tag，`latestSemver` 为空 |
| `error` | 检查失败 | 网络/HTTP/JSON 解析失败；`message` 带上游原因 |

Gitee API v5 实测（2026-11-03 的 `tag=YiiOffice` 发布）：**没有 `published_at`，也没有 `html_url`**。
所以 `publishedAt` 回退到 `created_at`，并用 `publishedAtSource` 标出来源；`releaseUrl` 由资产下载地址
`https://gitee.com/<owner>/<repo>/releases/download/...` 重建为 `/releases` 页。所有 URL 在返回前都过
`gitee.com` / `github.com` 主机白名单（含子域，拒绝 userinfo 与非 https），shell 只打开通过白名单的链接。

因此**在 tag 修成 `vX.Y.Z` 之前，点「检查更新」会得到 `incomparable`**，界面显示
「有新发布：YiiOffice V0.13.0（发布标签不是语义版本，无法判断新旧）」并可打开发布页——这是预期行为，
不是 bug。tag 改好后无需改代码，状态会自动变成 `latest` / `update-available`。

## 7. 不要做的事

- 不要只上传源码 zip/tar.gz（不含 `windows`/`amd64`，不会被误选，但客户端也无更新可用）。
- 不要发布没有 `.sha256` 的版本：客户端会记 `integrity="missing"`，警告后允许安装（兼容历史版本），该次更新没有完整性保护。
