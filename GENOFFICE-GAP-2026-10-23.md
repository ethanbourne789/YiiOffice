# GenOffice ↔ 本项目 差异对比与升级点清单

- **对比对象**：`github.com/genspark-ai/genoffice`（main，快照 2026-10-22）↔ `E:/Dev/YiiOffice-Electron`（v0.1.0 / 审计报告记为 v0.11.0）
- **对比日期**：2026-10-23
- **对比方法**：GitHub Tree API 全量文件树（5,188 blob）× 本地源码树逐文件比对（排除 `node_modules`/`out`/`dist`/`release`）+ 关键新文件源码注释抽查 + README 逐行 diff
- **前置约定**：按要求，**AI / LLM / MCP / CLI / Agent Skill 不在升级评估范围内**，仅在 §4 说明边界与风险

---

## 0. 一句话结论

本项目**就是 GenOffice 的"去 AI 化子集"**：同源、同结构、同 README，删掉了 AI/LLM/MCP/CLI。剔除这部分后，上游仍有 **162 个功能源码文件、8 类能力** 是本项目没有的。

其中只有 4 项能形成产品级差异，值得优先移植：

1. **ODF 导入**（`.odt/.ods/.odp/.ott/.ots/.otp`）——上游有完整 `odf2ooxml` 包 + Rust 侧 `odf.rs`/`spreadsheetml.rs`，本项目把 ODF 系列明确列为"不支持格式"
2. **PDF 数字证书签名**（PKCS#7 + 系统证书库）——本项目只有视觉签名，源码注释自认"不校验证书签名"
3. **Markdown 双链笔记体系**（`[[wikilink]]` + 反链 + 关系图谱）——本项目 Markdown 仍只是"块编辑器"
4. **多语言**（2 → 20 语言 + 30 篇帮助主题全语言化）

其余是体验/稳定性增强：邮件合并引擎、标签休眠、界面缩放、外部改动监听、崩溃恢复副本、单元格图片、大表筛选、版面审计等。

---

## 1. 关系定性：同一份代码的两个版本

| 证据 | 说明 |
| --- | --- |
| README 逐行 diff | 差异几乎只有品牌词（GenOffice ↔ YiiOffice、`genoffice` ↔ `yiioffice`）；功能性差异仅 3 处，且全部是 AI 侧（Ask AI、Skills、Genspark 登录）与语言数 |
| 应用结构 | 双方都是 7 个 app：`docs / sheets / slides / pdf / markdown / html / shell`，目录层次一致 |
| 包结构 | 本项目 14 个 package 全部是上游 20 个的子集 |
| 反向差异 | 本项目**独有的 src 文件只有 13 个**，且全部是品牌资源改名（`YiiOffice*.woff2` ×12、`brand-logo.png`） |

**结论**：上游没有从本项目拿走任何能力；本项目是严格子集 + AI 裁剪。

### 规模对比

| 指标 | 本项目 | 上游 GenOffice |
| --- | --- | --- |
| app 数 | 7 | 7 |
| package 数 | 14 | 20 |
| `src` 下源码文件 | 1,521 | 2,501 |
| 仓库文件总数（不含 node_modules） | 4,323 | 5,188 |
| UI 语言 | 2（en / zh） | 20（en, zh, zh-TW, ja, ko, ar, he, hi, th, vi, id, ms, ru, de, fr, es, pt, it, nl, pl, cs） |
| 帮助主题 | 15 篇 × 2 语言（31 个 md） | 30 篇 × 20 语言（398 个 md） |
| CI / 安全策略 | 无 `.github/`、`SECURITY.md` 为死链 | `.github/workflows/ci.yml` + CODEOWNERS + PR/issue 模板 + `SECURITY.md` |

---

## 2. 993 个差异文件的构成

上游独有的 993 个 `src` 文件，按"是否与 AI 相关"拆开：

