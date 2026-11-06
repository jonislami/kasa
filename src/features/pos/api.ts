import { supabase } from '@/lib/supabase'
import { kosovoDateISO, serverDate } from '@/lib/clock'
import type { VatCode } from '@/lib/vat'
import type { PosProduct } from './cart'

export type SaleKind = 'sale' | 'void' | 'refund'
export type PaymentMethod = 'cash' | 'card' | 'mixed'

export interface SaleItem {
  id: string
  position: number
  product_id: string | null
  name: string
  unit: string
  quantity: number
  unit_price: number
  line_discount: number
  invoice_discount: number
  total: number
  vat_code: VatCode
  refunded: number
}

export interface Sale {
  id: string
  kind: SaleKind
  ref_sale_id: string | null
  ref_invoice_no: number | null
  invoice_no: number
  daily_no: number
  sale_date: string
  created_at: string
  client_created_at: string | null
  items_count: number
  subtotal: number
  invoice_discount: number
  discount_total: number
  total: number
  net_total: number
  vat_total: number
  vat_lines: { code: VatCode; rate: number; gross: number; net: number; vat: number }[]
  payment_method: PaymentMethod
  cash_amount: number
  card_amount: number
  tendered: number | null
  change_amount: number
  reason: string | null
  note: string | null
  offline: boolean
  offline_no: string | null
  fiscal_status: string
  worker_id: string
  worker_name: string | null
  register_name: string | null
  items: SaleItem[]
  voided: boolean
  has_refunds: boolean
}

export interface CreateSaleInput {
  client_id: string
  register_id?: string | null
  items: { product_id: string; quantity: number; unit_price: number; discount?: number }[]
  invoice_discount?: number
  payment: { method: PaymentMethod; card_amount?: number; tendered?: number }
  offline?: boolean
  offline_no?: string
  client_created_at?: string
  note?: string
}

/** Thrown for "no connection" so the till can queue the sale offline. */
export class NetworkError extends Error {}

function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = String((e as { message?: string })?.message ?? e)
  return /fetch|network|load failed|timeout|ERR_INTERNET/i.test(msg)
}

