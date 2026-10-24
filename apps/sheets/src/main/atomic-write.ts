/// Re-exported from its own electron-utils subpath on purpose: external
/// consumers bundle this module, and the package barrel pulls in
/// renderer/main-only modules that import 'electron' at top level, which a
/// plain Node process cannot resolve.
export { atomicWriteFile } from '@yiioffice/electron-utils/atomic-write'
