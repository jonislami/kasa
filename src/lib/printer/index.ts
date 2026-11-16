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
  if (!(await printerReady())) return 'browser'
  const copies = opts.copy ? 1 : Math.min(Math.max(settings.settings.copies ?? 1, 1), 3)
  const drawer = Boolean(opts.openDrawer && settings.settings.open_drawer && sale.cash_amount > 0)
  for (let i = 0; i < copies; i++) {
    await device.printer.write(receiptBytes(sale, business, settings, { copy: opts.copy || i > 0, drawer: drawer && i === 0 }), settings.printer_chunk)
  }
  return 'printer'
}

/** Kitchen/bar ticket on this device's printer; 'browser' when none is connected. */
export async function printTicket(ticket: Ticket, settings: ReceiptSettings, reprint = false): Promise<'printer' | 'browser'> {
  if (!(await printerReady())) return 'browser'
  await device.printer.write(ticketBytes(ticket, settings, reprint), settings.printer_chunk)
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
  const thermal = list.find((p) => /xprinter|xp-?\d|pos-?\d|thermal|receipt|epson tm|tm-t|rongta|bixolon|star tsp|80mm|58mm/i.test(p.name))
  return thermal?.name ?? null
}

/** Prints what the page renders for print (the receipt): silently on the Windows printer, else with the browser dialog. */
export async function printPage(): Promise<void> {
  if (device.systemPrint) {
    try {
      await device.systemPrint.print((await receiptPrinterName()) ?? undefined)
      return
    } catch {
      /* printer missing or offline: fall back to the dialog */
    }
  }
  window.print()
}
