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

/** #00487 */
export function formatInvoiceNo(n: number): string {
  return '#' + String(n).padStart(5, '0')
}
