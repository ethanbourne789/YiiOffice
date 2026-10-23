# YiiOffice

**本地优先的开源 Office 套件 —— 原生读写 Word、Excel、PPT、PDF，不登录、不上传、无广告。**

![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![No Login](https://img.shields.io/badge/no%20login-%E2%9C%93-brightgreen)
![No Ads](https://img.shields.io/badge/no%20ads-%E2%9C%93-brightgreen)
![Offline](https://img.shields.io/badge/offline-first-%E2%9C%93-brightgreen)

<p align="center"><b>简体中文</b> · <a href="docs/i18n/README.en.md">English</a></p>

---

## 愿景

> **一个本地优先、无广告、无登录的 Office —— 原生支持 Word、Excel、PPT、PDF。**

今天的办公软件，要么把文件锁在云里，要么逼你注册账号，要么在侧边栏塞满推销，要么为了「打开一份文档」背上整套在线协作栈。YiiOffice 想做的恰恰相反：**文件双击就开，断网一个功能不少，不注册、不登录、不看广告、不上传任何数据。**

围绕这个目标，项目遵守四条原则：

| 原则 | 具体做法 |
|------|----------|
| **本地优先** | 打开、编辑、保存、格式转换全部在本机完成；没有账号体系、没有云同步强制项，只有检查更新时会联网。 |
| **可用** | 不是「只能看不能改」的预览器。六个编辑器都能真正打开、编辑、保存 Office 原生格式，**保存后能被 MS Office / WPS 正常打开**。 |
| **干净** | 无登录墙、无广告、无遥测，界面里没有藏着的付费入口。 |
| **格式优先** | 直接读写 `.docx` / `.xlsx` / `.pptx` / `.pdf` 等标准格式，不发明私有格式，不要求「导入后再编辑」。 |

**关于运行时**：本仓库是 YiiOffice 的 **Electron 版**（Electron 43 + React 19）。同源的 Tauri 3 版本在 `YiiOffice-Tauri3` 仓库，功能面基本一致：Electron 自带 Chromium 与 Node，安装包与内存占用更大，换来的是三平台渲染完全一致、不依赖系统 WebView 版本，以及成熟的调试与打包链路。

**关于 AI**：当前代码树**不含** AI / LLM / MCP 子系统，相关入口已裁掉，仅余少量待清理的 stub。

---

## 功能

### Shell 工作台

单窗口、多标签的统一宿主，是打开应用后看到的第一个界面：

- **首页**：最近文件、星标文件（支持分组）、文件夹树（多根目录、子目录展开、拖拽移动、新建/重命名/删除）、按文件类型筛选
- **新建与打开**：一键新建 Docs / Sheets / Slides / PDF / Markdown / HTML；系统文件对话框；文件关联双击打开；文件拖入窗口打开
- **全文搜索**：基于 `node:sqlite` FTS5 的本地索引，覆盖文件名、路径与正文；CJK 走 bigram + unigram 双流分词，中文两字词能命中长串
- **标签页**：常驻不可关闭的 Home 标签；新建、切换、拖动排序、关闭（含未保存拦截）；标签可拖出为独立窗口，也能停靠回主窗口；关闭后按 MRU 回退
- **状态保留**：每个标签一个独立 `WebContentsView`，切换只做显示/隐藏、从不销毁 —— 滚动位置、光标、撤销栈、未保存内容都原样保留
- **设置与记忆**：界面语言（中/英）、界面主题与文档主题、默认保存行为、更新通道；最近文件、星标、窗口尺寸均本地持久化
- **帮助中心**：15 个主题 × 中英双语，快捷键与操作说明随界面语言切换

### 六大编辑器

| 编辑器 | 文件格式 | 内核 | 主要能力 |
|--------|----------|------|----------|
| **Docs** | `.docx` | Tiptap 3 + `docx-engine` | 分页/多页视图、页眉页脚、页码与分节、样式库、标尺与页面设置、脚注尾注、批注、文档比较、公式与域、墨迹、查找替换、字数统计、文档保护、加密文档、打印与导出 PDF |
| **Sheets** | `.xlsx` `.xlsm` `.xls` `.csv` `.tsv` | Univer 0.25 + `xlsx-gateway` + Rust `xlsx-sidecar` | 公式与函数库（插入函数、参数提示）、格式单元格、条件格式、数据验证、排序/筛选/高级筛选、分级显示、数据透视、图表、合并与冻结、定位、单变量求解、合并计算、填充序列、选择性粘贴、名称管理器、工作表保护、分页打印、CSV |
| **Slides** | `.pptx` | Konva 9 + `pptx-engine` / `pptx-render` | 母版与版式、文本/形状/图片/图表编辑、动画与切换（含 Morph）、放映与演讲者视图、备注与批注、自定义放映、非破坏性裁剪、墨迹、导出 SVG/图片 |
| **PDF** | `.pdf` | pdf.js 6 + PDFium WASM + pdf-lib | 文本与图像就地编辑、批注与标注、表单设计与填写、密文涂黑（Redaction）、签名与图章、大纲导航、页面操作、密码保护、PDF → Word/PPT/Excel 本地转换 |
| **Markdown** | `.md` `.markdown` `.txt` `.json` | Tiptap + CodeMirror 6 | 所见即所得与源码双视图、表格/代码块/图片、Mermaid 图表、KaTeX 公式、导出 DOCX / PDF / 图片、打印 |
| **HTML** | `.html` `.htm` | CodeMirror 6 | 源码编辑 + 实时预览、元素点选与文本编辑、全屏演示、导出 HTML / PDF / DOCX、图片与附件管理 |

### 通用能力

- **字节保真保存**：只重写被修改的那部分 XML，未触及的内容（样式、批注、嵌入对象、宏等）原样保留，避免「打开一次就丢失格式」
- **原子写入**：所有保存走「临时文件 + rename」，崩溃或断电不会写出半个损坏的文件
- **本地索引**：文件索引与搜索全部在 `node:sqlite` 里完成，不上传、不依赖外部服务
- **多语言**：界面与帮助中英双语，文案集中在 `@yiioffice/i18n`
- **命令行**：应用自带 `yiioffice` CLI，同一套引擎可无界面调用（见下）

---

## 命令行

打包后的应用会安装一个 `yiioffice` 命令（通过应用内置的 Node 运行，无需另外装运行时），把引擎能力暴露给脚本：

```bash
yiioffice info report.docx                         # 结构概览：标题、块、工作表、幻灯片、页面
yiioffice convert report.docx --to pdf             # docx/xlsx/pptx/md/html ↔ pdf 等互转
yiioffice create --type xlsx --from data.csv --out data.xlsx
yiioffice sheet read book.xlsx --range A1:D20 --json
yiioffice slides read deck.pptx --json             # 元素 id 与几何信息，供后续 apply 定位
yiioffice render deck.pptx --out shots/            # 每页一张 PNG，用来看自己做了什么
yiioffice open report.docx                         # 交给编辑器打开
```

`--json` 输出单个 JSON 对象，便于程序消费；全部命令见 [`packages/cli/README.md`](packages/cli/README.md)。运行中的应用还开了一个本地控制通道（Unix socket / Windows 命名管道，带随机 token），支持 `open --slide`、读取当前选区这类「让已打开的窗口跳到某处」的操作。

---

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面运行时 | **Electron 43** + electron-vite 5，electron-builder 26 打包 |
| 后端 | Node 主进程（TypeScript），`WebContentsView` 多标签宿主，`node:sqlite` FTS5 索引 |
| 前端 | React 19 + TypeScript 5.9，每个 app 独立 Vite 7 构建 |
| 文档 | Tiptap 3（Docs / Markdown） |
| 表格 | Univer 0.25；`.xlsx` 解析与公式计算走 Rust sidecar（calamine + IronCalc） |
| 幻灯片 | Konva 9 / react-konva 19 |
| PDF | pdf.js 6、PDFium WASM（`@embedpdf/pdfium`）、pdf-lib |
| 代码编辑 | CodeMirror 6（HTML / Markdown 源码视图） |
| 渲染辅助 | harfbuzzjs（复杂文字整形）、Mermaid、KaTeX |
| 工程化 | npm workspaces（monorepo）、ESLint 10、Prettier、Vitest 4、Playwright、Cargo |

---

## 快速开始

### 环境要求

| 依赖 | 版本 / 说明 |
|------|-------------|
| Node.js | ≥ 22.12（`package.json` 的 `engines`） |
| npm | ≥ 10 |
| Rust | stable（仅 Sheets 的 `xlsx-sidecar` 需要，`cargo` 在 PATH） |
| Windows | Windows 10/11，x64 或 arm64 |
| macOS | arm64（`YIIOFFICE_MAC_X64=1` 可一并打出 Intel 版） |
| Linux | x64，AppImage / deb / rpm 三种产物 |

### 安装与开发

```bash
# 1. 安装依赖（monorepo，一次装全部；postinstall 会下载 Electron）
npm install

# 2. 生成测试用的 .docx fixtures
npm run fixtures

# 3. 启动开发环境：6 个编辑器 dev server（:5173–:5178）+ Electron 主进程
npm run dev

#    只调试单个编辑器时用 standalone 模式
npm run dev:docs
```

> `npm run dev` 会先用 `tools/build-stale-preloads.mjs` 重建过期的 preload，再并行拉起六个渲染器与 shell，缺一不可 —— 编辑器窗口加载的是各自的 dev server 地址。

### 构建与打包

```bash
# 只构建前端并跑一次主进程（不打包安装包）
npm run build:all
npm run shell

# 完整安装包
npm run dist:mac      # dmg + zip（含 universal sidecar）
npm run dist:win      # zip（便携包，暂未出 NSIS 安装器）
npm run dist:linux    # AppImage + deb + rpm
```

打包前会自动生成第三方许可证清单（`npm run notices`）。Sheets 的 sidecar 由 `npm run build -w @yiioffice/sheets` 触发 `cargo build --release` 编译；macOS 上 `dist:mac` 会把两个架构的二进制合并成 universal。

---

## 项目结构

```
YiiOffice-Electron/
├── apps/
│   ├── shell/                  # Electron 主应用：主进程 + 首页 + 标签条 + 设置
│   │   ├── src/main/           # 主进程（标签、窗口、文件索引、更新、控制通道…）
│   │   ├── src/preload/        # 预加载脚本（contextBridge）
│   │   └── src/renderer/       # 首页 / 标签条 / 设置 / 帮助中心
│   ├── docs/                   # 文档编辑器（Tiptap + docx-engine）
│   ├── sheets/                 # 表格编辑器（Univer + xlsx-gateway）
│   │   └── native/xlsx-engine/ # Rust xlsx sidecar（calamine + IronCalc）
│   ├── slides/                 # 演示文稿编辑器（Konva + pptx-engine）
│   ├── pdf/                    # PDF 编辑器（pdf.js + PDFium WASM）
│   ├── markdown/               # Markdown 编辑器
│   └── html/                   # HTML 编辑器
├── packages/                   # 14 个共享包
│   ├── docx-engine/            # DOCX 解析 / 生成 / 字节级补丁
│   ├── pptx-engine/ pptx-ops/ pptx-render/
│   ├── xlsx-gateway/ zip-gate/
│   ├── pdf2docx/ html2docx/ file-parse/
│   ├── font-metrics/ i18n/ ui/ electron-utils/
│   └── cli/                    # @yiioffice/cli：命令行与控制协议
├── e2e/                        # Playwright 端到端测试
├── docs/                       # 架构文档、i18n、截图资源
├── tools/                      # 许可证、主题色、字体、fixtures 等构建脚本
└── CONTRIBUTING.md             # 贡献流程、引擎包说明、docx 往返细节
```

---

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

**7. 本地控制通道**
应用在 `userData` 下开一个 socket（POSIX 0600 / Windows 命名管道），CLI 携带 `control.json` 里的随机 token 才能调用；协议只支持「跳到某页/某张幻灯片」与「读取选区」，不接受任何写文件或执行代码的请求。

---

## 测试与质量门禁

```bash
npm test                    # Vitest 单元测试（21 个 workspace，含 sheets 的 cargo test）
npm run typecheck           # 全部 workspace 的 TypeScript 检查
npm run lint                # ESLint
npm run format:check        # Prettier（只检查改动文件）
npm run check:theme-colors  # 主题色必须走 CSS 变量
npm run check:english-comments # 注释与日志一律英文
npm run check:help-langs    # 帮助主题中英两版必须对齐
npm run test:e2e            # Playwright 端到端（78 个用例，需要先 build:all）
```

单个应用可以只跑自己的：`npm test -w @yiioffice/docs`、`npm run typecheck -w @yiioffice/pdf`。

**注意**：仓库当前**没有 CI 配置**，以上门禁全部依赖本地执行（见审计 §B2）；`typecheck` 在部分 workspace 仍有存量错误，改动前先在目标 workspace 单独跑一遍。

---

## 项目状态

当前应用版本 `0.11.0`（`@yiioffice/shell`），根 `package.json` 仍是 `0.1.0`，CLI 为 `0.10.0`，三处版本号尚未统一。Windows 便携包已能在本地打出（`apps/shell/release-build/YiiOffice-0.11.0-win.zip`），macOS 与 Linux 产物尚未发布。

| 状态 | 内容 |
|------|------|
| ✅ 已完成 | monorepo 结构；Shell 主流程（首页、标签、文件增删改移、设置持久化、全文搜索）；6 个编辑器的渲染层与主进程能力；Rust xlsx sidecar；CLI 与控制通道；打包脚本（mac / win / linux） |
| 🚧 进行中 | AI 子系统裁剪后的残留 stub 清理；IPC 信任模型统一（路径授权 + `senderFrame` 校验）；原子写入保留文件权限；渲染端 `ErrorBoundary` 与主进程崩溃兜底；测试与类型检查门禁转正 |
| 🗺️ 计划中 | ODF 导入（`.odt/.ods/.odp`）、PDF 数字证书签名、Markdown 双链笔记、更多界面语言 |

**文档与实现的一致性**：`PRIVACY.md` 目前仍描述一套「匿名使用统计」上报流程，代码树中并未实现；本 README 已按实际代码重写，不再描述已移除的 AI 面板与 MCP 服务。若发现其他出入，以代码为准，并欢迎提 PR 修正文档。

相关文档：

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 贡献流程、引擎包导览、docx 往返架构
- [`docs/headless-pdf-export.md`](docs/headless-pdf-export.md) — 无界面导出 PDF 的实现说明
- [`docs/slides-op-journal.md`](docs/slides-op-journal.md) — Slides 操作日志与撤销/重做设计

---

## 常见问题

**Q：需要联网或注册账号吗？**
A：都不需要。没有账号体系，也不会上传文件；编辑、保存、搜索、格式转换都在本机完成。唯一的自动联网行为是检查更新。

**Q：保存后 MS Office / WPS 能正常打开吗？**
A：能。保存走 OOXML 补丁回写，只改动被编辑的节点，其余字节保持不变，不会破坏 Office 能识别的结构与扩展属性。

**Q：和 `YiiOffice-Tauri3` 是什么关系？**
A：同源的两个运行时实现。Tauri 版用 Rust 主进程 + 系统 WebView，包体与内存更小；Electron 版用 Chromium + Node，三平台渲染一致、生态与调试工具更成熟，代价是体积更大。

**Q：Windows 为什么只有 zip 包？**
A：`electron-builder` 的 win target 目前只配了 `zip`（便携版），NSIS 安装器与自动更新链路还没接完，见审计 §S3。

**Q：中文搜索能搜到吗？**
A：能。索引层对 CJK 做了 bigram + unigram 双流分词，规避了 FTS5 `unicode61` 不切分中日韩连续文本的问题。

**Q：`npm run dev` 起来了但编辑器标签是空白？**
A：先确认六个渲染器 dev server 都活着（:5173–:5178）——Shell 里每个编辑器标签加载的是各自 dev server 的地址，某个端口被占用或某个渲染器进程崩掉，对应标签就会空白。只想单独调某一个编辑器时用 `npm run dev:docs` 这类 standalone 模式，它会开自己的窗口，不经过 Shell。

---

## 贡献

1. Fork 并创建分支：`git checkout -b feat/your-feature`
2. 提交前在受影响的 workspace 跑通：`npm run lint && npm run typecheck && npm test`
3. 涉及 Rust 改动时补 `cargo test`（在 `apps/sheets/native/xlsx-engine` 下）
4. 改动用户可见行为时，同步更新对应帮助主题（中英两份）与相关文档
5. 提交 PR，说明变更动机与验证方式

代码风格约定：TypeScript 严格模式、注释与日志信息使用英文、界面文案走 `@yiioffice/i18n`（中/英双语）、颜色一律用主题 CSS 变量。完整规范见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

---

## 致谢

YiiOffice 建立在这些开源项目之上：[Electron](https://www.electronjs.org/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [PDFium](https://pdfium.googlesource.com/pdfium/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [CodeMirror](https://codemirror.net/) · [calamine](https://github.com/tafia/calamine) · [IronCalc](https://github.com/ironcalc/IronCalc) · [HarfBuzz](https://github.com/harfbuzz/harfbuzz) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [JSZip](https://stuk.github.io/jszip/) · [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)

`npm run notices` 会重新生成随包分发的第三方许可证清单（`tools/gen-third-party-notices.mjs`）。

---

## 许可证

[Apache License 2.0](LICENSE)。YiiOffice 名称与标识为其权利人的商标，Apache-2.0 不授予商标使用权（见许可证第 6 节）；衍生项目请使用自己的品牌。
