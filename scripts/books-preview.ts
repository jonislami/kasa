// Fills the four original ATK books (public/atk) with sample documents:
//   npx tsx --tsconfig tsconfig.app.json scripts/books-preview.ts <out-dir>
import { readFileSync, writeFileSync } from 'node:fs'
import { buildRows, checkBooks, TEMPLATES, type BookDoc, type BookKind } from '../src/kontabilist/atkBooks'
import { fillTemplate } from '../src/kontabilist/atkXlsx'

const base = { vat_no: '', vat_nd: 0, asset: false, export: false, category: 'goods', vat_flag: 'none', doc_type: 'invoice', net_d: 0, vat_d: 0, amt_c: 0, amt_a: 0 } as const
const docs: BookDoc[] = [
  { ...base, kind: 'sale', date: '2026-10-03', doc_no: 'S-1', partner: 'Kompania A', nui: '810243569', net_e: 1000, vat_e: 180, total: 1180 },
  { ...base, kind: 'sale', date: '2026-10-05', doc_no: 'S-2', partner: 'Klient jashtë', nui: '', export: true, amt_c: 500, net_e: 0, vat_e: 0, total: 500 },
  { ...base, kind: 'sale', date: '2026-10-06', doc_no: 'S-3', partner: 'Kompania B', nui: '811111111', doc_type: 'credit_note', net_e: -100, vat_e: -18, total: -118 },
  { ...base, kind: 'purchase', date: '2026-10-07', doc_no: 'B-1', partner: 'Furnitori', nui: '812395037', vat_no: '330000000', net_e: 2000, vat_e: 360, net_d: 100, vat_d: 8, total: 2468 },
  { ...base, kind: 'purchase', date: '2026-10-08', doc_no: 'B-2', partner: 'Pajisje SH.P.K.', nui: '812000000', category: 'assets', asset: true, net_e: 5000, vat_e: 900, total: 5900 },
  { ...base, kind: 'purchase', date: '2026-10-10', doc_no: 'R-1', partner: 'Google Ireland', nui: '', vat_flag: 'reverse_charge', category: 'services', amt_c: 300, net_e: 0, vat_e: 0, total: 300 },
]
const dir = process.argv[2] ?? '.'
for (const b of ['sales_vat', 'purchase_vat', 'sales_novat', 'purchase_novat'] as BookKind[]) {
  const rows = buildRows(b, docs)
  writeFileSync(`${dir}/${b}.xlsx`, fillTemplate(new Uint8Array(readFileSync(`public/atk/${b}.xlsx`)), b, rows, TEMPLATES[b].widths.length))
  console.log(b, rows.length, 'rreshta')
}
console.log(checkBooks(docs, true, '2026-10-01', '2026-10-31').map((i) => `${i.level}: ${i.text}`).join('\n'))
