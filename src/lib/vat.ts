import { round2 } from './money'

/** ATK VAT letters: E = 18%, D = 8%, C = 0%, A = exempt. */
export type VatCode = 'E' | 'D' | 'C' | 'A'

export const VAT_RATES: Record<VatCode, number> = { E: 0.18, D: 0.08, C: 0, A: 0 }

export const VAT_LABELS: Record<VatCode, string> = {
  E: 'E – 18%',
  D: 'D – 8%',
  C: 'C – 0%',
  A: 'A – e liruar',
}

export interface VatLine {
  code: VatCode
  gross: number
  net: number
  vat: number
}

/** Prices include VAT. VAT is computed once per rate over that rate's gross total. */
export function vatBreakdown(lines: { code: VatCode; gross: number }[]): VatLine[] {
  const totals = new Map<VatCode, number>()
  for (const l of lines) totals.set(l.code, (totals.get(l.code) ?? 0) + l.gross)
  return [...totals.entries()].map(([code, grossRaw]) => {
    const gross = round2(grossRaw)
    const net = round2(gross / (1 + VAT_RATES[code]))
    return { code, gross, net, vat: round2(gross - net) }
  })
}
