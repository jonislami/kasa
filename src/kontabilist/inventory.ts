// Inventory for clients without the Kasa till (0026): items, warehouses, moves, stock from invoices, transfers, stocktaking.
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'
import type { VatCode } from '@/lib/vat'

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}
const n = (v: unknown) => (v == null ? 0 : Number(v))
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) fail(error)
  return data as T
}

export const UNITS = ['copë', 'kg', 'litër', 'pako', 'm', 'm²', 'kuti', 'arkë']

export interface Warehouse {
  id: string
  name: string
  is_default: boolean
  active: boolean
  items: number
}
export const fetchWarehouses = (clientId: string) => rpc<Warehouse[]>('acc_warehouses_list', { p_client: clientId }).then((r) => (r ?? []).map((w) => ({ ...w, items: n(w.items) })))
export const saveWarehouse = (p: { id?: string; client_id: string; name: string; is_default?: boolean; active?: boolean }) => rpc<string>('acc_warehouse_save', { p })

export type StockStatus = 'ok' | 'low' | 'critical' | 'negative'
export interface Item {
  id: string
  sku: string | null
  barcode: string | null
  name: string
  unit: string
  vat_code: VatCode
  purchase_price: number
  sale_price: number
  min_stock: number
  category: string | null
  note: string | null
  active: boolean
  stock: number
  by_wh: Record<string, number>
  avg_cost: number
  value: number
  last_move: string | null
  status: StockStatus
}
export async function fetchItems(clientId: string, asOf?: string): Promise<Item[]> {
  const rows = await rpc<Record<string, unknown>[]>('acc_items_list', { p_client: clientId, p_as_of: asOf ?? null })
  return (rows ?? []).map((i) => ({
    ...(i as unknown as Item),
    purchase_price: n(i.purchase_price),
    sale_price: n(i.sale_price),
    min_stock: n(i.min_stock),
    stock: n(i.stock),
    avg_cost: n(i.avg_cost),
    value: n(i.value),
    by_wh: Object.fromEntries(Object.entries((i.by_wh as Record<string, unknown>) ?? {}).map(([k, v]) => [k, n(v)])),
  }))
}
export const saveItem = (clientId: string, p: Partial<Item>) => {
  const { stock: _s, by_wh: _b, avg_cost: _a, value: _v, last_move: _l, status: _st, ...rest } = p
  void [_s, _b, _a, _v, _l, _st]
  return rpc<string>('acc_item_save', { p: { ...rest, client_id: clientId } })
}
export const deleteItem = (id: string) => rpc<'archived' | 'deleted'>('acc_item_delete', { p_id: id })
export const importItems = (clientId: string, rows: Record<string, unknown>[], date?: string) =>
  rpc<{ new: number; updated: number }>('acc_items_import', { p_client: clientId, p_rows: rows, p_date: date ?? null })

export type MoveKind = 'opening' | 'in' | 'out' | 'transfer_in' | 'transfer_out' | 'adjust'
export const MOVE_LABELS: Record<MoveKind, string> = {
  opening: 'Gjendje fillestare',
  in: 'Hyrje',
  out: 'Dalje',
  transfer_in: 'Transfer (hyrje)',
  transfer_out: 'Transfer (dalje)',
  adjust: 'Korrigjim',
}
export interface Move {
  id: string
  move_date: string
  kind: MoveKind
  qty: number
  unit_cost: number | null
  note: string | null
  created_at: string
  transfer_id: string | null
  stocktake_id: string | null
  item_id: string
  item_name: string
  unit: string
  warehouse_name: string
  doc_id: string | null
  doc_no: string | null
  doc_kind: 'sale' | 'purchase' | null
  created_by_name: string | null
}
export async function fetchMoves(clientId: string, itemId?: string | null, from?: string, to?: string): Promise<Move[]> {
  const rows = await rpc<Record<string, unknown>[]>('acc_stock_moves_list', { p_client: clientId, p_item: itemId ?? null, p_from: from ?? null, p_to: to ?? null })
  return (rows ?? []).map((m) => ({ ...(m as unknown as Move), qty: n(m.qty), unit_cost: m.unit_cost == null ? null : n(m.unit_cost) }))
}
export const addMove = (p: { client_id: string; item_id: string; warehouse_id?: string | null; kind: 'opening' | 'in' | 'out' | 'adjust'; qty: number; unit_cost?: number | null; move_date?: string; note?: string }) =>
  rpc<string>('acc_stock_move', { p })
