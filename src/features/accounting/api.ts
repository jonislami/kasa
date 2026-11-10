import { supabase } from '@/lib/supabase'
import { kosovoDateISO } from '@/lib/clock'
import type { BusinessType } from '@/lib/business'
import type { VatCode } from '@/lib/vat'

/** Thrown when migration 0012 has not been run yet – pages show a clear message. */
export class AccountingNotMigrated extends Error {
  constructor() {
    super('Kontabiliteti aktivizohet pasi të ekzekutohen migrimet 0012_accountant.sql dhe 0013_accountant_app.sql në Supabase.')
  }
}

const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883', '42703'])

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new AccountingNotMigrated()
  throw new Error(error.message)
}

const n = (v: unknown) => (v == null ? 0 : Number(v))

// ---------------------------------------------------------------------------
// Periods (month / quarter / year)
// ---------------------------------------------------------------------------
export type PeriodKind = 'month' | 'quarter' | 'year'

export interface Period {
  kind: PeriodKind
  /** First day of the period, YYYY-MM-DD. */
  start: string
}

const pad = (v: number) => String(v).padStart(2, '0')
const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor']

function parts(iso: string): { y: number; m: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) }
}

export function monthStart(iso: string = kosovoDateISO()): string {
  return iso.slice(0, 8) + '01'
}

/** Moves a YYYY-MM-01 date by whole months. */
export function addMonths(iso: string, months: number): string {
  const { y, m } = parts(iso)
  const t = y * 12 + (m - 1) + months
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`
}

export function periodOf(kind: PeriodKind, anyDate: string = kosovoDateISO()): Period {
  const { y, m } = parts(anyDate)
  if (kind === 'year') return { kind, start: `${y}-01-01` }
  if (kind === 'quarter') return { kind, start: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01` }
  return { kind, start: `${y}-${pad(m)}-01` }
}

const LENGTH: Record<PeriodKind, number> = { month: 1, quarter: 3, year: 12 }

export function shiftPeriod(p: Period, step: number): Period {
  return { kind: p.kind, start: addMonths(p.start, step * LENGTH[p.kind]) }
}

export function periodRange(p: Period): { from: string; to: string } {
  const next = addMonths(p.start, LENGTH[p.kind])
  const d = new Date(next + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return { from: p.start, to: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
}

export function periodLabel(p: Period): string {
  const { y, m } = parts(p.start)
  if (p.kind === 'year') return `Viti ${y}`
  if (p.kind === 'quarter') return `Tremujori ${Math.floor((m - 1) / 3) + 1} · ${y}`
  return `${MONTHS[m - 1]} ${y}`
}

export function monthName(iso: string): string {
  const { y, m } = parts(iso)
  return `${MONTHS[m - 1]} ${y}`
}

/** VAT return and payment are due on the 20th of the month after the period. */
export function vatDueDate(month: string): string {
  return addMonths(month, 1).slice(0, 8) + '20'
}

export function formatDay(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

// ---------------------------------------------------------------------------
// The books of one business for a period
// ---------------------------------------------------------------------------
export interface VatRow {
  code: VatCode
  gross: number
  net: number
  vat: number
}

export interface DayRow {
  date: string
  docs: number
  corrections: number
  first_no: number
  last_no: number
  gross: number
  net: number
  vat: number
  cash: number
  card: number
  rates: Partial<Record<VatCode, { gross: number; net: number; vat: number }>>
}

export interface ShiftRow {
  id: string
  started_at: string
  ended_at: string | null
  register: string | null
  worker: string | null
  opening: number
  counted: number | null
  cash_sales: number
  card_sales: number
  docs: number
}

export type VatStatus = 'open' | 'filed'

export interface Summary {
  from: string
  to: string
  business: {
    id: string
    name: string
    type: BusinessType
    city: string | null
    address: string | null
    nui: string | null
    vat_number: string | null
    fiscal_number: string | null
    vat_registered: boolean
  }
  sales: {
    gross: number
    net: number
    vat: number
    docs: number
    voids: number
    void_total: number
    refunds: number
    refund_total: number
    cash: number
    card: number
    discounts: number
    offline: number
    first_no: number | null
    last_no: number | null
  }
  vat_out: VatRow[]
  purchases: { gross: number; net: number; vat: number; docs: number; due: number; cash: number; bank: number }
  vat_in: VatRow[]
  expenses: { gross: number; net: number; vat: number; docs: number; due: number }
  expense_categories: { category: ExpenseCategory; gross: number; net: number; vat: number }[]
  expense_vat: VatRow[]
  cogs: { gross: number; net: number }
  stock: { items: number; gross: number; net: number; sale_value: number }
  adjustments: { writeoffs: number; inventory: number }
  daily: DayRow[]
  shifts: ShiftRow[]
  registers: { id: string; name: string }[]
  periods: { month: string; vat_status: VatStatus; note: string | null; closed_at: string | null }[]
}

function nums<T>(o: unknown): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries((o ?? {}) as Record<string, unknown>)) out[k] = typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v))) ? Number(v) : v
  return out as T
}

