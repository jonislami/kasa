// The office's own forms, filled from the program's data in copies of the original files (public/hr/, made by
// scripts/prepare-hr-templates.ts): the two employment contracts, the annual-leave decision (.docx) and the
// financial statements in the Kosovo reporting format (.xlsx). Only the {{key}} places change; an unknown value puts
// the original blank back, so an empty form is the original form.
// Pure (no browser or database imports): scripts/office-forms-preview.ts uses it in Node.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
export const dmy = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')
export const eur = (v: number) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} €`

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------
export type Values = Record<string, string | null | undefined>

/** Replaces every {{key}} in the document, headers and footers; missing values get `blanks[key]` (the original blank). */
export function fillDocx(template: Uint8Array, values: Values, blanks: Record<string, string> = {}): Uint8Array {
  const files = unzipSync(template)
  for (const part of Object.keys(files).filter((p) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(p))) {
    const xml = strFromU8(files[part]).replace(/\{\{(\w+)(\|br)?\}\}/g, (_, k: string, br?: string) => {
      const v = values[k]
      const has = v != null && (String(v).trim() !== '' || (v === '' && k.endsWith('_pad')))
      // {{key|br}}: the value on a new line of the same run, nothing at all when there is no value
      if (br) return has ? `</w:t><w:br/><w:t xml:space="preserve">${esc(String(v))}` : esc(blanks[k] ?? '')
      // {{raw_…}}: paragraph properties written by this module itself, not text
      if (k.startsWith('raw_')) return has ? String(v) : blanks[k] ?? ''
      return esc(has ? String(v) : blanks[k] ?? '')
    })
    files[part] = strToU8(xml)
  }
  return zipSync(files, { level: 9 })
}

/** Keys left in a filled document (should be none). */
export const leftKeys = (doc: Uint8Array) =>
  Object.entries(unzipSync(doc))
    .filter(([p]) => p.startsWith('word/') && p.endsWith('.xml'))
    .flatMap(([, b]) => strFromU8(b).match(/\{\{\w+(\|br)?\}\}/g) ?? [])

export interface FormClient {
  name: string
  nui: string | null
  address: string | null
  city: string | null
  representative?: string | null
}

export interface FormEmployee {
  first_name: string
  last_name: string
  personal_no: string | null
  address?: string | null
  city?: string | null
  profession?: string | null
  position: string | null
  iban: string | null
  duties?: string | null
  workplace?: string | null
  contract: 'indefinite' | 'fixed' | 'part_time' | 'service'
  start_date: string
  end_date: string | null
  probation_months?: number | null
  weekly_hours?: number
  work_days?: 5 | 6
  schedule_from?: string | null
  schedule_to?: string | null
  gross_salary: number
  annual_leave_days?: number | null
}

export type ContractForm = 'fixed' | 'indefinite'
export const CONTRACT_FILES: Record<ContractForm, string> = { fixed: 'kontrata_kohe_te_caktuar.docx', indefinite: 'kontrata_kohe_te_pacaktuar.docx' }
export const contractForm = (e: Pick<FormEmployee, 'contract' | 'end_date'>): ContractForm => (e.contract === 'fixed' || e.end_date ? 'fixed' : 'indefinite')

/** The original paragraph properties of the "Vendi i punës" cell. */
const WORKPLACE_PPR = '<w:ind w:left="-2718"/><w:jc w:val="center"/>'

/** The blanks exactly as the two originals have them. */
export const CONTRACT_BLANKS: Record<ContractForm, Record<string, string>> = {
  fixed: { workplace_pad: ' '.repeat(13), raw_workplace_ppr: WORKPLACE_PPR, period: '____', hours: '___', from: '___', to: '____', gross_month: '______', gross_hour: '__________', leave_days: '_____', court: '_______' },
  indefinite: { workplace_pad: ' '.repeat(13), raw_workplace_ppr: WORKPLACE_PPR, hours: '___', from: '__', to: '__', gross_month: '______', gross_hour: '__________', leave_days: '_____', court: '_______' },
}

const monthsBetween = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) + (d2 >= d1 - 1 ? 0 : -1)
}

export function contractValues(c: FormClient, e: FormEmployee): Values {
  const hours = e.weekly_hours ?? 40
  const monthlyHours = (hours * 52) / 12
  const months = e.end_date ? Math.max(1, monthsBetween(e.start_date, e.end_date) + 1) : 0
  const place = [c.address, c.city].filter(Boolean).join(', ')
  return {
    company: c.name,
    company_no: c.nui,
    company_address: place,
    representative: c.representative,
    name: `${e.first_name} ${e.last_name}`.trim(),
    personal_no: e.personal_no,
    residence: [e.address, e.city].filter(Boolean).join(', '),
    profession: e.profession || e.position,
    iban: e.iban,
    duties: (e.duties ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean).join('; ') || e.position,
    period: e.end_date ? `${months} muaj (${dmy(e.start_date)} – ${dmy(e.end_date)})` : null,
    start: dmy(e.start_date),
    probation: e.probation_months == null ? null : e.probation_months > 0 ? `${e.probation_months} muaj` : 'Pa punë provuese',
    hours: `${hours} `,
    from: e.schedule_from,
    to: e.schedule_to,
    overtime: null,
    break: null,
    workplace: e.workplace || place || null,
    workplace_pad: e.workplace || place ? '' : null,
    raw_workplace_ppr: e.workplace || place ? '<w:ind w:left="0"/><w:jc w:val="left"/>' : null,
    gross_month: e.gross_salary ? eur(e.gross_salary) : null,
    gross_hour: e.gross_salary ? eur(r2(e.gross_salary / monthlyHours)) : null,
    leave_days: ` ${e.annual_leave_days ?? (e.work_days === 6 ? 24 : 20)}`,
    court: c.city,
  }
}

export const DECISION_FILE = 'vendimi_pushimi_vjetor.docx'
export const DECISION_BLANKS = { company_head: '', name: '____________________', company: '____________________', year: '____', days: '___', from: '__________', to: '__________', back: '__________', nui: '__________', address: '' }

export function decisionValues(c: FormClient, e: Pick<FormEmployee, 'first_name' | 'last_name'>, l: { from_date: string; to_date: string; days: number }, backDay: string, year?: number): Values {
  return {
    name: `${e.first_name} ${e.last_name}`.trim(),
    company: c.name.trim().replace(/\.+$/, ''), // the form puts the full stop after the name itself
    company_head: c.name,
    year: String(year ?? Number(l.from_date.slice(0, 4))),
    days: Number.isInteger(l.days) ? String(l.days) : String(l.days).replace('.', ','),
    from: dmy(l.from_date),
    to: dmy(l.to_date),
    back: dmy(backDay),
    nui: c.nui,
    address: [c.address, c.city].filter(Boolean).join(', '),
  }
}

// ---------------------------------------------------------------------------
// Financial statements (KSRF) from the trial balance of the year and of the year before
// ---------------------------------------------------------------------------
export const STATEMENTS_FILE = 'pasqyrat_financiare_ksrf.xlsx'

export interface TbLine {
  code: string
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  opening: number
  debit: number
  credit: number
  closing: number
}

/** Row of the "Shpalosje" sheet → amount, for one year (column C = the year, D = the year before). */
export type Notes = Record<number, number>
/** The PPE note (3.2) is one table for the year, in the total column G. */
export type PpeNote = Record<number, number>

const EXPENSE_ROW: Record<string, number> = {
  '6000': 172, // cost of goods sold (3.9)
  '6110': 191, '6330': 192, '6360': 193, '6120': 195, '6200': 198, '6210': 198, '6300': 199, '6340': 199, '6400': 199, '6900': 199,
  '6320': 208, '6130': 209, '6150': 211, '6350': 219, '6100': 213, '6140': 216, '6310': 217, '6600': 218,
  '6500': 226, '6700': 227,
}
const INCOME_ROW: Record<string, number> = { '5000': 157, '5100': 157, '5910': 158, '5900': 159 }

export function ksrfNotes(tb: TbLine[]): { notes: Notes; ppe: PpeNote; result: number; check: number; unmapped: string[] } {
  const n: Notes = {}
  const add = (row: number, v: number) => (n[row] = r2((n[row] ?? 0) + v))
  const unmapped: string[] = []
  const bal = (t: TbLine) => (t.type === 'asset' ? t.closing : -t.closing)
  let ppeCost = { open: 0, dr: 0, cr: 0, close: 0 }
  let ppeDep = { open: 0, dr: 0, cr: 0, close: 0 }
  let stockOpen = 0
  let stockClose = 0
  let plOpening = 0
  let income = 0
  let expense = 0

  for (const t of tb) {
    const c = t.code
    if (t.type === 'income' || t.type === 'expense') {
      plOpening += t.opening
      if (t.type === 'income') {
        const v = t.credit - t.debit
        income += v
        if (!INCOME_ROW[c]) unmapped.push(c)
        add(INCOME_ROW[c] ?? 159, v)
      } else {
        const v = t.debit - t.credit
        expense += v
        if (c === '6000') continue // goes through 3.9 below
        if (!EXPENSE_ROW[c]) unmapped.push(c)
        add(EXPENSE_ROW[c] ?? 199, v)
        if (c === '6200' || c === '6210') add(c === '6200' ? 183 : 184, v) // 3.10.1.1
      }
      continue
    }
    const v = bal(t)
    if (t.type === 'asset') {
      if (c.startsWith('229')) ppeDep = { open: ppeDep.open - t.opening, dr: ppeDep.dr + t.debit, cr: ppeDep.cr + t.credit, close: ppeDep.close - t.closing }
      else if (c.startsWith('2')) ppeCost = { open: ppeCost.open + t.opening, dr: ppeCost.dr + t.debit, cr: ppeCost.cr + t.credit, close: ppeCost.close + t.closing }
      else if (c === '1010') v >= 0 ? add(30, v) : add(105, -v)
      else if (c.startsWith('10')) v >= 0 ? add(31, v) : add(105, -v)
      else if (c.startsWith('12')) add(c === '1200' ? 49 : 54, v)
      else if (c.startsWith('13')) {
        add(75, v)
        stockOpen += t.opening
        stockClose += t.closing
      } else if (c === '1600') add(63, v)
      else if (c.startsWith('14')) add(64, v)
      else {
        unmapped.push(c)
        add(54, v)
      }
    } else if (t.type === 'liability') {
      if (c.startsWith('31')) add(145, v)
      else if (c.startsWith('32')) add(98, v)
      else if (c.startsWith('34')) add(110, v)
      else if (c.startsWith('35')) add(112, v)
      else if (c.startsWith('36') || c === '3790') v >= 0 ? add(108, v) : add(63, -v) // a VAT credit is an asset (prepaid VAT)
      else if (c.startsWith('37')) add(109, v)
      else {
        unmapped.push(c)
        add(115, v)
      }
    } else {
      // equity: capital, the rest is retained earnings carried into the year
      add(c === '4000' ? 85 : 86, v)
    }
  }

  const result = r2(income - expense)
  add(86, -plOpening) // results of earlier years not yet closed into equity
  add(87, result)
  // 3.9 cost of goods sold: opening stock + purchases − closing stock = the expense of account 6000
  const cogs = r2(tb.filter((t) => t.code === '6000').reduce((s, t) => s + t.debit - t.credit, 0))
  n[168] = r2(stockOpen)
  n[171] = r2(stockClose)
  n[172] = cogs
  n[169] = r2(cogs - stockOpen + stockClose)
  n[170] = r2(n[168] + n[169])
  // totals of the notes (written as values, as the sheet has no formulas there)
  const sum = (rows: number[]) => r2(rows.reduce((s, r) => s + (n[r] ?? 0), 0))
  n[33] = sum([30, 31, 32])
  n[66] = sum([62, 63, 64])
  n[50] = n[66]
  n[55] = sum([49, 50, 51, 52, 53, 54])
  n[77] = sum([73, 74, 75, 76])
  n[90] = r2((n[85] ?? 0) + (n[86] ?? 0) + (n[87] ?? 0) - (n[88] ?? 0) + (n[89] ?? 0))
  n[102] = sum([98, 99, 100, 101])
  n[150] = sum([145, 146, 147, 148, 149])
  // suppliers stay only in note 3.8: B-Gj counts them from C150 (D34) and the rest of 3.7 from C116 (D40)
  n[116] = sum([105, 106, 107, 108, 109, 110, 111, 112, 113, 115])
  n[118] = r2(n[102] + n[116])
  n[160] = sum([157, 158, 159])
  n[200] = sum([191, 192, 193, 194, 195, 196, 197, 198, 199])
  n[220] = sum([208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219])
  n[229] = sum([226, 227, 228])

  const ppe: PpeNote = {
    6: r2(ppeCost.open),
    7: r2(ppeCost.dr),
    10: r2(ppeCost.cr),
    11: r2(ppeCost.close),
    14: r2(ppeDep.open),
    15: r2(ppeDep.cr),
    17: r2(ppeDep.dr),
    18: r2(ppeDep.close),
    21: r2(ppeCost.close - ppeDep.close),
  }
  // the balance sheet as B-Gj builds it, to say before downloading whether it balances (G57 of the template)
  const assets = r2((n[33] ?? 0) + (n[55] ?? 0) - (n[50] ?? 0) + (n[77] ?? 0) + (n[66] ?? 0) + ppe[21])
  const liabEq = r2((n[116] ?? 0) + (n[150] ?? 0) + (n[102] ?? 0) + (n[85] ?? 0) + (n[86] ?? 0) + (n[87] ?? 0) - (n[88] ?? 0) + (n[89] ?? 0))
  return { notes: n, ppe, result, check: r2(assets - liabEq), unmapped: [...new Set(unmapped)] }
}

// --- xlsx cell writing -------------------------------------------------------
const colNum = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0)

/** Sets a cell keeping its style; adds the cell (and the row) in column order when the template has none. */
export function setCell(xml: string, ref: string, value: number | string | null): string {
  const content = value == null || value === '' ? '' : typeof value === 'number' ? `<v>${value}</v>` : `<is><t xml:space="preserve">${esc(value)}</t></is>`
  const typ = typeof value === 'string' && value !== '' ? ' t="inlineStr"' : ''
  const re = new RegExp(`<c r="${ref}"((?:\\s+(?!t=)[\\w:]+="[^"]*")*)(?:\\s+t="[^"]*")?((?:\\s+[\\w:]+="[^"]*")*)\\s*(?:/>|>[\\s\\S]*?</c>)`)
  if (re.test(xml)) return xml.replace(re, (_m, a: string, b: string) => (content ? `<c r="${ref}"${a}${b}${typ}>${content}</c>` : `<c r="${ref}"${a}${b}/>`))
  if (!content) return xml
  const row = ref.replace(/[A-Z]+/, '')
  const cell = `<c r="${ref}"${typ}>${content}</c>`
  const rowRe = new RegExp(`<row r="${row}"[^>]*?(?:/>|>([\\s\\S]*?)</row>)`)
  const m = rowRe.exec(xml)
  if (m) {
    const open = m[0].endsWith('/>') ? m[0].slice(0, -2) + '>' : m[0].slice(0, m[0].indexOf('>') + 1)
    const cells = m[1] ?? ''
    const parts = [...cells.matchAll(/<c r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)]
    const after = parts.find((p) => colNum(p[1]) > colNum(ref))
    const body = after ? cells.slice(0, after.index) + cell + cells.slice(after.index) : cells + cell
    return xml.replace(m[0], `${open}${body}</row>`)
  }
  const rows = [...xml.matchAll(/<row r="(\d+)"/g)]
  const next = rows.find((r) => Number(r[1]) > Number(row))
  const rowXml = `<row r="${row}">${cell}</row>`
  return next ? xml.slice(0, next.index) + rowXml + xml.slice(next.index) : xml.replace('</sheetData>', `${rowXml}</sheetData>`)
}

export interface StatementsInput {
  company: string
  nui: string | null
  address: string
  year: number
  current: TbLine[]
  previous: TbLine[]
}

/** Sheet file of each sheet name, from the workbook. */
function sheetFiles(files: Record<string, Uint8Array>): Record<string, string> {
  const wb = strFromU8(files['xl/workbook.xml'])
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'])
  const out: Record<string, string> = {}
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const t = new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`).exec(rels) ?? new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`).exec(rels)
    if (t) out[m[1].trim()] = `xl/${t[1].replace(/^\/?xl\//, '')}`
  }
  return out
}

