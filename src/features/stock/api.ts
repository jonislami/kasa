import { supabase } from '@/lib/supabase'
import { round2 } from '@/lib/money'
import type { VatCode } from '@/lib/vat'

/** Thrown when migration 0003 has not been run yet – the page shows a clear message. */
export class StockNotMigrated extends Error {
  constructor() {
    super('Stoku nuk është aktivizuar ende në databazë (migrimi 0003_stock.sql).')
  }
}

const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883', '42703'])

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new StockNotMigrated()
  throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
export interface Supplier {
  id: string
  name: string
  nui: string | null
  vat_number: string | null
  phone: string | null
  email: string | null
  address: string | null
  note: string | null
  active: boolean
}

export type SupplierInput = Omit<Supplier, 'id' | 'active'> & { id?: string; active?: boolean }

const SUPPLIER_COLS = 'id, name, nui, vat_number, phone, email, address, note, active'

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from('suppliers').select(SUPPLIER_COLS).order('name')
  if (error) fail(error)
  return (data ?? []) as Supplier[]
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? '').trim()
  return t ? t : null
}

export async function saveSupplier(input: SupplierInput): Promise<Supplier> {
  const row = {
    name: input.name.trim(),
    nui: clean(input.nui),
    vat_number: clean(input.vat_number),
    phone: clean(input.phone),
    email: clean(input.email),
    address: clean(input.address),
    note: clean(input.note),
    ...(input.active === undefined ? {} : { active: input.active }),
  }
  const q = input.id
    ? supabase.from('suppliers').update(row).eq('id', input.id).select(SUPPLIER_COLS).single()
    : supabase.from('suppliers').insert(row).select(SUPPLIER_COLS).single()
  const { data, error } = await q
  if (error) {
    if (error.code === '23505') throw new Error('Ky furnitor ekziston')
    fail(error)
  }
  return data as Supplier
}

// ---------------------------------------------------------------------------
// Goods entries
// ---------------------------------------------------------------------------
export type EntryPayment = 'cash' | 'bank' | 'due'
export type EntryStatus = 'draft' | 'confirmed'

export interface EntryVatLine {
  code: VatCode
  rate: number
  gross: number
  net: number
  vat: number
}

export interface StockEntry {
  id: string
  entry_no: number | null
  status: EntryStatus
  supplier_id: string | null
  invoice_no: string | null
  entry_date: string
  payment: EntryPayment
  due_days: number | null
  note: string | null
  items_count: number
  units_total: number
  total: number
  net_total: number
  vat_total: number
  vat_lines: EntryVatLine[]
  created_at: string
  confirmed_at: string | null
  created_by: string | null
}

export interface StockEntryItem {
  id: string
  position: number
  product_id: string
  name: string
  unit: string
  vat_code: VatCode
  quantity: number
  unit_cost: number
  total: number
}

export interface EntryInput {
  id?: string
  supplier_id: string | null
  invoice_no: string
  entry_date: string
  payment: EntryPayment
  due_days: number | null
  note: string
  items: { product_id: string; quantity: number; unit_cost: number }[]
}

const ENTRY_COLS =
  'id, entry_no, status, supplier_id, invoice_no, entry_date, payment, due_days, note, items_count, units_total, total, net_total, vat_total, vat_lines, created_at, confirmed_at, created_by'

function toEntry(r: Record<string, unknown>): StockEntry {
  return {
    ...(r as unknown as StockEntry),
    units_total: Number(r.units_total),
    total: Number(r.total),
    net_total: Number(r.net_total),
    vat_total: Number(r.vat_total),
    vat_lines: ((r.vat_lines as EntryVatLine[]) ?? []).map((l) => ({
      ...l,
      gross: Number(l.gross),
      net: Number(l.net),
      vat: Number(l.vat),
      rate: Number(l.rate),
    })),
  }
}

export async function fetchEntries(limit = 200): Promise<StockEntry[]> {
  const { data, error } = await supabase.from('stock_entries').select(ENTRY_COLS).order('created_at', { ascending: false }).limit(limit)
  if (error) fail(error)
  return (data ?? []).map((r) => toEntry(r as Record<string, unknown>))
}

export async function fetchEntryItems(entryId: string): Promise<StockEntryItem[]> {
  const { data, error } = await supabase
    .from('stock_entry_items')
    .select('id, position, product_id, name, unit, vat_code, quantity, unit_cost, total')
    .eq('entry_id', entryId)
    .order('position')
  if (error) fail(error)
  return (data ?? []).map((r) => ({
    ...(r as StockEntryItem),
    quantity: Number(r.quantity),
    unit_cost: Number(r.unit_cost),
    total: Number(r.total),
  }))
}

export async function saveEntryDraft(input: EntryInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_stock_entry', { p: input })
  if (error) fail(error)
  return data as string
}