| 分类 | 文件数 | 占比 | 举例 |
| --- | --- | --- | --- |
| AI / LLM / Agent / MCP / Skill 侧 | 392 | 39% | `packages/ai-provider`(31)、`agent-core`(14)、`ai-search`(8)、`apps/*/renderer/ai`(~110)、`apps/shell/src/main/mcp`(17)、`skills/`(43) |
| i18n 与帮助中心 | 439 | 44% | 20 种语言的 strings、398 个 help topics |
| **真正的非 AI 功能代码** | **162** | **16%** | ODF、证书签名、双链笔记、录制、标签休眠…… |

> 所以"要不要跟进上游"这个问题，实际只需要评估 **162 个文件**，其余是纯 AI 或纯翻译工作量。

---

## 3. 升级点清单（按可移植价值排序）

标注说明：**价值**＝对"不做 AI 的 Office 套件"的产品意义；**成本**＝S（≤1 人日）/ M（3–5 人日）/ L（≥2 人周）。

### 3.1 P0 · 能形成产品差异的四项

#### ① ODF 导入（价值：高 / 成本：L）

- **上游**：新增 `packages/odf2ooxml`（9 个源文件：`odf.ts` / `odt-docx.ts` / `odp-pptx.ts` / `styles.ts` / `text.ts` / `images.ts` / `units.ts` / `xml.ts` / `index.ts`）；Rust sidecar 增加 `apps/sheets/native/xlsx-engine/src/odf.rs` 与 `spreadsheetml.rs`。策略是"**原文件只读、导入生成全新 OOXML 副本**"，格式注册表把 `.odt/.ods/.odp/.ott/.ots/.otp` 标为 open-only，没有任何写回 ODF 的代码路径。
- **本项目**：`apps/shell/src/main/launch-paths.ts:4` 明确把 `odt / ods / odp` 列入 `UNSUPPORTED_LAUNCH_RE`；`packages/file-parse` 只有 doc/docx/pdf/ppt/pptx/xlsx，无 ODF 解析器。
- **为什么值得**：LibreOffice / WPS / 政企环境大量存量 ODF 文件；开源办公套件不认 ODF 是硬伤，而"只导入不回写"的实现成本与风险都远低于双向支持。
- **移植要点**：.ods 必须走 Rust 侧（calamine 已支持 ODS，上游即复用此路径）；.odt/.odp 是纯 TS，可整包搬入并只改包名。

#### ② PDF 数字证书签名（价值：高 / 成本：M–L）

- **上游**：`apps/pdf/src/renderer/` 新增 `CertSignDialog.tsx`(492 行) / `SignaturesDialog.tsx` / `cert-appearance.ts`；主进程侧 `pdf-sign.ts` / `pdf-signatures.ts` / `system-certificates.ts` / `forge-native.ts`。能力 = 读**操作系统证书库**选证书、PKCS#7 签名域、签名外观渲染、签名面板管理。
- **本项目**：只有 `SignatureDialog.tsx` + `SignDropOverlay.tsx`（手写/图片盖章）。`apps/pdf/src/renderer/App.tsx:1781` 注释自认："does not verify certificate signatures. A visual Ink/Stamp signature must…"
- **为什么值得**：合同、发票、公文场景里"能盖章"和"有法律效力的数字签名"是两个产品等级；这是本项目 PDF 最明显的功能天花板。
- **移植要点**：`forge-native.ts` 用 node-forge，注意与现有 `zip-gate`/供应链策略对齐；`system-certificates.ts` 需分 Windows（cert store）/macOS（Keychain）/Linux（NSS）三套实现，是主要工作量。

#### ③ Markdown 双链笔记体系（价值：高 / 成本：M）

- **上游**：`apps/markdown/src/` 新增 17 个文件——`wikilink.ts`、`wikiEmbed.ts`、`wiki-index.ts`、`wiki-notes.ts`、`wiki-resolve.ts`、`wiki-fragment.ts`、`wikiSuggest.ts` + `WikiSuggestMenu.tsx`、`BacklinksPane.tsx`、`GraphView.tsx`、`graph-layout.ts`、`markdown-theme.ts`、`markdown-themes.css`，外加主进程 4 个文件做索引。
- **本项目**：Markdown 侧只有 outline / 搜索高亮 / 导出，grep `wikilink`、`backlink`、`graph-view` 均无命中。
- **为什么值得**：这是"Office 套件里唯一能抢 Obsidian/Logseq 用户"的功能，且**完全离线**——索引在本地主进程建，不依赖任何模型。上游把它做进了同一个 Markdown 文件格式（纯 `.md` + 前置元数据），不引入私有格式。
- **移植要点**：`wiki-index` 可复用本项目的 `file-index`（SQLite FTS5）经验；`GraphView` 用现成 `graph-layout.ts` 力导向布局，无新依赖。

