// Fills the original ATK book files (public/atk/*.xlsx, copied unchanged from the ATK templates) with the rows of a
// period. Rows 1–3 (titles, colours, fonts, borders, merged cells, box numbers) stay exactly as in the ATK file;
// the documents start at row 4 with the cell styles and formulas the template has in its data rows.
// Pure: no browser or database imports (scripts/books-preview.ts uses it in Node).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { BookKind, BookRow } from './atkBooks'

interface Layout {
  /** Cell style ids of a data row by column letter (from the template's data rows). */
  styles: Partial<Record<string, number>>
  /** Formula columns as in the template: column → formula for row {r}. */
  formulas: Partial<Record<string, (r: number) => string>>
}

export const LAYOUTS: Record<BookKind, Layout> = {
  sales_vat: {
    styles: { C: 19, D: 18, E: 18, F: 18, G: 2, H: 2, K: 2, R: 1, W: 1, X: 1 },
    formulas: {
      K: (r) => `H${r}+I${r}+J${r}`,
      R: (r) => `(M${r}+N${r}+O${r}+P${r}+Q${r})*18%`,
      W: (r) => `(S${r}+T${r}+U${r}+V${r})*8%`,
      X: (r) => `R${r}+W${r}`,
    },
  },
  purchase_vat: {
    styles: Object.fromEntries([...'ABCDEFGHIJKLMNOPQR'].map((c) => [c, c === 'C' ? 18 : 17])),
    formulas: {
      S: (r) => `(K${r}+L${r}+M${r}+N${r}+O${r}+P${r}+Q${r}+R${r})*18%`,
      AB: (r) => `(T${r}+U${r}+V${r}+W${r}+X${r}+Y${r}+Z${r}+AA${r})*8%`,
      AC: (r) => `S${r}+AB${r}`,
    },
  },
  sales_novat: {
    styles: { A: 4, B: 4, C: 4, D: 4, E: 4, F: 5, G: 5, H: 5, I: 5 },
    formulas: { I: (r) => `F${r}+G${r}+H${r}` },
  },
  purchase_novat: {
    styles: {},
    formulas: { L: (r) => `SUM(F${r}:K${r})` },
  },
}

export const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function cell(ref: string, style: number | undefined, v: string | number | null, formula?: string): string {
  const s = style != null ? ` s="${style}"` : ''
  if (formula) return `<c r="${ref}"${s}><f>${esc(formula)}</f><v>${v ?? 0}</v></c>`
  if (v == null || v === '') return `<c r="${ref}"${s}/>`
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
}

interface TRow {
  n: number
  attrs: string
  cells: { col: string; style: number | undefined; formula: boolean; xml: string }[]
}

