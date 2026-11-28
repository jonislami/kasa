// Downloads of Kontabilist reports in the common Excel layout (reportXlsx.ts). The company of the report is the one
// open in the program (Frame sets it), the logo and name of the office come from the office profile.
import type { Cell, Sheet } from '@/features/accounting/export'
import { buildReport, excelDate, inferKinds, inferRows, logoFromDataUrl, type Kind, type Logo, type ReportSheet, type Val } from './reportXlsx'

interface ReportClient {
  name: string
  nui?: string | null
  vat_number?: string | null
  vat_registered?: boolean
  address?: string | null
  city?: string | null
}

let client: ReportClient | null = null
let office: { name: string | null; logo: Logo | null } = { name: null, logo: null }

export function setReportClient(c: ReportClient | null) {
  client = c
}
export function setReportOffice(name: string | null | undefined, logoUrl: string | null | undefined) {
  office = { name: name ?? null, logo: logoFromDataUrl(logoUrl) }
}

const two = (n: number) => String(n).padStart(2, '0')
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor']

/** "…-2026-10-01-2026-10-31.xlsx" → "01.10.2026 – 31.10.2026"; "…-2026-10.xlsx" → "Tetor 2026"; "…-2026.xlsx" → "2026". */
export function periodFromName(name: string): string | undefined {
  const r = /(\d{4}-\d{2}-\d{2})[-_ ]+(\d{4}-\d{2}-\d{2})/.exec(name)
  if (r) return `${dmy(r[1])} – ${dmy(r[2])}`
  const d = /(\d{4}-\d{2}-\d{2})/.exec(name)
  if (d) return `më ${dmy(d[1])}`
  const m = /(?:^|[^\d])(\d{4})-(\d{2})(?:[^\d]|$)/.exec(name)
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
  const y = /(?:^|[^\d])(20\d{2})(?:[^\d]|$)/.exec(name)
  return y ? y[1] : undefined
}

/** "libri-kryesor-1010-firma-2026-10-01-2026-10-31.xlsx" → "Libri kryesor" when there is no explicit title. */
function titleFromName(name: string, fallback: string): string {
  const base = name.replace(/\.xlsx$/i, '').split(/[-_ ](?=\d{4}|\d{3,})/)[0].replace(/[-_]+/g, ' ').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : fallback
}

export interface ReportOptions {
  title?: string
  period?: string
}

export async function downloadReport(filename: string, sheets: ReportSheet[], opts: ReportOptions = {}): Promise<void> {
  const now = new Date()
  const c = client
  const line = c ? [c.nui && `NUI ${c.nui}`, c.vat_registered ? (c.vat_number ? `Nr. TVSH ${c.vat_number}` : 'Në TVSH') : c.vat_registered === false ? 'Jo në TVSH' : null, [c.address, c.city].filter(Boolean).join(', ')].filter(Boolean).join('   ·   ') : undefined
  const bytes = buildReport(
    {
      company: c?.name ?? office.name ?? 'KontoSef Kontabilist',
      companyLine: line,
      title: opts.title ?? (sheets.length === 1 ? sheets[0].title ?? sheets[0].name : titleFromName(filename, sheets[0]?.name ?? 'Raporti')),
      period: opts.period ?? periodFromName(filename),
      generatedAt: `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}`,
      preparedBy: office.name ?? undefined,
      logo: office.logo,
    },
    sheets,
  )
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[\\/:*?"<>|]+/g, ' ')
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------------------------------------------------------------------------
// The program's existing sheets (Cell rows with their own title rows) in the common layout
// ---------------------------------------------------------------------------
const bold = (c: Cell) => Boolean(c && c.fontWeight === 'bold')
const text = (c: Cell) => (c && typeof c.value === 'string' ? c.value : '')

function kindOfCell(c: Cell): Kind | null {
  if (!c) return null
  if (typeof c.value === 'number') return c.format === '0' ? 'int' : c.format && /0\.00/.test(c.format) ? 'money' : 'qty'
  return excelDate(c.value) != null ? 'date' : 'text'
}

/**
 * A sheet built for the old export: the rows before the column headers (title, company, "Periudha: …") are left out –
 * the common title block replaces them; the first row with several bold cells is the header; later bold rows are
 * totals (or headings when they carry no amount).
 */
export function fromCellSheet(sh: Sheet): { sheet: ReportSheet; period?: string; title?: string } {
  const headerIdx = sh.rows.findIndex((r) => r.filter(bold).length >= Math.min(3, Math.max(1, r.filter(Boolean).length)) && r.filter(Boolean).length >= 2)
  const h = headerIdx < 0 ? 0 : headerIdx
  const lead = sh.rows.slice(0, h)
  const title = lead.length ? text(lead[0][0]) || undefined : undefined
  const periodRow = lead.flat().map(text).find((t) => /^Periudha:/i.test(t))
  const header = sh.rows[h] ?? []
  const body = sh.rows.slice(h + 1)
  const n = Math.max(header.length, ...body.map((r) => r.length))
  const kinds: Kind[] = Array.from({ length: n }, (_, i) => {
    const ks = body.map((r) => kindOfCell(r[i] ?? null)).filter((k): k is Kind => k != null)
    const nums = ks.filter((k) => k !== 'text' && k !== 'date')
    if (nums.length && nums.length >= ks.filter((k) => k === 'text').length) return nums.includes('money') ? 'money' : nums[0]
    if (ks.length && ks.every((k) => k === 'date')) return 'date'
    return 'text'
  })
  const columns = Array.from({ length: n }, (_, i) => ({ header: text(header[i] ?? null) || (header[i] && typeof header[i]!.value === 'number' ? String(header[i]!.value) : ''), kind: kinds[i] }))
  const values: Val[][] = body.map((r) => Array.from({ length: n }, (_, i) => (r[i] ? r[i]!.value : null)))
  const auto = inferRows(values, kinds)
  const rows = body.map((r, k) => {
    if (!r.some(Boolean)) return { cells: values[k], style: 'note' as const }
    if (r.some(bold) && auto[k].style == null) return { cells: values[k], style: values[k].some((v, i) => typeof v === 'number' && kinds[i] !== 'text') ? ('total' as const) : ('group' as const) }
    return auto[k]
  })
  return { sheet: { name: sh.name, title, columns, rows: rows.filter((r, k) => !(r.style === 'note' && !values[k].some((v) => v != null && v !== ''))) }, period: periodRow?.replace(/^Periudha:\s*/i, ''), title }
}

/** Old-style sheets (features/accounting/export) downloaded in the common layout. */
export async function downloadCellSheets(filename: string, sheets: Sheet[], opts: ReportOptions = {}): Promise<void> {
  const conv = sheets.map(fromCellSheet)
  return downloadReport(
    filename,
    conv.map((c) => c.sheet),
    { title: opts.title ?? (sheets.length === 1 ? conv[0].title : undefined), period: opts.period ?? conv.find((c) => c.period)?.period },
  )
}

/** Plain columns + rows (the kind the program builds most) in the common layout. */
export function sheetFromRows(name: string, columns: string[], rows: Val[][], extra: Partial<ReportSheet> = {}): ReportSheet {
  const kinds = inferKinds(columns, rows)
  return { name, columns: columns.map((header, i) => ({ header, kind: kinds[i] })), rows: inferRows(rows, kinds), ...extra }
}
