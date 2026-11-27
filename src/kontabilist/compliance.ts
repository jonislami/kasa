// ATK compliance checks that run before anything is filed or exported. Pure (no database / browser imports),
// so scripts/compliance-selftest.ts can test it.
//
// Every rate, threshold and deadline below is from the ATK page "General Information on Taxes in Kosovo"
// (atk-ks.org/en/portfolio/informata-te-pergjithshme-per-tatimet-ne-kosove/, read 27.11.2026) and, for the report of
// purchases over 500 €, the ATK notice "Raportimi i blerjeve mbi 500 €" (21.03.2019). See docs/kontabilisti-analiza.md.

import type { BookDoc } from './atkBooks'
import type { TaxRegime } from './vat'

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

export const ATK_RULES = {
  source: 'ATK – General Information on Taxes in Kosovo (Ligji 05/L-028 me ndryshimin 08/L-142, 06/L-105, 05/L-037, 04/L-101)',
  vatThreshold: 30000,
  /** Gross income up to which the 3% / 9% regime applies. */
  smallThreshold: { individual: 50000, corporate: 30000 },
  /** Annual personal income tax since 23.08.2024 (Law 08/L-142). */
  pitAnnual: [
    { upTo: 3000, rate: 0 },
    { upTo: 5400, rate: 0.08 },
    { upTo: Infinity, rate: 0.1 },
  ],
  wageMonthly: [
    { upTo: 250, rate: 0 },
    { upTo: 450, rate: 0.08 },
    { upTo: Infinity, rate: 0.1 },
  ],
  secondaryWageRate: 0.1,
  pensionMinPct: 5,
  rentWithholding: 0.09,
  rentTax: 0.1,
  purchases500: 500,
} as const

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------
export interface Issue {
  level: 'error' | 'warn' | 'info'
  /** Area of the program where it is fixed (a tab key of ClientPage). */
  tab?: string
  text: string
}

// ---------------------------------------------------------------------------
// Legal form and tax regime
// ---------------------------------------------------------------------------
export type LegalKind = 'individual' | 'corporate' | 'partnership' | 'other' | 'unknown'

/** Legal form as typed in the company data ("SH.P.K.", "B.I.", "Biznes individual", "OJQ"…). */
export function legalKind(form: string | null | undefined): LegalKind {
  const s = (form ?? '').toLowerCase().replace(/[\s.]/g, '')
  if (!s) return 'unknown'
  if (/^(bi|biznesindividual|individual|nisi)/.test(s) || s.includes('individual')) return 'individual'
  if (/^(shpk|sha|llc|doo|ad|shoqeri(me|aksionare))/.test(s) || s.includes('shpk') || s.includes('aksionare') || s.includes('kufizuar')) return 'corporate'
  if (/^(op|ok|ortakeri|partneritet)/.test(s) || s.includes('ortak')) return 'partnership'
  if (/^(ojq|ngo|institucion|komun)/.test(s)) return 'other'
  return 'unknown'
}

export interface RegimeInput {
  regime: TaxRegime
  legal_form: string | null | undefined
  vat_registered: boolean
  /** Sales of the last 12 months (acc_tax_overview.sales_12m). */
  sales_12m: number
}

