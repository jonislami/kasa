import { downloadWorkbook, type Cell, type Sheet } from '@/features/accounting/export'

type Plain = string | number | null | undefined

/** A simple sheet: bold header, numbers with 2 decimals, text as text. */
export function sheetOf(name: string, columns: string[], rows: Plain[][]): Sheet {
  const cell = (v: Plain): Cell =>
    v == null || v === '' ? null : typeof v === 'number' ? { value: Math.round(v * 100) / 100, type: Number, format: '0.00' } : { value: v, type: String }
  return {
    name,
    rows: [columns.map((c) => ({ value: c, fontWeight: 'bold' as const })), ...rows.map((r) => r.map(cell))],
    widths: columns.map((c, i) => Math.min(40, Math.max(10, c.length + 2, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2)))),
  }
}

export const downloadSheets = (filename: string, sheets: { name: string; columns: string[]; rows: Plain[][] }[]) =>
  downloadWorkbook(filename, sheets.map((s) => sheetOf(s.name, s.columns, s.rows)))
