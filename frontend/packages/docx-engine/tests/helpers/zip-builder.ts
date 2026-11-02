/**
 * Minimal zip writer for tests.
 *
 * The zip-bomb cases need archives whose declared sizes differ from what a part
 * actually inflates to, and no general-purpose writer will produce those — the
 * bytes have to be laid out by hand. This used to be part of
 * `src/zip-splice.ts`, the reader/writer pair behind the lazy-media scheme;
 * only this writer outlived that feature, so it lives with the tests now.
 */

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const FLAG_DATA_DESCRIPTOR = 0x8

export interface ZipEntry {
  name: string
  nameBytes: Buffer
  flags: number
  method: number
  time: number
  date: number
  crc: number
  csize: number
  usize: number
  verMade: number
  verNeed: number
  intAttr: number
  extAttr: number
  /** first byte of the (compressed) data inside the archive */
  dataOffset: number
}

interface OutEntry {
  meta: Omit<ZipEntry, 'dataOffset'>
  data: Buffer
}

/** Writes a plain (non-zip64) archive: data descriptors are folded into the
 *  headers, so every declared size is whatever the caller claimed. */
export function writeZip(entries: OutEntry[]): Buffer {
  if (entries.length >= 0xffff) throw new Error('zip: too many entries for a plain archive')
  const chunks: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { meta, data } of entries) {
    const flags = meta.flags & ~FLAG_DATA_DESCRIPTOR
    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(meta.verNeed, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(meta.method, 8)
    local.writeUInt16LE(meta.time, 10)
    local.writeUInt16LE(meta.date, 12)
    local.writeUInt32LE(meta.crc, 14)
    local.writeUInt32LE(meta.csize, 18)
    local.writeUInt32LE(meta.usize, 22)
    local.writeUInt16LE(meta.nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(meta.verMade, 4)
    central.writeUInt16LE(meta.verNeed, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(meta.method, 10)
    central.writeUInt16LE(meta.time, 12)
    central.writeUInt16LE(meta.date, 14)
    central.writeUInt32LE(meta.crc, 16)
    central.writeUInt32LE(meta.csize, 20)
    central.writeUInt32LE(meta.usize, 24)
    central.writeUInt16LE(meta.nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(meta.intAttr, 36)
    central.writeUInt32LE(meta.extAttr, 38)
    central.writeUInt32LE(offset, 42)
    chunks.push(local, meta.nameBytes, data)
    centrals.push(central, meta.nameBytes)
    offset += 30 + meta.nameBytes.length + data.length
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0)
  if (offset + cdSize > 0xffffffff) throw new Error('zip: archive too large for a plain archive')
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, ...centrals, eocd])
}