const vatRows = (v: unknown): VatRow[] => ((v as Record<string, unknown>[]) ?? []).map((x) => ({ code: x.code as VatCode, gross: n(x.gross), net: n(x.net), vat: n(x.vat) }))

export async function fetchSummary(from: string, to: string): Promise<Summary> {
  const { data, error } = await supabase.rpc('accounting_summary', { p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  return {
    from: r.from as string,
    to: r.to as string,
    business: r.business as Summary['business'],
    sales: { ...nums<Summary['sales']>(r.sales), first_no: (r.sales as Record<string, unknown>).first_no == null ? null : n((r.sales as Record<string, unknown>).first_no), last_no: (r.sales as Record<string, unknown>).last_no == null ? null : n((r.sales as Record<string, unknown>).last_no) },
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
      rates: Object.fromEntries(Object.entries((d.rates ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) => [k, { gross: n(v.gross), net: n(v.net), vat: n(v.vat) }])),
    })),
    shifts: ((r.shifts as Record<string, unknown>[]) ?? []).map((s) => ({
      id: s.id as string,
      started_at: s.started_at as string,
      ended_at: (s.ended_at as string) ?? null,
      register: (s.register as string) ?? null,
      worker: (s.worker as string) ?? null,
      opening: n(s.opening),
      counted: s.counted == null ? null : n(s.counted),
      cash_sales: n(s.cash_sales),
      card_sales: n(s.card_sales),
      docs: n(s.docs),
    })),
    registers: (r.registers as Summary['registers']) ?? [],
    periods: ((r.periods as Summary['periods']) ?? []).map((p) => ({ ...p, month: String(p.month).slice(0, 10) })),
  }
}

/** Sum of VAT rows by code (purchases + expenses → deductible VAT). */
export function mergeVat(...lists: VatRow[][]): VatRow[] {
  const map = new Map<VatCode, VatRow>()
  for (const list of lists)
    for (const r of list) {
      const cur = map.get(r.code) ?? { code: r.code, gross: 0, net: 0, vat: 0 }
      map.set(r.code, { code: r.code, gross: cur.gross + r.gross, net: cur.net + r.net, vat: cur.vat + r.vat })
    }
  return (['E', 'D', 'C', 'A'] as VatCode[]).filter((c) => map.has(c)).map((c) => map.get(c)!)
}

export const sumVat = (rows: VatRow[]) => rows.reduce((a, r) => ({ gross: a.gross + r.gross, net: a.net + r.net, vat: a.vat + r.vat }), { gross: 0, net: 0, vat: 0 })

/** Profit and loss for the period. VAT payers count without VAT; others with the amounts they paid. */
export function profitAndLoss(s: Summary) {
  const vat = s.business.vat_registered
  const revenue = vat ? s.sales.net : s.sales.gross
  const cogs = vat ? s.cogs.net : s.cogs.gross
  const gross = revenue - cogs
  // Negative movements are losses (damage, expiry, missing at the count); positive ones are surplus.
  const stockLoss = -(s.adjustments.writeoffs + s.adjustments.inventory)
  const expenses = vat ? s.expenses.net : s.expenses.gross
  const categories = s.expense_categories.map((c) => ({ category: c.category, amount: vat ? c.net : c.gross }))
  return { vat, revenue, cogs, gross, margin: revenue ? gross / revenue : null, stockLoss, expenses, categories, result: gross - stockLoss - expenses }
}

// ---------------------------------------------------------------------------
// Documents (read through RLS; always filtered by the business)
// ---------------------------------------------------------------------------
const PAGE = 1000
const MAX_ROWS = 30000

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) fail(error)
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < PAGE) break
  }
  return out
}

