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
<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>
***
## 愿景
> **一个本地、无广告、无登录的 Office —— 原生支持 Word、Excel、PPT、PDF。**

今天的办公软件，要么把文件锁在云里，要么逼你注册账号，要么在侧边栏塞满推销，要么为了「打开一份文档」背上整套在线协作栈。YiiOffice 想做的恰恰相反：**文件双击就开，断网一个功能不少，不注册、不登录、不看广告、不上传任何数据。**

围绕这个目标，项目遵守四条原则：

| 原则 | 具体做法 |
| ---- | -------- |
| **本地优先** | 打开、编辑、保存、格式转换、全文索引全部在本机完成；没有账号体系、没有云同步强制项，更新检查只在用户手动触发时进行。 |
| **可用** | 不是「只能看不能改」的预览器。Docs / Sheets / Slides / Markdown 四个编辑器都能真正打开、编辑、保存原生格式，**保存后能被 MS Office / WPS 正常打开**；PDF 提供查看、导航与页面级操作。 |
| **干净** | 无登录墙、无广告、无遥测，界面里没有藏着的付费入口；不支持的功能直接隐藏入口，不放「点了才报错」的按钮。 |
| **格式优先** | 直接读写 `.docx` / `.xlsx` / `.pptx` / `.pdf` 等标准格式，不发明私有格式，不要求「导入后再编辑」。 |

**关于运行时**：本仓库是 YiiOffice 的 **Wails v3 版** —— Go 后端 + 系统 WebView2 渲染。编译产物是单个原生 exe，安装包和内存占用远小于自带 Chromium 的方案；代价是渲染效果依赖用户机器的 WebView2 版本，因此项目锁定 Windows 平台。

