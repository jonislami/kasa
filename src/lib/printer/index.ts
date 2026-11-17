import type { Business } from '@/app/AuthProvider'
import { device } from '@/lib/device'
import type { Sale } from '@/features/pos/api'
import type { ReceiptSettings } from '@/features/settings/api'
import { receiptBytes, testPageBytes } from './receipt'
import { ticketBytes } from './ticket'
import type { Ticket } from '@/features/restaurant/api'

export { receiptBytes, testPageBytes }

/** Connected, or reconnected silently to the last printer (no picker). */
export async function printerReady(): Promise<boolean> {
  if (device.printer.isConnected()) return true
  try {
    return Boolean(await device.printer.reconnect())
  } catch {
    return false
  }
}

/**
 * Prints a receipt on the Bluetooth/USB printer when one is connected; otherwise returns 'browser'
 * so the caller prints the on-screen receipt with window.print() (80mm).
 */
export async function printReceipt(
  sale: Sale,
  business: Business,
  settings: ReceiptSettings,
  opts: { copy?: boolean; openDrawer?: boolean } = {},
): Promise<'printer' | 'browser'> {
  const copies = opts.copy ? 1 : Math.min(Math.max(settings.settings.copies ?? 1, 1), 3)
  const drawer = Boolean(opts.openDrawer && settings.settings.open_drawer && sale.cash_amount > 0)
  const bytes = (i: number) => receiptBytes(sale, business, settings, { copy: opts.copy || i > 0, drawer: drawer && i === 0 })
  if (await printerReady()) {
    for (let i = 0; i < copies; i++) await device.printer.write(bytes(i), settings.printer_chunk)
    return 'printer'
  }
  const raw = await rawWindowsPrinter()
  if (!raw) return 'browser'
  const parts = Array.from({ length: copies }, (_, i) => bytes(i))
  await device.systemPrint!.printRaw!(raw, concat(parts))
  return 'printer'
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Kitchen/bar ticket on this device's printer; 'browser' when none is connected. */
export async function printTicket(ticket: Ticket, settings: ReceiptSettings, reprint = false): Promise<'printer' | 'browser'> {
  if (await printerReady()) {
    await device.printer.write(ticketBytes(ticket, settings, reprint), settings.printer_chunk)
    return 'printer'
  }
  const raw = await rawWindowsPrinter()
  if (!raw) return 'browser'
  await device.systemPrint!.printRaw!(raw, ticketBytes(ticket, settings, reprint))
  return 'printer'
}

export function lastPrinterName(): string | null {
  try {
    const n = localStorage.getItem('kasa.printer.name')
    return n === null ? null : n || 'Printer'
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Printer installed in Windows (e.g. Xprinter XP-80 with its driver): the Windows app prints the rendered
// receipt straight to it, without the print dialog. The chosen printer is kept on the device.
// ---------------------------------------------------------------------------
const WIN_PRINTER = 'kasa.winprinter'

export const windowsPrinter = (): string | null => {
  try {
    return localStorage.getItem(WIN_PRINTER) || null
  } catch {
    return null
  }
}
export const setWindowsPrinter = (name: string | null) => (name ? localStorage.setItem(WIN_PRINTER, name) : localStorage.removeItem(WIN_PRINTER))

/**
 * The printer for receipts: the one chosen in Printeri, else the Windows default, else a thermal receipt printer
 * found by name (Xprinter, POS-80, …), so a new till prints without any setup.
 */
export async function receiptPrinterName(): Promise<string | null> {
  const chosen = windowsPrinter()
  if (chosen || !device.systemPrint) return chosen
  const list = await device.systemPrint.list().catch(() => [])
  const def = list.find((p) => p.isDefault)
  if (def) return def.name
  const thermal = list.find((p) => THERMAL_RE.test(p.name))
  return thermal?.name ?? null
}

// How the Windows app prints: 'raw' = ESC/POS commands straight to the thermal printer (no driver; works with every
// receipt printer, also clones that print the driver's output as rows of symbols), 'driver' = the rendered receipt
// through the printer's Windows driver, 'dialog' = the print dialog. Default: 'raw' for a thermal printer, else 'driver'.
export type WinPrintMode = 'raw' | 'driver' | 'dialog'
const WIN_MODE = 'kasa.winprint.mode'
export const THERMAL_RE = /xprinter|xp-?\d|pos-?\d|thermal|receipt|epson tm|tm-t|rongta|bixolon|star tsp|80mm|58mm|gprinter|hprt|munbyn|zjiang/i

export const windowsPrintMode = (): WinPrintMode | null => {
  try {
    const m = localStorage.getItem(WIN_MODE)
    return m === 'raw' || m === 'driver' || m === 'dialog' ? m : null
  } catch {
    return null
  }
}
export const setWindowsPrintMode = (m: WinPrintMode | null) => (m ? localStorage.setItem(WIN_MODE, m) : localStorage.removeItem(WIN_MODE))

/** The mode in use for that printer: the one chosen, else raw for a thermal printer. */
export function effectiveMode(printer: string | null): WinPrintMode {
  const m = windowsPrintMode()
  if (m) return m
  return printer && THERMAL_RE.test(printer) ? 'raw' : 'driver'
}

/** The Windows printer that takes ESC/POS directly, when the raw mode is in use. */
async function rawWindowsPrinter(): Promise<string | null> {
  if (!device.systemPrint?.printRaw) return null
  const name = await receiptPrinterName()
  return name && effectiveMode(name) === 'raw' ? name : null
}

/** Removes the waiting jobs of the receipt printer (stuck jobs print later as symbols when the printer reconnects). */
export async function clearPrinterQueue(name?: string | null): Promise<void> {
  const n = name ?? (await receiptPrinterName())
  if (!n || !device.systemPrint?.clearQueue) throw new Error('Nuk ka printer të Windows')
  await device.systemPrint.clearQueue(n)
}

/** Test page: ESC/POS straight to the printer (raw mode) – shows at once whether the printer understands it. */
export async function printWindowsTest(businessName: string, s: ReceiptSettings, name?: string | null) {
  const n = name ?? (await receiptPrinterName())
  if (!n || !device.systemPrint?.printRaw) throw new Error('Zgjidh printerin')
  await device.systemPrint.printRaw(n, testPageBytes(businessName, s))
}

/**
 * Prints what the page renders for print (the receipt): silently through the Windows driver, else with the dialog.
 * In raw mode the receipt has already gone as ESC/POS; this runs only when that failed, so it opens the dialog
 * instead of queueing a driver job for a printer that may be unplugged.
 */
export async function printPage(): Promise<void> {
  const name = device.systemPrint ? await receiptPrinterName() : null
  if (device.systemPrint && effectiveMode(name) === 'driver') {
    try {
      await device.systemPrint.print(name ?? undefined)
      return
    } catch {
      /* printer missing or offline: fall back to the dialog */
    }
  }
  window.print()
}