function parseRows(data: string): TRow[] {
  return [...data.matchAll(/<row ([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)].map((m) => ({
    n: Number(/\br="(\d+)"/.exec(m[1])![1]),
    attrs: m[1],
    cells: [...(m[2] ?? '').matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => ({
      col: c[1],
      style: /\bs="(\d+)"/.exec(c[2]) ? Number(/\bs="(\d+)"/.exec(c[2])![1]) : undefined,
      formula: /<f[\s>/]/.test(c[3] ?? ''),
      xml: c[0],
    })),
  }))
}

const colIndex = (L: string) => [...L].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1

/**
 * The sheet XML filled in place: rows 1–3 untouched; every document goes into the template's own row (its cell
 * styles, borders, fills, formulas); the template's prepared rows after the last document stay as they are
 * (shared formulas written out, since their first cell may now hold a document). More documents than prepared
 * rows → new rows like the template's main data row. "jo TVSH" sales: row 4 is ATK's example ("Kompania A")
 * and rows 5–15 its colour guide for filling – a real book has the documents there instead.
 */
export function fillSheetXml(xml: string, book: BookKind, rows: BookRow[], columns: number): string {
  const lay = LAYOUTS[book]
  const start = xml.indexOf('<sheetData>')
  const end = xml.indexOf('</sheetData>')
  const all = parseRows(xml.slice(start + '<sheetData>'.length, end))
  const head = all.filter((r) => r.n <= 3)
  const example = book === 'sales_novat'
  const prepared = example ? [] : all.filter((r) => r.n >= 4)
  const byN = new Map(prepared.map((r) => [r.n, r]))
  // the main data row: the prepared row with most styled cells (example row 4 for "jo TVSH" sales)
  const main = example
    ? all.find((r) => r.n === 4)!
    : [...prepared].sort((a, b) => b.cells.filter((c) => c.style != null).length - a.cells.filter((c) => c.style != null).length || a.n - b.n)[0]
  const rowXml = (attrs: string, n: number, cells: string) => `<row ${attrs.replace(/\br="\d+"/, `r="${n}"`)}>${cells}</row>`

  const out: string[] = head.map((r) => rowXml(r.attrs, r.n, r.cells.map((c) => c.xml).join('')))
  rows.forEach((r, i) => {
    const n = i + 4
    const tpl = byN.get(n) ?? main
    const styleOf = new Map((tpl?.cells ?? []).map((c) => [c.col, c.style]))
    const values: (string | number | null)[] = [i + 1, ...r.text.map((t, k) => ((k === 1 || k === 3) && /^\d{1,10}$/.test(t) ? Number(t) : t)), ...r.amounts.map((v) => (v ? v : null))]
    const cols = new Set<string>([...(tpl?.cells ?? []).map((c) => c.col), ...values.map((v, c) => (v != null && v !== '' ? colName(c) : '')).filter(Boolean), ...Object.keys(lay.formulas)])
    const cells = [...cols]
      .filter((L) => colIndex(L) < columns)
      .sort((a, b) => colIndex(a) - colIndex(b))
      .map((L) => {
        const f = lay.formulas[L]
        const v = values[colIndex(L)] ?? null
        return cell(`${L}${n}`, styleOf.has(L) ? styleOf.get(L) : undefined, f ? (v ?? 0) : v, f ? f(n) : undefined)
      })
      .join('')
    out.push(rowXml(tpl?.attrs ?? `r="${n}"`, n, cells))
  })
  // prepared rows after the documents, unchanged (formulas written out with a 0 value)
  for (const r of prepared.filter((x) => x.n >= rows.length + 4)) {
    const cells = r.cells
      .map((c) => {
        const f = lay.formulas[c.col]
        return c.formula && f ? cell(`${c.col}${r.n}`, c.style, 0, f(r.n)) : c.xml
      })
      .join('')
    out.push(rowXml(r.attrs, r.n, cells))
  }
  const lastRow = Math.max(rows.length + 3, ...prepared.map((r) => r.n), 3)
  return (xml.slice(0, start) + `<sheetData>${out.join('')}</sheetData>` + xml.slice(end + '</sheetData>'.length)).replace(
    /<dimension ref="[^"]*"\/>/,
    `<dimension ref="A1:${colName(columns - 1)}${lastRow}"/>`,
  )
}

/** The filled workbook (bytes of an .xlsx) from the bytes of the ATK template. */
export function fillTemplate(template: Uint8Array, book: BookKind, rows: BookRow[], columns: number): Uint8Array {
  const files = unzipSync(template)
  const sheet = 'xl/worksheets/sheet1.xml'
  files[sheet] = strToU8(fillSheetXml(strFromU8(files[sheet]), book, rows, columns))
  // The formula cells change: drop the calculation chain and let Excel recalculate on opening.
  delete files['xl/calcChain.xml']
  const ct = '[Content_Types].xml'
  files[ct] = strToU8(strFromU8(files[ct]).replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''))
  const rels = 'xl/_rels/workbook.xml.rels'
  files[rels] = strToU8(strFromU8(files[rels]).replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, ''))
  const wb = 'xl/workbook.xml'
  const w = strFromU8(files[wb])
  files[wb] = strToU8(/<calcPr[^>]*\/>/.test(w) ? w.replace(/<calcPr([^>]*?)\s*\/>/, (m, a: string) => (/fullCalcOnLoad/.test(a) ? m : `<calcPr${a} fullCalcOnLoad="1"/>`)) : w.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>'))
  return zipSync(files, { level: 6 })
}