***
## 功能
### Shell 工作台
单窗口、多标签的统一宿主，是打开应用后看到的第一个界面：
- **首页**：最近文件、星标文件、文件夹树（多根目录、子目录展开）、按文件类型筛选
- **新建与打开**：一键新建 Docs / Sheets / Slides / PDF / Markdown；系统文件对话框；文件关联双击打开
- **全文搜索**：基于 SQLite FTS5 的本地索引，覆盖文件名、路径与正文；CJK 走 bigram + unigram 双流分词，中文两字词能命中长串
- **标签页**：标签由 Go 侧统一托管，打开、切换、关闭（含未保存拦截）；标签可分离为独立窗口
- **设置与记忆**：界面语言（中/英）、界面与文档主题、默认保存目录、各类型默认应用；最近文件、星标均本地持久化
### 五大编辑器
| 编辑器 | 文件格式 | 内核 | 主要能力 |
| ------ | -------- | ---- | -------- |
| **Docs** | `.docx` | Tiptap 3 + `docx-engine` | Word 式功能区（开始/插入/绘图/设计/布局/引用/审阅/视图）、格式刷与选择性粘贴、中西文分设字体、图片裁剪/去背景/旋转翻转、查找替换、字数统计、缩放与阅读模式、段落级补丁保存 |
| **Sheets** | `.xlsx` `.xlsm` `.csv` `.tsv` | Univer 1.3 + `xlsx-gateway` + Go `workbook`（excelize） | 公式与函数库、条件格式、数据验证、排序/筛选、表格、批注、绘图、查找替换；读写与保存走 Go 侧 OOXML 补丁网关 |
| **Slides** | `.pptx` | Konva 10 + `pptx-engine` / `pptx-ops` / `pptx-render` | 功能区式编辑（插入/绘图/设计/切换/动画/放映/审阅）、文本/形状/图片/表格编辑、切换与动画、EMU→px 高保真渲染、元素级补丁保存 |
| **PDF** | `.pdf` | pdf.js 6 + pdfcpu（Go） | 查看与导航（缩略图、跳页、缩放、适应模式）；页面操作：合并、拆分、提取页面、插入 PDF、替换页面、N-up、网格切分、裁剪、设置页大小、导出页面图片、插入空白页 |
| **Markdown** | `.md` `.markdown` `.txt` `.json` | Tiptap + CodeMirror 6 | 所见即所得与源码双视图、表格/代码块/图片、Mermaid 图表、KaTeX 公式 |
### 通用能力
- **补丁式保真保存**：DOCX 段落级、PPTX 元素级补丁，只重写被修改的 XML 节点，未触及的内容原样保留，避免「打开一次就丢失格式」
- **原子写入**：所有落盘走「临时文件 + rename」，崩溃或断电不会写出半个损坏的文件
- **zip 炸弹防护**：`zip-gate` 在解包前拒绝解压体积超出声明值的压缩包，DOCX / PPTX 引擎共用
- **本地索引**：索引与搜索全部在 SQLite（FTS5）里完成，不上传、不依赖外部服务；fsnotify 监听文件夹增删改（400ms 去抖增量更新），大目录按一级子目录切片并行扫描
- **无界面导出**：`--headless-export <文件> --to <格式> --out <路径>` 不弹窗完成导出，`--json` 输出一行结构化结果，便于脚本调用；Docs/Sheets/Slides/Markdown 可导出 PDF，Docs 另可导出 HTML / DOCX
- **服务器模式与 Docker**：`-tags server` 构建纯 HTTP 服务（无 GUI，默认 8080 端口），可一键打包为 distroless Docker 镜像部署
- **更新通道**：从 Gitee Releases 检查新版本（内置 Gitee API 兼容层），安装包随附 SHA-256 校验文件
- **多语言**：界面中英双语，文案集中在 `@yiioffice/i18n`
***
## 技术栈
| 层 | 选型 |
| ---- | ---- |
| 桌面运行时 | **Wails v3.1.0**（Go 后端 + 系统 WebView2），Task 构建编排，NSIS 打包 |
| 后端 | Go 1.27 服务层：`workbook`（excelize）、`pdfengine`（pdfcpu）、`index`（SQLite FTS5 + fsnotify）、`export`、`update`、`servmode` |
| 前端 | React 19 + TypeScript 7.0，每个 app 独立 Vite 8 构建，类型化 bindings 直连 Go 服务 |
| 文档 | Tiptap 3（Docs / Markdown）+ `docx-engine` |
| 表格 | Univer 1.3；`.xlsx` 读写经 Go `workbook` + `xlsx-gateway` |
| 幻灯片 | Konva 10 / react-konva + `pptx-engine` / `pptx-ops` / `pptx-render` |
| PDF | pdf.js 6.5（查看渲染）、pdfcpu 0.16（页面操作，Go 侧） |
| 代码编辑 | CodeMirror 6（Markdown / JSON 源码视图） |
| 渲染辅助 | Mermaid、KaTeX、marked、opentype.js 字体度量 |
| 工程化 | npm workspaces（monorepo）、Vitest 5、Playwright、GitHub Actions CI |
***
## 快速开始
### 环境要求
| 依赖 | 版本 / 说明 |
| ---- | ----------- |
| Go | ≥ 1.27（见 `go.mod`） |
| Node.js | ≥ 22 |
| wails3 CLI | v3.1.0：`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0` |
| WebView2 | Windows 10/11 一般自带；缺失时安装 Evergreen 运行时 |
| NSIS | 仅打安装包需要（`makensis` 需在 PATH 中） |
| Docker | 可选，仅构建 server 镜像需要 |
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
***
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
***
## 架构要点
**1. Go 服务层 + 类型化 bindings。**
前端通过 `wails3 generate bindings -ts` 生成的类型化接口直接调用 Go 服务，`wails-bridge` 做薄封装；同一套服务在桌面形态和 server 形态下行为一致。

**2. 单窗口 + Go 侧标签宿主。**
标签由 Go 侧 `TabService` 统一托管，编辑器以标签页打开；标签可分离为独立窗口再收回，关闭前做未保存拦截。

