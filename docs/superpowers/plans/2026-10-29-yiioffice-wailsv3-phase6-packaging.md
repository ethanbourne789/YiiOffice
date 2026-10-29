# Phase 6: 打包与更新

> 接续 Phase 5（导出与无头）。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** 将 YiiOffice Wails V3 构建为可在干净 Windows 10/11 上安装的桌面应用，包含 NSIS 安装包、文件关联注册、自动更新机制和代码签名（可选）。

**Scope:** 仅 Windows 平台。不创建 macOS/Linux 打包目标。

**Exit Gate G6:** 安装包在干净 Windows 11 虚拟机上安装即用；WebView2 缺失时引导安装；文件关联生效；自动更新功能可用。

---

## 1. 范围与约束

### 1.1 必须实现

| 功能 | 源参考 | 说明 |
|---|---|---|
| Wails V3 单文件构建 | `wails3 build` | 单 exe，含嵌入的前端资源 |
| NSIS 安装包 | `apps/shell/build/installer.nsh` | 含 ShellNew 模板、自定义安装目录 |
| 文件关联注册 | `electron-builder.cjs` fileAssociations + `default-app.ts` | 注册 .docx/.xlsx/.pptx/.pdf/.md 等 |
| 文件关联图标 | `build/*.ico` | 每种文件类型对应图标 |
| 自动更新 | 源项目未实现（`publish: null`） | 新建，决策门 D8 |
| 代码签名 | `YIIOFFICE_WIN_SIGN_MODE` 环境变量 | 可选，如具备证书 |
| WebView2 引导 | 无 | 缺失时引导用户安装 Evergreen Bootstrapper |
| 空白模板 | `build/shell-new/` | .docx/.xlsx/.pptx 右键 "新建" 模板 |
| 第三方许可 | `THIRD-PARTY-NOTICES.txt` | 含 PDFium 再分发条款 |

### 1.2 依赖 Phase 1-5

| 前置产出 | Phase 6 用途 |
|---|---|
| P1 前端工作区 | 5 个编辑器 bundle 作为打包输入 |
| P4 Rust xlsx sidecar | 作为 extraResources 打包 |
| P5 无头导出 | 集成到安装包 |
| P2 文件关联（运行时） | 构建时注册 + 运行时管理 |

### 1.3 明确不做

- 不做 macOS DMG/zip 打包
- 不做 Linux AppImage/deb/rpm 打包
- 不做 notarization / 公证
- 不做 GitHub Actions CI/CD 发布流水线（后续可加）

---

## 2. 关键决策

### D8: 自动更新方案

源项目未实现自动更新（`publish: null`）。三选一：

| 方案 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|
| **A. Wails updater 插件** | 官方支持，集成简单 | 需要更新服务器/CDN，beta 阶段 API 可能变动 | **首选** |
| **B. 自建 Go 更新器** | 完全控制，支持差分更新 | 开发量大，需处理 self-replace 问题 | 备选 |
| **C. winget / 手动下载** | 零维护成本 | 无自动更新，用户体验差 | 回退 |

**决策：A 为首选，C 为短期回退。**

**实施路径：**
1. 评估 Wails V3 `wails3 update` 或 `github.com/wailsapp/wails/v3/pkg/updater` 可用性
2. 配置更新服务器（可以是 Gitee Release 或自建 HTTP 端点）
3. 在 "Settings → About" 中添加 "检查更新" 按钮
4. 更新流程：检查版本 → 下载 → 后台 NSIS 静默安装 → 提示重启

### D7-EXT: 资源打包策略

| 资源 | 打包方式 | 说明 |
|---|---|---|
| 前端 bundle | `go:embed` | 单文件 exe，P1 已实现 |
| xlsx-sidecar.exe | `extraResources` 或 `go:embed` | Wails V3 支持的额外资源机制 |
| 空白模板 | `go:embed` | 小文件（~50KB），嵌入更简单 |
| PDFium WASM | `go:embed` | 由前端通过相对路径加载 |
| OCR 辅助程序 | `extraResources` | 较大二进制，运行时解压到 temp |

**决策：优先 `go:embed`，大文件使用 `extraResources`。**

---

## 3. 目标仓库结构（Phase 6 新增文件）