export function regimeIssues(x: RegimeInput): Issue[] {
  const out: Issue[] = []
  const kind = legalKind(x.legal_form)
  const small = x.regime === 'individual_small_3' || x.regime === 'individual_small_9'
  if (kind === 'unknown') out.push({ level: 'warn', tab: 'klienti', text: 'Forma juridike nuk është plotësuar (SH.P.K., Biznes individual…): pa të nuk kontrollohet regjimi tatimor.' })
  if (kind === 'individual' && x.regime === 'corporate')
    out.push({ level: 'error', tab: 'tatimet', text: 'Biznes individual me regjimin e korporatave: biznesi individual tatohet me tatimin në të ardhurat personale (0/8/10% ose 3%/9%).' })
  if (kind === 'corporate' && x.regime === 'individual_real')
    out.push({ level: 'error', tab: 'tatimet', text: 'Shoqëri (SH.P.K./SH.A.) me regjimin e biznesit individual: korporata tatohet 10% të fitimit, ose 3%/9% kur të ardhurat bruto vjetore janë deri 30.000 €.' })
  if (small) {
    const limit = kind === 'corporate' ? ATK_RULES.smallThreshold.corporate : ATK_RULES.smallThreshold.individual
    if (x.sales_12m > limit)
      out.push({ level: 'error', tab: 'tatimet', text: `Qarkullimi i 12 muajve (${x.sales_12m.toFixed(2)} €) e kalon pragun ${limit.toLocaleString('de-DE')} € të regjimit 3%/9% – tatohet në të ardhurat reale.` })
    else if (x.sales_12m > limit * 0.85) out.push({ level: 'warn', tab: 'tatimet', text: `Qarkullimi i 12 muajve (${x.sales_12m.toFixed(2)} €) i afrohet pragut ${limit.toLocaleString('de-DE')} € të regjimit 3%/9%.` })
  }
  if (!x.vat_registered && x.sales_12m > ATK_RULES.vatThreshold)
    out.push({ level: 'error', tab: 'klienti', text: `Qarkullimi i 12 muajve (${x.sales_12m.toFixed(2)} €) e kalon 30.000 €: biznesi duhet të regjistrohet për TVSH.` })
  return out
}

/** Name of the quarterly form that ATK expects for the regime (IS / IL / QS / QL). */
export function quarterlyForm(regime: TaxRegime, legal: LegalKind): { code: string; label: string } {
  const small = regime === 'individual_small_3' || regime === 'individual_small_9'
  if (legal === 'corporate' || regime === 'corporate')
    return small ? { code: 'QS', label: 'Pagesa tremujore e tatimit për korporatat e vogla' } : { code: 'QL', label: 'Parapagimi tremujor për korporatat e mëdha' }
  return small ? { code: 'IS', label: 'Tatimi dhe kontributet tremujore për bizneset e vogla individuale' } : { code: 'IL', label: 'Parapagimi tremujor për bizneset e mëdha individuale' }
}

