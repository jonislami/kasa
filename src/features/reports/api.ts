import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/business'
import type { VatCode } from '@/lib/vat'

/** Thrown when migration 0004 has not been run yet – pages show a clear message. */
export class ReportsNotMigrated extends Error {
  constructor() {
    super('Raportet nuk janë aktivizuar ende në databazë (migrimi 0004_reports.sql).')
  }
}

const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883'])

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new ReportsNotMigrated()
  throw new Error(error.message)
}

const n = (v: unknown) => (v == null ? 0 : Number(v))

// ---------------------------------------------------------------------------
// Dates (local, Kosovo – the browser's local date)
// ---------------------------------------------------------------------------
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return iso(d)
}

export function today(): string {
  return iso(new Date())
}

export type PeriodKey = 'today' | 'yesterday' | '7' | 'month' | 'custom'

export function periodRange(key: PeriodKey, custom?: { from: string; to: string }): { from: string; to: string } {
  const t = today()
  switch (key) {
    case 'today':
      return { from: t, to: t }
    case 'yesterday':
      return { from: addDays(t, -1), to: addDays(t, -1) }
    case '7':
      return { from: addDays(t, -6), to: t }
    case 'month':
      return { from: t.slice(0, 8) + '01', to: t }
    default:
      return custom ?? { from: t, to: t }
  }
}

const longFmt = new Intl.DateTimeFormat('sq-AL', { day: 'numeric', month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('sq-AL', { day: 'numeric', month: 'long' })

export function formatRange(from: string, to: string): string {
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to + 'T00:00:00')
  if (from === to) return longFmt.format(a)
  return `${a.getFullYear() === b.getFullYear() ? dayFmt.format(a) : longFmt.format(a)} – ${longFmt.format(b)}`
}

const WEEKDAYS = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht']
const MONTHS = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj']

export function dayLabel(isoDate: string, withNumber = false): string {
  const d = new Date(isoDate + 'T00:00:00')
  return withNumber ? `${WEEKDAYS[d.getDay()]} ${d.getDate()}` : WEEKDAYS[d.getDay()]
}

export function monthLabel(isoDate: string): string {
  return MONTHS[new Date(isoDate + 'T00:00:00').getMonth()]
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return m ? `${h} orë ${m} min` : `${h} orë`
}

// ---------------------------------------------------------------------------
// Report summary
// ---------------------------------------------------------------------------
export interface Totals {
  total: number
  net_total: number
  vat_total: number
  invoices: number
  voids: number
  void_total: number
  refunds: number
  refund_total: number
  cash: number
  card: number
  discounts: number
  cost: number
  profit: number
  offline: number
}

export interface SeriesPoint {
  date: string
  total: number
  invoices: number
}

export interface TopProduct {
  key: string
  name: string
  unit: string
  quantity: number
  total: number
  profit: number
}

export interface WorkerRow {
  worker_id: string
  name: string
  role: Role | null
  invoices: number
  total: number
  cash: number
  card: number
  voids: number
  refunds: number
}

export interface ReportSummary {
  from: string
  to: string
  prev_from: string
  prev_to: string
  totals: Totals
  prev: { total: number; invoices: number }
  vat: { code: VatCode; gross: number; net: number; vat: number }[]
  top: TopProduct[]
  workers: WorkerRow[]
  daily: SeriesPoint[]
  hours: { hour: number; total: number; invoices: number }[]
}

function numObj<T>(o: Record<string, unknown>, skip: string[] = []): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k] = skip.includes(k) || typeof v === 'string' && isNaN(Number(v)) ? v : typeof v === 'string' || typeof v === 'number' ? Number(v) : v
  return out as T
}