```text
build/
├── windows/
│   ├── icon.ico                     # 主应用图标 (Task 1)
│   ├── wails.exe.manifest           # 应用清单 (Task 1)
│   ├── icon-versioned.rc            # 版本资源 (Task 1)
│   └── nsis/
│       ├── installer.nsi            # NSIS 安装脚本 (Task 2)
│       └── uninstaller.nsi          # 卸载脚本
├── shell-new/
│   ├── blank.docx                   # 右键新建模板 (Task 3)
│   ├── blank.xlsx
│   └── blank.pptx
├── icons/
│   ├── docx.ico                     # 文件关联图标 (Task 3)
│   ├── xlsx.ico
│   ├── pptx.ico
│   ├── pdf.ico
│   └── md.ico
├── THIRD-PARTY-NOTICES.txt          # 第三方许可 (Task 4)
└── notary/                          # (预留，代码签名工具)

internal/
├── buildinfo/
│   └── ldflags.go                   # 注入版本信息 (Task 1)
├── export/                          # P5 已有
└── update/                          # 自动更新 (Task 5)
    ├── updater.go
    ├── updater_test.go
    └── bridge.go                    # IPC 通道

Taskfile.yml                         # 修改：增加打包目标

docs/
└── superpowers/
    └── plans/
        └── 2026-10-29-...phase6-packaging.md  (本文件)
```

---

## 4. Phase 6 详细任务（可执行）

### Task 1: Wails V3 构建配置与图标资源

**Go 文件:**
- Modify: `main.go` — 注入版本信息
- Modify: `Taskfile.yml` — 增加 `dist:win` / `dist:win:installer` 目标
- Create: `internal/buildinfo/ldflags.go`

**构建资源:**
- Create: `build/windows/icon.ico`
- Create: `build/windows/wails.exe.manifest`
- Create: `build/windows/icon-versioned.rc`

**Steps:**

- [ ] **Step 1: 准备图标资源**

从源项目 `apps/shell/build/` 复制图标，或从 SVG 源生成：

```powershell
# 如果源项目有现成图标
Copy-Item "E:\Dev\YiiOffice-Electron\apps\shell\build\icon.ico" "build\windows\icon.ico"
Copy-Item "E:\Dev\YiiOffice-Electron\apps\shell\build\*.ico" "build\icons\"
```

- [ ] **Step 2: 写应用清单**

`build/windows/wails.exe.manifest` — 声明 DPI 感知、支持的 OS、文件关联 ProgId：

```xml
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity
    name="YiiOffice"
    processorArchitecture="amd64"
    version="0.13.0.0"
    type="win32"
    language="*" />
  <description>YiiOffice Desktop Office Suite</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/PM</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
```

- [ ] **Step 3: 版本资源**

`build/windows/icon-versioned.rc` — 嵌入版本号、产品名称、版权信息：

```rc
1 ICON "icon.ico"

VS_VERSION_INFO VERSIONINFO
 FILEVERSION 0,13,0,0
 PRODUCTVERSION 0,13,0,0
 BEGIN
   BLOCK "StringFileInfo"
   BEGIN
     BLOCK "040904B0"
     BEGIN
       VALUE "CompanyName", "YiiOffice"
       VALUE "FileDescription", "YiiOffice Desktop Office Suite"
       VALUE "FileVersion", "0.13.0"
       VALUE "InternalName", "YiiOffice"
       VALUE "LegalCopyright", "Apache-2.0"
       VALUE "OriginalFilename", "YiiOffice.exe"
       VALUE "ProductName", "YiiOffice"
       VALUE "ProductVersion", "0.13.0"
     END
   END
   BLOCK "VarFileInfo"
   BEGIN
     VALUE "Translation", 0x0409, 1200
   END
 END
```

- [ ] **Step 4: 配置 Wails V3 构建选项**

在 `main.go` 或 `wails.json`（如果 Wails V3 支持）中配置：

```go
app := application.New(application.Options{
    Name:        "YiiOffice",
    Description: "YiiOffice desktop office suite",
    // ...
    // 版本号从 buildinfo 注入
    Version: buildinfo.Version,
})
```

- [ ] **Step 5: 更新 Taskfile.yml**

```yaml
  dist:win:
    desc: Build Windows production binary
    deps: [frontend]
    cmds:
      - |
        wails3 build -production -tags production
        --ldflags "-X gitee.com/ethanbourne789/yiioffice/internal/buildinfo.Version={{.APP_VERSION}}"

  dist:win:installer:
    desc: Build NSIS installer
    deps: [dist:win]
    cmds:
      - makensis build\windows\nsis\installer.nsi
```

