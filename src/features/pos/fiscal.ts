// The till's side of fiscalization: turns a Kasa sale (sale, cancel, return) into the ATK coupon via
// src/lib/fiscal. Returns null when this register on this device is not registered at ATK.
import { fetchSaleFiscal, fiscalize, type FiscalReceipt, type FiscalSale } from '@/lib/fiscal'
import type { Sale } from './api'

export function toFiscalSale(sale: Sale): FiscalSale {
  return {
    kind: sale.kind,
    total: sale.total,
    discount_total: sale.discount_total,
    cash_amount: sale.cash_amount,
    card_amount: sale.card_amount,
    vat_lines: sale.vat_lines,
    items: sale.items.map((i) => ({ name: i.name, unit: i.unit, quantity: i.quantity, unit_price: i.unit_price, total: i.total, vat_code: i.vat_code })),
  }
}

/**
 * @param key       client_id of the sale
 * @param saved     the sale is on the server (false while it waits in the offline queue)
 */
export async function fiscalizeSale(sale: Sale, o: { key: string; registerId: string | null; operator: string; saved: boolean }): Promise<FiscalReceipt | null> {
  if (!o.registerId) return null
  let referenceNo: string | null = null
  if (sale.kind !== 'sale') {
    // Cancel / return point to the original fiscal coupon; a sale made before fiscalization has none.
    const orig = sale.ref_sale_id ? await fetchSaleFiscal(sale.ref_sale_id) : null
    if (!orig) return null
    referenceNo = String(orig.coupon_id)
  }
  return fiscalize({ key: o.key, saleId: o.saved ? sale.id : null, registerId: o.registerId, sale: toFiscalSale(sale), operator: o.operator, referenceNo })
}
