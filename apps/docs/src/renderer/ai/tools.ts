/** Stub — AI tools removed. Keep exports for CLI compilation. */
export const aiTools = {}
export const AGENT_TOOLS: any[] = []
export type AiCommentsAccess = {}
export function executeTool(..._args: any[]): any {
  return Promise.reject(new Error('AI tools are unavailable'))
}
export function markDocSeen(..._args: any[]): any {}