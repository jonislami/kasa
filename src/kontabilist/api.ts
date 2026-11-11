import { supabase } from '@/lib/supabase'
import type { BusinessType } from '@/lib/business'
import type { VatCode } from '@/lib/vat'
import { AccountingNotMigrated, mergeVat, type DayRow, type ExpenseCategory, type Summary, type VatRow, type VatStatus } from '@/features/accounting/api'

const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883', '42703'])

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new AccountingNotMigrated()
  throw new Error(error.message)
}

const n = (v: unknown) => (v == null ? 0 : Number(v))

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export interface AccMe {
  is_accountant: boolean
  has_business: boolean
  accountant: { full_name: string; email: string; office_name: string | null; phone: string | null; active: boolean } | null
}

export async function fetchMe(): Promise<AccMe> {
  const { data, error } = await supabase.rpc('acc_me')
  if (error) fail(error)
  return data as AccMe
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
export type LinkStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'revoked'

export interface ClientRow {
  id: string
  name: string
  nui: string | null
  vat_number: string | null
  vat_registered: boolean
  city: string | null
  activity: string | null
  note: string | null
  active: boolean
  link_status: LinkStatus
  kasa_name: string | null
  kasa_type: BusinessType | null
  sales: number
  docs: number
  purchases: number
  vat_out: number
  vat_in: number
  corrections: number
  offline: number
  last_activity: string | null
  vat_status: VatStatus | 'na'
}

export async function fetchClients(month: string): Promise<ClientRow[]> {
  const { data, error } = await supabase.rpc('acc_clients_overview', { p_month: month })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((c) => ({
    ...(c as unknown as ClientRow),
    sales: n(c.sales),
    docs: n(c.docs),
    purchases: n(c.purchases),
    vat_out: n(c.vat_out),
    vat_in: n(c.vat_in),
    corrections: n(c.corrections),
    offline: n(c.offline),
  }))
}

export interface Client {
  id: string
  name: string
  legal_form?: string | null
  representative?: string | null
  registration_date?: string | null
  bank_name?: string | null
  iban?: string | null
  nui: string | null
  vat_number: string | null
  fiscal_number: string | null
  vat_registered: boolean
  activity: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  note: string | null
  active: boolean
  kasa_business_id: string | null
  link_status: LinkStatus
  link_requested_at: string | null
  link_responded_at: string | null
}

export type ClientInput = Pick<
  Client,
  'name' | 'nui' | 'vat_number' | 'fiscal_number' | 'vat_registered' | 'activity' | 'address' | 'city' | 'phone' | 'email' | 'note' | 'legal_form' | 'representative' | 'registration_date' | 'bank_name' | 'iban'
> & { id?: string; active?: boolean }

export async function saveClient(c: ClientInput): Promise<string> {
  const { data, error } = await supabase.rpc('acc_save_client', { p: c })
  if (error) fail(error)
  return data as string
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_client', { p_client: id })
  if (error) fail(error)
}

export async function requestLink(clientId: string, nui: string): Promise<void> {
  const { error } = await supabase.rpc('acc_request_link', { p_client: clientId, p_nui: nui })
  if (error) fail(error)
}

export async function cancelLink(clientId: string): Promise<void> {
  const { error } = await supabase.rpc('acc_cancel_link', { p_client: clientId })
  if (error) fail(error)
}

export async function setClientPeriod(clientId: string, month: string, status: VatStatus): Promise<void> {
  const { error } = await supabase.rpc('acc_set_period', { p_client: clientId, p_month: month, p_status: status })
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// Books of one client: the accountant's own documents (+ the Kasa books when linked)
// ---------------------------------------------------------------------------
interface Manual {
  sales: { gross: number; net: number; vat: number; docs: number }
  vat_out: VatRow[]
  purchases: Summary['purchases']
  vat_in: VatRow[]
  cogs: { gross: number; net: number }
  expenses: Summary['expenses']
  expense_categories: Summary['expense_categories']
  expense_vat: VatRow[]
  daily: { date: string; docs: number; gross: number; net: number; vat: number; rates: DayRow['rates'] }[]
}

export interface ClientBooks {
  client: Client
  /** Kasa part only (null when the client is not linked or access was taken away). */
  kasa: Summary | null
  /** Everything together, in the shape the shared book screens use. */
  summary: Summary
  /** Open amounts of the accountant's own invoices today (0016): customers owe / owed to suppliers. */
  receivable: number
  payable: number
}

function nums<T>(o: unknown): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries((o ?? {}) as Record<string, unknown>)) out[k] = typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v))) ? Number(v) : v
  return out as T
}
const vatRows = (v: unknown): VatRow[] => ((v as Record<string, unknown>[]) ?? []).map((x) => ({ code: x.code as VatCode, gross: n(x.gross), net: n(x.net), vat: n(x.vat) }))
const rates = (r: unknown): DayRow['rates'] =>
  Object.fromEntries(Object.entries((r ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) => [k, { gross: n(v.gross), net: n(v.net), vat: n(v.vat) }]))

