// ATK VAT return – form TV-A7 (corrected 01.09.2015) – and the sales / purchase books for EDI.
// The server computes the boxes from the documents of the month (acc_vat_form); the accountant may
// add amounts to any base box (bad debts, adjustments, imports…). VAT of an added base = base × rate.
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'

export type Boxes = Record<string, number>

export interface VatFormData {
  month: string
  kasa: boolean
  client: { name: string; nui: string | null; fiscal_number: string | null; vat_number: string | null; address: string; phone: string | null; vat_registered: boolean }
  computed: Boxes
  carry_prev: number
  prev_status: 'draft' | 'filed' | null
  saved: null | {
    manual: Boxes
    boxes: Boxes
    status: 'draft' | 'filed'
    filed_at: string | null
    reference: string | null
    paid_at: string | null
    paid_amount: number | null
    note: string | null
    updated_at: string
  }
}

/** One line of the form: base box, its VAT box and rate (when it has one). */
export interface FormLine {
  box: string
  label: string
  vat?: string
  rate?: number
  /** Accountant may add to it (adjustments, imports, bad debts…). */
  manual?: boolean
}

export const OUTPUTS: FormLine[] = [
  { box: '9', label: 'Shitjet e liruara pa të drejtë kreditimi', manual: true },
  { box: '10a', label: 'Shitjet e shërbimeve jashtë vendit', manual: true },
  { box: '10b', label: 'Shitjet brenda vendit me ngarkesë të kundërt', manual: true },
  { box: '10c', label: 'Shitjet tjera të liruara me të drejtë kreditimi', manual: true },
  { box: '11', label: 'Eksportet', manual: true },
  { box: '12', label: 'Shitjet e tatueshme me normën 18%', vat: '13', rate: 0.18, manual: true },
  { box: '14', label: 'Shitjet e tatueshme me normën 8%', vat: '15', rate: 0.08, manual: true },
  { box: '16', label: 'Nota debitore e lëshuar, nota kreditore e pranuar me normë 18%', vat: '17', rate: 0.18, manual: true },
  { box: '18', label: 'Nota debitore e lëshuar, nota kreditore e pranuar me normë 8%', vat: '19', rate: 0.08, manual: true },
  { box: '20', label: 'Fatura e borxhit të keq e pranuar, inkasimi i B.K. me normë 18%', vat: '21', rate: 0.18, manual: true },
  { box: '22', label: 'Fatura e borxhit të keq e pranuar, inkasimi i B.K. me normë 8%', vat: '23', rate: 0.08, manual: true },
  { box: '24', label: 'Rregullimet për të rritur TVSH-në me normë 18%', vat: '25', rate: 0.18, manual: true },
  { box: '26', label: 'Rregullimet për të rritur TVSH-në me normë 8%', vat: '27', rate: 0.08, manual: true },
  { box: '28', label: 'Blerjet që i nënshtrohen ngarkesës së kundërt', vat: '29', rate: 0.18, manual: true },
]

export const INPUTS: FormLine[] = [
  { box: '31', label: 'Blerjet dhe importet pa TVSH', manual: true },
  { box: '32', label: 'Blerjet dhe importet investive pa TVSH', manual: true },
  { box: '33', label: 'Blerjet dhe importet me TVSH jo të zbritshme', manual: true },
  { box: '34', label: 'Blerjet dhe importet investive me TVSH jo të zbritshme', manual: true },
  { box: '35', label: 'Importet me normë 18%', vat: '36', rate: 0.18, manual: true },
  { box: '37', label: 'Importet me normë 8%', vat: '38', rate: 0.08, manual: true },
  { box: '39', label: 'Importet investive me normë 18%', vat: '40', rate: 0.18, manual: true },
  { box: '41', label: 'Importet investive me normë 8%', vat: '42', rate: 0.08, manual: true },
  { box: '43', label: 'Blerjet vendore me normë 18%', vat: '44', rate: 0.18, manual: true },
  { box: '45', label: 'Blerjet vendore me normë 8%', vat: '46', rate: 0.08, manual: true },
  { box: '47', label: 'Blerjet investive vendore me normë 18%', vat: '48', rate: 0.18, manual: true },
  { box: '49', label: 'Blerjet investive vendore me normë 8%', vat: '50', rate: 0.08, manual: true },
  { box: '51', label: 'Blerjet nga fermerët vendorë me normë 8%', vat: '52', rate: 0.08, manual: true },
  { box: '53', label: 'Nota debitore e pranuar, nota kreditore e lëshuar me normë 18%', vat: '54', rate: 0.18, manual: true },
  { box: '55', label: 'Nota debitore e pranuar, nota kreditore e lëshuar me normë 8%', vat: '56', rate: 0.08, manual: true },
  { box: '57', label: 'Fatura e borxhit të keq e lëshuar, pagesa e borxhit të keq me normë 18%', vat: '58', rate: 0.18, manual: true },
  { box: '59', label: 'Fatura e borxhit të keq e lëshuar, pagesa e borxhit të keq me normë 8%', vat: '60', rate: 0.08, manual: true },
  { box: '61', label: 'Rregullimet për të ulur TVSH-në me normë 18%', vat: '62', rate: 0.18, manual: true },
  { box: '63', label: 'Rregullimet për të ulur TVSH-në me normë 8%', vat: '64', rate: 0.08, manual: true },
  { box: '65', label: 'E drejta e kreditimit të TVSH-së në lidhje me ngarkesën e kundërt me normë 18%', vat: '66', rate: 0.18, manual: true },
]

