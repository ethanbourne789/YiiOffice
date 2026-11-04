# YiiOffice

**本地优先的开源 Office 套件 —— 原生读写 Word、Excel、PPT、PDF，不登录、不上传、无广告。**

![Wails](https://img.shields.io/badge/Wails-v3.1.0-4493F1?logo=go&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![No Login](https://img.shields.io/badge/no%20login-%E2%9C%93-brightgreen)
![No Ads](https://img.shields.io/badge/no%20ads-%E2%9C%93-brightgreen)
![Local First](https://img.shields.io/badge/local--first-%E2%9C%93-brightgreen)

**简体中文** · [English](README.en.md)

[Gitee 镜像](https://gitee.com/ethanbourne789/yiioffice)

---

## 愿景

> **一个本地、无广告、无登录的 Office —— 原生支持 Word、Excel、PPT、PDF。**

今天的办公软件，要么把文件锁在云里，要么需要注册账号，要么在侧边栏塞满推销，要么为了「打开一份文档」背上整套在线协作栈。YiiOffice 想做的恰恰相反：**文件双击就开，断网也能用，不注册、不登录、不看广告、不上传任何数据。**

围绕这个目标，项目遵守四条原则：

| 原则       | 具体做法                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| **本地优先** | 打开、编辑、保存、格式转换、全文索引全部在本机完成；没有账号体系、没有云同步强制项。                                                                               |
| **可用**   | 不是「只能看不能改」的预览器。Docs / Sheets / Slides / Markdown 四个编辑器都能真正打开、编辑、保存原生格式，**保存后能被 MS Office / WPS 正常打开**；PDF 提供查看、导航与页面级操作。 |
| **干净**   | 无登录墙、无广告、无遥测，界面里没有藏着的付费入口。                                                                                               |
| **格式优先** | 直接读写 `.docx` / `.xlsx` / `.pptx` / `.pdf` 等标准格式。                                                                         |

---

## 功能

### 工作台

单窗口、多标签的统一宿主，是打开应用后看到的第一个界面：

- **首页**：最近文件、星标文件、文件夹树（多根目录、子目录展开）、按文件类型筛选
- **新建与打开**：一键新建 Docs / Sheets / Slides / Markdown；文件关联双击打开
- **标签页**：标签由 Go 侧统一托管，打开、切换、关闭（含未保存拦截）；标签可分离为独立窗口
- **拖放打开**：把受支持的文件从资源管理器拖进主窗口，会按类型打开对应应用的新标签页；一次拖入多个按拖入顺序逐个打开，目录和不认识的类型会被忽略。旧版二进制格式（`.doc` / `.xls` / `.ppt`）不在可打开范围内，请先另存为新格式
- **最近文件**：按时间倒序分段加载，向下滚动会继续取出更早的记录；打开过的文件自动回到列表顶部。本地最多保留最近 2000 条记录，星标文件不受此上限影响（更早的星标记录也会保留），因此列表总条数可能超过 2000
- **设置与记忆**：界面语言（中/英）、界面与文档主题、默认保存目录、各类型默认应用；最近文件、星标均本地持久化

### 五大编辑器

| 编辑器          | 文件格式                             | 内核                                                    | 主要能力                                                                                         |
| ------------ | -------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Docs**     | `.docx`                          | Tiptap 3 + `docx-engine`                              | Word 式功能区（开始/插入/绘图/设计/布局/引用/审阅/视图）、格式刷与选择性粘贴、中西文分设字体、图片裁剪/去背景/旋转翻转、查找替换、字数统计、缩放与阅读模式、段落级补丁保存 |
| **Sheets**   | `.xlsx` `.xlsm` `.csv` `.tsv`    | Univer 1.3 + `xlsx-gateway` + Go `workbook`（excelize） | 公式与函数库、条件格式、数据验证、排序/筛选、表格、批注、绘图、查找替换；读写与保存走 Go 侧 OOXML 补丁网关                                  |
| **Slides**   | `.pptx`                          | Konva 10 + `pptx-engine` / `pptx-ops` / `pptx-render` | 功能区式编辑（插入/绘图/设计/切换/动画/放映/审阅）、文本/形状/图片/表格编辑、切换与动画、EMU→px 高保真渲染、元素级补丁保存                        |
| **PDF**      | `.pdf`                           | pdf.js 6 + pdfcpu（Go）                                 | 查看与导航（缩略图、跳页、缩放、适应模式）；页面操作：合并、拆分、提取页面、插入 PDF、替换页面、N-up、网格切分、裁剪、设置页大小、导出页面图片、插入空白页            |
| **Markdown** | `.md` `.markdown` `.txt` `.json` | Tiptap + CodeMirror 6                                 | 所见即所得与源码双视图、表格/代码块/图片、Mermaid 图表、KaTeX 公式                                                    |

编辑器内部也接收拖放：文档和表格里拖入图片会插入当前文件，幻灯片里拖入图片、视频、音频会插入当前页。

### 加密工作簿的保存与打印

- **打开**：带密码的 OOXML 工作簿（`.xlsx` / `.xlsm`）会先弹密码框；密码错误可在框内重试，取消则不打开。ECMA-376 Standard 与 Agile 两种加密都能解密。
- **保存**：文件原来带密码时，保存与另存为都会沿用密码，但加密方式会写成 ECMA-376 **Standard**。原本使用 Agile 加密的文件，保存一次后加密方式会变成 Standard —— 密码本身不变，MS Office / WPS 仍能正常打开；未加密的文件保存后也不会被加密。
- **做不到的情况**：`.xls`（Excel 97-2003 二进制格式）不能打开，请先在 Excel / WPS 中另存为 `.xlsx`；其他无法识别的加密容器会提示「加密方式暂不支持」，不会伪装成文件损坏。
- **打印**：Sheets 不提供物理打印，只保留「导出为 PDF」；`Ctrl+P` 直接执行导出 PDF，不会再弹系统打印对话框。

### 系统通知

导出与保存的结果会进入 Windows 通知中心：

- **导出完成**：窗口在前台时只显示应用内提示；切到别的程序后才发系统通知。
- **导出失败**：无论窗口是否在前台都会通知。
- **保存失败**：窗口不在前台时一律通知；窗口在前台时，Docs / Sheets / Markdown 仍会弹通知，Slides 只在应用内提示。
- 同一段失败文案在 60 秒内只弹一次；后台自动保存的失败只在窗口不在前台时提醒，且不参与这条去重，磁盘持续不可写时可能按保存节奏重复提醒。
- 通知覆盖 Docs / Sheets / Slides / Markdown 的导出与保存；PDF 的查看、页面操作与导出不发系统通知。
- 通知的图标、样式和停留时间由 Windows 版本与系统通知设置决定，本应用只提交标题和正文。

### 手动检查更新（只读）

设置 → 关于 提供「检查更新」：

- 只读取最近一次发布并在界面显示结果：已是最新、发现新版本、无法比较新旧、检查失败；不下载安装包、不读取校验文件、不启动安装器。
- 如果发布 tag 不是语义版本（如 `v1.2.3`，前导 `v` 可省略），会显示「有新发布：<tag>」并注明无法自动判断新旧，同时列出发布日期、更新说明和发布页链接；tag 改成语义版本后，新旧判断会自动恢复。
- 自动下载与安装未启用，状态见下文「快速开始」中的说明。

---

## 技术栈

| 层     | 选型                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| 桌面运行时 | **Wails v3.1.0**（Go 后端 + 系统 WebView2），Task 构建编排，NSIS 打包                                                           |
| 后端    | Go 1.27 服务层：`workbook`（excelize）、`pdfengine`（pdfcpu）、`index`（SQLite FTS5 + fsnotify）、`export`、`update`、`servmode` |
| 前端    | React 19 + TypeScript 7.0，每个 app 独立 Vite 8 构建，类型化 bindings 直连 Go 服务                                               |
| 文档    | Tiptap 3（Docs / Markdown）+ `docx-engine`                                                                          |
| 表格    | Univer 1.3；`.xlsx` 读写经 Go `workbook` + `xlsx-gateway`                                                             |
| 幻灯片   | Konva 10 / react-konva + `pptx-engine` / `pptx-ops` / `pptx-render`                                               |
| PDF   | pdf.js 6.5（查看渲染）、pdfcpu 0.16（页面操作，Go 侧）                                                                           |
| 代码编辑  | CodeMirror 6（Markdown / JSON 源码视图）                                                                                |
| 渲染辅助  | Mermaid、KaTeX、marked、opentype.js 字体度量                                                                             |
| 工程化   | npm workspaces（monorepo）、Vitest 5、Playwright、GitHub Actions CI                                                    |

---

## 安装包体积对比（Windows 64 位）

> 查询日期：2026-11-04。表中体积均为**完整离线安装包**；单位 1 MB = 1,048,576 字节（与 Windows 文件大小显示一致），GB 按 1 GB = 1,024 MB 换算。Office 行为 ODT 拉取的 cab/dat 文件集合，其余为单一安装包。

| 产品 | 版本 | 安装包类型 | 体积 | 相对本项目倍数 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Microsoft Office | Office LTSC 2024（ProPlus2024Volume，x64） | ODT 完整离线包（cab/dat 集合，en-us） | 3,115.0 MB（3,266,286,064 字节） | 约 123× | 完整套件；匿名 ODT `/download` 可拉取，字节数按官方 CDN 文件集逐项求和；安装/激活仍需 LTSC 授权。LTSC 2021 同法为 1,858.4 MB。 |
| WPS Office | Windows 64 位 build 29158（2026-10-12） | 完整离线安装包 | 356.8 MB | 约 14× | 官网默认下载是约 5 MB 的在线安装器；本行取完整离线包。 |
| LibreOffice | 26.8.2 | 完整离线安装包（MSI） | 358.5 MB | 约 14× | 官方只提供完整 MSI，没有在线安装器。 |
| ONLYOFFICE Desktop Editors | 10.0.0 | 完整离线安装包（EXE） | 286.0 MB | 约 11× | 官方另有约 1 MB 在线安装器；本行取 Windows x64 完整包。 |
| **YiiOffice** | 0.13.0 | 完整离线安装包（NSIS） | **25.4 MB** | 1×（基准） | 仓库内 `dist/YiiOffice_0.13.0_setup.exe`，26,625,923 字节。 |

以上只比较安装包体积，不构成完整的能力或质量对比。Office LTSC、WPS 与 LibreOffice 是覆盖面更广的办公套件，安装包内包含大量本机组件、字体、模板与离线资源；ONLYOFFICE 同样捆绑了完整桌面编辑器。YiiOffice 是自研轻量套件，界面渲染与部分能力依赖系统 WebView2（Windows 10/11 一般自带），安装包因此更小。体积差异主要来自产品取舍，不代表功能强弱。

**数据来源与换算**

- Microsoft：ODT 免费公开，配置 `ProPlus2024Volume`、x64、en-us 后 `setup /download` 无需 VLSC 登录即可拉取。各文件字节数取自官方 PerpetualVL2024 CDN（<https://officecdn.microsoft.com/pr/7983bac0-e531-40cf-be00-fd24fe66619c/Office/Data/16.0.17932.21056/>），合计 3,266,286,064 字节；安装与激活仍需有效的 LTSC 授权。Office LTSC 2021（16.0.14334.20974）同法合计 1,948,647,170 字节（1,858.4 MB）。
- WPS：官方 CDN 完整包 `WPS_Setup_x64_29158.exe`，下载文件 374,103,552 字节；版本发布信息见 WPS 官方社区（<https://bbs.wps.cn/topic/99188>）。
- LibreOffice：官方下载 `LibreOffice_26.8.2_Win_x86-64.msi`，下载文件 375,934,976 字节（<https://download.documentfoundation.org/libreoffice/stable/26.8.2/win/x86_64/LibreOffice_26.8.2_Win_x86-64.msi>）。
- ONLYOFFICE：官方下载页标注 Windows x64 完整包 286 MB（<https://www.onlyoffice.com/en/download-desktop>）；对应的 GitHub Release 资产 `DesktopEditors_x64.exe` 为 299,860,896 字节。
- YiiOffice：仓库内当前构建产物实测字节数。

---

## 快速开始

### 环境要求

| 依赖         | 版本 / 说明                                                            |
| ---------- | ------------------------------------------------------------------ |
| Go         | ≥ 1.27（见 `go.mod`）                                                 |
| Node.js    | ≥ 22                                                               |
| wails3 CLI | v3.1.0：`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0` |
| WebView2   | Windows 10/11 一般自带；缺失时安装 Evergreen 运行时                             |
| NSIS       | 仅打安装包需要（`makensis` 需在 PATH 中）                                      |

### 安装与运行

```bash
# 1. 安装前端依赖
cd frontend && npm install && cd ..
# 2. 开发模式：生成 bindings、拉起 Vite dev server（:5178）、热重建并运行应用
wails3 dev
```

### 构建与打包

```bash
task build                    # 生产构建（build/bin/YiiOffice.exe，-tags production）
task package:windows          # NSIS 安装包 + SHA-256 校验文件（dist/）
task build:server             # 服务器模式二进制（纯 HTTP，无 GUI）
task build:docker             # distroless Docker 镜像
task run:docker               # 运行镜像，映射 8080 端口
```

自动更新当前为暂停状态；恢复开发前请先按[发布检查清单](docs/releasing.md)准备 tag 与资产。

### 无界面导出

安装包里的 `YiiOffice.exe` 支持不开窗口直接转换：

```bash
YiiOffice.exe --headless-export <输入文件> --to <格式> --out <输出文件> [--json]
```

| 输入       | `--to`        | 说明                    |
| -------- | ------------- | --------------------- |
| `.docx` | `pdf` / `html` | 版式 PDF 或独立 HTML     |
| `.xlsx` `.xlsm` `.csv` `.tsv` | `pdf` | 工作簿全部工作表            |
| `.pptx` | `pdf`         | 每页一张 PDF 页面         |
| `.md` `.markdown` | `pdf` | 渲染后的正文（不含源码视图） |

- 输入清单以“真的能打开并完成转换”的格式为准，命令行与渲染器共用同一份：`.docx`、`.xlsx` / `.xlsm` / `.csv` / `.tsv`、`.pptx`、`.md` / `.markdown`。
- 旧版 97-2003 二进制（`.doc` / `.xls` / `.ppt`）和 `.html` / `.htm` 会在参数校验阶段直接拒绝（退出码 `1`），错误信息会列出支持的扩展名；旧版格式请先另存为 `.docx` / `.xlsx` / `.pptx`，`.html` / `.htm` 只能作为导出目标。`.xls` 不会被路由到 Sheets 后再失败，而是在入口处就被拒绝。
- 进程退出码：`0` 成功、`1` 参数/格式错误、`2` 输入文件问题、`3` 转换或超时失败。
- `--json` 时 stdout 输出一行结构化结果（成功含产物路径）。
- 导出前会等待编辑器渲染完成；首次加载最多 20 秒，整个导出最多 45–90 秒（按类型），超时以 `3` 退出并打印原因。
- 不支持从 headless 导出 DOCX、只读源码视图的 Markdown，也不支持 PDF 页面操作类功能——这些只在 GUI 中提供。

---

## 项目结构

```
YiiOffice-WailsV3/
├── main.go                       # Wails 应用入口（desktop / server 双形态）
├── internal/                     # Go 后端服务
│   ├── bridge/                   # 暴露给前端的绑定服务（Home/Doc/Sheet/PDF/Slide…）
│   ├── host/                     # 窗口与标签宿主、文件关联、设置、原生菜单
│   ├── workbook/                 # xlsx 引擎（excelize + 会话管理）
│   ├── pdfengine/                # pdfcpu 页面操作
│   ├── index/                    # SQLite FTS5 索引 + fsnotify 监听
│   ├── export/                   # 无界面导出 CLI
│   ├── update/                   # Gitee 更新通道与兼容层
│   ├── servmode/                 # server 构建标签下的 HTTP 模式
│   └── fsutil/ platform/ …       # 原子写入、平台路径等基础设施
├── frontend/
│   ├── apps/                     # shell / docs / sheets / slides / pdf / markdown
│   ├── packages/                 # 11 个共享包（docx-engine、pptx-*、xlsx-gateway、
│   │                             #   zip-gate、font-metrics、i18n、ui、wails-bridge…）
│   └── bindings/                 # wails3 generate bindings 输出
├── e2e/                          # Playwright 端到端测试（驱动真实 Go 后端）
├── docker/                       # server 模式 Dockerfile
├── build/                        # NSIS 脚本、图标等构建资产
└── .github/workflows/ci.yml      # CI：Go + 前端 + E2E 三段流水线
```

---

## 测试与门禁

```bash
go vet ./... && go test ./internal/...  # 后端静态检查与单元测试
npm --prefix frontend run typecheck     # 各 workspace 的 tsc 检查
npm --prefix frontend test              # Vitest 单元测试
npm --prefix frontend run build         # 全量渲染端构建
task e2e                                # Playwright E2E（真实 Go 后端，server 构建）
```

CI（GitHub Actions）在每次 push / PR 上依次跑 Go、前端、E2E 三段流水线。

---

## 常见问题

**Q：需要联网或注册账号吗？**

A：都不需要。没有账号体系，也不会上传文件；编辑、保存、搜索、格式转换都在本机完成。更新检查不自动发起，只在设置里手动触发。

**Q：保存后 MS Office / WPS 能正常打开吗？**

A：能。保存走 OOXML 补丁回写，只改动被编辑的节点，其余字节保持不变，不会破坏 Office 能识别的结构与扩展属性。

**Q：PDF 能加批注、改文字吗？**

A：不能。本项目的 PDF 引擎是 pdfcpu，只能操作页面结构（合并、拆分、裁剪、页面替换等）；内容流级别的编辑超出其能力边界，相应入口已隐藏。查看、导航与页面操作不受影响。

**Q：可以把文件直接拖进窗口打开吗？**

A：可以。把受支持的格式拖进主窗口会按类型打开新标签页，一次拖多个会逐个打开；目录和不认识的类型会被忽略。拖进编辑器内部则由编辑器自己处理：文档和表格里拖入图片会插入当前文件，幻灯片里拖入图片、视频、音频会插入当前页。

**Q：带密码的 Excel 能打开吗？保存后密码还在吗？**

A：能打开 `.xlsx` / `.xlsm`，会先弹密码框。原文件带密码时，保存和另存都会保留密码，但加密方式会统一写成 ECMA-376 Standard —— 原本用 Agile 加密的文件保存一次后会变成 Standard。`.xls` 和其他无法识别的加密方式打不开。

**Q：为什么在 Sheets 里按 Ctrl+P 没有打印对话框？**

A：当前没有可靠的物理打印链路，Sheets 只保留「导出为 PDF」；按 `Ctrl+P` 会直接导出 PDF，不再弹系统打印对话框。

**Q：Windows 提示「未知发布者」或被 SmartScreen 拦截，正常吗？**

A：正常。项目未购买代码签名证书，首次下载安装包时可能出现该提示。发布页同时提供安装包的 SHA-256（即 `.sha256` 资产的那一行），可用 `Get-FileHash -Algorithm SHA256 <安装包>` 比对，一致后再选择「仍要运行」。

---

## 致谢

YiiOffice 建立在这些开源项目之上：[Wails](https://wails.io/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdfcpu](https://github.com/pdfcpu/pdfcpu) · [excelize](https://github.com/xuri/excelize) · [CodeMirror](https://codemirror.net/) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [marked](https://marked.js.org/) · [SQLite (modernc)](https://modernc.org/sqlite) · [fsnotify](https://github.com/fsnotify/fsnotify) · [GenOffice](https://genoffice.ai/)

---

## 许可证

[Apache License 2.0](LICENSE)。YiiOffice 名称与标识为其权利人的商标，Apache-2.0 不授予商标使用权（见许可证第 6 节）；衍生项目请使用自己的品牌。

**简体中文** · [English](README.en.md)