function parseKasa(r: Record<string, unknown>): Summary {
  const sales = r.sales as Record<string, unknown>
  return {
    from: r.from as string,
    to: r.to as string,
    business: r.business as Summary['business'],
    sales: { ...nums<Summary['sales']>(sales), first_no: sales.first_no == null ? null : n(sales.first_no), last_no: sales.last_no == null ? null : n(sales.last_no) },
    vat_out: vatRows(r.vat_out),
    purchases: nums(r.purchases),
    vat_in: vatRows(r.vat_in),
    expenses: nums(r.expenses),
    expense_categories: ((r.expense_categories as Record<string, unknown>[]) ?? []).map((x) => ({ category: x.category as ExpenseCategory, gross: n(x.gross), net: n(x.net), vat: n(x.vat) })),
    expense_vat: vatRows(r.expense_vat),
    cogs: nums(r.cogs),
    stock: nums(r.stock),
    adjustments: nums(r.adjustments),
    daily: ((r.daily as Record<string, unknown>[]) ?? []).map((d) => ({
      date: String(d.date).slice(0, 10),
      docs: n(d.docs),
      corrections: n(d.corrections),
      first_no: n(d.first_no),
      last_no: n(d.last_no),
      gross: n(d.gross),
      net: n(d.net),
      vat: n(d.vat),
      cash: n(d.cash),
      card: n(d.card),
      rates: rates(d.rates),
    })),
    shifts: ((r.shifts as Record<string, unknown>[]) ?? []).map((s) => ({
      id: s.id as string,
      started_at: s.started_at as string,
      ended_at: (s.ended_at as string) ?? null,
      register: (s.register as string) ?? null,
      worker: null,
      opening: n(s.opening),
      counted: s.counted == null ? null : n(s.counted),
      cash_sales: n(s.cash_sales),
      card_sales: n(s.card_sales),
      docs: n(s.docs),
    })),
    registers: (r.registers as Summary['registers']) ?? [],
    periods: [],
  }
}

function addRates(a: DayRow['rates'], b: DayRow['rates']): DayRow['rates'] {
  const out: DayRow['rates'] = { ...a }
  for (const [k, v] of Object.entries(b) as [VatCode, { gross: number; net: number; vat: number }][]) {
    const cur = out[k] ?? { gross: 0, net: 0, vat: 0 }
    out[k] = { gross: cur.gross + v.gross, net: cur.net + v.net, vat: cur.vat + v.vat }
  }
  return out
}

function mergeCategories(a: Summary['expense_categories'], b: Summary['expense_categories']): Summary['expense_categories'] {
  const map = new Map<ExpenseCategory, Summary['expense_categories'][number]>()
  for (const x of [...a, ...b]) {
    const cur = map.get(x.category) ?? { category: x.category, gross: 0, net: 0, vat: 0 }
    map.set(x.category, { category: x.category, gross: cur.gross + x.gross, net: cur.net + x.net, vat: cur.vat + x.vat })
  }
  return [...map.values()].sort((x, y) => y.gross - x.gross)
}

const EMPTY_SALES: Summary['sales'] = { gross: 0, net: 0, vat: 0, docs: 0, voids: 0, void_total: 0, refunds: 0, refund_total: 0, cash: 0, card: 0, discounts: 0, offline: 0, first_no: null, last_no: null }

