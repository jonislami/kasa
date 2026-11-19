import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * The app keeps its OWN clock, taken from the server, so changing the device clock does not change
 * the time shown in the app or written on receipts.
 *
 *   serverNow() = server time at the last check + time elapsed since then on a monotonic timer
 *                 (performance.now(), which does not jump when someone changes the device clock).
 *
 * The device clock is only compared with it: more than 1 minute apart → warning (ATK requires a
 * correct date/time on fiscal coupons). Phase 9 adds the time returned by the ATK server.
 *
 * Phones: performance.now() stops while the phone sleeps (screen off, app in the background), so after waking the
 * app clock would lag by the time asleep. When the app comes back to the screen, the time asleep (from the device
 * clock, while hidden) is added and the server is asked again at once.
 */
export const MAX_DRIFT_MS = 60_000
const STORE_KEY = 'kasa.clockOffset'

interface Anchor {
  server: number // server time (ms) at the check
  perf: number // performance.now() at the same instant
}

let anchor: Anchor | null = null

// device clock and monotonic timer when the app went to the background
let hiddenAt: { wall: number; perf: number } | null = null

/** Back on screen after a sleep: add the time the monotonic timer missed, then ask the server. */
function onVisibility() {
  if (typeof document === 'undefined') return
  if (document.visibilityState === 'hidden') {
    hiddenAt = { wall: Date.now(), perf: performance.now() }
    return
  }
  if (hiddenAt && anchor) {
    const missed = Date.now() - hiddenAt.wall - (performance.now() - hiddenAt.perf)
    // more than 2 s: the timer stood still while the phone slept (a device-clock change while hidden is corrected by
    // the server check right below)
    if (missed > 2000 && missed < 30 * 24 * 3600_000) anchor = { server: anchor.server + missed, perf: anchor.perf }
  }
  hiddenAt = null
  void checkClock()
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

// After a reload without internet: last known offset (server − device) as a fallback.
let savedOffset: number | null = (() => {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === null ? null : Number(v)
  } catch {
    return null
  }
})()

/** Current time according to the server (ms since epoch). */
export function serverNow(): number {
  if (anchor) return anchor.server + (performance.now() - anchor.perf)
  if (savedOffset !== null && Number.isFinite(savedOffset)) return Date.now() + savedOffset
  return Date.now()
}

export function serverDate(): Date {
  return new Date(serverNow())
}

export interface ClockState {
  /** device − app clock, in ms (positive: the device is ahead). null = never measured. */
  drift: number | null
  checkedAt: number | null
  /** ok: device clock right · off: device clock wrong (the app still shows the right time)
   *  unknown: never checked · offline: no check possible now */
  status: 'unknown' | 'ok' | 'off' | 'offline'
  /** true when the app time comes from a server check in this session (not a guess). */
  verified: boolean
}

let checkedAt: number | null = null
let reachable = true

function compute(): ClockState {
  const known = anchor !== null || savedOffset !== null
  if (!known) return { drift: null, checkedAt: null, status: reachable ? 'unknown' : 'offline', verified: false }
  const drift = Date.now() - serverNow()
  const status = Math.abs(drift) > MAX_DRIFT_MS ? 'off' : anchor ? 'ok' : 'offline'
  return { drift, checkedAt, status, verified: anchor !== null }
}

let state: ClockState = compute()
const listeners = new Set<() => void>()
function refresh() {
  const next = compute()
  if (next.status !== state.status || next.checkedAt !== state.checkedAt || Math.abs((next.drift ?? 0) - (state.drift ?? 0)) > 1000) {
    state = next
    listeners.forEach((l) => l())
  }
}

let running: Promise<void> | null = null

export function checkClock(): Promise<void> {
  if (running) return running
  running = (async () => {
    try {
      const p0 = performance.now()
      const { data, error } = await supabase.rpc('server_time')
      const p1 = performance.now()
      if (error || !data) throw error ?? new Error('no time')
      // Half the round trip is the best guess of when the server read its clock.
      anchor = { server: Date.parse(String(data)) + (p1 - p0) / 2, perf: p1 }
      savedOffset = serverNow() - Date.now()
      try {
        localStorage.setItem(STORE_KEY, String(Math.round(savedOffset)))
      } catch {
        /* storage unavailable */
      }
      checkedAt = serverNow()
      reachable = true
    } catch {
      reachable = false
    } finally {
      running = null
      refresh()
    }
  })()
  return running
}

/** Checks on start, every 10 minutes and when the connection returns; re-evaluates the drift every second. */
export function useClock(): ClockState {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
  useEffect(() => {
    void checkClock()
    const t = window.setInterval(() => void checkClock(), 10 * 60_000)
    const r = window.setInterval(refresh, 1000) // notices at once when someone changes the device clock
    const onOnline = () => void checkClock()
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(t)
      window.clearInterval(r)
      window.removeEventListener('online', onOnline)
    }
  }, [])
  return snap
}

/** "2 min 15 s" */
export function formatDrift(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} orë${m % 60 ? ` ${m % 60} min` : ''}`
  return `${Math.round(h / 24)} ditë`
}

// ---------------------------------------------------------------------------
// Kosovo time: everything is shown and dated in Europe/Belgrade (CET/CEST), whatever the
// time zone set on the device.
// ---------------------------------------------------------------------------
export const KOSOVO_TZ = 'Europe/Belgrade'

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: KOSOVO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Date and time parts in Kosovo for an instant (default: now, app clock). */
export function kosovoParts(ms: number = serverNow()): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second) }
}

/** "2026-11-06" – the Kosovo date (default: today on the app clock). */
export function kosovoDateISO(ms: number = serverNow()): string {
  const { y, m, d } = kosovoParts(ms)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "06.11.2026 12:41" in Kosovo time. */
export function formatKosovoDateTime(iso: string | number): string {
  const { y, m, d, h, min } = kosovoParts(typeof iso === 'number' ? iso : Date.parse(iso))
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d)}.${p(m)}.${y} ${p(h)}:${p(min)}`
}

/** "2026-11-06" + "11:30" in Kosovo → the instant as an ISO string (handles CET/CEST). */
export function kosovoToIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, min)
  const p = kosovoParts(guess)
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess // Kosovo is ahead of UTC by this much
  return new Date(guess - offset).toISOString()
}

/** "11:30" in Kosovo for an instant. */
export function kosovoTime(iso: string | number): string {
  const { h, min } = kosovoParts(typeof iso === 'number' ? iso : Date.parse(iso))
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
