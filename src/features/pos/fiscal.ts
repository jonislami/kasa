// The till's side of fiscalization: turns a KontoSef sale (sale, cancel, return) into the ATK coupon via
// src/lib/fiscal. Returns null when this register on this device is not registered at ATK.
import { duplicateCoupons, fetchSaleFiscal, fiscalize, type FiscalReceipt, type FiscalSale } from '@/lib/fiscal'
import { groupItems } from '@/lib/printer/receiptFacts'
import { getSale, type Sale } from './api'

export function toFiscalSale(sale: Sale): FiscalSale {
  return {
    kind: sale.kind,
    total: sale.total,
    discount_total: sale.discount_total,
    cash_amount: sale.cash_amount,
    card_amount: sale.card_amount,
    voucher_amount: sale.voucher_amount ?? 0,
    payment_kind: sale.payment_kind ?? null,
    vat_lines: sale.vat_lines,
    // the same item on one line, as on the printed coupon (ATK)
    items: groupItems(sale.items).map((i) => ({ name: i.name, unit: i.unit, quantity: i.quantity, unit_price: i.unit_price, total: i.total, vat_code: i.vat_code, atk_type: i.atk_type ?? null })),
  }
}

/**
 * @param key       client_id of the sale
 * @param saved     the sale is on the server (false while it waits in the offline queue)
 */
export async function fiscalizeSale(sale: Sale, o: { key: string; registerId: string | null; operator: string; saved: boolean; issuedAt?: string | null; offline?: boolean }): Promise<FiscalReceipt | null> {
  if (!o.registerId) return null
  let referenceNo: string | null = null
  if (sale.kind !== 'sale') {
    // Cancel / return point to the original fiscal coupon; a sale made before fiscalization has none.
    const orig = sale.ref_sale_id ? await fetchSaleFiscal(sale.ref_sale_id) : null
    if (!orig) return null
    referenceNo = String(orig.coupon_id)
  }
  return fiscalize({ key: o.key, saleId: o.saved ? sale.id : null, registerId: o.registerId, sale: toFiscalSale(sale), operator: o.operator, referenceNo, issuedAt: o.issuedAt, offline: o.offline })
}

let repairing: Promise<void> | null = null
/**
 * A coupon refused by the server because its number was already used (it never reached ATK) is signed again with
 * the next free number, keeping the time and the worker of the sale, and sent.
 */
export function repairDuplicateCoupons(): Promise<void> {
  if (repairing) return repairing
  repairing = (async () => {
    try {
      for (const d of await duplicateCoupons()) {
        const sale = await getSale(d.sale_id).catch(() => null)
        if (!sale) continue
        await fiscalizeSale(sale, { key: d.key, registerId: d.register_id, operator: sale.worker_name ?? '', saved: true, issuedAt: d.issued_at, offline: d.offline }).catch(() => null)
      }
    } finally {
      repairing = null
    }
  })()
  return repairing
}
