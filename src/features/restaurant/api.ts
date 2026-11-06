import { supabase } from '@/lib/supabase'
import { round2 } from '@/lib/money'
import type { UnitCode } from '@/lib/units'
import type { VatCode } from '@/lib/vat'

/** Thrown when migration 0011 has not been run yet. */
export class RestaurantNotMigrated extends Error {
  constructor() {
    super('Tavolinat nuk janë aktivizuar ende në databazë (migrimi 0011_restaurant.sql).')
  }
}

const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883', '42703'])

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new RestaurantNotMigrated()
  if (/fetch|network|load failed/i.test(error.message)) throw new Error('Nuk ka lidhje me internetin – porositë kërkojnë internet')
  throw new Error(error.message)
}

async function rpc<T>(fn: string, p: unknown): Promise<T> {
  let res
  try {
    res = await supabase.rpc(fn, { p })
  } catch {
    throw new Error('Nuk ka lidhje me internetin – porositë kërkojnë internet')
  }
  if (res.error) fail(res.error)
  return res.data as T
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Station = 'kitchen' | 'bar'
export const STATION_LABELS: Record<Station, string> = { kitchen: 'Kuzhina', bar: 'Bari' }

export type TableShape = 'square' | 'round' | 'long'

export interface DiningTable {
  id: string
  name: string
  area: string
  seats: number
  shape: TableShape
  x: number
  y: number
}

export interface ModifierOption {
  name: string
  price: number
  product_id?: string
}
export interface ModifierGroup {
  name: string
  multi: boolean
  required: boolean
  options: ModifierOption[]
}

export interface MenuItem {
  id: string
  name: string
  category_id: string | null
  unit: UnitCode
  sale_price: number
  vat_code: VatCode
  stock: number
  kind: 'product' | 'service'
  has_recipe: boolean
  modifiers: ModifierGroup[]
}

export interface ChosenModifier {
  group: string
  name: string
  price: number
  product_id?: string | null
}

export type ItemStatus = 'new' | 'sent' | 'ready'

export interface OrderItem {
  id: string
  product_id: string
  name: string
  unit_price: number
  quantity: number
  paid_qty: number
  modifiers: ChosenModifier[]
  note: string | null
  station: Station | null
  status: ItemStatus
  created_at: string
  sent_at: string | null
  vat_code: VatCode
  unit: UnitCode
}

export interface Order {
  id: string
  order_no: number
  table_id: string | null
  table_name: string | null
  status: 'open' | 'paid' | 'cancelled'
  guests: number | null
  waiter_id: string | null
  waiter_name: string | null
  note: string | null
  opened_at: string
  items: OrderItem[]
}

export interface Ticket {
  id: string
  order_id: string
  station: Station
  table_name: string | null
  order_no: number
  waiter_name: string | null
  items: { name: string; quantity: number; modifiers: string[]; note: string | null }[]
  created_at: string
  printed_at: string | null
  done_at: string | null
}

/** Table status on the floor plan. */
export interface OpenOrderSummary {
  id: string
  order_no: number
  table_id: string | null
  opened_at: string
  waiter_id: string | null
  total: number
  unsent: number
  ready: number
}

function toOrder(raw: unknown): Order {
  const o = raw as Order
  return {
    ...o,
    order_no: Number(o.order_no),
    items: (o.items ?? []).map((i) => ({
      ...i,
      unit_price: Number(i.unit_price),
      quantity: Number(i.quantity),
      paid_qty: Number(i.paid_qty),
      modifiers: (i.modifiers ?? []).map((m) => ({ ...m, price: Number(m.price) })),
    })),
  }
}

export const lineOpen = (i: OrderItem) => round2(i.quantity - i.paid_qty)
export const orderTotal = (o: Pick<Order, 'items'>) => round2(o.items.reduce((s, i) => s + i.unit_price * lineOpen(i), 0))

// ---------------------------------------------------------------------------
// Tables & orders
// ---------------------------------------------------------------------------
export async function fetchTables(): Promise<DiningTable[]> {
  const { data, error } = await supabase.from('dining_tables').select('id, name, area, seats, shape, x, y').eq('active', true).order('name')
  if (error) fail(error)
  return (data ?? []) as DiningTable[]
}

export async function saveTables(tables: (Omit<DiningTable, 'id'> & { id?: string })[]): Promise<DiningTable[]> {
  return rpc<DiningTable[]>('save_tables', { tables })
}

export async function fetchOpenOrders(): Promise<OpenOrderSummary[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_no, table_id, opened_at, waiter_id, order_items(quantity, paid_qty, unit_price, status)')
    .eq('status', 'open')
    .order('opened_at')
  if (error) fail(error)
  return ((data ?? []) as unknown as (Omit<OpenOrderSummary, 'total' | 'unsent' | 'ready'> & {
    order_items: { quantity: number; paid_qty: number; unit_price: number; status: string }[]
  })[]).map((o) => {
    const live = o.order_items.filter((i) => i.status !== 'cancelled')
    return {
      id: o.id,
      order_no: Number(o.order_no),
      table_id: o.table_id,
      opened_at: o.opened_at,
      waiter_id: o.waiter_id,
      total: round2(live.reduce((s, i) => s + Number(i.unit_price) * (Number(i.quantity) - Number(i.paid_qty)), 0)),
      unsent: live.filter((i) => i.status === 'new').length,
      ready: live.filter((i) => i.status === 'ready' && Number(i.quantity) > Number(i.paid_qty)).length,
    }
  })
}

export async function fetchOrder(id: string): Promise<Order | null> {
  const { data, error } = await supabase.rpc('order_json', { p_order: id })
  if (error) fail(error)
  return data ? toOrder(data) : null
}

export async function openOrder(p: { table_id?: string | null; guests?: number }): Promise<Order> {
  return toOrder(await rpc('open_order', { ...p, client_id: crypto.randomUUID() }))
}

export async function addOrderItems(orderId: string, items: { product_id: string; quantity: number; modifiers?: { group: string; name: string }[]; note?: string }[]): Promise<Order> {
  return toOrder(await rpc('add_order_items', { order_id: orderId, items }))
}

export async function setOrderItem(itemId: string, patch: { quantity?: number; note?: string }): Promise<Order> {
  return toOrder(await rpc('set_order_item', { item_id: itemId, ...patch }))
}

export async function sendOrder(orderId: string): Promise<{ order: Order; tickets: Ticket[] }> {
  const r = await rpc<{ order: unknown; tickets: Ticket[] }>('send_order', { order_id: orderId })
  return { order: toOrder(r.order), tickets: r.tickets ?? [] }
}

export async function cancelOrderItem(p: { item_id: string; quantity: number; reason: string; approver_id?: string; pin?: string }): Promise<{ ok: true; order: Order } | { ok: false; error: string }> {
  const r = await rpc<{ ok: boolean; order?: unknown; error?: string }>('cancel_order_item', p)
  return r.ok ? { ok: true, order: toOrder(r.order) } : { ok: false, error: r.error ?? 'pin_required' }
}

export async function moveOrder(orderId: string, tableId: string): Promise<Order> {
  return toOrder(await rpc('move_order', { order_id: orderId, table_id: tableId }))
}

export async function cancelOrder(orderId: string): Promise<void> {
  await rpc('cancel_order', { order_id: orderId })
}

// ---------------------------------------------------------------------------
// Kitchen / bar
// ---------------------------------------------------------------------------
export async function fetchTickets(station: Station): Promise<Ticket[]> {
  const since = new Date(Date.now() - 12 * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('kitchen_tickets')
    .select('id, order_id, station, table_name, order_no, waiter_name, items, created_at, printed_at, done_at')
    .eq('station', station)
    .gte('created_at', since)
    .order('created_at')
    .limit(300)
  if (error) fail(error)
  return ((data ?? []) as Ticket[]).map((t) => ({ ...t, order_no: Number(t.order_no) }))
}

export async function setTicket(ticketId: string, patch: { printed?: boolean; done?: boolean }): Promise<void> {
  await rpc('set_ticket', { ticket_id: ticketId, ...patch })
}

// ---------------------------------------------------------------------------
// Menu (with modifiers), recipes, stations
// ---------------------------------------------------------------------------
export async function fetchMenu(): Promise<MenuItem[]> {
  const cols = 'id, name, category_id, unit, sale_price, vat_code, stock, kind, has_recipe, modifiers'
  const { data, error } = await supabase
    .from('products')
    .select(cols)
    .eq('active', true)
    .eq('show_in_pos', true)
    .is('addon_of', null)
    .is('has_variants', false)
    .order('name')
    .limit(5000)
  if (error) fail(error)
  return ((data ?? []) as unknown as MenuItem[]).map((p) => ({
    ...p,
    sale_price: Number(p.sale_price),
    stock: Number(p.stock),
    modifiers: (p.modifiers ?? []).map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, price: Number(o.price ?? 0) })) })),
  }))
}

