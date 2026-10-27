# YiiOffice

**本地优先的开源 Office 套件 —— 原生读写 Word、Excel、PPT、PDF，不登录、不上传、无广告。**

![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron\&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react\&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript\&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows\&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![No Login](https://img.shields.io/badge/no%20login-%E2%9C%93-brightgreen)
![No Ads](https://img.shields.io/badge/no%20ads-%E2%9C%93-brightgreen)
![Offline](https://img.shields.io/badge/offline-first-%E2%9C%93-brightgreen)

<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>

***

## 愿景

> **一个本地、无广告、无登录的 Office —— 原生支持 Word、Excel、PPT、PDF。**

今天的办公软件，要么把文件锁在云里，要么逼你注册账号，要么在侧边栏塞满推销，要么为了「打开一份文档」背上整套在线协作栈。YiiOffice 想做的恰恰相反：**文件双击就开，断网一个功能不少，不注册、不登录、不看广告、不上传任何数据。**

围绕这个目标，项目遵守四条原则：

| 原则       | 具体做法                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| **本地优先** | 打开、编辑、保存、格式转换全部在本机完成；没有账号体系、没有云同步强制项，也没有后台联网的更新检查。          |
| **可用**   | 不是「只能看不能改」的预览器。五个编辑器都能真正打开、编辑、保存 Office 原生格式，**保存后能被 MS Office / WPS 正常打开**。 |
| **干净**   | 无登录墙、无广告、无遥测，界面里没有藏着的付费入口。                                                   |
| **格式优先** | 直接读写 `.docx` / `.xlsx` / `.pptx` / `.pdf` 等标准格式，不发明私有格式，不要求「导入后再编辑」。         |

**关于运行时**：本仓库是 YiiOffice 的 **Electron 版**（Electron 45 + React 19）。Electron 自带 Chromium 与 Node，安装包和内存占用会更大；换来的是渲染完全确定、不依赖用户机器的 WebView 版本，调试与打包工具链也更成熟。

<br />

***

## 功能

### Shell 工作台

单窗口、多标签的统一宿主，是打开应用后看到的第一个界面：

- **首页**：最近文件、星标文件（支持分组）、文件夹树（多根目录、子目录展开、拖拽移动、新建/重命名/删除）、按文件类型筛选
- **新建与打开**：一键新建 Docs / Sheets / Slides / PDF / Markdown；系统文件对话框；文件关联双击打开；文件拖入窗口打开
- **全文搜索**：基于 `node:sqlite` FTS5 的本地索引，覆盖文件名、路径与正文；CJK 走 bigram + unigram 双流分词，中文两字词能命中长串
- **标签页**：常驻不可关闭的 Home 标签；新建、切换、拖动排序、关闭（含未保存拦截）；标签可拖出为独立窗口，也能停靠回主窗口；关闭后按 MRU 回退
- **状态保留**：每个标签一个独立 `WebContentsView`，切换只做显示/隐藏、从不销毁 —— 滚动位置、光标、撤销栈、未保存内容都原样保留
- **设置与记忆**：界面语言（中/英）、界面主题与文档主题、默认保存行为；最近文件、星标、窗口尺寸均本地持久化

### 五大编辑器

| 编辑器          | 文件格式                                 | 内核                                                 | 主要能力                                                                                                          |
| ------------ | ------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Docs**     | `.docx`                              | Tiptap 3 + `docx-engine`                           | 分页/多页视图、页眉页脚、页码与分节、样式库、标尺与页面设置、脚注尾注、批注、文档比较、公式与域、墨迹、查找替换、字数统计、文档保护、加密文档、打印与导出 PDF                             |
| **Sheets**   | `.xlsx` `.xlsm` `.xls` `.csv` `.tsv` | Univer 0.25 + `xlsx-gateway` + Rust `xlsx-sidecar` | 公式与函数库（插入函数、参数提示）、格式单元格、条件格式、数据验证、排序/筛选/高级筛选、分级显示、数据透视、图表、合并与冻结、定位、单变量求解、合并计算、填充序列、选择性粘贴、名称管理器、工作表保护、分页打印、CSV |
| **Slides**   | `.pptx`                              | Konva 10 + `pptx-engine` / `pptx-render`           | 母版与版式、文本/形状/图片/图表编辑、动画与切换（含 Morph）、放映与演讲者视图、备注与批注、自定义放映、非破坏性裁剪、墨迹、导出 SVG/图片                                   |
| **PDF**      | `.pdf`                               | pdf.js 6 + PDFium WASM + pdf-lib                   | 文本与图像就地编辑、批注与标注、表单设计与填写、密文涂黑（Redaction）、签名与图章、大纲导航、页面操作、密码保护、PDF → Word/PPT/Excel 本地转换                        |
| **Markdown** | `.md` `.markdown` `.txt` `.json`     | Tiptap + CodeMirror 6                              | 所见即所得与源码双视图、表格/代码块/图片、Mermaid 图表、KaTeX 公式、导出 DOCX / PDF / 图片、打印                                               |

### 通用能力

- **字节保真保存**：只重写被修改的那部分 XML，未触及的内容（样式、批注、嵌入对象、宏等）原样保留，避免「打开一次就丢失格式」
- **原子写入**：所有保存走「临时文件 + rename」，崩溃或断电不会写出半个损坏的文件
- **本地索引**：文件索引与搜索全部在 `node:sqlite` 里完成，不上传、不依赖外部服务
- **无界面导出**：`--headless-export <文件> --to pdf --out <路径>` 在不弹窗口的情况下完成导出，`--json` 输出一行结构化结果，便于脚本调用（细节见 [`docs/headless-pdf-export.md`](docs/headless-pdf-export.md)）
- **多语言**：界面中英双语，文案集中在 `@yiioffice/i18n`

***

## 技术栈

| 层     | 选型                                                                    |
| ----- | --------------------------------------------------------------------- |
| 桌面运行时 | **Electron 45** + electron-vite 6，electron-builder 26 打包              |
| 后端    | Node 主进程（TypeScript），`WebContentsView` 多标签宿主，`node:sqlite` FTS5 索引    |
| 前端    | React 19 + TypeScript 7.0，每个 app 独立 Vite 8 构建                         |
| 文档    | Tiptap 3（Docs / Markdown）                                             |
| 表格    | Univer 0.25；`.xlsx` 解析与公式计算走 Rust sidecar（calamine + IronCalc）        |
| 幻灯片   | Konva 10 / react-konva 19                                             |
| PDF   | pdf.js 6、PDFium WASM（`@embedpdf/pdfium`）、pdf-lib                      |
| 代码编辑  | CodeMirror 6（HTML / Markdown 源码视图）                                    |
| 渲染辅助  | harfbuzzjs 1.6（复杂文字整形 / 字体子集化）、Mermaid、KaTeX                        |
| 工程化   | npm workspaces（monorepo）、ESLint、Vitest 5、Playwright、Cargo              |

***

## 快速开始

### 环境要求

| 依赖      | 版本 / 说明                                                       |
| ------- | ------------------------------------------------------------ |
| Node.js | ≥ 22.12（见根 `package.json` 的 `engines`）                        |
| npm     | ≥ 10                                                         |
| Rust    | stable，仅 Sheets 的 `xlsx-sidecar` 需要，`cargo` 需在 PATH 中          |
| 操作系统    | Windows 10/11（x64 / arm64）                                     |

### 安装与运行

```bash
# 1. 安装依赖（monorepo 一次装完；postinstall 会下载 Electron）
npm install

# 2. 生成 .docx 测试夹具
npm run fixtures

# 3. 开发模式：五个编辑器的 dev server（:5173–:5177）+ Electron 主进程
npm run dev

#    单独调试某一个编辑器
npm run dev:docs
```

> `npm run dev` 会先重建过期的 preload（`tools/build-stale-preloads.mjs`），再并行拉起五个渲染端与 Shell。编辑器的标签页各自加载自己的 dev server，所以五个都得活着。

### 构建与打包

```bash
# 构建全部前端并启动主进程（shell 脚本内部已包含 build:all）
npm run shell

# 完整安装包
npm run dist:win              # zip 便携包
npm run dist:win:installer    # NSIS 安装器（向导默认装到 D:\YiiOffice，可改）
```

打包前会自动生成第三方许可证清单（`npm run notices`）。Sheets 的 sidecar 由 `npm run build -w @yiioffice/sheets` 触发 `cargo build --release` 编译。

***

## 项目结构

```
YiiOffice-Electron/
├── apps/
│   ├── shell/                  # Electron 主应用：主进程 + 首页 + 标签条 + 设置
│   │   ├── src/main/           # 主进程（标签、窗口、文件索引、无界面导出…）
│   │   ├── src/preload/        # 预加载脚本（contextBridge）
│   │   └── src/renderer/       # 首页 / 标签条 / 设置
│   ├── docs/                   # 文档编辑器（Tiptap + docx-engine）
│   ├── sheets/                 # 表格编辑器（Univer + xlsx-gateway）
│   │   └── native/xlsx-engine/ # Rust xlsx sidecar（calamine + IronCalc）
│   ├── slides/                 # 演示文稿编辑器（Konva + pptx-engine）
│   ├── pdf/                    # PDF 编辑器（pdf.js + PDFium WASM）
│   └── markdown/               # Markdown 编辑器
├── packages/                   # 13 个共享包
│   ├── docx-engine/            # DOCX 解析 / 生成 / 字节级补丁
│   ├── pptx-engine/ pptx-ops/ pptx-render/
│   ├── xlsx-gateway/ zip-gate/
│   ├── pdf2docx/ html2docx/ file-parse/
│   ├── font-metrics/ i18n/ ui/ electron-utils/
├── e2e/                        # Playwright 端到端测试
├── docs/                       # 架构文档与截图资源
└── tools/                      # 许可证、主题色、字体、夹具等构建脚本
```

***

## 架构要点

**1. 单主进程 + 多标签 `WebContentsView`**
主窗口本身是 Shell（首页 + 标签条），每打开一份文档就往窗口里挂一个 `WebContentsView`，切换标签只做显示/隐藏，不销毁、不重载。标签可以整体 reparent 成独立窗口，再停靠回来。

**2. 双模式编辑器**
每个编辑器既能独立运行（standalone，便于单独调试），也能嵌入 Shell（embedded，作为标签页）。主进程 IPC 通过各应用的薄桥接层暴露给渲染端。

**3. Rust sidecar，边界清晰**
`.xlsx` 的解析与公式计算放在独立进程 `xlsx-sidecar` 里，通过 JSON 与主进程通信；它只在 Sheets 需要时启动，也便于单独跑 `cargo test`。

**4. 字节保真 + 原子写入**
DOCX / PPTX 的保存采用「段落级 / 元素级补丁」：解析原文 → 只改动被编辑的节点 → 回写未变部分；落盘统一走 `atomic-write`（临时文件 + rename）。

**5. 进程隔离与最小权限**
所有窗口 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，渲染端只能通过 preload 暴露的白名单接口访问文件；`renderer-scheme` 自定义协议、`navigation-guard` 锁定导航与外部链接。IPC 信任模型（路径授权 + `senderFrame` 校验）与文件权限仍是待收敛的已知缺口。

**6. 本地索引**
`apps/shell/src/main/file-index` 扫描工作目录、抽取正文（Office / PDF / Markdown / HTML）、写入 `node:sqlite` FTS5 虚表；分词器对 CJK 生成 bigram 流 + unigram 流，兼顾两字词与单字查询。

**延伸阅读**：[`docs/headless-pdf-export.md`](docs/headless-pdf-export.md)（无界面导出的入口、退出码与就绪判定）、[`docs/slides-op-journal.md`](docs/slides-op-journal.md)（Slides 的操作日志与撤销/重做设计）。

***

## 测试与门禁

```bash
npm test                        # Vitest，一次跑完 19 个 workspace 的测试项目
npm run typecheck               # 各 workspace 的 tsc 检查
npm run lint                    # ESLint（按包并行；CI 建议加 --no-cache）
npm run check:theme-colors      # 颜色必须走主题 CSS 变量
npm run check:english-comments  # 代码注释与日志文案必须是英文
npm run test:e2e                # Playwright 端到端，需先跑过 build:all
```

单独检查某个应用：`npm test -w @yiioffice/docs`、`npm run typecheck -w @yiioffice/pdf`。

仓库目前**没有 CI 配置**，上面这些门禁都在本地执行。测试与类型检查仍有既有的历史失败（多因断言漂移或引用了已删除的模块），改动前先在对应 workspace 跑一遍确认基线。

***

## 常见问题

**Q：需要联网或注册账号吗？**
A：都不需要。没有账号体系，也不会上传文件；编辑、保存、搜索、格式转换都在本机完成。程序不会联网检查更新，唯一的联网行为是加载文档里引用的网络图片。

**Q：保存后 MS Office / WPS 能正常打开吗？**
A：能。保存走 OOXML 补丁回写，只改动被编辑的节点，其余字节保持不变，不会破坏 Office 能识别的结构与扩展属性。

**Q：Windows 上能打出哪些包？**
A：`npm run dist:win` 出便携 zip；`npm run dist:win:installer` 出 NSIS 安装器 —— 向导默认装到 `D:\YiiOffice`（已装过则沿用原路径，D: 不是固定本地卷时退回 `%LOCALAPPDATA%\Programs\YiiOffice`），按用户安装、不弹 UAC，也保留整机安装的选项。没有自动更新链路。

**Q：中文能搜到吗？**
A：能。FTS5 的 `unicode61` 不切分连续中文，所以索引额外产出 bigram 与 unigram 两路 token，两字词和单字查询都能命中。

**Q：`npm run dev` 起来了，但编辑器标签是白屏？**
A：先确认五个渲染端 dev server（:5173–:5177）都活着 —— 每个编辑器标签加载自己的 dev server，端口被占或渲染端崩掉就会白屏。只想调一个编辑器时用 `npm run dev:docs` 这类独立模式，它会自己开窗口、不经过 Shell。

***

## 致谢

YiiOffice 建立在这些开源项目之上：[Electron](https://www.electronjs.org/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [PDFium](https://pdfium.googlesource.com/pdfium/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [CodeMirror](https://codemirror.net/) · [calamine](https://github.com/tafia/calamine) · [IronCalc](https://github.com/ironcalc/IronCalc) · [HarfBuzz](https://github.com/harfbuzz/harfbuzz) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [JSZip](https://stuk.github.io/jszip/) · [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) · [GenOffice](https://www.genoffice.com/)

第三方许可证清单由 `npm run notices` 生成（`tools/gen-third-party-notices.mjs`），随安装包一起分发。

***

## 许可证

[Apache License 2.0](LICENSE)。YiiOffice 名称与标识为其权利人的商标，Apache-2.0 不授予商标使用权（见许可证第 6 节）；衍生项目请使用自己的品牌。

<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>