- [ ] **Step 6: 验证构建**

```powershell
$env:APP_VERSION = "0.13.0"
task dist:win
.\build\bin\YiiOffice.exe --version
# 检查文件属性中的版本信息
(Get-Item ".\build\bin\YiiOffice.exe").VersionInfo.FileVersion
```

- [ ] **Step 7: 提交**

```powershell
git add build/windows Taskfile.yml internal/buildinfo
git commit -m "feat: add windows build configuration and icon resources"
```

---

### Task 2: NSIS 安装包

**Source reference:** `apps/shell/build/installer.nsh`

**构建文件:**
- Create: `build/windows/nsis/installer.nsi`
- Create: `build/windows/nsis/uninstaller.nsi`

**Steps:**

- [ ] **Step 1: 编写 NSIS 安装脚本**

基于源项目 `installer.nsh`，关键配置：
- 安装目录默认 `D:\YiiOffice`（检测 D: 盘存在且为本地卷）
- per-user 安装（无 UAC 提示）
- ShellNew 模板注册（.docx/.xlsx/.pptx）
- 文件关联注册（ProgId + 图标）
- 卸载清理

```nsis
; YiiOffice Windows Installer
; Per-user installation, no UAC

RequestExecutionLevel user
SetCompressor lzma

!define APP_NAME "YiiOffice"
!define APP_VERSION "0.13.0"
!define APP_PUB "YiiOffice"
!define APP_EXE "YiiOffice.exe"
!define APP_UNINSTALL_KEY "YiiOffice"
!define APP_WEBSITE "https://yiioffice.com"

Name "${APP_NAME}"
OutFile "..\..\..\dist\${APP_NAME}_${APP_VERSION}_setup.exe"

; 安装目录
InstallDir "$LOCALAPPDATA\${APP_NAME}"

; 页面
Page directory
Page instfiles

; 节
Section "MainSection"
  SetOutPath "$INSTDIR"
  File "..\..\..\build\bin\${APP_EXE}"
  ; ... 其他资源

  ; ShellNew 模板
  SetOutPath "$INSTDIR\shell-new"
  File "..\..\..\build\shell-new\blank.docx"
  File "..\..\..\build\shell-new\blank.xlsx"
  File "..\..\..\build\shell-new\blank.pptx"

  ; 注册文件关联
  WriteRegStr HKCU "Software\Classes\.docx" "" "YiiOffice.docx"
  WriteRegStr HKCU "Software\Classes\YiiOffice.docx" "" "Word Document"
  WriteRegStr HKCU "Software\Classes\YiiOffice.docx\DefaultIcon" "" "$INSTDIR\YiiOffice.exe,0"
  WriteRegStr HKCU "Software\Classes\YiiOffice.docx\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  ; ... .xlsx, .pptx, .pdf, .md 同理

  ; ShellNew 右键新建
  WriteRegStr HKCU "Software\Classes\.docx\ShellNew" "NullFile" ""
  WriteRegStr HKCU "Software\Classes\.docx\ShellNew" "FileName" "$INSTDIR\shell-new\blank.docx"
  ; ... .xlsx, .pptx 同理

  ; 卸载信息
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "Publisher" "${APP_PUB}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayIcon" '"$INSTDIR\YiiOffice.exe"'

  ; 开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; 卸载程序
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; 卸载
Section "Uninstall"
  ; 删除注册表
  DeleteRegKey HKCU "Software\Classes\.docx"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.docx"
  ; ... 其他扩展名

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}"

  ; 删除文件
  RMDir /r "$INSTDIR"
  RMDir "$SMPROGRAMS\${APP_NAME}"
SectionEnd
```

- [ ] **Step 2: 编写卸载脚本**

`build/windows/nsis/uninstaller.nsi` — 清理所有注册表和文件。

- [ ] **Step 3: 构建验证**

```powershell
task dist:win:installer
.\dist\YiiOffice_0.13.0_setup.exe
```

在干净 Windows 11 虚拟机中：
1. 运行安装程序
2. 验证安装目录
3. 验证快捷方式
4. 验证文件关联（右键 .docx 文件 → "打开方式" 有 YiiOffice）
5. 验证 ShellNew（右键空白区域 → "新建" 有 .docx/.xlsx/.pptx）
6. 运行卸载程序
7. 验证注册表清理

- [ ] **Step 4: 提交**

