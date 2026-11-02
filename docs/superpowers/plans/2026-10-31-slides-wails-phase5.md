# Phase 5: Slides 保存与编辑操作 — Wails 完整实现

> **状态**: 待审批
> **创建**: 2026-10-31
> **前置**: Phase 4 (editor bridge stubs) 已完成

---

## 问题根因

Slides 编辑器在 Wails 模式下有两个架构级别的问题：

### 问题 1: `save()` / `saveAs()` 是空操作

**现状**: `window.desktop.save()` 返回 `undefined`，导致 `file-actions.ts` 中 `r.ok` 为 falsy，每次保存都显示失败。

**根因**: Electron 架构中，`save()` 不传参数 — 主进程持有 `OpenedPptx` 完整模型，自己序列化后写磁盘。Wails 模式下没有主进程模型持有者，Go 后端的 `SlidesService.Save(path, content)` 需要前端传入 `(path, base64Content)`。

### 问题 2: ~65 个编辑操作全部 noopPromise

**现状**: `editText`, `deleteElement`, `addBlankSlide` 等返回 `undefined`，编辑不生效。

**根因**: 同上的架构差异 — Electron 主进程在 `OpenedPptx` 内存模型上应用编辑，返回新的 `RenderSlide`。Wails 模式下 pptx-engine 无法直接在 renderer 中运行（依赖 `node:crypto`, `Buffer`, `node:zlib`）。

---

## 架构决策：渲染器端 pptx-engine（浏览器兼容层）

### 方案对比

| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| **A. 渲染器端 pptx-engine** | 编辑即时生效，无需 IPC 往返；Go 后端仅负责文件 I/O | 需改造 pptx-engine 消除 Node.js 依赖（~75 处改动） | **推荐** |
| B. Go 后端托管 deck 模型 | 前端无需改造 | Go 无法运行 JS pptx-engine；IPC 数据量大（每次编辑传输整个 RenderSlide） | 不可行 |
| C. 混合方案（Worker 运行） | 编辑操作隔离在 Web Worker 中 | Web Worker 仍需要浏览器兼容的 pptx-engine；不解决 Node.js 依赖问题 | 方案 A 的子集 |

### 选择方案 A 的理由

1. **Docs 已经在 renderer 端序列化**（`buildDocBytes()`）— Slides 应保持一致模式
2. Go 后端的 `Save(path, base64Content)` 已经实现，只需前端提供 base64 内容
3. pptx-engine 的 Node.js 依赖消除是纯机械替换（Buffer → TextEncoder, createHash → Web Crypto），不影响业务逻辑
4. 编辑操作本质是内存操作 — 正好适合在 renderer 端运行

---

## 实施计划

### Step 1: pptx-engine 浏览器兼容化

**目标**: pptx-engine 可以在浏览器环境中运行（不依赖 Node.js 内置模块）。

**策略**: 创建 `browser-compat.ts` 兼容层，**不动用原文件**，通过条件导出或 entry override 替换。

#### 1.1 创建兼容层

新建 `frontend/packages/pptx-engine/src/browser-compat.ts`:

```typescript
// TextEncoder/TextDecoder 替代 Buffer
export function textToBytes(text: string): Uint8Array
export function bytesToText(bytes: Uint8Array): string

// Web Crypto 替代 node:crypto createHash
export async function sha256Hash(bytes: Uint8Array): Promise<Uint8Array>

// crypto.randomUUID() 替代 node:crypto randomUUID
export function randomUUID(): string

// pako 替代 node:zlib deflateSync（仅纯色 PNG 生成）
export function deflateSync(data: Uint8Array): Uint8Array
```

#### 1.2 替换 Node.js 依赖（按文件）

| 文件 | Node.js 依赖 | 替换方案 | 影响范围 |
|------|-------------|---------|---------|
| `zip.ts` | `createHash` (SHA-256) | `crypto.subtle.digest('SHA-256', ...)` | `PackageArchive.open()` 哈希计算 |
| `sections.ts` | `randomUUID` | `globalThis.crypto.randomUUID()` | 创建 section 时 |
| `media-insert.ts` | `deflateSync` (zlib) | pako 或 pre-computed PNG buffer | 纯色 PNG 帧生成 |
| `index.ts` | `node:fs`, `node:stream` (dynamic import) | 不暴露 `savePptxToFile` | 仅磁盘写入，Wails 中不需要 |
| 15 个文件 | `Buffer.from/alloc/concat` | `TextEncoder.encode` / `Uint8Array` | zip 条目写入 |