export async function fetchReport(from: string, to: string): Promise<ReportSummary> {
  const { data, error } = await supabase.rpc('report_summary', { p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const arr = (k: string, skip: string[] = []) => ((r[k] as Record<string, unknown>[]) ?? []).map((x) => numObj(x, skip))
  return {
    from: r.from as string,
    to: r.to as string,
    prev_from: r.prev_from as string,
    prev_to: r.prev_to as string,
    totals: numObj<Totals>(r.totals as Record<string, unknown>),
    prev: { total: n((r.prev as Record<string, unknown>)?.total), invoices: n((r.prev as Record<string, unknown>)?.invoices) },
    vat: arr('vat', ['code']) as ReportSummary['vat'],
    top: arr('top', ['key', 'name', 'unit']) as TopProduct[],
    workers: arr('workers', ['worker_id', 'name', 'role']) as WorkerRow[],
    daily: arr('daily', ['date']) as SeriesPoint[],
    hours: arr('hours') as ReportSummary['hours'],
  }
}

export async function fetchSeries(from: string, to: string, bucket: 'day' | 'month'): Promise<SeriesPoint[]> {
  const { data, error } = await supabase.rpc('sales_series', { p_from: from, p_to: to, p_bucket: bucket })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((x) => ({ date: String(x.date).slice(0, 10), total: n(x.total), invoices: n(x.invoices) }))
}

// ---------------------------------------------------------------------------
// Work of a worker
// ---------------------------------------------------------------------------
export interface Shift {
  id: string
  worker_id: string
  started_at: string
  ended_at: string | null
  opening_cash: number
  closing_cash: number | null
}

export type WorkEventType = 'sale' | 'void' | 'refund' | 'shift_start' | 'shift_end'

export interface WorkEvent {
  at: string
  type: WorkEventType
  invoice_no: number | null
  total: number | null
  payment_method: 'cash' | 'card' | 'mixed' | null
  items_count: number | null
  offline: boolean
  reason: string | null
  ref_invoice_no: number | null
  approved_by: string | null
  sale_id: string
}

export interface WorkSummary {
  worker: { id: string; name: string; role: Role; commission_pct: number }
  from: string
  to: string
  totals: {
    invoices: number
    total: number
    cash: number
    card: number
    voids: number
    void_total: number
    refunds: number
    refund_total: number
    offline: number
    items: number
  }
  commission: number
  minutes: number
  shifts: number
  first_start: string | null
  open_shift: Shift | null
  events: WorkEvent[]
}

function toShift(s: Record<string, unknown> | null): Shift | null {
  if (!s) return null
  return { ...(s as unknown as Shift), opening_cash: n(s.opening_cash), closing_cash: s.closing_cash == null ? null : n(s.closing_cash) }
}

export async function fetchWork(worker: string | null, from?: string, to?: string): Promise<WorkSummary> {
  const { data, error } = await supabase.rpc('work_summary', { p_worker: worker, p_from: from ?? null, p_to: to ?? null })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const w = r.worker as Record<string, unknown>
  return {
    worker: { id: w.id as string, name: (w.name as string) ?? '—', role: w.role as Role, commission_pct: n(w.commission_pct) },
    from: r.from as string,
    to: r.to as string,
    totals: numObj(r.totals as Record<string, unknown>),
    commission: n(r.commission),
    minutes: n(r.minutes),
    shifts: n(r.shifts),
    first_start: (r.first_start as string) ?? null,
    open_shift: toShift(r.open_shift as Record<string, unknown> | null),
    events: ((r.events as Record<string, unknown>[]) ?? []).map((e) => ({
      ...(e as unknown as WorkEvent),
      invoice_no: e.invoice_no == null ? null : n(e.invoice_no),
      total: e.total == null ? null : n(e.total),
      items_count: e.items_count == null ? null : n(e.items_count),
      ref_invoice_no: e.ref_invoice_no == null ? null : n(e.ref_invoice_no),
    })),
  }
}

export interface ComparisonRow {
  worker_id: string
  name: string
  role: Role
  active: boolean
  commission_pct: number
  invoices: number
  total: number
  voids: number
  refunds: number
  commission: number
  minutes: number
}

export async function fetchComparison(from: string, to: string): Promise<ComparisonRow[]> {
  const { data, error } = await supabase.rpc('workers_comparison', { p_from: from, p_to: to })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((x) => numObj<ComparisonRow>(x, ['worker_id', 'name', 'role', 'active']))
}

export async function fetchOpenShift(): Promise<Shift | null> {
  const { data, error } = await supabase.rpc('my_open_shift')
  if (error) fail(error)
  return toShift(data as Record<string, unknown> | null)
}

export async function startShift(opening_cash: number): Promise<Shift> {
  const { data, error } = await supabase.rpc('start_shift', { p: { opening_cash } })
  if (error) fail(error)
  return toShift(data as Record<string, unknown>)!
}

export async function endShift(closing_cash: number | null): Promise<Shift | null> {
  const { data, error } = await supabase.rpc('end_shift', { p: closing_cash == null ? {} : { closing_cash } })
  if (error) fail(error)
  return toShift(data as Record<string, unknown> | null)
}

// ---------------------------------------------------------------------------
// Invoices list (managers: all; RLS limits workers to their own)
// ---------------------------------------------------------------------------
export interface InvoiceRow {
  id: string
  kind: 'sale' | 'void' | 'refund'
  invoice_no: number
  ref_sale_id: string | null
  created_at: string
  worker_id: string
  payment_method: 'cash' | 'card' | 'mixed'
  items_count: number
  total: number
  offline: boolean
  fiscal_status: string
}

export async function fetchInvoices(from: string, to: string, limit = 500): Promise<InvoiceRow[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('id, kind, invoice_no, ref_sale_id, created_at, worker_id, payment_method, items_count, total, offline, fiscal_status')
    .gte('sale_date', from)
    .lte('sale_date', to)
    .order('invoice_no', { ascending: false })
    .limit(limit)
  if (error) fail(error)
  return (data ?? []).map((r) => ({ ...(r as InvoiceRow), invoice_no: n(r.invoice_no), items_count: n(r.items_count), total: n(r.total) }))
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export interface AuditRow {
  id: number
  user_id: string | null
  action: string
  entity: string | null
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export async function fetchAudit(opts: { from: string; to: string; userId?: string; action?: string; limit?: number }): Promise<AuditRow[]> {
  let q = supabase
    .from('audit_log')
    .select('id, user_id, action, entity, entity_id, details, created_at')
    .gte('created_at', new Date(opts.from + 'T00:00:00').toISOString())
    .lt('created_at', new Date(addDays(opts.to, 1) + 'T00:00:00').toISOString())
    .order('id', { ascending: false })
    .limit(opts.limit ?? 1000)
  if (opts.userId) q = q.eq('user_id', opts.userId)
  if (opts.action) q = q.eq('action', opts.action)
  const { data, error } = await q
  if (error) fail(error)
  return (data ?? []) as AuditRow[]
}

export const PAY_LABEL = { cash: 'Kesh', card: 'Kartelë', mixed: 'Kesh + Kartelë' } as const

export function pctChange(now: number, before: number): number | null {
  if (!before) return null
  return (now - before) / Math.abs(before)
}
