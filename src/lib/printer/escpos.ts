/**
 * ESC/POS byte builder for 58mm (32 chars) and 80mm (48 chars) thermal printers.
 * Albanian letters ë/ç: code page CP852 or CP1250, or plain replacement (e, c) – a setting,
 * because cheap printers differ.
 */
export type Charset = 'cp852' | 'cp1250' | 'replace'

const ESC = 0x1b
const GS = 0x1d

// Code page numbers for ESC t n (Epson-compatible; most Chinese BT printers follow them).
const CODEPAGE: Record<Exclude<Charset, 'replace'>, number> = { cp852: 18, cp1250: 45 }

// Unicode → byte for the letters we need beyond ASCII.
const MAP: Record<Exclude<Charset, 'replace'>, Record<string, number>> = {
  cp852: { ë: 0x89, Ë: 0xd3, ç: 0x87, Ç: 0x80, é: 0x82, É: 0x90, ü: 0x81, Ü: 0x9a, ö: 0x94, Ö: 0x99, ä: 0x84, Ä: 0x8e, š: 0xe7, Š: 0xe6, č: 0x9f, Č: 0xac, ž: 0xa7, Ž: 0xa6, ć: 0x86, Ć: 0x8f, đ: 0xd0, Đ: 0xd1 },
  cp1250: { ë: 0xeb, Ë: 0xcb, ç: 0xe7, Ç: 0xc7, é: 0xe9, É: 0xc9, ü: 0xfc, Ü: 0xdc, ö: 0xf6, Ö: 0xd6, ä: 0xe4, Ä: 0xc4, š: 0x9a, Š: 0x8a, č: 0xe8, Č: 0xc8, ž: 0x9e, Ž: 0x8e, ć: 0xe6, Ć: 0xc6, đ: 0xf0, Đ: 0xd0, '€': 0x80 },
}

const PLAIN: Record<string, string> = {
  ë: 'e', Ë: 'E', ç: 'c', Ç: 'C', é: 'e', É: 'E', ü: 'u', Ü: 'U', ö: 'o', Ö: 'O', ä: 'a', Ä: 'A',
  š: 's', Š: 'S', č: 'c', Č: 'C', ž: 'z', Ž: 'Z', ć: 'c', Ć: 'C', đ: 'dj', Đ: 'Dj', '€': 'EUR',
  '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '·': '-', '×': 'x', '…': '...',
}

export function encodeText(text: string, charset: Charset): number[] {
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 0x80) {
      out.push(code)
      continue
    }
    if (charset !== 'replace') {
      const b = MAP[charset][ch]
      if (b !== undefined) {
        out.push(b)
        continue
      }
    }
    const plain = PLAIN[ch] ?? ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    for (const c of plain) out.push(c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : 0x3f)
  }
  return out
}

export class EscPos {
  private bytes: number[] = []

  constructor(
    public readonly width: number,
    private readonly charset: Charset,
  ) {
    this.raw(ESC, 0x40) // init
    if (charset !== 'replace') this.raw(ESC, 0x74, CODEPAGE[charset])
  }

  raw(...b: number[]): this {
    this.bytes.push(...b)
    return this
  }

  /** Raster image (GS v 0, normal size): rows of `bytesPerRow` bytes, most significant bit first, 1 = black. Follows ESC a. */
  image(bytesPerRow: number, height: number, data: Uint8Array): this {
    this.raw(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff)
    for (const b of data) this.bytes.push(b)
    return this.raw(0x0a)
  }

  text(s: string): this {
    this.bytes.push(...encodeText(s, this.charset))
    return this
  }

  line(s = ''): this {
    return this.text(s).raw(0x0a)
  }

  align(a: 'left' | 'center' | 'right'): this {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2)
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0)
  }

  /** 1 = normal, 2 = double width + height */
  size(n: 1 | 2): this {
    return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00)
  }

  rule(ch = '-'): this {
    return this.line(ch.repeat(this.width))
  }

  /** Left text + right text on one line (left is cut if needed). */
  pair(left: string, right: string, width = this.width): this {
    const space = width - right.length - 1
    const l = left.length > space ? left.slice(0, Math.max(space, 0)) : left
    return this.line(l + ' '.repeat(Math.max(width - l.length - right.length, 1)) + right)
  }

  /** Columns with fixed widths; the last one is right-aligned. */
  cols(values: string[], widths: number[]): this {
    const parts = values.map((v, i) => {
      const w = widths[i]
      const s = v.length > w ? v.slice(0, w) : v
      return i === values.length - 1 || i > 0 ? s.padStart(w) : s.padEnd(w)
    })
    return this.line(parts.join(''))
  }

  /** Word-wrapped paragraph. */
  wrap(s: string): this {
    const words = s.split(/\s+/)
    let cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > this.width) {
        if (cur) this.line(cur)
        cur = w
      } else cur = (cur + ' ' + w).trim()
    }
    if (cur) this.line(cur)
    return this
  }

  feed(n = 1): this {
    return this.raw(ESC, 0x64, n)
  }

  /** QR code (GS ( k), model 2. `size` 1–16 dots per module. */
  qr(data: string, size = 6): this {
    const d = Array.from(new TextEncoder().encode(data))
    const len = d.length + 3
    return this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00) // model 2
      .raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size) // module size
      .raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31) // error correction M
      .raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...d) // store
      .raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30) // print
  }

  /** CODE128 barcode (GS k m=73). */
  barcode128(data: string): this {
    const d = [0x7b, 0x42, ...Array.from(data).map((c) => c.charCodeAt(0) & 0x7f)] // {B = code set B
    return this.raw(GS, 0x68, 60).raw(GS, 0x77, 2).raw(GS, 0x48, 0).raw(GS, 0x6b, 73, d.length, ...d)
  }

  cut(): this {
    return this.feed(3).raw(GS, 0x56, 0x42, 0x00)
  }

  /** Opens the cash drawer on pin 2. */
  drawer(): this {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa)
  }

  build(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

export function charsPerLine(paper: 58 | 80): number {
  return paper === 58 ? 32 : 48
}