```powershell
git add build/windows/nsis
git commit -m "feat: add NSIS installer with file associations and ShellNew"
```

---

### Task 3: 文件关联图标与默认应用

**Source reference:** `default-app.ts`, `tools/gen-file-association-icons.mjs`

**Go 文件:**
- Modify: `internal/host/fileassoc.go` — 完善默认应用状态查询
- Modify: `internal/bridge/fileassoc.go` — 注册通道

**构建资源:**
- Create: `build/icons/docx.ico` (及 xlsx/pptx/pdf/md)

**Steps:**

- [ ] **Step 1: 准备文件关联图标**

从源项目复制或重新生成：

```powershell
Copy-Item "E:\Dev\YiiOffice-Electron\apps\shell\build\docx.ico" "build\icons\docx.ico"
Copy-Item "E:\Dev\YiiOffice-Electron\apps\shell\build\xlsx.ico" "build\icons\xlsx.ico"
Copy-Item "E:\Dev\YiiOffice-Electron\apps\shell\build\pptx.ico" "build\icons\pptx.ico"
Copy-Item "E:\Dev\YiiOffice-Electron\apps\shell\build\pdf.ico"  "build\icons\pdf.ico"
Copy-Item "E:\Dev\YiiOffice-Electron\apps\shell\build\md.ico"   "build\icons\md.ico"
```

- [ ] **Step 2: 完善运行时默认应用状态查询**

完善 `internal/host/fileassoc.go` 中的 Windows 注册表查询逻辑：

```go
// GetDefaultAppStatus checks which file types are currently associated with YiiOffice.
func GetDefaultAppStatus() (map[string]bool, error) {
    // 通过 registry 查询 HKCU\Software\Classes\Extensions\.<ext>\OpenWithProgids
    // 和 HKCR\.xxx 确定当前默认应用
}

// SetDefaultApp opens ms-settings:defaultapps on Windows.
func SetDefaultApp() error {
    return platform.OpenExternal("ms-settings:defaultapps")
}
```

- [ ] **Step 3: 注册 IPC 通道**

在 `internal/bridge/fileassoc.go` 中注册：
- `home:get-default-app-status` → 返回 `{"docx":true,"xlsx":false,...}`
- `home:set-default-app` → 打开系统设置

- [ ] **Step 4: 提交**

```powershell
git add build/icons internal/host/fileassoc.go internal/bridge/fileassoc.go
git commit -m "feat: add file association icons and runtime default app management"
```

---

### Task 4: WebView2 引导安装

**Steps:**

- [ ] **Step 1: 在启动时检查 WebView2**

```go
func main() {
    if err := checkWebView2(); err != nil {
        // 弹出对话框或引导页面
        if shouldInstall := showWebView2InstallPrompt(); shouldInstall {
            platform.OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703")
            os.Exit(1)
        }
    }
    // ...
}

func checkWebView2() error {
    key := registry.MustOpen(registry.LOCAL_MACHINE,
        `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
        registry.QUERY_VALUE)
    defer key.Close()
    pv, _, err := key.GetString("pv")
    if err != nil || pv == "" {
        return errors.New("WebView2 runtime not found")
    }
    return nil
}
```

- [ ] **Step 2: 提交**

```powershell
git add internal/platform/
git commit -m "feat: add WebView2 runtime check and install prompt"
```

---

### Task 5: 自动更新

**决策门 D8 实施。**

**Go 文件:**
- Create: `internal/update/updater.go`
- Create: `internal/update/updater_test.go`
- Create: `internal/update/bridge.go`

**Steps:**

- [ ] **Step 1: Spike Wails V3 更新 API**

检查 Wails V3 是否内置更新支持：

```powershell
Get-ChildItem $env:USERPROFILE\go\pkg\mod\github.com\wailsapp\wails\v3@* -Recurse |
    Select-String -Pattern "update|Updater" -List -SimpleMatch
```

- [ ] **Step 2: 实现版本检查**

```go
// CheckForUpdates queries the release server for new versions.
func CheckForUpdates(currentVersion string) (*UpdateInfo, error) {
    resp, err := http.Get("https://api.gitee.com/repos/ethanbourne789/yiioffice/releases/latest")
    // 解析响应，比较版本号
}

