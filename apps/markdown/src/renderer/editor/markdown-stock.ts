import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownRendererHelpers,
  MarkdownToken,
  Node,
  RenderContext,
} from '@tiptap/core'

type AnyNode = Node<any, any>

/**
 * Tiptap 3.32 annotates the markdown hooks with a `this` of
 * `{ name, options, storage, parent }`, which `node.config` (a `NodeConfig`)
 * does not declare — even though the stock hook is still invoked with that
 * config as its receiver. Call through the widened signature so the receiver
 * stays the config the stock implementation expects and the compiler stops
 * demanding instance-only fields.
 */
export function stockParseMarkdown(
  node: AnyNode,
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
): MarkdownParseResult {
  const hook = node.config.parseMarkdown as unknown as (
    this: AnyNode['config'],
    token: MarkdownToken,
    helpers: MarkdownParseHelpers,
  ) => MarkdownParseResult
  return hook.call(node.config, token, helpers)
}

export function stockRenderMarkdown(
  node: AnyNode,
  content: JSONContent,
  helpers: MarkdownRendererHelpers,
  ctx: RenderContext,
): string {
  const hook = node.config.renderMarkdown as unknown as (
    this: AnyNode['config'],
    content: JSONContent,
    helpers: MarkdownRendererHelpers,
    ctx: RenderContext,
  ) => string
  return hook.call(node.config, content, helpers, ctx)
}
