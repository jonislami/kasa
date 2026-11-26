// Minimal compound file (OLE2 / CFB v3) reader and writer, enough to rewrite the streams of an .xls template:
// the directory entries are kept as they are (names, tree, CLSIDs, times), only start sectors and sizes change.
// Streams below the mini-stream cutoff (4096 bytes) are not supported by the writer (an .xls has none).

export interface CfbStream {
  name: string
  /** Index of the directory entry. */
  entry: number
  data: Uint8Array
}

export interface Cfb {
  /** The raw 128-byte directory entries. */
  dir: Uint8Array[]
  streams: CfbStream[]
  header: Uint8Array
}

const FREE = 0xffffffff
const END = 0xfffffffe
const FATSECT = 0xfffffffd
const DIFSECT = 0xfffffffc

export function readCfb(buf: Uint8Array): Cfb {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const u32 = (o: number) => dv.getUint32(o, true)
  if (u32(0) !== 0xe011cfd0 || u32(4) !== 0xe11ab1a1) throw new Error('Skedari nuk është .xls')
  const ss = 1 << dv.getUint16(30, true)
  const sec = (i: number) => 512 + i * ss
  const difat: number[] = []
  for (let i = 0; i < 109; i++) if (u32(76 + i * 4) !== FREE) difat.push(u32(76 + i * 4))
  for (let s = u32(68), k = 0; s < 0xfffffffa && k < u32(72); k++) {
    for (let i = 0; i < ss / 4 - 1; i++) if (u32(sec(s) + i * 4) !== FREE) difat.push(u32(sec(s) + i * 4))
    s = u32(sec(s) + ss - 4)
  }
  const fat: number[] = []
  for (const s of difat) for (let i = 0; i < ss / 4; i++) fat.push(u32(sec(s) + i * 4))
  const chain = (start: number): number[] => {
    const out: number[] = []
    for (let s = start; s < 0xfffffffa && out.length <= fat.length; s = fat[s]) out.push(s)
    return out
  }
  const read = (start: number, size: number) => {
    const out = new Uint8Array(chain(start).length * ss)
    chain(start).forEach((s, i) => out.set(buf.subarray(sec(s), sec(s) + ss), i * ss))
    return out.slice(0, size)
  }
  const dirBytes = read(u32(48), Infinity)
  const dir: Uint8Array[] = []
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) dir.push(dirBytes.slice(o, o + 128))
  const cutoff = u32(56)
  const streams: CfbStream[] = []
  dir.forEach((e, i) => {
    const ed = new DataView(e.buffer, e.byteOffset, 128)
    if (e[66] !== 2) return
    const size = ed.getUint32(120, true)
    if (size < cutoff) throw new Error('Shablloni .xls ka rrjedhë të vogël (mini stream), e pambështetur')
    const nl = ed.getUint16(64, true)
    const name = String.fromCharCode(...Array.from({ length: Math.max(0, nl / 2 - 1) }, (_, k) => ed.getUint16(k * 2, true)))
    streams.push({ name, entry: i, data: read(ed.getUint32(116, true), size) })
  })
  return { dir, streams, header: buf.slice(0, 512) }
}

export function writeCfb(cfb: Cfb): Uint8Array {
  const ss = 512
  const per = ss / 4
  const secs = (n: number) => Math.ceil(n / ss)
  for (const s of cfb.streams) if (s.data.length < 4096) throw new Error('Rrjedhë nën 4096 bajt')
  const dataSecs = cfb.streams.reduce((a, s) => a + secs(s.data.length), 0)
  const dirSecs = secs(cfb.dir.length * 128)
  let fatSecs = 1
  while (fatSecs * per < dataSecs + dirSecs + fatSecs) fatSecs++
  if (fatSecs > 109) throw new Error('Skedari është shumë i madh')
  const total = dataSecs + dirSecs + fatSecs
  const fat = new Array<number>(fatSecs * per).fill(FREE)
  const out = new Uint8Array(512 + total * ss)
  const dv = new DataView(out.buffer)
  let next = 0
  const place = (bytes: Uint8Array, count: number): number => {
    const start = next
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? END : start + i + 1
    out.set(bytes, 512 + start * ss)
    next += count
    return start
  }
  const dir = cfb.dir.map((e) => new Uint8Array(e))
  for (const s of cfb.streams) {
    const start = place(s.data, secs(s.data.length))
    const ed = new DataView(dir[s.entry].buffer)
    ed.setUint32(116, start, true)
    ed.setUint32(120, s.data.length, true)
    ed.setUint32(124, 0, true)
  }
  // root entry: no mini stream
  new DataView(dir[0].buffer).setUint32(116, END, true)
  new DataView(dir[0].buffer).setUint32(120, 0, true)
  const dirBytes = new Uint8Array(dirSecs * ss)
  dir.forEach((e, i) => dirBytes.set(e, i * 128))
  // unused directory slots: empty entries (siblings/child = NOSTREAM)
  for (let i = dir.length; i < dirSecs * 4; i++) {
    const v = new DataView(dirBytes.buffer, i * 128, 128)
    v.setInt32(68, -1, true)
    v.setInt32(72, -1, true)
    v.setInt32(76, -1, true)
  }
  const dirStart = place(dirBytes, dirSecs)
  const fatStart = next
  for (let i = 0; i < fatSecs; i++) fat[fatStart + i] = FATSECT
  fat.forEach((v, i) => dv.setUint32(512 + fatStart * ss + i * 4, v, true))

  out.set(cfb.header.subarray(0, 76))
  dv.setUint16(26, 3, true) // version 3
  dv.setUint16(30, 9, true) // 512-byte sectors
  dv.setUint16(32, 6, true)
  dv.setUint32(40, 0, true) // directory sectors (v3: 0)
  dv.setUint32(44, fatSecs, true)
  dv.setUint32(48, dirStart, true)
  dv.setUint32(56, 4096, true)
  dv.setUint32(60, END, true) // no mini FAT
  dv.setUint32(64, 0, true)
  dv.setUint32(68, END, true) // no DIFAT sectors
  dv.setUint32(72, 0, true)
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i < fatSecs ? fatStart + i : FREE, true)
  void DIFSECT
  return out
}