#### ④ 多语言 + 帮助中心（价值：中高 / 成本：L，但是纯工作量）

- **上游**：docs / sheets / slides / html 四个 app 各有 20 套语言 strings（`apps/docs/src/renderer/i18n/{en,zh,zh-TW,ja,ko,ar,he,hi,th,vi,id,ms,ru,de,fr,es,pt,it,nl,pl,cs}.ts`）；帮助中心 30 个主题全部 20 语言化（398 个 md）；README 21 语言。
- **本项目**：`apps/*/src/renderer/i18n/app/` 只有 `en.ts` + `zh.ts`；`apps/shell/src/renderer/src/i18n/help/topics/` 只有 15 个主题 × en/zh（31 个 md）。
- **注意**：上游的 **pdf 与 markdown 两个 app 至今仍是单语**（只有 `strings.ts`），说明这活是按 app 分批推的，可以照抄这个节奏，不必一次做完。

### 3.2 P1 · 单项体验增强（成本大多为 S）

| # | 能力 | 上游证据 | 本项目现状 | 价值 | 成本 |
| --- | --- | --- | --- | --- | --- |
| 1 | **邮件合并引擎** | `packages/docx-engine/src/mail-merge.ts`（488 行，支持 `NEXT`/`SKIPIF`/`IF` 控制域，注释明确"引擎已完成，UI 在之上构建"、关联 issue #1984） | `parse.ts`/`patch.ts` 只保证 `MERGEFIELD` 往返保真，**没有取值能力** | 高（公文/批量信函刚需） | S–M |
| 2 | **文档属性读写** | `docx-engine/src/doc-properties.ts` + `resolve-props.ts` | 无 | 中（作者/标题/自定义属性） | S |
| 3 | **Zotero 引用** | `docx-engine/src/zotero-doc-props.ts` + `apps/docs/src/renderer/zotero/`(3) + `zotero-ipc.ts`/`zotero-wire.ts` | 无（`field-balance.ts` 只做域配平） | 中（学术写作） | M |
| 4 | **文字环绕** | `apps/docs/src/renderer/wrap-obstacles.ts` + `wrap-group.ts` | 无（grep `wrapObstacles` 零命中） | 中（图文混排保真） | M |
| 5 | **表格行拖拽 / 多选 / 插入图片** | `table-row-drag.ts`、`multi-select.ts`、`insert-picture.ts` | 无 | 中 | S each |
| 6 | **Word → Markdown / RTF 导出** | `export-markdown.ts`、`rtf.ts` | 无 | 中 | S–M |
| 7 | **PDF 内链导出** | `pdf-links.ts` / `pdf-internal-links.ts`（Word/HTML 导出 PDF 时把标题转成书签与链接） | 无 | 中 | S |
| 8 | **文档脱敏（Redaction）** | docs / markdown / pdf 三端补齐 `redact*.ts` + `RedactDialog.tsx`（本项目只有 HTML 端有） | 仅 html app 有 | 中高（合规） | M |
| 9 | **Slides 录制 + 旁白** | `RecordingBar.tsx`、`recorder.ts`、`use-recording.ts`、`wav.ts`、`segments.ts`、`packages/pptx-engine/src/narration.ts` | `getUserMedia`/`MediaRecorder` 零命中 | 中（把 deck 变课件） | M |
| 10 | **版面审计（确定性，无 AI）** | `packages/pipelines/src/slides/{layout-audit,audit-deck,deck-spec,page-spec,stage-check}.ts`——纯几何检测溢出/重叠，依赖 `pptx-engine`+`pptx-render`，**不调用任何模型** | 无（本地 `slides audit` 不存在） | 中（导出前自检） | M |
| 11 | **3D / 图表引擎下沉** | `pptx-engine/src/{model3d,glb-bounds,chart-workbook,crc32}.ts` + `Model3dTurnHandle.tsx` | slides app 内已有 GLB 处理，但引擎层没有；图表无法改数据源 | 中 | M |
| 12 | **Sheets 单元格图片** | `xlsx-gateway/src/xlsx-cell-image-add.ts` + `cell-image-preview.ts` + `workbook-media.ts` | 无 | 中（WPS/国产表格常见） | M |
| 13 | **Sheets 批注带图** | `note-pictures.ts` + `NotePicturesPane.tsx`（注释说明 Univer 的 note 弹窗塞不进图片，所以单开面板列"带图批注"） | 无 | 低中 | S |
| 14 | **Sheets 大表筛选 / Excel 风格筛选按钮 / 公式审计** | `large-filter.ts`、`large-filter-state.ts`、`filter-button-excel-style.ts`、`formula-audit.ts` | 已有 `AdvancedFilterDialog.tsx`、`SlicerPanel.tsx`、`trace-arrows.tsx`，但无大表专用路径与公式审计报告 | 中（10 万行级体验） | M |
| 15 | **Sheets RTL 视图** | `sheet-rtl-view.ts` | 无（docs 有 bidi） | 低中（阿拉伯/希伯来） | S |