**3. 一套代码，两种形态。**
`-tags server` 切换为纯 HTTP 服务（无 WebView2、无原生窗口），渲染包与 Go 服务完全复用；E2E 套件正是用 server 构建驱动真实后端。

**4. 补丁式保存 + 原子写入。**
DOCX / PPTX 保存是段落级 / 元素级补丁：解析原文 → 只改动被编辑的节点 → 回写未变部分；落盘统一走原子写入（临时文件 + rename）。

**5. PDF 的能力边界。**
PDF 引擎是 pdfcpu，它操作页面结构而非内容流。因此批注、文字/图片编辑、表单设计、签名、OCR、Office 转换等能力**不提供**，对应入口从界面移除、API 显式拒绝，而不是留下点了报错的按钮。

**6. 本地索引与增量监听。**
`internal/index` 扫描根目录、抽取正文（Office / PDF / 文本 / 代码）、写入 SQLite FTS5 虚表；CJK 生成 bigram + unigram 双流 token；fsnotify 以 400ms 去抖做单文件增量更新，侧栏文件夹增删实时联动索引，无需重启。

**7. 安全边界。**
文件访问经 IPC 路径授权（`pathgrants`）；压缩包解包前过 `zip-gate` 体积校验；server 模式绑定非回环地址时启动告警。
***
## 测试与门禁
```bash
go vet ./... && go test ./internal/...  # 后端静态检查与单元测试
npm --prefix frontend run typecheck     # 各 workspace 的 tsc 检查
npm --prefix frontend test              # Vitest 单元测试
npm --prefix frontend run build         # 全量渲染端构建
task e2e                                # Playwright E2E（真实 Go 后端，server 构建）
```
CI（GitHub Actions）在每次 push / PR 上依次跑 Go、前端、E2E 三段流水线。
***
## 常见问题
**Q：需要联网或注册账号吗？**
A：都不需要。没有账号体系，也不会上传文件；编辑、保存、搜索、格式转换都在本机完成。更新检查不自动发起，只在设置里手动触发。
**Q：保存后 MS Office / WPS 能正常打开吗？**
A：能。保存走 OOXML 补丁回写，只改动被编辑的节点，其余字节保持不变，不会破坏 Office 能识别的结构与扩展属性。
**Q：PDF 能加批注、改文字吗？**
A：不能。本项目的 PDF 引擎是 pdfcpu，只能操作页面结构（合并、拆分、裁剪、页面替换等）；内容流级别的编辑超出其能力边界，相应入口已隐藏。查看、导航与页面操作不受影响。
**Q：中文能搜到吗？**
A：能。FTS5 的 `unicode61` 不切分连续中文，所以索引额外产出 bigram 与 unigram 两路 token，两字词和单字查询都能命中。
**Q：能部署到服务器上吗？**
A：可以。`task build:server` 或 `task build:docker` 产出 HTTP 服务形态，默认监听 8080；绑定到非回环地址时启动会告警，请自行置于可信网络或反向代理之后。
**Q：安装包能打出哪些？**
A：`task package:windows` 生成 NSIS 安装包（`dist/YiiOffice_<版本>_setup.exe`），同时写出 `.sha256` 校验文件供发布完整性核对。
***
## 致谢
YiiOffice 建立在这些开源项目之上：[Wails](https://wails.io/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdfcpu](https://github.com/pdfcpu/pdfcpu) · [excelize](https://github.com/xuri/excelize) · [CodeMirror](https://codemirror.net/) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [marked](https://marked.js.org/) · [SQLite (modernc)](https://modernc.org/sqlite) · [fsnotify](https://github.com/fsnotify/fsnotify)
***
## 许可证
[Apache License 2.0](LICENSE)。YiiOffice 名称与标识为其权利人的商标，Apache-2.0 不授予商标使用权（见许可证第 6 节）；衍生项目请使用自己的品牌。
<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>