export async function confirmEntry(input: EntryInput): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_stock_entry', { p: input })
  if (error) fail(error)
  return data as string
}

export async function deleteEntryDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_stock_entry', { p_id: id })
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// Movements, write-offs, inventory
// ---------------------------------------------------------------------------
export type MovementKind = 'initial' | 'entry' | 'sale' | 'void' | 'refund' | 'adjustment' | 'inventory'
export type AdjustReason = 'damage' | 'expired' | 'loss' | 'own_use' | 'return_supplier' | 'correction' | 'other'

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  initial: 'Stoku fillestar',
  entry: 'Hyrje',
  sale: 'Shitje',
  void: 'Anulim',
  refund: 'Kthim',
  adjustment: 'Shkarkim',
  inventory: 'Inventarizim',
}

export const REASON_LABELS: Record<AdjustReason, string> = {
  damage: 'I dëmtuar',
  expired: 'Skadim',
  loss: 'Humbje / vjedhje',
  own_use: 'Përdorim i brendshëm',
  return_supplier: 'Kthim te furnitori',
  correction: 'Korrigjim',
  other: 'Tjetër',
}

export interface Movement {
  id: number
  product_id: string
  kind: MovementKind
  quantity: number
  stock_after: number
  ref_type: string | null
  ref_id: string | null
  note: string | null
  reason: AdjustReason | null
  worker_id: string | null
  created_at: string
}

export async function fetchMovements(opts: { productId?: string; kind?: MovementKind; from?: string; to?: string; limit?: number }): Promise<Movement[]> {
  let q = supabase
    .from('stock_movements')
    .select('id, product_id, kind, quantity, stock_after, ref_type, ref_id, note, reason, worker_id, created_at')
    .order('id', { ascending: false })
    .limit(opts.limit ?? 300)
  if (opts.productId) q = q.eq('product_id', opts.productId)
  if (opts.kind) q = q.eq('kind', opts.kind)
  if (opts.from) q = q.gte('created_at', opts.from)
  if (opts.to) q = q.lt('created_at', opts.to)
  const { data, error } = await q
  if (error) fail(error)
  return (data ?? []).map((r) => ({ ...(r as Movement), quantity: Number(r.quantity), stock_after: Number(r.stock_after) }))
}

export async function adjustStock(p: { product_id: string; quantity: number; reason: AdjustReason; note?: string }): Promise<number> {
  const { data, error } = await supabase.rpc('adjust_stock', { p })
  if (error) fail(error)
  return Number(data)
}

export interface InventoryCount {
  id: string
  count_no: number
  title: string | null
  note: string | null
  items_count: number
  diff_count: number
  value_diff: number
  created_at: string
  created_by: string | null
}

export interface InventoryCountItem {
  id: number
  product_id: string
  name: string
  unit: string
  expected: number
  counted: number
  diff: number
  unit_cost: number
}

export async function fetchInventoryCounts(): Promise<InventoryCount[]> {
  const { data, error } = await supabase
    .from('inventory_counts')
    .select('id, count_no, title, note, items_count, diff_count, value_diff, created_at, created_by')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) fail(error)
  return (data ?? []).map((r) => ({ ...(r as InventoryCount), value_diff: Number(r.value_diff) }))
}

export async function fetchInventoryItems(countId: string): Promise<InventoryCountItem[]> {
  const { data, error } = await supabase
    .from('inventory_count_items')
    .select('id, product_id, name, unit, expected, counted, diff, unit_cost')
    .eq('count_id', countId)
    .order('name')
  if (error) fail(error)
  return (data ?? []).map((r) => ({
    ...(r as InventoryCountItem),
    expected: Number(r.expected),
    counted: Number(r.counted),
    diff: Number(r.diff),
    unit_cost: Number(r.unit_cost),
  }))
}

export async function confirmInventory(p: { title?: string; note?: string; items: { product_id: string; counted: number }[] }): Promise<{
  id: string
  count_no: number
  items_count: number
  diff_count: number
  value_diff: number
}> {
  const { data, error } = await supabase.rpc('confirm_inventory', { p })
  if (error) fail(error)
  return data as { id: string; count_no: number; items_count: number; diff_count: number; value_diff: number }
}

/** Names of the people in the business (for "who did it"). */
export async function fetchPeople(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('profiles').select('id, full_name, email')
  if (error) return new Map()
  return new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string) || '—']))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function lineTotal(quantity: number, unitCost: number): number {
  return round2(quantity * unitCost)
}

export function dueDate(entryDate: string, days: number | null): string | null {
  if (!days) return null
  const d = new Date(entryDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dateFmt = new Intl.DateTimeFormat('sq-AL', { day: '2-digit', month: '2-digit', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso.length === 10 ? iso + 'T00:00:00' : iso))
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso))
}
