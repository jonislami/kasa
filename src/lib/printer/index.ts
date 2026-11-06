import type { Business } from '@/app/AuthProvider'
import { device } from '@/lib/device'
import type { Sale } from '@/features/pos/api'
import type { ReceiptSettings } from '@/features/settings/api'
import { receiptBytes, testPageBytes } from './receipt'

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

export function lastPrinterName(): string | null {
  try {
    const n = localStorage.getItem('kasa.printer.name')
    return n === null ? null : n || 'Printer'
  } catch {
    return null
  }
}
