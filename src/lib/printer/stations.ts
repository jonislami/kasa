// Kitchen / bar printers of this device (restaurant). Each station prints its tickets on its own printer:
//  - 'receipt': the receipt printer of this device (Bluetooth / USB / Windows) – as before
//  - 'windows': a printer installed in Windows, ESC/POS straight to it (RAW)
//  - 'network': a printer on the local network (Ethernet / Wi-Fi), ESC/POS to IP:port (9100)
//  - 'off'    : this device does not print the station's tickets (the kitchen screen or another device does)
// Kept on the device: each till / tablet decides where it sends the tickets of the orders taken on it.
import { device } from '@/lib/device'
import type { Station } from '@/features/restaurant/api'
import type { PaperWidth } from './escpos'

export type StationTarget =
  | { kind: 'off' }
  | { kind: 'receipt' }
  | { kind: 'windows'; name: string; paper?: PaperWidth }
  | { kind: 'network'; host: string; port: number; paper?: PaperWidth }

const KEY = 'kasa.station.printers'
export const STATIONS: Station[] = ['kitchen', 'bar']

function readAll(): Partial<Record<Station, StationTarget>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<Station, StationTarget>>
  } catch {
    return {}
  }
}

export function stationTarget(s: Station): StationTarget | null {
  const t = readAll()[s]
  if (!t) return null
  if (t.kind === 'windows' && !t.name) return null
  if (t.kind === 'network' && !validHost(t.host)) return null
  return t
}

export function setStationTarget(s: Station, t: StationTarget | null) {
  const all = readAll()
  if (t) all[s] = t
  else delete all[s]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable */
  }
}

export const validHost = (h: string | undefined | null) =>
  Boolean(h && /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i.test(h.trim()))

/** What this device can print to: Windows printers (Windows app), network printers (Windows and Android apps). */
export const targetSupport = () => ({ windows: Boolean(device.systemPrint?.printRaw), network: Boolean(device.networkPrint) })

/** Sends ESC/POS bytes to a station printer that is not the receipt printer. */
export async function sendToTarget(t: Extract<StationTarget, { kind: 'windows' | 'network' }>, bytes: Uint8Array): Promise<void> {
  if (t.kind === 'windows') {
    if (!device.systemPrint?.printRaw) throw new Error('Printerët e Windows-it janë vetëm në programin për Windows')
    await device.systemPrint.printRaw(t.name, bytes)
    return
  }
  if (!device.networkPrint) throw new Error('Printerët në rrjet janë vetëm në programin për Windows dhe Android')
  await device.networkPrint.send(t.host.trim(), t.port || 9100, bytes)
}

export const targetLabel = (t: StationTarget | null): string =>
  !t || t.kind === 'receipt' ? 'Printeri i faturave' : t.kind === 'off' ? 'Nuk printohet këtu' : t.kind === 'windows' ? t.name : `${t.host}:${t.port || 9100}`
