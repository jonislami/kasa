import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

/**
 * Real connectivity, not just "Wi-Fi is on": navigator.onLine stays true when the router has no
 * internet. Every request to the server goes through `trackedFetch`; a network failure switches
 * the app to offline (screens keep showing the last data kept on the device, queries pause
 * instead of failing) and a light ping every 10 s switches it back when the server answers again.
 */
let pingUrl: string | null = null
let pingHeaders: Record<string, string> = {}
let timer: number | null = null

export function configureConnectivity(url: string, anonKey: string) {
  pingUrl = `${url}/rest/v1/rpc/server_time`
  pingHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }
}

function setOnline(online: boolean) {
  if (onlineManager.isOnline() !== online) onlineManager.setOnline(online)
  if (online && timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  if (!online && timer === null && typeof window !== 'undefined') {
    timer = window.setInterval(() => void ping(), 10_000)
  }
}

async function ping() {
  if (!pingUrl) return
  try {
    const r = await fetch(pingUrl, { method: 'POST', headers: pingHeaders, body: '{}', cache: 'no-store' })
    if (r.status < 500) setOnline(true)
  } catch {
    /* still offline */
  }
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string })?.name === 'AbortError'
}

/** fetch for the Supabase client: reports network failures / recoveries to the app. */
export const trackedFetch: typeof fetch = async (input, init) => {
  try {
    const res = await fetch(input, init)
    if (!onlineManager.isOnline()) setOnline(true)
    return res
  } catch (e) {
    if (!isAbort(e)) setOnline(false)
    throw e
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOnline(false))
  window.addEventListener('online', () => void ping())
}

export function isAppOnline(): boolean {
  return onlineManager.isOnline()
}

export function useAppOnline(): boolean {
  return useSyncExternalStore(
    (l) => onlineManager.subscribe(l),
    () => onlineManager.isOnline(),
  )
}