export async function fetchClientBooks(clientId: string, from: string, to: string): Promise<ClientBooks> {
  const { data, error } = await supabase.rpc('acc_client_books', { p_client: clientId, p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const client = r.client as Client
  const m = r.manual as Record<string, unknown>
  const manual: Manual = {
    sales: nums(m.sales),
    vat_out: vatRows(m.vat_out),
    purchases: nums(m.purchases),
    vat_in: vatRows(m.vat_in),
    cogs: nums(m.cogs),
    expenses: nums(m.expenses),
    expense_categories: ((m.expense_categories as Record<string, unknown>[]) ?? []).map((x) => ({ category: x.category as ExpenseCategory, gross: n(x.gross), net: n(x.net), vat: n(x.vat) })),
    expense_vat: vatRows(m.expense_vat),
    daily: ((m.daily as Record<string, unknown>[]) ?? []).map((d) => ({ date: String(d.date).slice(0, 10), docs: n(d.docs), gross: n(d.gross), net: n(d.net), vat: n(d.vat), rates: rates(d.rates) })),
  }
  const kasa = r.kasa ? parseKasa(r.kasa as Record<string, unknown>) : null

  // Daily sales book: the till's days plus the accountant's sales invoices.
  const days = new Map<string, DayRow>()
  for (const d of kasa?.daily ?? []) days.set(d.date, { ...d })
  for (const d of manual.daily) {
    const cur = days.get(d.date) ?? { date: d.date, docs: 0, corrections: 0, first_no: 0, last_no: 0, gross: 0, net: 0, vat: 0, cash: 0, card: 0, rates: {} }
    days.set(d.date, { ...cur, docs: cur.docs + d.docs, gross: cur.gross + d.gross, net: cur.net + d.net, vat: cur.vat + d.vat, rates: addRates(cur.rates, d.rates) })
  }

  const ks = kasa?.sales ?? EMPTY_SALES
  const summary: Summary = {
    from: r.from as string,
    to: r.to as string,
    business: {
      id: client.id,
      name: client.name,
      type: kasa?.business.type ?? 'market',
      city: client.city,
      address: client.address,
      nui: client.nui,
      vat_number: client.vat_number,
      fiscal_number: client.fiscal_number,
      vat_registered: client.vat_registered,
    },
    sales: { ...ks, gross: ks.gross + manual.sales.gross, net: ks.net + manual.sales.net, vat: ks.vat + manual.sales.vat, docs: ks.docs + manual.sales.docs },
    vat_out: mergeVat(kasa?.vat_out ?? [], manual.vat_out),
    purchases: {
      gross: (kasa?.purchases.gross ?? 0) + manual.purchases.gross,
      net: (kasa?.purchases.net ?? 0) + manual.purchases.net,
      vat: (kasa?.purchases.vat ?? 0) + manual.purchases.vat,
      docs: (kasa?.purchases.docs ?? 0) + manual.purchases.docs,
      due: (kasa?.purchases.due ?? 0) + manual.purchases.due,
      cash: (kasa?.purchases.cash ?? 0) + manual.purchases.cash,
      bank: (kasa?.purchases.bank ?? 0) + manual.purchases.bank,
    },
    vat_in: mergeVat(kasa?.vat_in ?? [], manual.vat_in),
    expenses: {
      gross: (kasa?.expenses.gross ?? 0) + manual.expenses.gross,
      net: (kasa?.expenses.net ?? 0) + manual.expenses.net,
      vat: (kasa?.expenses.vat ?? 0) + manual.expenses.vat,
      docs: (kasa?.expenses.docs ?? 0) + manual.expenses.docs,
      due: (kasa?.expenses.due ?? 0) + manual.expenses.due,
    },
    expense_categories: mergeCategories(kasa?.expense_categories ?? [], manual.expense_categories),
    expense_vat: mergeVat(kasa?.expense_vat ?? [], manual.expense_vat),
    cogs: { gross: (kasa?.cogs.gross ?? 0) + manual.cogs.gross, net: (kasa?.cogs.net ?? 0) + manual.cogs.net },
    stock: kasa?.stock ?? { items: 0, gross: 0, net: 0, sale_value: 0 },
    adjustments: kasa?.adjustments ?? { writeoffs: 0, inventory: 0 },
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    shifts: kasa?.shifts ?? [],
    registers: kasa?.registers ?? [],
    periods: ((r.periods as Summary['periods']) ?? []).map((p) => ({ ...p, month: String(p.month).slice(0, 10) })),
  }
  return { client, kasa, summary, receivable: n(m.receivable), payable: n(m.payable) }
}

// ---------------------------------------------------------------------------
// Documents (sales, purchases/expenses, proformas)
// ---------------------------------------------------------------------------
export type DocKind = 'sale' | 'purchase'
export type AnyDocKind = DocKind | 'proforma'
export type DocType = 'invoice' | 'credit_note' | 'debit_note'
export type PayStatus = 'paid' | 'partial' | 'unpaid' | 'applied'
export type DocCategory = 'goods' | 'services' | 'assets' | ExpenseCategory | 'fuel' | 'vehicles' | 'admin' | 'operating' | 'travel' | 'representation'

export const SALE_CATEGORIES: { value: DocCategory; label: string }[] = [
  { value: 'goods', label: 'Mallra' },
  { value: 'services', label: 'Shërbime' },
]

export const PURCHASE_CATEGORIES: { value: DocCategory; label: string }[] = [
  { value: 'goods', label: 'Mall për rishitje' },
  { value: 'assets', label: 'Mjete themelore (pajisje, inventar)' },
  { value: 'services', label: 'Shërbime profesionale' },
  { value: 'rent', label: 'Qiraja' },
  { value: 'utilities', label: 'Rryma, uji, mbeturinat' },
  { value: 'telecom', label: 'Telefoni dhe interneti' },
  { value: 'fuel', label: 'Karburanti' },
  { value: 'vehicles', label: 'Automjetet (servisi, sigurimi, regjistrimi)' },
  { value: 'transport', label: 'Transporti' },
  { value: 'wages', label: 'Pagat' },
  { value: 'contributions', label: 'Kontributet pensionale' },
  { value: 'taxes', label: 'Tatime dhe taksa' },
  { value: 'admin', label: 'Shpenzime administrative' },
  { value: 'operating', label: 'Shpenzime operative' },
  { value: 'travel', label: 'Udhëtimet zyrtare' },
  { value: 'representation', label: 'Përfaqësimi (dreka, dhurata)' },
  { value: 'maintenance', label: 'Mirëmbajtja dhe riparimet' },
  { value: 'marketing', label: 'Reklama' },
  { value: 'bank', label: 'Provizionet bankare' },
  { value: 'other', label: 'Të tjera' },
]

export const DOC_TYPE_LABELS: Record<DocType, string> = { invoice: 'Faturë', credit_note: 'Faturë kreditore', debit_note: 'Faturë debitore' }
export const PAY_STATUS_LABELS: Record<PayStatus, string> = { paid: 'E paguar', partial: 'Pjesërisht', unpaid: 'E papaguar', applied: 'E zbritur' }

export function categoryLabel(kind: AnyDocKind, c: DocCategory): string {
  return (kind === 'purchase' ? PURCHASE_CATEGORIES : SALE_CATEGORIES).find((x) => x.value === c)?.label ?? c
}

export interface Doc {
  id: string
  kind: AnyDocKind
  doc_type: DocType
  category: DocCategory
  doc_date: string
  due_date: string | null
  doc_no: string | null
  auto_number: boolean
  partner_id: string | null
  partner_name: string | null
  partner_nui: string | null
  partner_vat: string | null
  partner_address: string | null
  description: string | null
  note: string | null
  payment: 'cash' | 'bank' | 'due'
  ref_doc_id: string | null
  ref_doc_no: string | null
  export: boolean
  net_e: number
  vat_e: number
  net_d: number
  vat_d: number
  amt_c: number
  amt_a: number
  vat_nd: number
  discount_total: number
  total: number
  has_lines: boolean
  converted_to: string | null
  vat_flag?: InvoiceInput['vat_flag']
  /** From acc_doc_balances (0016); before the migration: derived from `payment`. */
  paid: number
  credited: number
  open: number
  pay_status: PayStatus | null
  overdue_days: number | null
  files: number
}

const NUMS = ['net_e', 'vat_e', 'net_d', 'vat_d', 'amt_c', 'amt_a', 'vat_nd', 'discount_total', 'total', 'paid', 'credited', 'open', 'files'] as const
function toDoc(r: Record<string, unknown>): Doc {
  const d = { doc_type: 'invoice', vat_nd: 0, discount_total: 0, export: false, has_lines: false, files: 0, ...r } as unknown as Doc
  for (const k of NUMS) (d as unknown as Record<string, number>)[k] = n(r[k])
  return d
}

const DOC_COLS = 'id, kind, category, doc_date, doc_no, partner_name, partner_nui, partner_vat, description, payment, net_e, vat_e, net_d, vat_d, amt_c, amt_a, total'

export async function fetchDocs(clientId: string, kind: AnyDocKind, from: string, to: string): Promise<Doc[]> {
  const { data, error } = await supabase.rpc('acc_documents_list', { p_client: clientId, p_kind: kind, p_from: from, p_to: to })
  if (!error) return ((data as Record<string, unknown>[]) ?? []).map(toDoc)
  if (!['PGRST202', '42883'].includes(error.code ?? '') || kind === 'proforma') fail(error)
  // Before migration 0016: the plain table, "cash/bank" counts as paid.
  const out: Doc[] = []
  for (let a = 0; a < 30000; a += 1000) {
    const { data: rows, error: e2 } = await supabase
      .from('acc_documents')
      .select(DOC_COLS)
      .eq('client_id', clientId)
      .eq('kind', kind)
      .gte('doc_date', from)
      .lte('doc_date', to)
      .order('doc_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(a, a + 999)
    if (e2) fail(e2)
    out.push(
      ...(rows ?? []).map((r) => {
        const d = toDoc(r as Record<string, unknown>)
        const paid = d.payment === 'due' ? 0 : d.total
        return { ...d, paid, open: d.total - paid, pay_status: (d.payment === 'due' ? 'unpaid' : 'paid') as PayStatus }
      }),
    )
    if ((rows ?? []).length < 1000) break
  }
  return out
}

/** Old quick entry (amounts per rate) – still used by the Excel import. */
export type DocInput = Pick<Doc, 'category' | 'doc_date' | 'doc_no' | 'partner_name' | 'partner_nui' | 'partner_vat' | 'description' | 'payment' | 'net_e' | 'vat_e' | 'net_d' | 'vat_d' | 'amt_c' | 'amt_a'> & { id?: string; kind: DocKind }

export async function saveDoc(clientId: string, d: DocInput): Promise<void> {
  const { error } = await supabase.rpc('acc_save_document', { p: { ...d, client_id: clientId } })
  if (error) fail(error)
}

export async function deleteDoc(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_document', { p_id: id })
  if (error) fail(error)
}

export async function importDocs(clientId: string, rows: Omit<DocInput, 'id'>[]): Promise<number> {
  const { data, error } = await supabase.rpc('acc_import_documents', { p_client: clientId, p_rows: rows })
  if (error) fail(error)
  return Number(data)
}

export const docVat = (d: Pick<Doc, 'vat_e' | 'vat_d'>) => d.vat_e + d.vat_d
export const docNet = (d: Pick<Doc, 'net_e' | 'net_d' | 'amt_c' | 'amt_a'>) => d.net_e + d.net_d + d.amt_c + d.amt_a

// ---------------------------------------------------------------------------
// Invoices with lines (0016)
// ---------------------------------------------------------------------------
export interface DocLine {
  id?: string
  description: string
  unit: string
  quantity: number
  unit_price: number // without VAT
  discount_pct: number
  vat_code: VatCode
  net?: number
}

export interface InvoiceInput {
  id?: string
  kind: AnyDocKind
  doc_type: DocType
  ref_doc_id?: string | null
  category: DocCategory
  doc_date: string
  due_date?: string | null
  doc_no?: string | null
  partner_id?: string | null
  partner_name?: string | null
  partner_nui?: string | null
  partner_vat?: string | null
  description?: string | null
  note?: string | null
  export?: boolean
  vat_deductible?: boolean
  lines: DocLine[]
  /** Used when there are no lines: amounts per rate as on the paper invoice. */
  net_e?: number
  vat_e?: number
  net_d?: number
  vat_d?: number
  amt_c?: number
  amt_a?: number
  paid_now?: { method: 'cash' | 'bank'; reference?: string } | null
  force?: boolean
  /** How the document enters the VAT form (0018). */
  vat_flag?: 'none' | 'service_abroad' | 'reverse_charge' | 'exempt_credit' | 'import' | 'farmer'
}

export class DuplicateInvoice extends Error {}

export async function saveInvoice(clientId: string, inv: InvoiceInput): Promise<{ id: string; doc_no: string }> {
  const { data, error } = await supabase.rpc('acc_save_invoice', { p: { ...inv, client_id: clientId } })
  if (error) {
    if (error.code === '23505' && (error.hint === 'duplicate' || /regjistruar tashmë/.test(error.message))) throw new DuplicateInvoice(error.message)
    if (['PGRST202', '42883'].includes(error.code ?? '')) throw new Error('Kjo pjesë kërkon migrimin supabase/migrations/0016_acc_invoices.sql në Supabase.')
    fail(error)
  }
  const r = data as { id: string; doc_no: string }
  if (inv.vat_flag && (inv.vat_flag !== 'none' || inv.id)) {
    const f = await supabase.rpc('acc_set_vat_flag', { p_doc: r.id, p_flag: inv.vat_flag })
    if (f.error && !['PGRST202', '42883'].includes(f.error.code ?? '')) fail(f.error)
  }
  return r
}

export async function convertProforma(id: string, date?: string): Promise<{ id: string; doc_no: string }> {
  const { data, error } = await supabase.rpc('acc_convert_proforma', { p_id: id, p_date: date ?? null })
  if (error) fail(error)
  return data as { id: string; doc_no: string }
}

export interface Payment {
  id: string
  pay_date: string
  amount: number
  method: 'cash' | 'bank'
  reference: string | null
  note: string | null
}

export interface DocFile {
  id: string
  path: string
  file_name: string
  mime: string | null
  size_bytes: number | null
  created_at: string
}

export interface DocDetail extends Doc {
  lines: (DocLine & { id: string; net: number })[]
  payments: Payment[]
  corrections: { id: string; doc_no: string; doc_type: DocType; doc_date: string; total: number }[]
  ref_doc: { id: string; doc_no: string; doc_date: string; total: number } | null
  converted_doc_no: string | null
  files_list: DocFile[]
  installments: { due_date: string; amount: number }[] | null
  history: { action: string; details: Record<string, unknown>; created_at: string; user_name: string }[]
}

export async function fetchDocDetail(id: string): Promise<DocDetail> {
  const { data, error } = await supabase.rpc('acc_document_detail', { p_id: id })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const d = toDoc(r)
  const ref = r.ref_doc as Record<string, unknown> | null
  return {
    ...d,
    lines: ((r.lines as Record<string, unknown>[]) ?? []).map((l) => ({
      ...(l as unknown as DocLine & { id: string }),
      quantity: n(l.quantity),
      unit_price: n(l.unit_price),
      discount_pct: n(l.discount_pct),
      net: n(l.net),
    })),
    payments: ((r.payments as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as Payment), amount: n(x.amount) })),
    corrections: ((r.corrections as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as DocDetail['corrections'][number]), total: n(x.total) })),
    ref_doc: ref ? { id: ref.id as string, doc_no: ref.doc_no as string, doc_date: ref.doc_date as string, total: n(ref.total) } : null,
    converted_doc_no: (r.converted_doc_no as string) ?? null,
    files_list: (r.files as DocFile[]) ?? [],
    files: ((r.files as unknown[]) ?? []).length,
    installments: (r.installments as DocDetail['installments']) ?? null,
    history: (r.history as DocDetail['history']) ?? [],
  }
}