### 3.3 P2 · Shell 平台能力（都是 S，但组合起来是"成熟度"）

| 能力 | 上游证据与关键事实 | 本项目 |
| --- | --- | --- |
| **标签休眠** | `apps/shell/src/main/tab-hibernation.ts`，注释给出实测："每个 Docs 标签约 250 MB，只有销毁 webContents 才释放"，策略是"活动标签数超过阈值才休眠，少量标签永不付重载代价" | 无 |
| **界面缩放** | `ui-scale.ts`(143 行)，注释解释为何不用 `setZoomFactor()`：窗口缩放会连文档画布一起放大，所以改为写 CSS 变量 `--ui-scale`，只作用于 chrome | 无 |
| **窗口位置记忆** | `window-bounds.ts` | 无 |
| **窗口背景/材质** | `window-background.ts` | 部分（`backgroundMaterial` 已有） |
| **外部改动监听** | `packages/electron-utils/src/disk-watch.ts`（`watchFile` + nlink 检测，处理"文件被删除/替换/重命名"） | 无（grep `watchFile` 零命中） |
| **崩溃恢复副本** | `recovery-copy.ts` | 无（docs 有 `doc-cache`，非崩溃恢复） |
| **打印作业管理** | `print-job.ts` | 无 |
| **标签操作菜单** | `tab-menu.ts` / `tab-lifecycle.ts` / `tab-duplicate.ts` / `tab-document-actions.ts` | 部分（`tab-manager.ts`） |
| **首次引导** | `Onboarding.tsx` + `onboarding.css` | 无 |
| **使用统计** | `analytics.ts`（可关，且明确不上传文档内容/路径） | 无（审计确认 `analytics.ts` 被引用但缺失 → **当前是构建隐患**） |

### 3.4 P2 · 工程治理与资产

- **`.github/`**：`ci.yml` + `CODEOWNERS` + PR 模板 + 两个 issue 表单（本项目审计已判"无 CI，门禁全靠人工"）
- **文档**：`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CLAUDE.md`、`docs/{headless-pdf-export,slides-op-journal,word-truths-coverage,native-waf-admission}.md`、21 语言 README
- **字体替身矩阵**：`apps/docs/src/renderer/fonts/stand-in-boxes.json` + `font-resolve.ts` + `effective-css.ts`（缺失字体用什么替代、按 CSS 生效结果重算），另加孟加拉文 Bold/Regular 字体子集
- **`ee/`**：企业版 License 目录（本项目 README 引用的 `ee/LICENSE` 是死链）

---

## 4. 已排除部分（AI / LLM / MCP / CLI）——以及一个必须处理的坑

按约定这些**不进升级清单**，此处只做边界说明，避免误移植：