export async function fetchModifiers(productId: string): Promise<ModifierGroup[]> {
  const { data, error } = await supabase.from('products').select('modifiers').eq('id', productId).maybeSingle()
  if (error) fail(error)
  return ((data?.modifiers as ModifierGroup[]) ?? []).map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, price: Number(o.price ?? 0) })) }))
}

export async function saveModifiers(productId: string, groups: ModifierGroup[]): Promise<ModifierGroup[]> {
  return rpc('save_modifiers', { product_id: productId, groups })
}

export interface RecipeLine {
  ingredient_id: string
  quantity: number
}

export async function fetchRecipe(productId: string): Promise<RecipeLine[]> {
  const { data, error } = await supabase.from('recipe_items').select('ingredient_id, quantity').eq('product_id', productId)
  if (error) fail(error)
  return (data ?? []).map((r) => ({ ingredient_id: r.ingredient_id as string, quantity: Number(r.quantity) }))
}

export async function saveRecipe(productId: string, items: RecipeLine[]): Promise<{ cost: number }> {
  const r = await rpc<{ cost: number }>('save_recipe', { product_id: productId, items })
  return { cost: Number(r.cost) }
}

export async function fetchCategoryStations(): Promise<Map<string, Station | null>> {
  const { data, error } = await supabase.from('categories').select('id, station')
  if (error) {
    if (error.code === '42703') return new Map()
    fail(error)
  }
  return new Map((data ?? []).map((c) => [c.id as string, (c.station as Station | null) ?? null]))
}

export async function setCategoryStation(categoryId: string, station: Station | null): Promise<void> {
  const { error } = await supabase.from('categories').update({ station }).eq('id', categoryId)
  if (error) fail(error)
}

/** Sale lines for paying order items: the dish plus one line per priced modifier. */
export function saleLinesFor(items: { item: OrderItem; qty: number }[], menu: Map<string, MenuItem>) {
  const lines: { product_id: string; quantity: number; unit_price: number; order_item_id: string; addon?: boolean }[] = []
  for (const { item, qty } of items) {
    if (qty <= 0) continue
    const addOns = item.modifiers.filter((m) => m.price > 0 && m.product_id)
    const base = round2(item.unit_price - addOns.reduce((s, m) => s + m.price, 0))
    lines.push({ product_id: item.product_id, quantity: qty, unit_price: menu.get(item.product_id)?.sale_price ?? base, order_item_id: item.id })
    for (const m of addOns) lines.push({ product_id: m.product_id!, quantity: qty, unit_price: m.price, order_item_id: item.id, addon: true })
  }
  return lines
}