export async function savePayment(p: { id?: string; doc_id: string; pay_date: string; amount: number; method: 'cash' | 'bank'; account_id?: string | null; reference?: string; note?: string }): Promise<void> {
  const { error } = await supabase.rpc('acc_save_payment', { p })
  if (error) fail(error)
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_payment', { p_id: id })
  if (error) fail(error)
}

/** Uploads a PDF / photo to the private bucket (folder = client) and links it to the document. */
export async function uploadDocFile(clientId: string, docId: string | null, file: File): Promise<void> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Skedari është më i madh se 20 MB')
  const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80)
  const path = `${clientId}/${crypto.randomUUID()}-${safe}`
  const up = await supabase.storage.from('acc-files').upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (up.error) throw new Error('Skedari nuk u ngarkua: ' + up.error.message)
  const { error } = await supabase.rpc('acc_add_file', { p: { client_id: clientId, doc_id: docId, path, file_name: file.name, mime: file.type, size_bytes: file.size } })
  if (error) {
    await supabase.storage.from('acc-files').remove([path])
    fail(error)
  }
}

export async function openDocFile(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('acc-files').createSignedUrl(path, 300)
  if (error || !data) throw new Error('Skedari nuk u hap')
  return data.signedUrl
}

export async function deleteDocFile(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('acc_delete_file', { p_id: id })
  if (error) fail(error)
  await supabase.storage.from('acc-files').remove([data as string])
}