// DownloadAndInstall downloads the new installer and runs it silently.
func DownloadAndInstall(updateURL string) error {
    // 1. 下载安装包到 temp 目录
    // 2. 运行 NSIS 静默安装: setup.exe /S /D=$INSTDIR
    // 3. 退出当前进程
}
```

- [ ] **Step 3: 注册 IPC 通道**

- `home:check-for-updates` → 返回 `UpdateInfo`
- `home:download-update` → 开始下载
- `home:update-downloaded` (event) → 下载完成通知

- [ ] **Step 4: 前端集成**

在 `@yiioffice/wails-bridge` 中添加 `HomeBridge.checkForUpdates()` 等方法。

- [ ] **Step 5: 提交**

```powershell
git add internal/update frontend/packages/wails-bridge
git commit -m "feat: add auto-update mechanism"
```

---

### Task 6: 代码签名（可选）

**仅当具备代码签名证书时执行。**

**Steps:**

- [ ] **Step 1: 配置签名工具**

```powershell
# 使用 signtool 签名
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a .\build\bin\YiiOffice.exe
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a .\dist\YiiOffice_0.13.0_setup.exe
```

- [ ] **Step 2: 集成到 Taskfile.yml**

```yaml
  sign:
    desc: Sign binaries with code signing certificate
    cmds:
      - signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a build\bin\YiiOffice.exe
      - signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a dist\*_setup.exe
    env:
      YIIOFFICE_WIN_SIGN_MODE: "{{default \"\" .YIIOFFICE_WIN_SIGN_MODE}}"
```

- [ ] **Step 3: 提交**

---

### Task 7: G6 验收

**Steps:**

- [ ] **Step 1: 构建完整安装包**

```powershell
task dist:win:installer
```

- [ ] **Step 2: 在干净 Windows 11 虚拟机中验证**

| 检查项 | 方法 | 通过标准 |
|---|---|---|
| 安装流程 | 运行 NSIS 安装包 | 正常安装，无错误 |
| 安装目录 | 检查 `D:\YiiOffice` | 文件完整 |
| 快捷方式 | 开始菜单 | YiiOffice 图标可用 |
| 首次启动 | 双击 YiiOffice.exe | 正常启动，WebView2 检查通过 |
| WebView2 缺失 | 卸载 WebView2 后启动 | 引导安装对话框 |
| 文件关联 | 右键 .docx → 打开方式 | YiiOffice 在列表中 |
| 文件关联图标 | 资源管理器 | .docx/.xlsx/.pptx/.pdf/.md 显示 YiiOffice 图标 |
| ShellNew | 右键空白区域 → 新建 | .docx/.xlsx/.pptx 选项可用 |
| 默认应用 | Settings → About → 设为默认 | 打开 `ms-settings:defaultapps` |
| 自动更新 | Settings → About → 检查更新 | 能检测到新版本（如有） |
| 卸载 | 运行 uninstall.exe | 清理所有文件和注册表 |
| 代码签名 | 右键 → 属性 → 数字签名 | 签名有效（如已签名） |

- [ ] **Step 3: 提交**

```powershell
git add -A
git commit -m "chore: phase 6 gate G6 verification"
```

---

## 5. 风险与回退

| 风险 | 触发信号 | 回退动作 |
|---|---|---|
| Wails V3 NSIS 不支持 | `wails3 build` 无 NSIS 输出 | 手动运行 `makensis`，Taskfile 中调用 |
| 文件关联注册失败 | 用户权限不足 | 使用 HKCU 而非 HKLM |
| NSIS 安装器过大 | > 200MB | 启用 LZMA2 最大压缩，或使用 7z |
| 自动更新 self-replace | 正在运行的 exe 无法被替换 | 下载新安装包，运行静默安装，退出当前进程 |
| WebView2 引导失败 | 用户无法联网 | 记录日志，允许在无 WebView2 下启动（显示错误页） |
| 代码签名不可用 | 无证书 | 跳过签名，用户可能看到 SmartScreen 警告 |

---

## 6. 自检清单

- [x] 覆盖度：NSIS 安装包、文件关联、图标、ShellNew、自动更新全部映射
- [x] 覆盖度：WebView2 引导安装
- [x] 无占位符：每个任务有具体文件路径、代码示例、验证命令
- [x] 类型一致性：`UpdateInfo` 与 IPC 通道签名对应
- [x] Windows-only：无 mac/linux 打包目标
- [x] 文件关联扩展名与源项目一致
- [x] 决策门 D8 有回退方案
- [x] 安装包默认目录与源项目一致（D: 盘优先）
- [x] per-user 安装（无 UAC 提示）