const OUT_VAT = ['13', '15', '17', '19', '21', '23', '25', '27', '29']
const IN_VAT = ['36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64', '66']
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Final boxes: computed + manual bases (VAT of the manual part = base × rate) and the calculation [30]–[72]. */
export function finalBoxes(computed: Boxes, manual: Boxes, carry68: number, refund70: number): Boxes {
  const out: Boxes = {}
  for (const l of [...OUTPUTS, ...INPUTS]) {
    const add = manual[l.box] ?? 0
    out[l.box] = r2((computed[l.box] ?? 0) + add)
    if (l.vat) out[l.vat] = r2((computed[l.vat] ?? 0) + (l.rate ? add * l.rate : 0))
  }
  out['10'] = r2(out['10a'] + out['10b'] + out['10c'])
  out['30'] = r2(OUT_VAT.reduce((s, b) => s + (out[b] ?? 0), 0))
  out['67'] = r2(IN_VAT.reduce((s, b) => s + (out[b] ?? 0), 0))
  out['68'] = r2(carry68)
  out['69'] = r2(Math.max(0, out['67'] + out['68'] - out['30']))
  out['70'] = r2(Math.min(Math.max(0, refund70), out['69']))
  out['71'] = r2(out['69'] - out['70'])
  out['72'] = r2(Math.max(0, out['30'] - out['67'] - out['68']))
  return out
}

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}

const numMap = (o: unknown): Boxes => Object.fromEntries(Object.entries((o as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v) || 0]))

export async function fetchVatForm(clientId: string, month: string): Promise<VatFormData> {
  const { data, error } = await supabase.rpc('acc_vat_form', { p_client: clientId, p_month: month })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const s = r.saved as Record<string, unknown> | null
  return {
    ...(r as unknown as VatFormData),
    month: String(r.month).slice(0, 10),
    computed: numMap(r.computed),
    carry_prev: Number(r.carry_prev) || 0,
    saved: s ? { ...(s as unknown as NonNullable<VatFormData['saved']>), manual: numMap(s.manual), boxes: numMap(s.boxes), paid_amount: s.paid_amount == null ? null : Number(s.paid_amount) } : null,
  }
}