const round2c = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Line and invoice amounts exactly as the server computes them (acc_save_invoice). */
export function computeInvoice(lines: DocLine[], exportSale: boolean) {
  const by: Record<VatCode, number> = { E: 0, D: 0, C: 0, A: 0 }
  let discount = 0
  const nets = lines.map((l) => {
    const code: VatCode = exportSale ? 'C' : l.vat_code
    const before = round2c(l.quantity * l.unit_price)
    const net = round2c(l.quantity * l.unit_price * (1 - (l.discount_pct || 0) / 100))
    discount += before - net
    by[code] += net
    return net
  })
  const ve = round2c(by.E * 0.18)
  const vd = round2c(by.D * 0.08)
  return {
    nets,
    net_e: round2c(by.E),
    vat_e: ve,
    net_d: round2c(by.D),
    vat_d: vd,
    amt_c: round2c(by.C),
    amt_a: round2c(by.A),
    discount: round2c(discount),
    total: round2c(by.E + ve + by.D + vd + by.C + by.A),
  }
}

// ---------------------------------------------------------------------------
// Partners, debts, statement (0016)
// ---------------------------------------------------------------------------
export type PartnerRole = 'customer' | 'supplier' | 'both'
export const ROLE_LABEL: Record<PartnerRole, string> = { customer: 'Blerës', supplier: 'Furnitor', both: 'Blerës dhe furnitor' }

