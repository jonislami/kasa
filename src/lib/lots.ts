import { supabase } from '@/lib/supabase'
import { kosovoDateISO } from '@/lib/clock'

/** A pharmacy lot: batch number + expiry date with its quantity (no prices). */
export interface Lot {
  id: string
  product_id: string
  lot_no: string | null
  expires_on: string | null
  quantity: number
}

export type ExpiryStatus = 'expired' | 'soon' | 'near' | 'ok' | 'none'

/** Days within which a lot counts as "soon" (red-ish) and "near" (amber). */
export const EXPIRY_SOON_DAYS = 30
export const EXPIRY_NEAR_DAYS = 90

/** Lots with stock. Returns [] when migration 0010 has not been run (older database). */
export async function fetchLots(): Promise<Lot[]> {
  const { data, error } = await supabase
    .from('product_lots')
    .select('id, product_id, lot_no, expires_on, quantity')
    .gt('quantity', 0)
    .order('expires_on', { ascending: true, nullsFirst: false })
    .limit(10000)
  if (error) {
    if (['42P01', 'PGRST205', '42703'].includes(error.code ?? '')) return []
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => ({ ...(r as Lot), quantity: Number(r.quantity) }))
}

export async function assignLot(p: { product_id: string; lot_no?: string; expires_on?: string; quantity: number }): Promise<string> {
  const { data, error } = await supabase.rpc('assign_lot', { p })
  if (error) throw new Error(error.message)
  return data as string
}

export function daysUntil(dateISO: string, today = kosovoDateISO()): number {
  return Math.round((Date.parse(dateISO + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000)
}

export function expiryStatus(expiresOn: string | null, today = kosovoDateISO()): ExpiryStatus {
  if (!expiresOn) return 'none'
  const d = daysUntil(expiresOn, today)
  if (d < 0) return 'expired'
  if (d <= EXPIRY_SOON_DAYS) return 'soon'
  if (d <= EXPIRY_NEAR_DAYS) return 'near'
  return 'ok'
}

/** "12.2027" style short expiry used on cards; full date elsewhere. */
export function formatExpiry(iso: string, short = false): string {
  const [y, m, d] = iso.split('-')
  return short ? `${m}/${y}` : `${d}.${m}.${y}`
}

export function expiryText(expiresOn: string | null, today = kosovoDateISO()): string {
  if (!expiresOn) return 'Pa afat'
  const d = daysUntil(expiresOn, today)
  if (d < 0) return `Skaduar më ${formatExpiry(expiresOn)}`
  if (d === 0) return 'Skadon sot'
  if (d <= EXPIRY_NEAR_DAYS) return `Skadon për ${d} ditë`
  return `Skadon ${formatExpiry(expiresOn)}`
}

export interface ProductLotSummary {
  lots: Lot[]
  /** Quantity in lots that have not expired (or have no expiry). */
  valid: number
  expired: number
  /** Nearest expiry among valid lots. */
  next: string | null
}

export function summarizeLots(lots: Lot[], today = kosovoDateISO()): Map<string, ProductLotSummary> {
  const m = new Map<string, ProductLotSummary>()
  for (const l of lots) {
    const s = m.get(l.product_id) ?? { lots: [], valid: 0, expired: 0, next: null }
    s.lots.push(l)
    if (expiryStatus(l.expires_on, today) === 'expired') s.expired += l.quantity
    else {
      s.valid += l.quantity
      if (l.expires_on && (!s.next || l.expires_on < s.next)) s.next = l.expires_on
    }
    m.set(l.product_id, s)
  }
  return m
}