/** Numbers come back from Postgres as numbers or numeric strings – normalise. */
function toSale(raw: unknown): Sale {
  const s = raw as Record<string, unknown>
  const n = (v: unknown) => (v == null ? 0 : Number(v))
  return {
    ...(s as unknown as Sale),
    invoice_no: n(s.invoice_no),
    daily_no: n(s.daily_no),
    ref_invoice_no: s.ref_invoice_no == null ? null : n(s.ref_invoice_no),
    items_count: n(s.items_count),
    subtotal: n(s.subtotal),
    invoice_discount: n(s.invoice_discount),
    discount_total: n(s.discount_total),
    total: n(s.total),
    net_total: n(s.net_total),
    vat_total: n(s.vat_total),
    cash_amount: n(s.cash_amount),
    card_amount: n(s.card_amount),
    tendered: s.tendered == null ? null : n(s.tendered),
    change_amount: n(s.change_amount),
    vat_lines: ((s.vat_lines as Sale['vat_lines']) ?? []).map((v) => ({
      ...v,
      rate: n(v.rate),
      gross: n(v.gross),
      net: n(v.net),
      vat: n(v.vat),
    })),
    items: ((s.items as SaleItem[]) ?? []).map((i) => ({
      ...i,
      quantity: n(i.quantity),
      unit_price: n(i.unit_price),
      line_discount: n(i.line_discount),
      invoice_discount: n(i.invoice_discount),
      total: n(i.total),
      refunded: n(i.refunded),
    })),
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res
  try {
    res = await supabase.rpc(fn, args)
  } catch (e) {
    if (isNetworkError(e)) throw new NetworkError('Nuk ka lidhje me internetin')
    throw e
  }
  if (res.error) {
    if (isNetworkError(res.error)) throw new NetworkError('Nuk ka lidhje me internetin')
    throw new Error(res.error.message)
  }
  return res.data as T
}

export async function createSale(input: CreateSaleInput): Promise<Sale> {
  return toSale(await rpc('create_sale', { p: input }))
}

export type ApprovalError = 'pin_required' | 'wrong_pin' | 'approver_locked' | 'approver_not_found' | 'approver_has_no_pin'

export const APPROVAL_MESSAGES: Record<ApprovalError, string> = {
  pin_required: 'Kërkohet PIN-i i menaxherit',
  wrong_pin: 'PIN-i është gabim',
  approver_locked: 'Shumë tentime të gabuara. Provo pas 15 minutash.',
  approver_not_found: 'Menaxheri nuk u gjet',
  approver_has_no_pin: 'Ky menaxher nuk ka vendosur ende PIN (Cilësimet → PIN-i im).',
}

type ApprovalResult = { ok: true; sale: Sale } | { ok: false; error: ApprovalError }

async function approvalRpc(fn: string, p: Record<string, unknown>): Promise<ApprovalResult> {
  const r = await rpc<{ ok: boolean; sale?: unknown; error?: ApprovalError }>(fn, { p })
  return r.ok ? { ok: true, sale: toSale(r.sale) } : { ok: false, error: r.error ?? 'pin_required' }
}

export function voidSale(p: {
  client_id: string
  sale_id: string
  reason: string
  note?: string
  restock?: boolean
  approver_id?: string
  pin?: string
  register_id?: string | null
}) {
  return approvalRpc('void_sale', p)
}

export function refundSale(p: {
  client_id: string
  sale_id: string
  items: { sale_item_id: string; quantity: number }[]
  reason: string
  note?: string
  restock: boolean
  method: 'cash' | 'card'
  approver_id?: string
  pin?: string
  register_id?: string | null
}) {
  return approvalRpc('refund_sale', p)
}

export async function lookupSale(invoiceNo: number): Promise<Sale | null> {
  const r = await rpc<unknown>('lookup_sale', { p_invoice_no: invoiceNo })
  return r ? toSale(r) : null
}

export async function getSale(id: string): Promise<Sale | null> {
  const r = await rpc<unknown>('sale_json', { p_sale_id: id })
  return r ? toSale(r) : null
}

export interface Approver {
  id: string
  full_name: string
  role: 'admin' | 'manager'
  has_pin: boolean
}

export async function fetchApprovers(): Promise<Approver[]> {
  return rpc<Approver[]>('business_approvers', {})
}

export async function setOwnPin(pin: string): Promise<void> {
  await rpc('set_own_pin', { p_pin: pin })
}

export async function myPinStatus(): Promise<boolean> {
  return Boolean(await rpc<boolean>('my_pin_status', {}))
}

export interface SaleRow {
  id: string
  kind: SaleKind
  invoice_no: number
  ref_sale_id: string | null
  total: number
  payment_method: PaymentMethod
  items_count: number
  created_at: string
  offline: boolean
}

/** Today's documents (workers: only their own, by RLS). */
export async function fetchTodaySales(date: string): Promise<SaleRow[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('id, kind, invoice_no, ref_sale_id, total, payment_method, items_count, created_at, offline')
    .eq('sale_date', date)
    .order('invoice_no', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({ ...r, invoice_no: Number(r.invoice_no), total: Number(r.total), items_count: Number(r.items_count) })) as SaleRow[]
}

export async function fetchPosProducts(): Promise<PosProduct[]> {
  const out: PosProduct[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('id, kind, name, barcode, category_id, unit, sale_price, vat_code, stock, min_stock, substance, duration_min')
      .eq('active', true)
      .eq('show_in_pos', true)
      .order('id')
      .range(from, from + 999)
    if (error) {
      if (isNetworkError(error)) throw new NetworkError('Nuk ka lidhje me internetin')
      throw new Error(error.message)
    }
    out.push(
      ...(data ?? []).map((p) => ({ ...p, sale_price: Number(p.sale_price), stock: Number(p.stock), min_stock: Number(p.min_stock) }) as PosProduct),
    )
    if (!data || data.length < 1000) break
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'sq'))
}

export interface Register {
  id: string
  name: string
}

/** Active registers; the last list is kept on the device so the till shows its name offline. */
export async function fetchRegisters(): Promise<Register[]> {
  try {
    const { data, error } = await supabase.from('registers').select('id, name').eq('active', true).order('name')
    if (error) throw new Error(error.message)
    try {
      localStorage.setItem('kasa.registers', JSON.stringify(data ?? []))
    } catch {
      /* storage unavailable */
    }
    return (data ?? []) as Register[]
  } catch (e) {
    if (isNetworkError(e)) {
      try {
        const cached = localStorage.getItem('kasa.registers')
        if (cached) return JSON.parse(cached) as Register[]
      } catch {
        /* ignore */
      }
    }
    throw e
  }
}

/** Local date in Kosovo (matches sale_date on the server). */
export function localDate(d = serverDate()): string {
  return kosovoDateISO(d.getTime())
}