export interface Partner {
  id: string
  role: PartnerRole
  name: string
  nui: string | null
  fiscal_number: string | null
  vat_number: string | null
  address: string | null
  city: string | null
  country: string
  phone: string | null
  email: string | null
  note: string | null
  active: boolean
  receivable: number
  payable: number
  overdue: number
  docs: number
  last_doc: string | null
}

export type PartnerInput = Pick<Partner, 'role' | 'name' | 'nui' | 'fiscal_number' | 'vat_number' | 'address' | 'city' | 'country' | 'phone' | 'email' | 'note'> & {
  id?: string
  active?: boolean
}

export async function fetchPartners(clientId: string): Promise<Partner[]> {
  const { data, error } = await supabase.rpc('acc_partners_list', { p_client: clientId })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((p) => ({
    ...(p as unknown as Partner),
    receivable: n(p.receivable),
    payable: n(p.payable),
    overdue: n(p.overdue),
    docs: n(p.docs),
  }))
}

export async function savePartner(clientId: string, p: PartnerInput): Promise<string> {
  const { data, error } = await supabase.rpc('acc_save_partner', { p: { ...p, client_id: clientId } })
  if (error) fail(error)
  return data as string
}

export async function deletePartner(id: string): Promise<'archived' | 'deleted'> {
  const { data, error } = await supabase.rpc('acc_delete_partner', { p_id: id })
  if (error) fail(error)
  return data as 'archived' | 'deleted'
}

export interface DebtDoc {
  id: string
  doc_no: string | null
  doc_date: string
  due_date: string
  total: number
  open: number
  days: number
}

export interface Debts {
  as_of: string
  total: number
  buckets: { current: number; d30: number; d60: number; d90: number; older: number }
  partners: { partner_id: string | null; name: string; nui: string | null; open: number; overdue: number; max_days: number; docs: DebtDoc[] }[]
}

export async function fetchDebts(clientId: string, side: 'receivable' | 'payable', asOf?: string): Promise<Debts> {
  const { data, error } = await supabase.rpc('acc_debts', { p_client: clientId, p_side: side, p_as_of: asOf ?? null })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const b = (r.buckets ?? {}) as Record<string, unknown>
  return {
    as_of: r.as_of as string,
    total: n(r.total),
    buckets: { current: n(b.current), d30: n(b.d30), d60: n(b.d60), d90: n(b.d90), older: n(b.older) },
    partners: ((r.partners as Record<string, unknown>[]) ?? []).map((p) => ({
      ...(p as unknown as Debts['partners'][number]),
      open: n(p.open),
      overdue: n(p.overdue),
      max_days: n(p.max_days),
      docs: ((p.docs as Record<string, unknown>[]) ?? []).map((d) => ({ ...(d as unknown as DebtDoc), total: n(d.total), open: n(d.open), days: n(d.days) })),
    })),
  }
}

export interface StatementRow {
  date: string
  type: DocType | 'payment'
  kind: AnyDocKind
  doc_id: string
  doc_no: string | null
  debit: number
  credit: number
  text: string | null
}

