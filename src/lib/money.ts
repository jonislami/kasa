const eur = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** €1,248.60 – the format used across the design. */
export function formatEUR(value: number): string {
  return eur.format(round2(value))
}

const eurPrice = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** A unit price: 2 decimals, up to 4 when the price has them (€1.2345) – ATK allows prices with 4 decimals. */
export function formatPrice(value: number): string {
  return eurPrice.format(round4(value))
}

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

/** #00487 */
export function formatInvoiceNo(n: number): string {
  return '#' + String(n).padStart(5, '0')
}