export async function saveVatReturn(p: {
  client_id: string
  month: string
  computed: Boxes
  manual: Boxes
  boxes: Boxes
  status: 'draft' | 'filed'
  filed_at?: string | null
  reference?: string | null
  paid_at?: string | null
  paid_amount?: number | null
  note?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('acc_save_vat_return', { p })
  if (error) fail(error)
}

export async function setVatFlag(docId: string, flag: VatFlag): Promise<void> {
  const { error } = await supabase.rpc('acc_set_vat_flag', { p_doc: docId, p_flag: flag })
  if (error) fail(error)
}

export type VatFlag = 'none' | 'service_abroad' | 'reverse_charge' | 'exempt_credit' | 'import' | 'farmer'
export const VAT_FLAG_LABELS: Record<VatFlag, string> = {
  none: 'E zakonshme',
  service_abroad: 'Shërbim jashtë vendit [10a]',
  reverse_charge: 'Ngarkesë e kundërt [10b] / [28]',
  exempt_credit: 'E liruar me të drejtë kreditimi [10c]',
  import: 'Import [35]–[42]',
  farmer: 'Nga fermerët vendorë [51]',
}

// ---------------------------------------------------------------------------
// Books for EDI: one row per document with the box columns
// ---------------------------------------------------------------------------
export interface BookRow {
  date: string
  doc_no: string | null
  partner: string
  nui: string
  vat_no: string
  doc_type: 'invoice' | 'credit_note' | 'debit_note'
  vat_flag: VatFlag
  asset: boolean
  export: boolean
  net_e: number
  vat_e: number
  net_d: number
  vat_d: number
  amt_c: number
  amt_a: number
  vat_nd: number
  total: number
}

export async function fetchVatBook(clientId: string, month: string, kind: 'sale' | 'purchase'): Promise<BookRow[]> {
  const { data, error } = await supabase.rpc('acc_vat_book', { p_client: clientId, p_month: month, p_kind: kind })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((x) => {
    const row = x as unknown as BookRow
    for (const k of ['net_e', 'vat_e', 'net_d', 'vat_d', 'amt_c', 'amt_a', 'vat_nd', 'total'] as const) row[k] = Number(x[k]) || 0
    return row
  })
}

export const SALES_BOOK_COLUMNS = ['Data', 'Numri i faturës', 'Emri i blerësit', 'NUI / NF', 'Nr. TVSH', '[9]', '[10a]', '[10b]', '[10c]', '[10]', '[11]', '[12]', '[16]', '[20]', '[24]', '[28]', '[K1]', '[14]', '[18]', '[22]', '[26]', '[K2]', '[30]']
export const PURCHASE_BOOK_COLUMNS = ['Data', 'Numri i faturës', 'Emri i shitësit', 'NUI / NF', 'Nr. TVSH', '[31]', '[32]', '[33]', '[34]', '[35]', '[37]', '[39]', '[41]', '[43]', '[45]', '[47]', '[49]', '[51]', '[53]', '[55]', '[65]', '[TVSH e zbritshme]']

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

/** Sales book row in the ATK column order. */
export function salesBookRow(r: BookRow): (string | number | null)[] {
  const inv = r.doc_type === 'invoice'
  const debit = r.doc_type === 'debit_note'
  const z = (v: number) => (v ? r2(Math.abs(v)) : null)
  const c10a = inv && !r.export && r.vat_flag === 'service_abroad' ? r.amt_c : 0
  const c10b = inv && !r.export && r.vat_flag === 'reverse_charge' ? r.amt_c : 0
  const c10c = inv && !r.export && !['service_abroad', 'reverse_charge'].includes(r.vat_flag) ? r.amt_c : 0
  const b12 = inv ? r.net_e : 0
  const b14 = inv ? r.net_d : 0
  const b16 = debit ? r.net_e : 0
  const b18 = debit ? r.net_d : 0
  const k1 = (inv || debit ? r.vat_e : 0)
  const k2 = (inv || debit ? r.vat_d : 0)
  return [
    ddmmyyyy(r.date), r.doc_no ?? '', r.partner, r.nui, r.vat_no,
    z(inv ? r.amt_a : 0), z(c10a), z(c10b), z(c10c), z(c10a + c10b + c10c), z(inv && r.export ? r.amt_c : 0),
    z(b12), z(b16), null, null, null, z(k1), z(b14), z(b18), null, null, z(k2), z(k1 + k2),
  ]
}

/** Purchase book row in the ATK column order (credit notes received belong to the sales side [16]/[18]). */
export function purchaseBookRow(r: BookRow): (string | number | null)[] {
  const inv = r.doc_type === 'invoice'
  const debit = r.doc_type === 'debit_note'
  const z = (v: number) => (v ? r2(Math.abs(v)) : null)
  const nd = r.vat_nd !== 0
  const rc = r.vat_flag === 'reverse_charge'
  const imp = r.vat_flag === 'import'
  const dom = inv && !nd && !rc && !imp && r.vat_flag !== 'farmer'
  const free = inv && !rc && !imp ? r.amt_c + r.amt_a : 0
  const ded = (dom || (inv && imp && !nd) || (inv && r.vat_flag === 'farmer') || debit) ? r.vat_e + r.vat_d : 0
  const rcBase = inv && rc ? r.net_e + r.net_d + r.amt_c + r.amt_a : 0
  return [
    ddmmyyyy(r.date), r.doc_no ?? '', r.partner, r.nui, r.vat_no,
    z(!r.asset ? free : 0), z(r.asset ? free : 0),
    z(inv && nd && !r.asset ? r.net_e + r.net_d : 0), z(inv && nd && r.asset ? r.net_e + r.net_d : 0),
    z(inv && imp && !nd && !r.asset ? r.net_e : 0), z(inv && imp && !nd && !r.asset ? r.net_d : 0),
    z(inv && imp && !nd && r.asset ? r.net_e : 0), z(inv && imp && !nd && r.asset ? r.net_d : 0),
    z(dom && !r.asset ? r.net_e : 0), z(dom && !r.asset ? r.net_d : 0),
    z(dom && r.asset ? r.net_e : 0), z(dom && r.asset ? r.net_d : 0),
    z(inv && r.vat_flag === 'farmer' && !nd ? r.net_d : 0),
    z(debit ? r.net_e : 0), z(debit ? r.net_d : 0),
    z(rcBase), z(ded + rcBase * 0.18),
  ]
}

// ---------------------------------------------------------------------------
// Other taxes and the calendar
// ---------------------------------------------------------------------------
export type TaxRegime = 'corporate' | 'individual_real' | 'individual_small_3' | 'individual_small_9'
export const REGIME_LABELS: Record<TaxRegime, string> = {
  corporate: 'Tatimi në fitimin e korporatave – 10% e fitimit',
  individual_real: 'Biznes individual – të ardhura reale (0 / 4 / 8 / 10%)',
  individual_small_3: 'Biznes i vogël – 3% e qarkullimit (tregti, transport, bujqësi)',
  individual_small_9: 'Biznes i vogël – 9% e qarkullimit (shërbime, profesione)',
}

/** Personal income tax brackets (annual): 0–960 0%, 960–3,000 4%, 3,000–5,400 8%, over 5,400 10%. */
export function personalIncomeTax(annual: number): number {
  const x = Math.max(0, annual)
  return r2(Math.max(0, Math.min(x, 3000) - 960) * 0.04 + Math.max(0, Math.min(x, 5400) - 3000) * 0.08 + Math.max(0, x - 5400) * 0.1)
}

/** Income tax estimate for one quarter. */
export function quarterTax(regime: TaxRegime, turnover: number, costs: number): number {
  const profit = turnover - costs
  switch (regime) {
    case 'corporate':
      return r2(Math.max(0, profit) * 0.1)
    case 'individual_small_3':
      return r2(Math.max(0, turnover) * 0.03)
    case 'individual_small_9':
      return r2(Math.max(0, turnover) * 0.09)
    default:
      return r2(personalIncomeTax(profit * 4) / 4)
  }
}

export type FilingKind = 'rent' | 'payroll' | 'income_q' | 'income_annual' | 'withholding' | 'other'
export const FILING_LABELS: Record<FilingKind | 'vat', string> = {
  vat: 'Deklarata e TVSH-së',
  rent: 'Tatimi në qira (9%)',
  payroll: 'Pagat dhe kontributet',
  income_q: 'Tatimi tremujor në të ardhura',
  income_annual: 'Deklarata vjetore e tatimit',
  withholding: 'Tatimi në burim',
  other: 'Tjetër',
}

export interface Filing {
  id: string
  kind: FilingKind
  period: string
  amount: number
  status: 'draft' | 'filed' | 'paid'
  filed_at: string | null
  paid_at: string | null
  reference: string | null
  note: string | null
}

export interface TaxOverview {
  regime: TaxRegime
  vat_registered: boolean
  rent: { month: string; gross: number; docs: number }[]
  quarters: { q: number; turnover: number; costs: number }[]
  sales_12m: number
  filings: Filing[]
}

export async function fetchTaxOverview(clientId: string, year: number): Promise<TaxOverview> {
  const { data, error } = await supabase.rpc('acc_tax_overview', { p_client: clientId, p_year: year })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  return {
    regime: r.regime as TaxRegime,
    vat_registered: Boolean(r.vat_registered),
    rent: ((r.rent as Record<string, unknown>[]) ?? []).map((x) => ({ month: String(x.month).slice(0, 10), gross: Number(x.gross) || 0, docs: Number(x.docs) || 0 })),
    quarters: ((r.quarters as Record<string, unknown>[]) ?? []).map((x) => ({ q: Number(x.q), turnover: Number(x.turnover) || 0, costs: Number(x.costs) || 0 })),
    sales_12m: Number(r.sales_12m) || 0,
    filings: ((r.filings as Record<string, unknown>[]) ?? []).map((f) => ({ ...(f as unknown as Filing), period: String(f.period).slice(0, 10), amount: Number(f.amount) || 0 })),
  }
}

export async function setTaxRegime(clientId: string, regime: TaxRegime): Promise<void> {
  const { error } = await supabase.rpc('acc_set_tax_regime', { p_client: clientId, p_regime: regime })
  if (error) fail(error)
}

export async function saveFiling(clientId: string, f: Partial<Filing> & { kind: FilingKind; period: string }): Promise<void> {
  const { error } = await supabase.rpc('acc_save_tax_filing', { p: { ...f, client_id: clientId } })
  if (error) fail(error)
}

export async function deleteFiling(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_tax_filing', { p_id: id })
  if (error) fail(error)
}

export interface Deadline {
  client_id: string
  client: string
  kind: FilingKind | 'vat'
  period: string
  due: string
  status: 'open' | 'draft' | 'filed' | 'paid'
  amount: number | null
}

export async function fetchCalendar(from: string, to: string): Promise<Deadline[]> {
  const { data, error } = await supabase.rpc('acc_tax_calendar', { p_from: from, p_to: to })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) return []
    fail(error)
  }
  return ((data as Record<string, unknown>[]) ?? []).map((d) => ({
    ...(d as unknown as Deadline),
    period: String(d.period).slice(0, 10),
    due: String(d.due).slice(0, 10),
    amount: d.amount == null ? null : Number(d.amount),
  }))
}
