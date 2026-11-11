// Tiny DER (ASN.1) writer – just what the ATK CSR and signatures need.

export const b64encode = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export const b64decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function length(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n)
  const bytes: number[] = []
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

export const tlv = (tag: number, ...content: Uint8Array[]): Uint8Array => {
  const body = concat(...content)
  return concat(Uint8Array.of(tag), length(body.length), body)
}

export const sequence = (...items: Uint8Array[]) => tlv(0x30, ...items)
export const set = (...items: Uint8Array[]) => tlv(0x31, ...items)
export const printable = (s: string) => tlv(0x13, new TextEncoder().encode(s))
export const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s))
export const bitString = (bytes: Uint8Array) => tlv(0x03, Uint8Array.of(0), bytes)

/** Unsigned big-endian integer (leading zeros trimmed, 0x00 added when the high bit is set). */
export function integer(bytes: Uint8Array): Uint8Array {
  let i = 0
  while (i < bytes.length - 1 && bytes[i] === 0) i++
  let v = bytes.subarray(i)
  if (v[0] & 0x80) v = concat(Uint8Array.of(0), v)
  return tlv(0x02, v)
}

export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number)
  const out: number[] = [parts[0] * 40 + parts[1]]
  for (const p of parts.slice(2)) {
    const chunk: number[] = []
    let x = p
    do {
      chunk.unshift(x & 0x7f)
      x >>= 7
    } while (x > 0)
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80
    out.push(...chunk)
  }
  return tlv(0x06, Uint8Array.from(out))
}

/** WebCrypto ECDSA signatures are raw r||s (P1363); ATK (Go ecdsa.SignASN1) expects DER SEQUENCE { r, s }. */
export function rawToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error('Nënshkrim ECDSA P-256 i pavlefshëm')
  return sequence(integer(raw.subarray(0, 32)), integer(raw.subarray(32)))
}

export function toPem(label: string, der: Uint8Array): string {
  const b64 = b64encode(der)
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

export { concat }
