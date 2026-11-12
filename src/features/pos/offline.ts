import { useEffect, useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { device } from '@/lib/device'
import { attachSaleId, flushFiscal } from '@/lib/fiscal'
import { serverDate } from '@/lib/clock'
import { createSale, NetworkError, type CreateSaleInput, type Sale } from './api'
import type { Cart, PosProduct } from './cart'

/**
 * Offline sales queue (encrypted on the device via device.storage).
 * Every sale has a client_id, so sending it twice never creates two sales.
 * Phase 7 adds the full offline mode; phase 9 adds signing/sending to ATK within 48 hours.
 */

export interface QueuedSale {
  input: CreateSaleInput
  queued_at: string
  attempts: number
  last_error: string | null
  /** true when the server refused it (not a network problem) – needs a manager. */
  rejected: boolean
}

const PREFIX = 'sale-queue:'

type State = { online: boolean; pending: QueuedSale[]; syncing: boolean; lastSync: string | null }
let state: State = { online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: [], syncing: false, lastSync: null }
const listeners = new Set<() => void>()

// Real connectivity (see lib/connectivity): offline when the server cannot be reached even with Wi-Fi on.
onlineManager.subscribe((online) => {
  if (state.online !== online) {
    state = { ...state, online }
    listeners.forEach((l) => l())
    if (online) void syncQueue()
  }
})

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

async function loadPending() {
  const keys = await device.storage.keys(PREFIX)
  const items = (await Promise.all(keys.map((k) => device.storage.get<QueuedSale>(k)))).filter(Boolean) as QueuedSale[]
  items.sort((a, b) => a.queued_at.localeCompare(b.queued_at))
  set({ pending: items })
}

export async function enqueueSale(input: CreateSaleInput): Promise<void> {
  const item: QueuedSale = { input, queued_at: serverDate().toISOString(), attempts: 0, last_error: null, rejected: false }
  await device.storage.set(PREFIX + input.client_id, item)
  await loadPending()
}

let syncing: Promise<void> | null = null

/** Sends queued sales one by one, oldest first. Returns the sales the server stored. */
export function syncQueue(onSent?: (s: Sale) => void): Promise<void> {
  if (syncing) return syncing
  syncing = (async () => {
    set({ syncing: true })
    try {
      await loadPending()
      for (const q of state.pending) {
        if (q.rejected) continue
        try {
          const sale = await createSale(q.input)
          await device.storage.remove(PREFIX + q.input.client_id)
          await attachSaleId(q.input.client_id, sale.id) // its fiscal coupon can now go to ATK
          onSent?.(sale)
          set({ online: true })
        } catch (e) {
          const network = e instanceof NetworkError
          await device.storage.set(PREFIX + q.input.client_id, {
            ...q,
            attempts: q.attempts + 1,
            last_error: (e as Error).message,
            rejected: !network,
          } satisfies QueuedSale)
          if (network) {
            set({ online: false })
            break
          }
        }
      }
      set({ lastSync: serverDate().toISOString() })
      if (state.online) void flushFiscal()
    } finally {
      await loadPending()
      set({ syncing: false })
      syncing = null
    }
  })()
  return syncing
}

export async function discardQueued(clientId: string) {
  await device.storage.remove(PREFIX + clientId)
  await loadPending()
}

export function markOnline(online: boolean) {
  if (state.online !== online) set({ online })
}

/** Starts background sync (on load, when the connection returns, every 30 s while something is pending). */
export function useOfflineQueue(onSent?: (s: Sale) => void) {
  const snap = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    void syncQueue(onSent)
    const goOnline = () => {
      markOnline(true)
      void syncQueue(onSent)
    }
    const goOffline = () => markOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    const t = window.setInterval(() => {
      if (state.pending.some((p) => !p.rejected)) void syncQueue(onSent)
    }, 30_000)
    // Fiscal coupons ATK has not confirmed yet (no answer at the time of the sale).
    const f = window.setInterval(() => {
      if (state.online && !state.pending.length) void flushFiscal()
    }, 120_000)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.clearInterval(t)
      window.clearInterval(f)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return snap
}

/** OFF-ab12-0007: temporary number printed on an offline receipt until the server assigns the real one. */
export async function nextOfflineNo(): Promise<string> {
  const id = (await device.getDeviceId()).replace(/-/g, '').slice(0, 4)
  const n = Number(localStorage.getItem('kasa.offlineSeq') ?? '0') + 1
  localStorage.setItem('kasa.offlineSeq', String(n))
  return `OFF-${id}-${String(n).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// Catalog copy for the till (so it opens without internet)
// ---------------------------------------------------------------------------
const CATALOG_KEY = 'pos-catalog'

export async function saveCatalog(businessId: string, products: PosProduct[], categories: { id: string; name: string }[]) {
  await device.storage.set(CATALOG_KEY, { businessId, products, categories, saved_at: new Date().toISOString() })
}

export async function loadCatalog(businessId: string) {
  const c = await device.storage.get<{ businessId: string; products: PosProduct[]; categories: { id: string; name: string }[]; saved_at: string }>(
    CATALOG_KEY,
  )
  return c && c.businessId === businessId ? c : null
}

// ---------------------------------------------------------------------------
// Held invoices ("Ruaj në pritje") – kept on this device only
// ---------------------------------------------------------------------------
export interface HeldCart {
  id: string
  label: string
  saved_at: string
  cart: Cart
}

const HELD_KEY = 'kasa.heldCarts'

export function loadHeld(businessId: string): HeldCart[] {
  try {
    return (JSON.parse(localStorage.getItem(`${HELD_KEY}.${businessId}`) ?? '[]') as HeldCart[]) ?? []
  } catch {
    return []
  }
}

export function saveHeld(businessId: string, list: HeldCart[]) {
  localStorage.setItem(`${HELD_KEY}.${businessId}`, JSON.stringify(list))
}
