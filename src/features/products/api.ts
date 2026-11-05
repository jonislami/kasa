import { supabase } from '@/lib/supabase'
import type { UnitCode } from '@/lib/units'
import type { VatCode } from '@/lib/vat'

export type ProductKind = 'product' | 'service'

export interface Category {
  id: string
  name: string
  sort: number
}

export interface Product {
  id: string
  kind: ProductKind
  name: string
  barcode: string | null
  category_id: string | null
  unit: UnitCode
  sale_price: number
  vat_code: VatCode
  stock: number
  min_stock: number
  duration_min: number | null
  substance: string | null
  atk_type: string
  show_in_pos: boolean
  active: boolean
  updated_at: string
  /** Only for admin/manager (from product_costs); null for workers. */
  purchase_price: number | null
}

export interface ProductInput {
  id?: string
  kind: ProductKind
  name: string
  barcode?: string | null
  category_id?: string | null
  unit: UnitCode
  sale_price: number
  purchase_price?: number
  vat_code: VatCode
  min_stock?: number
  initial_stock?: number
  duration_min?: number | null
  substance?: string | null
  show_in_pos: boolean
}

export interface ImportRow {
  name: string
  barcode?: string
  category?: string
  unit?: UnitCode
  sale_price: number
  purchase_price?: number
  vat_code?: VatCode
  min_stock?: number
  stock?: number
  kind?: ProductKind
  duration_min?: number
}

/** Thrown when migration 0001 has not been run yet – the page shows a clear message. */
export class CatalogNotMigrated extends Error {
  constructor() {
    super('Katalogu nuk është aktivizuar ende në databazë (migrimi 0001_catalog.sql).')
  }
}

// Only a missing table or function means "not migrated"; other errors (e.g. a wrong column) are shown as they are.
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883'])

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new CatalogNotMigrated()
  throw new Error(error.message)
}

const PRODUCT_COLS =
  'id, kind, name, barcode, category_id, unit, sale_price, vat_code, stock, min_stock, duration_min, substance, atk_type, show_in_pos, active, updated_at'

async function fetchAll<T>(table: string, cols: string, orderBy: string): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from(table).select(cols).order(orderBy).range(from, from + page - 1)
    if (error) fail(error)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < page) break
  }
  return out
}

type ProductRow = Omit<Product, 'purchase_price' | 'sale_price' | 'stock' | 'min_stock'> & {
  sale_price: number | string
  stock: number | string
  min_stock: number | string
}

export async function fetchProducts(withCosts: boolean): Promise<Product[]> {
  const [rows, costs] = await Promise.all([
    fetchAll<ProductRow>('products', PRODUCT_COLS, 'id'),
    withCosts ? fetchAll<{ product_id: string; purchase_price: number | string }>('product_costs', 'product_id, purchase_price', 'product_id') : Promise.resolve([]),
  ])
  const costMap = new Map(costs.map((c) => [c.product_id, Number(c.purchase_price)]))
  return rows
    .map((r) => ({
      ...r,
      sale_price: Number(r.sale_price),
      stock: Number(r.stock),
      min_stock: Number(r.min_stock),
      purchase_price: withCosts ? (costMap.get(r.id) ?? 0) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sq'))
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, name, sort').order('sort').order('name')
  if (error) fail(error)
  return (data ?? []) as Category[]
}

export async function createCategory(name: string): Promise<Category> {
  const { data, error } = await supabase.from('categories').insert({ name: name.trim() }).select('id, name, sort').single()
  if (error) {
    if (error.code === '23505') throw new Error('Kjo kategori ekziston')
    fail(error)
  }
  return data as Category
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('categories').update({ name: name.trim() }).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('Kjo kategori ekziston')
    fail(error)
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) fail(error)
}

export async function saveProduct(input: ProductInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_product', { p: input })
  if (error) fail(error)
  return data as string
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_product_active', { p_id: id, p_active: active })
  if (error) fail(error)
}

export async function nextInternalBarcode(): Promise<string> {
  const { data, error } = await supabase.rpc('next_internal_barcode')
  if (error) fail(error)
  return data as string
}

export async function importProducts(rows: ImportRow[]): Promise<{ created: number; updated: number }> {
  const { data, error } = await supabase.rpc('import_products', { p_rows: rows })
  if (error) fail(error)
  return data as { created: number; updated: number }
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

/** Margin = (sale − purchase) / sale. Null when there is no sale price or no cost. */
export function margin(sale: number, purchase: number | null | undefined): number | null {
  if (!sale || purchase == null || purchase <= 0) return null
  return (sale - purchase) / sale
}

export type StockLevel = 'ok' | 'low' | 'critical' | 'none'

/** Low: stock <= min_stock (only when min_stock > 0); critical: stock <= min_stock / 2. Services: 'none'. */
export function stockLevel(p: Pick<Product, 'kind' | 'stock' | 'min_stock'>): StockLevel {
  if (p.kind === 'service') return 'none'
  if (p.min_stock <= 0) return 'ok'
  if (p.stock <= p.min_stock / 2) return 'critical'
  if (p.stock <= p.min_stock) return 'low'
  return 'ok'
}
