/**
 * Barcodes for labels as bar widths (1 = narrow module), drawn as SVG by the label component.
 * EAN-13 for 13-digit codes (our internal 20… codes and most retail codes), Code 128-B otherwise.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function isEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  const d = code.split('').map(Number)
  const sum = d.slice(0, 12).reduce((s, v, i) => s + v * (i % 2 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === d[12]
}

/** "1010…" module pattern of an EAN-13 (95 modules). */
export function ean13Modules(code: string): string {
  const d = code.split('').map(Number)
  const par = PARITY[d[0]]
  let m = '101'
  for (let i = 1; i <= 6; i++) m += (par[i - 1] === 'L' ? L : G)[d[i]]
  m += '01010'
  for (let i = 7; i <= 12; i++) m += R[d[i]]
  return m + '101'
}

// Code 128 patterns (bar/space widths), values 0–106
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

/** "1010…" module pattern of a Code 128-B symbol (printable ASCII). */
export function code128Modules(text: string): string {
  const values = [104] // Start B
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    values.push(c >= 32 && c <= 126 ? c - 32 : 0)
  }
  const check = values.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0) % 103
  values.push(check, 106)
  let m = ''
  for (const v of values) {
    const w = C128[v]
    for (let i = 0; i < w.length; i++) m += (i % 2 === 0 ? '1' : '0').repeat(Number(w[i]))
  }
  return m
}

export function barcodeModules(code: string): { modules: string; kind: 'ean13' | 'code128' } {
  return isEan13(code) ? { modules: ean13Modules(code), kind: 'ean13' } : { modules: code128Modules(code), kind: 'code128' }
}