export interface SaleDoc {
  id: string
  kind: 'sale' | 'void' | 'refund'
  invoice_no: number
  daily_no: number
  ref_sale_id: string | null
  sale_date: string
  created_at: string
  register_id: string | null
  payment_method: 'cash' | 'card' | 'mixed'
  cash_amount: number
  card_amount: number
  total: number
  net_total: number
  vat_total: number
  discount_total: number
  vat_lines: VatRow[]
  offline: boolean
  offline_no: string | null
  fiscal_status: string
  reason: string | null
}

export async function fetchSaleDocs(businessId: string, from: string, to: string): Promise<SaleDoc[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('sales')
      .select('id, kind, invoice_no, daily_no, ref_sale_id, sale_date, created_at, register_id, payment_method, cash_amount, card_amount, total, net_total, vat_total, discount_total, vat_lines, offline, offline_no, fiscal_status, reason')
      .eq('business_id', businessId)
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('invoice_no', { ascending: true })
      .range(a, b),
  )
  return rows.map((r) => ({
    ...(r as unknown as SaleDoc),
    invoice_no: n(r.invoice_no),
    daily_no: n(r.daily_no),
    cash_amount: n(r.cash_amount),
    card_amount: n(r.card_amount),
    total: n(r.total),
    net_total: n(r.net_total),
    vat_total: n(r.vat_total),
    discount_total: n(r.discount_total),
    vat_lines: vatRows(r.vat_lines),
  }))
}

export interface SaleLine {
  id: string
  position: number
  name: string
  unit: string
  quantity: number
  unit_price: number
  line_discount: number
  invoice_discount: number
  total: number
  vat_code: VatCode
}

export async function fetchSaleLines(saleId: string): Promise<SaleLine[]> {
  const { data, error } = await supabase
    .from('sale_items')
    .select('id, position, name, unit, quantity, unit_price, line_discount, invoice_discount, total, vat_code')
    .eq('sale_id', saleId)
    .order('position')
  if (error) fail(error)
  return (data ?? []).map((r) => ({ ...(r as SaleLine), quantity: n(r.quantity), unit_price: n(r.unit_price), line_discount: n(r.line_discount), invoice_discount: n(r.invoice_discount), total: n(r.total) }))
}

export interface PurchaseDoc {
  id: string
  entry_no: number | null
  entry_date: string
  invoice_no: string | null
  payment: 'cash' | 'bank' | 'due'
  due_days: number | null
  items_count: number
  total: number
  net_total: number
  vat_total: number
  vat_lines: VatRow[]
  supplier: { name: string; nui: string | null; vat_number: string | null } | null
}

export async function fetchPurchases(businessId: string, from: string, to: string): Promise<PurchaseDoc[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('stock_entries')
      .select('id, entry_no, entry_date, invoice_no, payment, due_days, items_count, total, net_total, vat_total, vat_lines, supplier:suppliers(name, nui, vat_number)')
      .eq('business_id', businessId)
      .eq('status', 'confirmed')
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: true })
      .order('entry_no', { ascending: true })
      .range(a, b),
  )
  return rows.map((r) => ({
    ...(r as unknown as PurchaseDoc),
    entry_no: r.entry_no == null ? null : n(r.entry_no),
    items_count: n(r.items_count),
    total: n(r.total),
    net_total: n(r.net_total),
    vat_total: n(r.vat_total),
    vat_lines: vatRows(r.vat_lines),
    supplier: (Array.isArray(r.supplier) ? r.supplier[0] : r.supplier) ?? null,
  }))
}

export interface PurchaseLine {
  id: string
  position: number
  name: string
  unit: string
  vat_code: VatCode
  quantity: number
  unit_cost: number
  total: number
}

export async function fetchPurchaseLines(entryId: string): Promise<PurchaseLine[]> {
  const { data, error } = await supabase.from('stock_entry_items').select('id, position, name, unit, vat_code, quantity, unit_cost, total').eq('entry_id', entryId).order('position')
  if (error) fail(error)
  return (data ?? []).map((r) => ({ ...(r as PurchaseLine), quantity: n(r.quantity), unit_cost: n(r.unit_cost), total: n(r.total) }))
}

export interface StockRow {
  id: string
  name: string
  barcode: string | null
  unit: string
  category: string | null
  vat_code: VatCode
  stock: number
  sale_price: number
  purchase_price: number
}

