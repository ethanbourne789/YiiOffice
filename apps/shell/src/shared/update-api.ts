/** Update channel identifier the renderer and main process share. */
export type UpdateChannel = 'stable' | 'alpha'

const VALID_CHANNELS = new Set<UpdateChannel>(['stable', 'alpha'])

/** Guard: only the two known channel values are accepted. */
export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return typeof value === 'string' && VALID_CHANNELS.has(value as UpdateChannel)
}