| 被排除的包/目录 | 文件数 | 说明 |
| --- | --- | --- |
| `packages/ai-provider`、`agent-core`、`ai-search` | 53 | 模型接入、Agent 循环、Web 搜索 |
| `apps/*/renderer/ai`（含 prompts/guides/skills） | ~110 | 各 app 的 AI 面板与 op 协议 |
| `apps/shell/src/main/mcp` + `cli/src/mcp`、`skills/` | ~60 | MCP server、CLI、20+ 推荐技能 |
| `apps/shell` 的 `knowledge-base` / `KbAskPanel` / `AskAttachments` / `star-prompt` / `cloud-projects` / `integrations` | ~20 | Ask AI（收藏夹问答）、知识库、云项目 |

**两个"看着像 AI、其实可以单取"的边界项**：

- `packages/pipelines/src/slides/*` —— 是"deck 生成阶段 + 版面几何校验"，其中 `layout-audit` / `audit-deck` / `stage-check` 是纯确定性代码（只依赖 `pptx-engine` + `pptx-render`），**可以脱离 AI 单独用于 Slides 的"导出前体检"**；`guides/`、`design.md`、`spec.md` 才是给模型看的提示材料，可以不要。
- `packages/project-store` —— 是"本地项目式文档存储 + 聊天历史持久化"，去掉聊天历史后就是一套轻量的项目/工作区存储，与 AI 无关。

**必须处理的坑**：审计报告 A4 已指出，本项目 `apps/*/src/renderer/ai/*.ts` 保留了 **8 个 fail-silent stub**（`applyAiOps` 返回空、`executeTool` 抛错、`opCatalog` 返回 `[]`）。既然确定不要 AI，正确做法是**连同调用点与 UI 入口一起删除**，而不是保留"看起来成功但什么都没做"的空实现——这类代码在重构中会静默吞掉数据。

---

## 5. 建议路线

**第一批（立刻做，低成本高回报）**
1. 清理 AI stub 层（消除 fail-silent，README 与实现对齐）
2. 补齐 `.github/ci.yml` + `SECURITY.md`（本项目当前门禁失效、死链）
3. 从上游搬 S 级增强：外部改动监听、崩溃恢复副本、窗口位置记忆、界面缩放、标签休眠

**第二批（1–2 个月，形成差异）**
4. ODF 导入（先 `.ods` 走 Rust，再 `.odt`/`.odp` 走 TS）
5. Markdown 双链 + 反链 + 图谱
6. Docs 邮件合并引擎 + 文档属性 + PDF 内链导出
7. Slides 录制/旁白

**第三批（季度级）**
8. PDF 数字证书签名（需按平台做证书库适配）
9. 多语言铺开（按上游节奏：先 docs/sheets/slides/html，pdf/markdown 暂缓）
10. 版面审计、单元格图片、大表筛选

---

## 6. 复核方法

```bash
# 差异文件树（本次使用的方法）
curl -sL "https://api.github.com/repos/genspark-ai/genoffice/git/trees/main?recursive=1" -o genoffice-tree.json
# 与本项目 apps/ packages/ 下 /src/ 路径求差集，再按目录聚合

# 关键缺失点的本地反证
grep -rn "UNSUPPORTED_LAUNCH_RE" apps/shell/src/main/launch-paths.ts      # ODF 明确不支持
grep -rn "certificate signatures" apps/pdf/src/renderer/App.tsx            # 仅视觉签名
grep -rln "getUserMedia\|MediaRecorder" apps/slides/src                    # 无录制
grep -rln "wikilink\|backlink\|graph-view" apps/markdown/src               # 无双链
grep -rln "watchFile" packages apps --include=*.ts                         # 无外部改动监听
```

## 7. 待核实项（本报告未下结论的部分）

- 上游 `apps/slides/src/renderer/{layout-script,scene,views,actions}.ts` 与本地同名能力的对应关系（可能是重构而非新增），本次未逐行比对。
- `apps/docs/src/renderer/controller.ts`、`pagination-loop.ts` 判断为 Docs 内部重构产物，未计入升级点。
- 上游 `pipelines` 是否在本项目侧的 CLI 中已被裁剪过（本项目 CLI 无 `slides audit`，倾向于未包含）。
