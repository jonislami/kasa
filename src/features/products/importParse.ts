import { parseUnit } from '@/lib/units'
import type { VatCode } from '@/lib/vat'
import type { ImportRow } from './api'

type Field = keyof Pick<
  ImportRow,
  'name' | 'barcode' | 'category' | 'unit' | 'sale_price' | 'purchase_price' | 'vat_code' | 'min_stock' | 'stock' | 'duration_min'
>

/** Column titles in the template (and the first alias recognised for each field). */
export const TEMPLATE_COLUMNS: { field: Field; title: string }[] = [
  { field: 'name', title: 'Emri' },
  { field: 'barcode', title: 'Barkodi' },
  { field: 'category', title: 'Kategoria' },
  { field: 'unit', title: 'Njësia' },
  { field: 'purchase_price', title: 'Çmimi i blerjes' },
  { field: 'sale_price', title: 'Çmimi i shitjes' },
  { field: 'vat_code', title: 'TVSH' },
  { field: 'min_stock', title: 'Stoku minimal' },
  { field: 'stock', title: 'Stoku' },
  { field: 'duration_min', title: 'Kohëzgjatja (min)' },
]

const ALIASES: Record<Field, string[]> = {
  name: ['emri', 'emertimi', 'produkti', 'artikulli', 'emri i produktit', 'pershkrimi', 'name', 'sherbimi'],
  barcode: ['barkodi', 'barcode', 'kodi', 'ean', 'kodi i produktit'],
  category: ['kategoria', 'grupi', 'category'],
  unit: ['njesia', 'njesia matese', 'unit', 'njm'],
  purchase_price: ['cmimi i blerjes', 'c. blerjes', 'c blerjes', 'blerja', 'kosto', 'cmimi blerjes', 'purchase price', 'cost'],
  sale_price: ['cmimi i shitjes', 'c. shitjes', 'c shitjes', 'shitja', 'cmimi', 'cmimi shitjes', 'price', 'sale price'],
  vat_code: ['tvsh', 'norma', 'norma e tvsh', 'vat'],
  min_stock: ['stoku minimal', 'minimumi', 'stok minimal', 'min', 'min stock'],
  stock: ['stoku', 'sasia', 'stock', 'gjendja'],
  duration_min: ['kohezgjatja', 'kohezgjatja (min)', 'minuta', 'duration'],
}

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(/[€\s]/g, '')
  if (!s) return null
  // "1.234,56" → 1234.56 ; "1,25" → 1.25 ; "1,234.56" → 1234.56
  let t = s
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else t = t.replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

export function parseVat(v: unknown): VatCode | null {
  const s = norm(v).replace('%', '')
  if (!s) return null
  if (['e', '18', '0.18'].includes(s)) return 'E'
  if (['d', '8', '0.08'].includes(s)) return 'D'
  if (['c', '0', '0.0'].includes(s)) return 'C'
  if (['a', 'e liruar', 'liruar', 'exempt'].includes(s)) return 'A'
  return null
}

export interface ParsedImport {
  rows: ImportRow[]
  errors: { line: number; message: string }[]
  /** Fields found in the header, for the preview. */
  mapped: Field[]
  total: number
}

/** Turns spreadsheet rows (first row = header) into import rows + per-line errors. */
export function parseSheet(data: unknown[][], opts: { services: boolean }): ParsedImport {
  const headerIdx = data.findIndex((r) => r.some((c) => norm(c)))
  if (headerIdx < 0) return { rows: [], errors: [{ line: 1, message: 'Skedari është bosh' }], mapped: [], total: 0 }
  const header = data[headerIdx].map(norm)
  const col: Partial<Record<Field, number>> = {}
  for (const f of Object.keys(ALIASES) as Field[]) {
    const idx = header.findIndex((h) => ALIASES[f].includes(h))
    if (idx >= 0) col[f] = idx
  }
  const errors: ParsedImport['errors'] = []
  if (col.name == null) errors.push({ line: headerIdx + 1, message: 'Mungon kolona "Emri"' })
  if (col.sale_price == null) errors.push({ line: headerIdx + 1, message: 'Mungon kolona "Çmimi i shitjes"' })
  if (errors.length) return { rows: [], errors, mapped: Object.keys(col) as Field[], total: 0 }

  const rows: ImportRow[] = []
  let total = 0
  const seenBarcodes = new Map<string, number>()
  data.slice(headerIdx + 1).forEach((r, i) => {
    const line = headerIdx + 2 + i
    const get = (f: Field) => (col[f] == null ? null : r[col[f]!])
    const name = String(get('name') ?? '').trim()
    if (!name && r.every((c) => !norm(c))) return // empty line
    total++
    if (!name) return errors.push({ line, message: 'Mungon emri' })
    const sale = toNumber(get('sale_price'))
    if (sale == null || Number.isNaN(sale) || sale < 0) return errors.push({ line, message: `${name}: çmimi i shitjes mungon ose s'është numër` })
    const purchase = toNumber(get('purchase_price'))
    if (purchase != null && (Number.isNaN(purchase) || purchase < 0)) return errors.push({ line, message: `${name}: çmimi i blerjes s'është numër` })
    const rawVat = get('vat_code')
    const vat = parseVat(rawVat)
    if (norm(rawVat) && !vat) return errors.push({ line, message: `${name}: TVSH "${rawVat}" (lejohen E/18%, D/8%, C/0%, A)` })
    const rawUnit = get('unit')
    const unit = parseUnit(rawUnit)
    if (norm(rawUnit) && !unit) return errors.push({ line, message: `${name}: njësia "${rawUnit}" (lejohen copë, kg, pako, litër)` })
    const minStock = toNumber(get('min_stock'))
    const stock = toNumber(get('stock'))
    const duration = toNumber(get('duration_min'))
    if ([minStock, stock, duration].some((n) => Number.isNaN(n))) return errors.push({ line, message: `${name}: stoku ose kohëzgjatja s'është numër` })
    let barcode = String(get('barcode') ?? '').trim()
    if (/^\d+(\.\d+)?e\+\d+$/i.test(barcode)) return errors.push({ line, message: `${name}: barkodi është shkurtuar nga Excel-i (${barcode}); formatoje kolonën si tekst` })
    barcode = barcode.replace(/\.0+$/, '')
    if (barcode) {
      const prev = seenBarcodes.get(barcode)
      if (prev) return errors.push({ line, message: `${name}: barkodi ${barcode} përsëritet (rreshti ${prev})` })
      seenBarcodes.set(barcode, line)
    }
    const isService = opts.services || (duration != null && duration > 0 && !barcode && col.stock == null)
    rows.push({
      name,
      barcode: barcode || undefined,
      category: String(get('category') ?? '').trim() || undefined,
      unit: unit ?? undefined,
      sale_price: Math.round(sale * 100) / 100,
      purchase_price: purchase ?? undefined,
      vat_code: vat ?? undefined,
      min_stock: minStock ?? undefined,
      stock: stock ?? undefined,
      kind: isService ? 'service' : 'product',
      duration_min: duration ? Math.round(duration) : undefined,
    })
  })
  return { rows, errors, mapped: Object.keys(col) as Field[], total }
}

/** Minimal CSV reader (comma or semicolon, quoted fields). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      out.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    out.push(row)
  }
  return out
}