export async function fetchStockList(businessId: string): Promise<StockRow[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('products')
      .select('id, name, barcode, unit, vat_code, stock, sale_price, has_variants, category:categories(name), cost:product_costs(purchase_price)')
      .eq('business_id', businessId)
      .eq('kind', 'product')
      .eq('active', true)
      .order('name')
      .range(a, b),
  )
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null | undefined
  return rows
    .filter((r) => !r.has_variants) // the stock lives on the variants
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      barcode: (r.barcode as string) ?? null,
      unit: r.unit as string,
      category: (one(r.category)?.name as string) ?? null,
      vat_code: r.vat_code as VatCode,
      stock: n(r.stock),
      sale_price: n(r.sale_price),
      purchase_price: n(one(r.cost)?.purchase_price),
    }))
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export type ExpenseCategory = 'rent' | 'utilities' | 'wages' | 'contributions' | 'taxes' | 'telecom' | 'transport' | 'maintenance' | 'marketing' | 'bank' | 'services' | 'other'

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  rent: 'Qiraja',
  utilities: 'Rryma, uji, mbeturinat',
  wages: 'Pagat',
  contributions: 'Kontributet pensionale',
  taxes: 'Tatime dhe taksa',
  telecom: 'Telefoni dhe interneti',
  transport: 'Transporti dhe derivatet',
  maintenance: 'Mirëmbajtja dhe riparimet',
  marketing: 'Reklama',
  bank: 'Provizionet bankare',
  services: 'Shërbime profesionale',
  other: 'Të tjera',
}

export const PAYMENT_LABELS = { cash: 'Kesh', bank: 'Bankë', due: 'Me afat' } as const

export interface Expense {
  id: string
  expense_date: string
  category: ExpenseCategory
  description: string | null
  vendor: string | null
  doc_no: string | null
  vat_code: VatCode
  total: number
  net_total: number
  vat_total: number
  payment: 'cash' | 'bank' | 'due'
}

export async function fetchExpenses(businessId: string, from: string, to: string): Promise<Expense[]> {
  const rows = await fetchAll<Record<string, unknown>>((a, b) =>
    supabase
      .from('expenses')
      .select('id, expense_date, category, description, vendor, doc_no, vat_code, total, net_total, vat_total, payment')
      .eq('business_id', businessId)
      .gte('expense_date', from)
      .lte('expense_date', to)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(a, b),
  )
  return rows.map((r) => ({ ...(r as unknown as Expense), total: n(r.total), net_total: n(r.net_total), vat_total: n(r.vat_total) }))
}

export type ExpenseInput = Omit<Expense, 'id' | 'net_total' | 'vat_total'> & { id?: string }

export async function saveExpense(e: ExpenseInput): Promise<void> {
  const { error } = await supabase.rpc('save_expense', { p: e })
  if (error) fail(error)
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_expense', { p_id: id })
  if (error) fail(error)
}

export async function setPeriodStatus(month: string, status: VatStatus, note?: string): Promise<void> {
  const { error } = await supabase.rpc('set_period_status', { p_month: month, p_status: status, p_note: note ?? null })
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// The owner's side (Cilësimet → Kontabilisti): requests from the Kasa Kontabilist program
// ---------------------------------------------------------------------------
export interface BusinessAccountant {
  client_id: string
  user_id: string
  full_name: string
  email: string
  office_name: string | null
  phone: string | null
  status: 'pending' | 'approved'
  requested_at: string | null
  responded_at: string | null
  last_opened_at: string | null
}

export async function fetchAccountants(): Promise<BusinessAccountant[]> {
  const { data, error } = await supabase.rpc('business_accountants')
  if (error) fail(error)
  return ((data as BusinessAccountant[]) ?? []).filter((a) => a.client_id) // 0012 rows had no request
}

export async function respondAccountantRequest(clientId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_accountant_request', { p_client: clientId, p_approve: approve })
  if (error) fail(error)
}

/** Owner adds the accountant by email: the business appears at once among the accountant's clients (0014). */
export async function addAccountantByEmail(email: string): Promise<{ full_name: string | null; office_name: string | null }> {
  const { data, error } = await supabase.rpc('add_accountant_by_email', { p_email: email.trim() })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new Error('Kjo mundësi kërkon migrimin supabase/migrations/0014_owner_adds_accountant.sql në Supabase.')
    }
    fail(error)
  }
  return data as { full_name: string | null; office_name: string | null }
}

export async function revokeAccountant(userId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_accountant', { p_user: userId })
  if (error) fail(error)
}

/** The accountant program opens a linked Kasa business (read-only books through RLS). */
export async function setActiveBusiness(businessId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_active_business', { p_business: businessId })
  if (error) fail(error)
}
