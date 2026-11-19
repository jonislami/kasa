import type { Business } from '@/app/AuthProvider'
import { device } from '@/lib/device'
import type { Sale } from '@/features/pos/api'
import type { ReceiptSettings } from '@/features/settings/api'
import { receiptBytes, testPageBytes } from './receipt'
import { ticketBytes } from './ticket'
import { sendToTarget, stationTarget } from './stations'
import type { Ticket } from '@/features/restaurant/api'
import { PrinterError, toPrinterError } from './errors'

export { receiptBytes, testPageBytes }
export { PrinterError, toPrinterError, PRINTER_ERROR_HINTS, PRINTER_ERROR_TITLES, type PrinterErrorKind } from './errors'

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
 * Bytes to this device's receipt printer: the Bluetooth / USB one when it answers, else the Windows printer in raw
 * mode. 'browser' only when this device has no printer set up (the caller then prints the on-screen receipt).
 * A printer that is set up but does not answer throws a PrinterError – the till says so instead of opening the
 * print dialog by itself.
 */
async function toReceiptPrinter(chunks: Uint8Array[], chunkSize: number): Promise<'printer' | 'browser'> {
  if (await printerReady()) {
    try {
      for (const c of chunks) await device.printer.write(c, chunkSize)
    } catch (e) {
      throw toPrinterError(e)
    }
    return 'printer'
  }
  const raw = await rawWindowsPrinter()
  if (raw) {
    try {
      await device.systemPrint!.printRaw!(raw, concat(chunks))
    } catch (e) {
      throw toPrinterError(e)
    }
    return 'printer'
  }
  const remembered = lastPrinterName()
  if (remembered) throw new PrinterError('offline', `Printeri “${remembered}” nuk përgjigjet.`)
  return 'browser'
}

/** Forgets the Bluetooth / USB printer of this device (Printeri → Shkëput), so a missing printer is not an error. */
export function forgetPrinter() {
  try {
    for (const k of ['kasa.printer.name', 'kasa.printer.kind', 'kasa.printer.ble', 'kasa.printer.spp']) localStorage.removeItem(k)
  } catch {
    /* storage unavailable */
  }
}

/**
 * Prints a receipt on this device's printer; 'browser' when it has none, so the caller prints the on-screen receipt
 * with window.print(). Throws a PrinterError when the printer does not answer.
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
  return toReceiptPrinter(Array.from({ length: copies }, (_, i) => bytes(i)), settings.printer_chunk)
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

/**
 * Kitchen/bar ticket: on the station's own printer when this device has one (Windows printer or network printer,
 * Printeri → Kuzhina / Bari), else on this device's receipt printer; 'browser' when none is connected.
 */
export async function printTicket(ticket: Ticket, settings: ReceiptSettings, reprint = false): Promise<'printer' | 'browser'> {
  const target = stationTarget(ticket.station)
  if (target && (target.kind === 'windows' || target.kind === 'network')) {
    // the station printer's own paper; characters per line follow it
    const s = target.paper ? { ...settings, paper_width: target.paper, settings: { ...settings.settings, line_chars: null } } : settings
    try {
      await sendToTarget(target, ticketBytes(ticket, s, reprint))
    } catch (e) {
      throw toPrinterError(e)
    }
    return 'printer'
  }
  return toReceiptPrinter([ticketBytes(ticket, settings, reprint)], settings.printer_chunk)
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
 * The printer for receipts: the one chosen in Printeri, else a thermal receipt printer found by name (Xprinter,
 * POS-80, …) – the default thermal one first –, else the Windows default, so a new till prints without any setup
 * (the default is often "Microsoft Print to PDF" or OneNote).
 */
export async function receiptPrinterName(): Promise<string | null> {
  const chosen = windowsPrinter()
  if (chosen || !device.systemPrint) return chosen
  const list = await device.systemPrint.list().catch(() => [])
  const thermal = list.filter((p) => THERMAL_RE.test(p.name))
  const pick = thermal.find((p) => p.isDefault) ?? thermal[0] ?? list.find((p) => p.isDefault)
  return pick?.name ?? null
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
  try {
    await device.systemPrint.printRaw(n, testPageBytes(businessName, s))
  } catch (e) {
    throw toPrinterError(e)
  }
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