export async function fetchStatement(partnerId: string, from: string, to: string): Promise<{ partner: Partner; opening: number; rows: StatementRow[] }> {
  const { data, error } = await supabase.rpc('acc_partner_statement', { p_partner: partnerId, p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  return {
    partner: r.partner as Partner,
    opening: n(r.opening),
    rows: ((r.rows as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as StatementRow), debit: n(x.debit), credit: n(x.credit) })),
  }
}

// ---------------------------------------------------------------------------
// Cash & bank, statement, loans, cash flow, dashboard (0017)
// ---------------------------------------------------------------------------
export type MoneyKind = 'cash' | 'bank'
export type TxCategory = 'income' | 'owner' | 'loan' | 'interest' | 'wages' | 'taxes' | 'vat' | 'contributions' | 'bank_fee' | 'transfer' | 'other'

export const TX_LABELS: Record<TxCategory | 'customer' | 'supplier', string> = {
  customer: 'Arkëtim nga klienti',
  supplier: 'Pagesë furnitorit',
  income: 'Të hyra të tjera',
  owner: 'Pronari (kapital / tërheqje)',
  loan: 'Kredi (marrje / këst)',
  interest: 'Interesi',
  wages: 'Pagat',
  taxes: 'Tatime',
  vat: 'Pagesa e TVSH-së',
  contributions: 'Kontributet',
  bank_fee: 'Provizion bankar',
  transfer: 'Transfer ndërmjet llogarive',
  other: 'Tjetër',
}

export interface MoneyAccount {
  id: string
  kind: MoneyKind
  name: string
  bank_name: string | null
  iban: string | null
  opening_balance: number
  opening_date: string
  active: boolean
  balance: number
  to_match: number
}

export async function fetchAccounts(clientId: string, asOf?: string): Promise<MoneyAccount[]> {
  const { data, error } = await supabase.rpc('acc_accounts_list', { p_client: clientId, p_as_of: asOf ?? null })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) return []
    fail(error)
  }
  return ((data as Record<string, unknown>[]) ?? []).map((a) => ({ ...(a as unknown as MoneyAccount), opening_balance: n(a.opening_balance), balance: n(a.balance), to_match: n(a.to_match) }))
}

export async function saveAccount(clientId: string, a: Partial<MoneyAccount>): Promise<string> {
  const { data, error } = await supabase.rpc('acc_save_account', { p: { ...a, client_id: clientId } })
  if (error) fail(error)
  return data as string
}

export async function deleteAccount(id: string): Promise<'archived' | 'deleted'> {
  const { data, error } = await supabase.rpc('acc_delete_account', { p_id: id })
  if (error) fail(error)
  return data as 'archived' | 'deleted'
}

export interface LedgerRow {
  date: string
  source: 'payment' | 'tx'
  id: string
  doc_id: string | null
  amount: number
  text: string
  reference: string | null
  category: TxCategory | 'customer' | 'supplier'
  transfer_group?: string | null
  loan_id?: string | null
  partner?: string | null
}

export async function fetchLedger(accountId: string, from: string, to: string): Promise<{ opening: number; closing: number; rows: LedgerRow[] }> {
  const { data, error } = await supabase.rpc('acc_account_ledger', { p_account: accountId, p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  return { opening: n(r.opening), closing: n(r.closing), rows: ((r.rows as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as LedgerRow), amount: n(x.amount) })) }
}

