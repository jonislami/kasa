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

export type ClientInput = Pick<Client, 'name' | 'nui' | 'vat_number' | 'fiscal_number' | 'vat_registered' | 'activity' | 'address' | 'city' | 'phone' | 'email' | 'note'> & { id?: string; active?: boolean }

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
  return { client, kasa, summary }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export type DocKind = 'sale' | 'purchase'
export type DocCategory = 'goods' | 'services' | 'assets' | ExpenseCategory

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
  { value: 'wages', label: 'Pagat' },
  { value: 'contributions', label: 'Kontributet pensionale' },
  { value: 'taxes', label: 'Tatime dhe taksa' },
  { value: 'telecom', label: 'Telefoni dhe interneti' },
  { value: 'transport', label: 'Transporti dhe derivatet' },
  { value: 'maintenance', label: 'Mirëmbajtja dhe riparimet' },
  { value: 'marketing', label: 'Reklama' },
  { value: 'bank', label: 'Provizionet bankare' },
  { value: 'other', label: 'Të tjera' },
]

export function categoryLabel(kind: DocKind, c: DocCategory): string {
  return (kind === 'sale' ? SALE_CATEGORIES : PURCHASE_CATEGORIES).find((x) => x.value === c)?.label ?? c
}

export interface Doc {
  id: string
  kind: DocKind
  category: DocCategory
  doc_date: string
  doc_no: string | null
  partner_name: string | null
  partner_nui: string | null
  partner_vat: string | null
  description: string | null
  payment: 'cash' | 'bank' | 'due'
  net_e: number
  vat_e: number
  net_d: number
  vat_d: number
  amt_c: number
  amt_a: number
  total: number
}

export type DocInput = Omit<Doc, 'id' | 'total'> & { id?: string }

const DOC_COLS = 'id, kind, category, doc_date, doc_no, partner_name, partner_nui, partner_vat, description, payment, net_e, vat_e, net_d, vat_d, amt_c, amt_a, total'

export async function fetchDocs(clientId: string, kind: DocKind, from: string, to: string): Promise<Doc[]> {
  const out: Doc[] = []
  for (let a = 0; a < 30000; a += 1000) {
    const { data, error } = await supabase
      .from('acc_documents')
      .select(DOC_COLS)
      .eq('client_id', clientId)
      .eq('kind', kind)
      .gte('doc_date', from)
      .lte('doc_date', to)
      .order('doc_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(a, a + 999)
    if (error) fail(error)
    out.push(
      ...(data ?? []).map((r) => ({
        ...(r as unknown as Doc),
        net_e: n(r.net_e),
        vat_e: n(r.vat_e),
        net_d: n(r.net_d),
        vat_d: n(r.vat_d),
        amt_c: n(r.amt_c),
        amt_a: n(r.amt_a),
        total: n(r.total),
      })),
    )
    if ((data ?? []).length < 1000) break
  }
  return out
}

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