#### 1.3 实现方式：条件入口

**方案**: 在 `package.json` 中配置 browser field，指向条件入口文件：

```json
{
  "exports": {
    ".": {
      "browser": "./src/browser-entry.ts",
      "default": "./src/index.ts"
    }
  }
}
```

`browser-entry.ts` 重新导出 index.ts 的全部 API，但通过 Vite alias 将 `node:*` 导入重定向到兼容实现。

**或者**（更简单）：直接在 pptx-engine 源文件中添加条件判断：

```typescript
// zip.ts 第 11 行
const createHash = typeof globalThis.crypto?.subtle !== 'undefined'
  ? webCryptoCreateHash  // 浏览器实现
  : () => require('node:crypto').createHash  // Node.js 回退
```

**推荐**: 直接修改源文件添加条件分支（改动量最小，向后兼容）。不需要创建单独的 browser entry。

**涉及文件** (8 个):
- `frontend/packages/pptx-engine/src/zip.ts`
- `frontend/packages/pptx-engine/src/sections.ts`
- `frontend/packages/pptx-engine/src/media-insert.ts`
- `frontend/packages/pptx-engine/src/index.ts`
- `frontend/packages/pptx-engine/src/chart-insert.ts`
- `frontend/packages/pptx-engine/src/slide-transfer.ts`
- `frontend/packages/pptx-engine/src/builtin-layouts.ts`
- 以及其余引用 Buffer 的文件

**工作量**: ~75 处 Buffer 替换 + 4 处 node:* import 替换。机械性改动。

---

### Step 2: 在 Renderer 端建立 OpenedPptx 模型

**目标**: slides renderer 持有 `OpenedPptx` 实例，编辑操作在 renderer 端执行。

**关键文件**:
- `frontend/apps/slides/src/renderer/App.tsx` — 当前只有 `RenderSlide[]` (纯数据)，需要新增 `OpenedPptx` 状态
- `frontend/apps/slides/src/renderer/action-context.ts` — 需要暴露 `opened` 引用

#### 2.1 打开文件时创建 OpenedPptx

当 `openPptx` / `consumePendingOpen` 获取到 base64 内容后：

```typescript
// 在 App.tsx 中，打开文件时：
import { openPptx as openPptxEngine } from '@yiioffice/pptx-engine'

// 现有的 window.desktop.openPptx() 返回 { path, base64 }
const { path, base64 } = await window.desktop.openPptx(fitWidthPx)
const bytes = base64ToUint8(base64)
const opened = await openPptxEngine(bytes)  // 创建内存模型
const slides = opened.slides.map(scanSlide) // 生成 RenderSlide[] 用于渲染
setOpened(opened)
setSlides(slides)
```

#### 2.2 编辑操作路由到 renderer 端

修改 `slides-bridge.ts` 中的编辑操作，从 noopPromise 改为**调用 renderer 端的编辑函数**。

**方案**: bridge 不再自己实现编辑操作，而是暴露一个 `setEditHandler` 机制：

```typescript
// slides-bridge.ts
let editHandler: SlidesEditHandler | null = null

export function registerEditHandler(handler: SlidesEditHandler) {
  editHandler = handler
}

// editText 从 noopPromise 改为:
async editText(op) {
  return editHandler?.editText(op) ?? null
}
```

renderer 在 App.tsx 启动时注册 handler：

```typescript
// App.tsx
import { registerEditHandler } from '@yiioffice/wails-bridge/slides-bridge'
import { setElementTextBodyProps, patchSlideXml, scanSlide } from '@yiioffice/pptx-engine'

registerEditHandler({
  async editText(op) {
    const opened = openedRef.current
    if (!opened) return null
    const updated = setElementTextBodyProps(opened, op.slideIndex, op.sourceId, op.paragraphs)
    return updated ? scanSlide(updated) : null
  },
  // ... 其余编辑操作
})
```