export async function saveTransaction(t: {
  account_id: string
  to_account_id?: string
  tx_date: string
  amount: number
  category: TxCategory
  description?: string
  reference?: string
  partner_id?: string | null
  loan_id?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('acc_save_transaction', { p: t })
  if (error) fail(error)
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_transaction', { p_id: id })
  if (error) fail(error)
}

export interface Loan {
  id: string
  lender: string
  principal: number
  rate_pct: number
  start_date: string
  months: number
  account_id: string | null
  note: string | null
  repaid: number
  interest_paid: number
}

export async function fetchLoans(clientId: string): Promise<Loan[]> {
  const { data, error } = await supabase.rpc('acc_loans_list', { p_client: clientId })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((l) => ({
    ...(l as unknown as Loan),
    principal: n(l.principal),
    rate_pct: n(l.rate_pct),
    repaid: n(l.repaid),
    interest_paid: n(l.interest_paid),
    months: n(l.months),
  }))
}

export async function saveLoan(clientId: string, l: Partial<Loan> & { book_receipt?: boolean }): Promise<void> {
  const { error } = await supabase.rpc('acc_save_loan', { p: { ...l, client_id: clientId } })
  if (error) fail(error)
}

export async function deleteLoan(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_loan', { p_id: id })
  if (error) fail(error)
}

/** Annuity schedule (equal monthly instalments). */
export function loanSchedule(l: Pick<Loan, 'principal' | 'rate_pct' | 'months' | 'start_date'>) {
  const r = l.rate_pct / 100 / 12
  const pay = r ? (l.principal * r) / (1 - Math.pow(1 + r, -l.months)) : l.principal / l.months
  let bal = l.principal
  const rows: { no: number; date: string; payment: number; interest: number; principal: number; balance: number }[] = []
  for (let i = 1; i <= l.months; i++) {
    const interest = Math.round(bal * r * 100) / 100
    let principal = Math.round((pay - interest) * 100) / 100
    if (i === l.months) principal = Math.round(bal * 100) / 100
    bal = Math.round((bal - principal) * 100) / 100
    const d = new Date(l.start_date + 'T12:00:00')
    d.setMonth(d.getMonth() + i)
    rows.push({ no: i, date: d.toISOString().slice(0, 10), payment: Math.round((principal + interest) * 100) / 100, interest, principal, balance: Math.max(0, bal) })
  }
  return rows
}

export interface BankLine {
  id: string
  line_date: string
  amount: number
  description: string | null
  counterparty: string | null
  reference: string | null
  status: 'new' | 'matched' | 'ignored'
  payment_id: string | null
  tx_id: string | null
  doc_id: string | null
  doc_no: string | null
  suggestions: { doc_id: string; doc_no: string | null; partner: string | null; doc_date: string; open: number; score: number }[]
}

export async function importBankLines(
  accountId: string,
  rows: { date: string; amount: number; description?: string; counterparty?: string; reference?: string }[],
): Promise<{ added: number; skipped: number }> {
  const { data, error } = await supabase.rpc('acc_import_bank_lines', { p_account: accountId, p_rows: rows })
  if (error) fail(error)
  return data as { added: number; skipped: number }
}

export async function fetchBankLines(accountId: string, status: 'new' | 'matched' | 'ignored' | 'all'): Promise<BankLine[]> {
  const { data, error } = await supabase.rpc('acc_bank_lines_list', { p_account: accountId, p_status: status })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((l) => ({
    ...(l as unknown as BankLine),
    amount: n(l.amount),
    suggestions: ((l.suggestions as BankLine['suggestions']) ?? []).map((s) => ({ ...s, open: n(s.open) })),
  }))
}

export async function matchBankLine(lineId: string, docId: string): Promise<void> {
  const { error } = await supabase.rpc('acc_match_bank_line', { p_line: lineId, p_doc: docId })
  if (error) fail(error)
}

export async function bookBankLine(
  lineId: string,
  p: { category?: TxCategory; expense_category?: DocCategory; description?: string; partner_id?: string | null; loan_id?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('acc_book_bank_line', { p_line: lineId, p })
  if (error) fail(error)
}

export async function setBankLine(lineId: string, status: 'ignored' | 'new' | 'delete'): Promise<void> {
  const { error } = await supabase.rpc('acc_set_bank_line', { p_line: lineId, p_status: status })
  if (error) fail(error)
}

export interface CashFlow {
  opening: number
  closing: number
  months: { month: string; in: number; out: number; groups: Record<string, number> }[]
  groups: Record<string, number>
}

const numMap = (o: unknown) => Object.fromEntries(Object.entries((o as Record<string, unknown>) ?? {}).map(([k, v]) => [k, n(v)]))

export async function fetchCashFlow(clientId: string, from: string, to: string): Promise<CashFlow> {
  const { data, error } = await supabase.rpc('acc_cash_flow', { p_client: clientId, p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  return {
    opening: n(r.opening),
    closing: n(r.closing),
    months: ((r.months as Record<string, unknown>[]) ?? []).map((m) => ({ month: String(m.month).slice(0, 10), in: n(m.in), out: n(m.out), groups: numMap(m.groups) })),
    groups: numMap(r.groups),
  }
}

export interface Dashboard {
  year: number
  months: { month: string; sales: number; purchases: number; expenses: number; cash_in: number; cash_out: number }[]
  receivable: number
  payable: number
  overdue_receivable: number
  overdue_payable: number
  overdue_docs: number
  accounts: { id: string; name: string; kind: MoneyKind; balance: number; to_match: number }[]
  vat_prev: { month: string; out: number; in: number; status: VatStatus; due: string }
  recent: { at: string; action: string; doc_id: string; doc_no: string | null; kind: AnyDocKind; partner: string | null; details: Record<string, unknown> }[]
}

export async function fetchDashboard(clientId: string, year: number): Promise<Dashboard> {
  const { data, error } = await supabase.rpc('acc_client_dashboard', { p_client: clientId, p_year: year })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const v = r.vat_prev as Record<string, unknown>
  return {
    year: n(r.year),
    months: ((r.months as Record<string, unknown>[]) ?? []).map((m) => ({
      month: String(m.month).slice(0, 10),
      sales: n(m.sales),
      purchases: n(m.purchases),
      expenses: n(m.expenses),
      cash_in: n(m.cash_in),
      cash_out: n(m.cash_out),
    })),
    receivable: n(r.receivable),
    payable: n(r.payable),
    overdue_receivable: n(r.overdue_receivable),
    overdue_payable: n(r.overdue_payable),
    overdue_docs: n(r.overdue_docs),
    accounts: ((r.accounts as Record<string, unknown>[]) ?? []).map((a) => ({ ...(a as unknown as Dashboard['accounts'][number]), balance: n(a.balance), to_match: n(a.to_match) })),
    vat_prev: { month: String(v.month).slice(0, 10), out: n(v.out), in: n(v.in), status: v.status as VatStatus, due: String(v.due).slice(0, 10) },
    recent: (r.recent as Dashboard['recent']) ?? [],
  }
}