// ---------------------------------------------------------------------------
// Deadlines that the database calendar (acc_tax_calendar) does not list
// ---------------------------------------------------------------------------
export interface ExtraDeadline {
  code: string
  label: string
  period: string
  due: string
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * - LB / LSH quarterly (1st–15th of the month after the quarter) for persons outside VAT;
 * - RB, the report of purchases over 500 € (31 March) for real-income taxpayers;
 * - PF, the financial statements (31 March).
 */
export function extraDeadlines(x: { vat_registered: boolean; regime: TaxRegime }, from: string, to: string): ExtraDeadline[] {
  const out: ExtraDeadline[] = []
  const y0 = Number(from.slice(0, 4)) - 1
  const y1 = Number(to.slice(0, 4))
  const real = x.regime === 'corporate' || x.regime === 'individual_real'
  for (let y = y0; y <= y1; y++) {
    if (!x.vat_registered) {
      for (let q = 1; q <= 4; q++) {
        const dueY = q === 4 ? y + 1 : y
        const dueM = q === 4 ? 1 : q * 3 + 1
        out.push({ code: 'LB/LSH', label: `Libri i blerjes dhe i shitjes – TM${q} ${y}`, period: iso(y, (q - 1) * 3 + 1, 1), due: iso(dueY, dueM, 15) })
      }
    }
    if (real) out.push({ code: 'RB', label: `Raporti i blerjeve mbi 500 € – ${y}`, period: iso(y, 1, 1), due: iso(y + 1, 3, 31) })
    out.push({ code: 'PF', label: `Pasqyrat financiare – ${y}`, period: iso(y, 1, 1), due: iso(y + 1, 3, 31) })
  }
  return out.filter((d) => d.due >= from && d.due <= to).sort((a, b) => a.due.localeCompare(b.due))
}

// ---------------------------------------------------------------------------
// RB – purchases of 500 € or more from one taxable person within the tax year
// ---------------------------------------------------------------------------
export interface Rb500Row {
  nui: string
  name: string
  docs: number
  total: number
}

export function rbRequired(regime: TaxRegime, vatRegistered: boolean): { required: boolean; note: string } {
  if (regime !== 'corporate' && regime !== 'individual_real')
    return { required: false, note: 'Regjimi 3%/9% nuk tatohet në të ardhurat reale – raporti RB nuk kërkohet.' }
  if (vatRegistered)
    return { required: true, note: 'Deklaruesi i TVSH-së përjashtohet vetëm kur ka dorëzuar librin e blerjes dhe të shitjes për të 12 muajt e vitit me të gjitha transaksionet.' }
  return { required: true, note: 'Tatohet në të ardhurat reale: raporti dorëzohet deri më 31 mars të vitit pasues.' }
}

/** One row per supplier: total of the year's purchases (credit notes subtract); imports and foreign reverse charge are left out. */
export function buildRb500(docs: BookDoc[], year: number): { rows: Rb500Row[]; issues: Issue[] } {
  const by = new Map<string, Rb500Row & { names: Set<string> }>()
  for (const d of docs) {
    if (d.kind !== 'purchase' || d.source === 'kasa' || Number(d.date.slice(0, 4)) !== year) continue
    if (d.vat_flag === 'import' || d.vat_flag === 'reverse_charge' || d.vat_flag === 'service_abroad') continue
    const nui = (d.nui ?? '').replace(/\s/g, '')
    const name = d.partner.trim()
    const key = nui || `?${name.toLowerCase()}`
    const sign = d.doc_type === 'credit_note' ? -1 : 1
    const row = by.get(key) ?? { nui, name, docs: 0, total: 0, names: new Set<string>() }
    row.docs += 1
    row.total = r2(row.total + sign * Math.abs(d.total))
    row.names.add(name)
    by.set(key, row)
  }
  const rows: Rb500Row[] = []
  const issues: Issue[] = []
  for (const r of by.values()) {
    if (r.total < ATK_RULES.purchases500) continue
    rows.push({ nui: r.nui, name: r.name, docs: r.docs, total: r.total })
    if (!r.nui) issues.push({ level: 'error', tab: 'partneret', text: `${r.name}: ${r.total.toFixed(2)} € blerje pa numër fiskal / NUI – ATK nuk e identifikon furnitorin.` })
    else if (!/^\d{9}$/.test(r.nui) && !/^\d{10}$/.test(r.nui)) issues.push({ level: 'error', tab: 'partneret', text: `${r.name}: numri "${r.nui}" duhet të ketë 9 shifra (NUI / nr. fiskal) ose 10 (nr. personal).` })
    if (r.names.size > 1) issues.push({ level: 'warn', tab: 'partneret', text: `NUI ${r.nui}: i njëjti furnitor me emra të ndryshëm (${[...r.names].join(' / ')}).` })
  }
  rows.sort((a, b) => b.total - a.total)
  return { rows, issues }
}

// ---------------------------------------------------------------------------
// Payroll (WM/CM) before filing
// ---------------------------------------------------------------------------
export interface PayLineCheck {
  name: string
  personal_no: string | null
  primary_job: boolean
  gross: number
  emp_pct: number
  er_pct: number
  emp_contrib: number
  tax_base: number
  tax: number
  net: number
  payable: number
  iban: string | null
}

/** Same as acc_wage_tax in the database. */
export function wageTaxOf(base: number, primary: boolean): number {
  if (!primary) return r2(Math.max(base, 0) * ATK_RULES.secondaryWageRate)
  let tax = 0
  let lower = 0
  for (const b of ATK_RULES.wageMonthly) {
    tax += Math.max(0, Math.min(base, b.upTo) - lower) * b.rate
    lower = b.upTo
  }
  return r2(tax)
}

export function checkPayroll(lines: PayLineCheck[]): Issue[] {
  const out: Issue[] = []
  const seen = new Map<string, string>()
  for (const l of lines) {
    const who = l.name || '(pa emër)'
    const pn = (l.personal_no ?? '').trim()
    if (!/^\d{10}$/.test(pn)) out.push({ level: 'error', tab: 'punonjesit', text: `${who}: numri personal duhet të ketë 10 shifra – pa të ATK e refuzon listën WM/CM.` })
    else if (seen.has(pn)) out.push({ level: 'error', tab: 'punonjesit', text: `${who}: numri personal ${pn} është edhe te ${seen.get(pn)}.` })
    else seen.set(pn, who)
    if (l.gross <= 0) out.push({ level: 'warn', tab: 'pagat', text: `${who}: paga bruto është 0.` })
    if ((l.emp_pct > 0 || l.er_pct > 0) && (l.emp_pct < ATK_RULES.pensionMinPct || l.er_pct < ATK_RULES.pensionMinPct))
      out.push({ level: 'error', tab: 'punonjesit', text: `${who}: kontributi pensional nën 5% (${l.emp_pct}% + ${l.er_pct}%). Për shtetasit e Kosovës: 5% punëtori + 5% punëdhënësi.` })
    if (l.emp_pct === 0 && l.er_pct === 0) out.push({ level: 'warn', tab: 'punonjesit', text: `${who}: pa kontribute pensionale – vlen vetëm për të huajt ose personat e liruar me ligj.` })
    const tax = wageTaxOf(l.tax_base, l.primary_job)
    if (Math.abs(tax - l.tax) > 0.01) out.push({ level: 'error', tab: 'pagat', text: `${who}: tatimi ${l.tax.toFixed(2)} € nuk përputhet me shkallët e ATK-së (${tax.toFixed(2)} €). Përgatite listën përsëri.` })
    if (Math.abs(r2(l.gross - l.emp_contrib - l.tax) - l.net) > 0.01) out.push({ level: 'error', tab: 'pagat', text: `${who}: paga neto nuk është bruto − kontributi − tatimi.` })
    if (l.payable < 0) out.push({ level: 'error', tab: 'pagat', text: `${who}: avansi e kalon pagën neto (për pagesë ${l.payable.toFixed(2)} €).` })
    if (!l.iban?.trim() && l.payable > 0) out.push({ level: 'info', tab: 'punonjesit', text: `${who}: mungon IBAN-i – paga nuk mund të përfshihet në urdhërpagesën bankare.` })
  }
  return out
}

// ---------------------------------------------------------------------------
// VAT return against the books of the same month
// ---------------------------------------------------------------------------
/** Box [30] / [67] of a saved return against the totals of the sales / purchase book (VAT clients). */
export function vatVsBooks(saved: { boxes: Record<string, number>; status: string } | null, booksOut: number, booksIn: number, month: string): Issue[] {
  if (!saved) return [{ level: 'info', tab: 'tvsh', text: `Deklarata e TVSH-së për ${month} nuk është përgatitur ende.` }]
  const out: Issue[] = []
  const b30 = saved.boxes['30'] ?? 0
  const b67 = saved.boxes['67'] ?? 0
  // the form may hold manual corrections (bad debts, adjustments, imports from customs) that are not in the books
  if (Math.abs(b30 - booksOut) > 0.05)
    out.push({ level: 'warn', tab: 'tvsh', text: `TVSH e llogaritur: deklarata [30] ${b30.toFixed(2)} € ndërsa libri i shitjes ${booksOut.toFixed(2)} € – ndryshojnë ${(b30 - booksOut).toFixed(2)} €. Kontrollo shumat e shtuara me dorë.` })
  if (Math.abs(b67 - booksIn) > 0.05)
    out.push({ level: 'warn', tab: 'tvsh', text: `TVSH e zbritshme: deklarata [67] ${b67.toFixed(2)} € ndërsa libri i blerjes ${booksIn.toFixed(2)} € – ndryshojnë ${(b67 - booksIn).toFixed(2)} €. Kontrollo shumat e shtuara me dorë.` })
  return out
}
