import { round2 } from '@/lib/money'
import { VAT_RATES, type VatCode } from '@/lib/vat'
import type { UnitCode } from '@/lib/units'

/** What the till needs from a product (no purchase price). */
export interface PosProduct {
  id: string
  kind: 'product' | 'service'
  name: string
  barcode: string | null
  category_id: string | null
  unit: UnitCode
  sale_price: number
  vat_code: VatCode
  stock: number
  min_stock: number
  substance: string | null
  duration_min: number | null
}

export interface CartLine {
  key: string // product id (+ "@staff" in a salon: one line per product and worker)
  product: PosProduct
  quantity: number
  discount: number // amount off the line (EUR)
  /** Salon: who performs the service / sells the product (commission). */
  staffId?: string | null
}

const lineKey = (productId: string, staffId?: string | null) => (staffId ? `${productId}@${staffId}` : productId)

export interface Cart {
  lines: CartLine[]
  invoiceDiscount: number // amount off the subtotal (EUR)
}

export const emptyCart = (): Cart => ({ lines: [], invoiceDiscount: 0 })

export function roundQty(q: number, unit: string): number {
  return unit === 'kg' ? Math.round(q * 1000) / 1000 : Math.round(q)
}

export function addToCart(cart: Cart, product: PosProduct, quantity = 1, staffId?: string | null): Cart {
  const key = lineKey(product.id, staffId)
  const existing = cart.lines.find((l) => l.key === key)
  if (existing) {
    return {
      ...cart,
      lines: cart.lines.map((l) => (l.key === key ? { ...l, quantity: roundQty(l.quantity + quantity, product.unit) } : l)),
    }
  }
  return { ...cart, lines: [...cart.lines, { key, product, quantity: roundQty(quantity, product.unit), discount: 0, staffId: staffId ?? null }] }
}

/** Salon: another worker performs this line (merges with an identical line of that worker). */
export function setLineStaff(cart: Cart, key: string, staffId: string): Cart {
  const line = cart.lines.find((l) => l.key === key)
  if (!line) return cart
  const newKey = lineKey(line.product.id, staffId)
  if (newKey === key) return cart
  const other = cart.lines.find((l) => l.key === newKey)
  if (other) {
    return {
      ...cart,
      lines: cart.lines
        .filter((l) => l.key !== key)
        .map((l) => (l.key === newKey ? { ...l, quantity: roundQty(l.quantity + line.quantity, l.product.unit), discount: round2(l.discount + line.discount) } : l)),
    }
  }
  return { ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, key: newKey, staffId } : l)) }
}

export function setQuantity(cart: Cart, key: string, quantity: number): Cart {
  if (quantity <= 0) return { ...cart, lines: cart.lines.filter((l) => l.key !== key) }
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      if (l.key !== key) return l
      const q = roundQty(quantity, l.product.unit)
      // keep the line discount valid
      return { ...l, quantity: q, discount: Math.min(l.discount, round2(q * l.product.sale_price)) }
    }),
  }
}

export function setLineDiscount(cart: Cart, key: string, discount: number): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, discount: round2(Math.max(0, discount)) } : l)) }
}

export interface LineTotals {
  key: string
  gross: number // qty × price
  lineDiscount: number
  invoiceShare: number
  total: number
  vat_code: VatCode
}

export interface CartTotals {
  lines: LineTotals[]
  subtotal: number // after line discounts
  invoiceDiscount: number
  discountTotal: number
  total: number
  vat: { code: VatCode; rate: number; gross: number; net: number; vat: number }[]
  vatTotal: number
  netTotal: number
  itemsCount: number
}

/**
 * Mirrors create_sale on the server: line totals, the invoice discount spread over the lines
 * by size (largest first, remainder on the largest), then VAT once per rate over the gross of that rate.
 */
export function computeTotals(cart: Cart): CartTotals {
  const base = cart.lines.map((l) => {
    const gross = round2(l.quantity * l.product.sale_price)
    const lineDiscount = Math.min(round2(l.discount), gross)
    return { key: l.key, gross, lineDiscount, invoiceShare: 0, total: round2(gross - lineDiscount), vat_code: l.product.vat_code }
  })
  const subtotal = round2(base.reduce((s, l) => s + l.total, 0))
  const invoiceDiscount = Math.min(round2(cart.invoiceDiscount), subtotal)

  if (invoiceDiscount > 0 && subtotal > 0) {
    const order = [...base].sort((a, b) => b.total - a.total)
    let left = invoiceDiscount
    for (const l of order) {
      const share = Math.min(round2((invoiceDiscount * l.total) / subtotal), left, l.total)
      l.invoiceShare = share
      left = round2(left - share)
    }
    if (left !== 0 && order[0]) order[0].invoiceShare = round2(order[0].invoiceShare + left)
    for (const l of base) l.total = round2(l.total - l.invoiceShare)
  }

  const byRate = new Map<VatCode, number>()
  for (const l of base) byRate.set(l.vat_code, round2((byRate.get(l.vat_code) ?? 0) + l.total))
  const vat = [...byRate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([code, gross]) => {
      const rate = VAT_RATES[code]
      const net = round2(gross / (1 + rate))
      return { code, rate, gross, net, vat: round2(gross - net) }
    })
  const total = round2(subtotal - invoiceDiscount)
  const netTotal = round2(vat.reduce((s, v) => s + v.net, 0))
  return {
    lines: base,
    subtotal,
    invoiceDiscount,
    discountTotal: round2(base.reduce((s, l) => s + l.lineDiscount, 0) + invoiceDiscount),
    total,
    vat,
    vatTotal: round2(total - netTotal),
    netTotal,
    itemsCount: cart.lines.reduce((s, l) => s + l.quantity, 0),
  }
}