export const deleteMove = (id: string) => rpc<void>('acc_stock_move_delete', { p_id: id })
export const transfer = (p: { client_id: string; from_warehouse: string; to_warehouse: string; move_date?: string; note?: string; lines: { item_id: string; qty: number }[] }) =>
  rpc<string>('acc_stock_transfer', { p })

export interface StockDoc {
  id: string
  kind: 'sale' | 'purchase'
  doc_type: 'invoice' | 'credit_note' | 'debit_note'
  doc_no: string | null
  doc_date: string
  partner_name: string | null
  total: number
  lines: number
  posted: number
}
export const fetchStockDocs = (clientId: string, from: string, to: string) =>
  rpc<StockDoc[]>('acc_stock_docs', { p_client: clientId, p_from: from, p_to: to }).then((r) => (r ?? []).map((d) => ({ ...d, total: n(d.total), lines: n(d.lines), posted: n(d.posted) })))

export interface DocLineMatch {
  id: string
  description: string
  unit: string
  quantity: number
  unit_price: number
  net: number
  vat_code: VatCode
  posted: boolean
  item_id: string | null
}
export async function fetchDocLines(docId: string): Promise<{ doc: { id: string; kind: 'sale' | 'purchase'; doc_type: string; doc_no: string | null; doc_date: string; partner_name: string | null }; lines: DocLineMatch[] }> {
  const r = await rpc<{ doc: never; lines: Record<string, unknown>[] }>('acc_stock_doc_lines', { p_doc: docId })
  return { doc: r.doc, lines: (r.lines ?? []).map((l) => ({ ...(l as unknown as DocLineMatch), quantity: n(l.quantity), unit_price: n(l.unit_price), net: n(l.net) })) }
}
export const postDoc = (p: { doc_id: string; warehouse_id?: string | null; lines: { line_id: string; item_id?: string | null; new_item?: { name: string; sku?: string; unit?: string }; qty?: number }[] }) =>
  rpc<number>('acc_stock_post_doc', { p })
export const unpostDoc = (docId: string) => rpc<number>('acc_stock_unpost_doc', { p_doc: docId })

export interface Stocktake {
  id: string
  take_date: string
  status: 'draft' | 'posted'
  warehouse_name: string
  note: string | null
  lines: number
  counted: number
  diffs: number
  posted_at: string | null
}
export const fetchStocktakes = (clientId: string) =>
  rpc<Stocktake[]>('acc_stocktakes_list', { p_client: clientId }).then((r) => (r ?? []).map((s) => ({ ...s, lines: n(s.lines), counted: n(s.counted), diffs: n(s.diffs) })))
export const createStocktake = (clientId: string, warehouseId: string | null, date: string) => rpc<string>('acc_stocktake_create', { p_client: clientId, p_warehouse: warehouseId, p_date: date })
export interface StocktakeDetail {
  id: string
  take_date: string
  status: 'draft' | 'posted'
  warehouse_id: string
  warehouse_name: string
  note: string | null
  lines: { item_id: string; name: string; sku: string | null; barcode: string | null; unit: string; expected: number; counted: number | null; avg_cost: number }[]
}
export async function fetchStocktake(id: string): Promise<StocktakeDetail> {
  const r = await rpc<Record<string, unknown>>('acc_stocktake', { p_id: id })
  return {
    ...(r as unknown as StocktakeDetail),
    lines: ((r.lines as Record<string, unknown>[]) ?? []).map((l) => ({ ...(l as unknown as StocktakeDetail['lines'][number]), expected: n(l.expected), counted: l.counted == null ? null : n(l.counted), avg_cost: n(l.avg_cost) })),
  }
}
export const countStocktake = (id: string, itemId: string, counted: number | null) => rpc<void>('acc_stocktake_count', { p_id: id, p_item: itemId, p_counted: counted })
export const postStocktake = (id: string) => rpc<number>('acc_stocktake_post', { p_id: id })
export const deleteStocktake = (id: string) => rpc<void>('acc_stocktake_delete', { p_id: id })

export const qtyFmt = (v: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(v)