**优点**: bridge 层保持薄，renderer 控制编辑逻辑。

---

### Step 3: 修复 save() / saveAs() 链路

**目标**: 保存流程在 Wails 下正常工作。

#### 3.1 Renderer 端序列化

```typescript
// file-actions.ts 中的 save():
import { savePptx, reparseDeck, commitSaved } from '@yiioffice/pptx-engine'
import { SlidesSave, SlidesSaveAs } from '@bindings/.../slidesservice'

async function saveInWails(ctx: ActionCtx): Promise<SaveResult> {
  const opened = ctx.opened  // 新增: 内存模型引用
  if (!opened) return { ok: false, error: 'no document' }

  // 1. 序列化
  const bytes = await savePptx(opened)
  const base64 = uint8ToBase64(bytes)

  // 2. 调用 Go 后端写磁盘
  const path = ctx.path!
  try {
    await SlidesSave(path, base64)

    // 3. 重新解析（检测 ID 变化）
    const reparsed = reparseDeck(opened)
    commitSaved(opened)
    const newSlides = reparsed.slides.map(scanSlide)

    return { ok: true, slides: newSlides, path }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
```

#### 3.2 修改 `slides-bridge.ts`

- `save()` 签名改为 `save(path: string, base64: string): Promise<SaveResult>`
- `saveAs()` 签名改为 `saveAs(suggestedName: string, base64: string): Promise<SaveResult>`
- 内部调用 `SlidesSave` / `SlidesSaveAs`

#### 3.3 修改 `ipc.ts` 和 `file-actions.ts`

- `SlidesApi.save()` 签名改为 `save(path: string, content: string): Promise<SaveResult>`
- `save()` 函数传入 `ctx.path` 和序列化的 base64 内容

---

### Step 4: 编辑操作完整接线

**目标**: ~65 个编辑操作从 noopPromise 变为调用 pptx-engine。

#### 4.1 编辑操作分类

| 类别 | 操作数 | pptx-engine 函数 | 说明 |
|------|--------|-----------------|------|
| 文本编辑 | 3 | `setElementTextBodyProps`, `patchTextElementXml`, `applyParagraphFormat` | `editText`, `editTransform`, `batchEditTransform` |
| 样式编辑 | 6 | `setElementFill`, `setElementStroke`, `patchElementFill`, `setElementEffects` | `editFill`, `editStroke`, `editImageFill` |
| 变换编辑 | 4 | `patchElementXfrm`, `setShapePresetGeometry`, `setShapeCustomGeometry` | `editTransform`, `editTransformMulti` |
| 结构操作 | 12 | `deleteSlide`, `duplicateSlide`, `copySlide`, `pasteSlide`, `reorderElement` | `addBlankSlide`, `deleteSlides` 等 |
| 编组/解组 | 4 | `groupElements`, `ungroupElement`, `copyElementData`, `pasteElements` | `groupElements`, `ungroupElement` |
| 表格 | 7 | `addTable`, `editTableCellText`, `editTableStructure` | `addTable`, `editTableCell` 等 |
| 图表 | 3 | `addChart`, `editChartElement`, `getChartElementData` | `addChart`, `editChart` |
| 连接线 | 1 | `editConnectorEndpoints` (pptx-engine 内部) | `editConnectorEndpoints` |
| 图片/媒体 | 5 | `addPicture`, `addMedia`, `replacePictureBytes`, `setPictureSrcRect` | `insertImage`, `addImageBytes` |
| 背景/版式 | 2 | `setSlideLayout`, `editBackground` | `setSlideLayout`, `editBackground` |
| 动画/过渡 | 4 | `setSlideAnimations`, `getSlideAnimations`, `setSlideTransition` | `setAnimations`, `setTransition` |
| 链接 | 4 | `setElementLink`, `getSlideLinks`, `getRunLinks` | `setLink`, `getLink` |
| 母版 | 6 | 复用普通编辑函数 + master 模式 flag | `masterEditText` 等 |
| 撤销/重做 | 3 | pptx-engine 内置 undo/redo | `undo`, `redo`, `beginHistoryBatch` |
| 其他 | 7 | `setSections`, `getSections`, `getNotes` 等 | 元数据操作 |