export function fillStatements(template: Uint8Array, d: StatementsInput) {
  const files = unzipSync(template)
  const sheets = sheetFiles(files)
  const cur = ksrfNotes(d.current)
  const prev = ksrfNotes(d.previous)
  const Y = d.year
  const edit = (name: string, fn: (xml: string) => string) => {
    const p = sheets[name]
    if (!p) throw new Error(`Fleta "${name}" mungon në shabllon`)
    files[p] = strToU8(fn(strFromU8(files[p])))
  }

  // the company and the years
  let ss = strFromU8(files['xl/sharedStrings.xml'])
  ss = ss.replace('{{company}}', esc(d.company)).replace('{{nui}}', esc(d.nui ?? '')).replace('{{address}}', esc(d.address))
  ss = ss.replace(/(janar|dhjetor) (20\d\d)/g, (_, m: string, y: string) => `${m} ${y === '2024' ? Y : y === '2023' ? Y - 1 : y}`)
  files['xl/sharedStrings.xml'] = strToU8(ss)
  edit('B-Gj', (x) => {
    x = setCell(x, 'B7', `më 31 dhjetor ${Y}`)
    x = setCell(x, 'D8', Y)
    x = setCell(x, 'E8', Y - 1)
    // the figures the template had typed for the year before
    x = setCell(x, 'E14', r2((prev.notes[55] ?? 0) - (prev.notes[50] ?? 0)))
    x = setCell(x, 'E16', prev.notes[66] ?? 0)
    x = setCell(x, 'E22', prev.ppe[21])
    x = setCell(x, 'E37', prev.notes[109] ?? 0)
    x = setCell(x, 'G56', Y)
    x = setCell(x, 'H56', Y - 1)
    return x
  })
  edit('P-A', (x) => {
    x = setCell(x, 'B4', `për vitin që përfundon më 31 dhjetor ${Y}`)
    x = setCell(x, 'D5', `Viti ${Y}`)
    return setCell(x, 'E5', `Viti ${Y - 1}`)
  })
  edit('Prr-P', (x) => {
    x = setCell(x, 'D3', Y)
    x = setCell(x, 'E3', Y - 1)
    x = setCell(x, 'H43', Y - 1)
    return setCell(x, 'I43', Y - 2)
  })
  edit('Shpalosje', (x) => {
    for (const [row, v] of Object.entries(cur.notes)) x = setCell(x, `C${row}`, v)
    for (const [row, v] of Object.entries(prev.notes)) x = setCell(x, `D${row}`, v)
    for (const [row, v] of Object.entries(cur.ppe)) x = setCell(x, `G${row}`, v)
    return x
  })
  return { bytes: zipSync(files, { level: 9 }), current: cur, previous: prev }
}