#### 4.2 通用模式

每个编辑操作的实现遵循统一模式：

```typescript
// slides-bridge.ts 中的 EditHandler 接口:
interface SlidesEditHandler {
  editText(op: EditTextOp): Promise<RenderSlide | null>
  deleteElement(id: string): Promise<RenderSlide | null>
  // ...
}

// 内部实现:
async function withEdit<T>(fn: () => T): Promise<T | null> {
  const handler = editHandler
  if (!handler) return null
  try {
    return fn()
  } catch {
    return null
  }
}
```

---

### Step 5: 验证

#### 5.1 单元测试

- `pptx-engine` 已有 386 个测试覆盖编辑操作 — 确保浏览器兼容改造不破坏行为
- 新增 `browser-compat.test.ts` 验证 Web Crypto SHA-256 输出与 node:crypto 一致
- 新增 `buffer-replacement.test.ts` 验证 TextEncoder 替换 Buffer 后的 zip 二进制一致性

#### 5.2 E2E 测试（mock harness）

当前 mock harness 不启动 Go 后端。Phase 5 需要：
- 在 `e2e/fixture.ts` 中 mock `@yiioffice/pptx-engine` 的 `openPptx` 和 `savePptx`
- 新增 `slides-edit.spec.ts` 验证基本编辑流程（打开 → 编辑文本 → 保存）

#### 5.3 实机验证

- [ ] 打开一个 .pptx 文件
- [ ] 编辑文本框 → 内容正确更新
- [ ] Ctrl+S 保存 → 文件写入磁盘
- [ ] 关闭后重新打开 → 编辑内容持久化
- [ ] 另存为 → 写入新路径
- [ ] 自动保存（30s）→ 正常工作
- [ ] 关闭窗口提示未保存 → 正确检测脏状态

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Buffer 替换引入二进制不一致 | 生成的 pptx 损坏 | 保留 Electron 路径作为回退；新增二进制 diff 测试 |
| pptx-engine 大文件内存溢出（>100MB deck） | 浏览器 OOM | `savePptx` 已使用 JSZip `generateAsync`（分块生成）；超过阈值回退到 Wails 后端下载 |
| Web Crypto API 兼容性 | 旧版 WebView2 不支持 | 检查 `globalThis.crypto?.subtle`；不支持时回退到 js-sha256 |
| 编辑操作性能 | 大 deck 编辑卡顿 | 编辑操作是内存操作，不涉及 IPC；与 Electron 性能相当 |
| 改动范围过大 | 引入回归 bug | 分步提交：先完成浏览器兼容层（Step 1），再接线（Step 2-4） |

---

## 工作量估算

| Step | 涉及文件数 | 类型 | 复杂度 |
|------|-----------|------|--------|
| Step 1: pptx-engine 浏览器兼容化 | ~15 | 机械替换 | 中（量大但模式固定） |
| Step 2: 建立 OpenedPptx 模型 | ~3 | 架构调整 | 高（核心数据结构变更） |
| Step 3: save/saveAs 修复 | ~4 | 接口修改 | 中 |
| Step 4: 编辑操作接线 | ~2 | 批量映射 | 高（65+ 操作需要映射） |
| Step 5: 测试验证 | ~5 | 测试 | 中 |
| **合计** | **~29** | | |

---

## 不做（明确排除范围）

1. **Slides 的 `savePicture()`** — 图片导出已有 `renderSlidesToPngBase64` + `exportImages` 流程
2. **Slides 的 `exportImages()` 的 Go 后端写入** — 需要新增 Go 方法，属于独立需求
3. **master slide 编辑** — 使用与普通编辑相同的引擎函数，复用即可
4. **undo/redo 栈持久化** — pptx-engine 的 undo/redo 已在内存中实现
5. **协同编辑（多用户）** — 不在 Phase 5 范围

---

## 依赖关系

```
Step 1 (pptx-engine 浏览器兼容化)
  └── Step 2 (建立 OpenedPptx 模型)
        ├── Step 3 (save/saveAs 修复)        ← 可与 Step 4 并行
        └── Step 4 (编辑操作接线)
              └── Step 5 (验证)
```
