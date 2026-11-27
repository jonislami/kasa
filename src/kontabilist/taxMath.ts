// Pure tax arithmetic of Kontabilist (no database / browser imports), shared by the pages and
// scripts/compliance-selftest.ts. vat.ts and payroll.ts re-export everything here.
import type { TaxRegime } from './vat'

export type Boxes = Record<string, number>
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

// ---------------------------------------------------------------------------
// Wages: pension 5% + 5% (Trust); wage tax on (gross − employee contribution)
// ---------------------------------------------------------------------------
/** Same as the database (acc_wage_tax), for the preview in forms. */
export function wageTax(base: number, primary: boolean): number {
  return primary ? r2(Math.max(Math.min(base, 450) - 250, 0) * 0.08 + Math.max(base - 450, 0) * 0.1) : r2(Math.max(base, 0) * 0.1)
}

export function salaryPreview(gross: number, empPct: number, erPct: number, primary: boolean) {
  const emp = r2((gross * empPct) / 100)
  const er = r2((gross * erPct) / 100)
  const tax = wageTax(gross - emp, primary)
  return { emp, er, tax, net: r2(gross - emp - tax), cost: r2(gross + er) }
}

// ---------------------------------------------------------------------------
// VAT return TV-A7: boxes and calculation
// ---------------------------------------------------------------------------
/** One line of the form: base box, its VAT box and rate (when it has one). */
export interface FormLine {
  box: string
  label: string
  vat?: string
  rate?: number
  /** Accountant may add to it (adjustments, imports, bad debts…). */
  manual?: boolean
}

export const OUTPUTS: FormLine[] = [
  { box: '9', label: 'Shitjet e liruara pa të drejtë kreditimi', manual: true },
  { box: '10a', label: 'Shitjet e shërbimeve jashtë vendit', manual: true },
  { box: '10b', label: 'Shitjet brenda vendit me ngarkesë të kundërt', manual: true },
  { box: '10c', label: 'Shitjet tjera të liruara me të drejtë kreditimi', manual: true },
  { box: '11', label: 'Eksportet', manual: true },
  { box: '12', label: 'Shitjet e tatueshme me normën 18%', vat: '13', rate: 0.18, manual: true },
  { box: '14', label: 'Shitjet e tatueshme me normën 8%', vat: '15', rate: 0.08, manual: true },
  { box: '16', label: 'Nota debitore e lëshuar, nota kreditore e pranuar me normë 18%', vat: '17', rate: 0.18, manual: true },
  { box: '18', label: 'Nota debitore e lëshuar, nota kreditore e pranuar me normë 8%', vat: '19', rate: 0.08, manual: true },
  { box: '20', label: 'Fatura e borxhit të keq e pranuar, inkasimi i B.K. me normë 18%', vat: '21', rate: 0.18, manual: true },
  { box: '22', label: 'Fatura e borxhit të keq e pranuar, inkasimi i B.K. me normë 8%', vat: '23', rate: 0.08, manual: true },
  { box: '24', label: 'Rregullimet për të rritur TVSH-në me normë 18%', vat: '25', rate: 0.18, manual: true },
  { box: '26', label: 'Rregullimet për të rritur TVSH-në me normë 8%', vat: '27', rate: 0.08, manual: true },
  { box: '28', label: 'Blerjet që i nënshtrohen ngarkesës së kundërt', vat: '29', rate: 0.18, manual: true },
]

export const INPUTS: FormLine[] = [
  { box: '31', label: 'Blerjet dhe importet pa TVSH', manual: true },
  { box: '32', label: 'Blerjet dhe importet investive pa TVSH', manual: true },
  { box: '33', label: 'Blerjet dhe importet me TVSH jo të zbritshme', manual: true },
  { box: '34', label: 'Blerjet dhe importet investive me TVSH jo të zbritshme', manual: true },
  { box: '35', label: 'Importet me normë 18%', vat: '36', rate: 0.18, manual: true },
  { box: '37', label: 'Importet me normë 8%', vat: '38', rate: 0.08, manual: true },
  { box: '39', label: 'Importet investive me normë 18%', vat: '40', rate: 0.18, manual: true },
  { box: '41', label: 'Importet investive me normë 8%', vat: '42', rate: 0.08, manual: true },
  { box: '43', label: 'Blerjet vendore me normë 18%', vat: '44', rate: 0.18, manual: true },
  { box: '45', label: 'Blerjet vendore me normë 8%', vat: '46', rate: 0.08, manual: true },
  { box: '47', label: 'Blerjet investive vendore me normë 18%', vat: '48', rate: 0.18, manual: true },
  { box: '49', label: 'Blerjet investive vendore me normë 8%', vat: '50', rate: 0.08, manual: true },
  { box: '51', label: 'Blerjet nga fermerët vendorë me normë 8%', vat: '52', rate: 0.08, manual: true },
  { box: '53', label: 'Nota debitore e pranuar, nota kreditore e lëshuar me normë 18%', vat: '54', rate: 0.18, manual: true },
  { box: '55', label: 'Nota debitore e pranuar, nota kreditore e lëshuar me normë 8%', vat: '56', rate: 0.08, manual: true },
  { box: '57', label: 'Fatura e borxhit të keq e lëshuar, pagesa e borxhit të keq me normë 18%', vat: '58', rate: 0.18, manual: true },
  { box: '59', label: 'Fatura e borxhit të keq e lëshuar, pagesa e borxhit të keq me normë 8%', vat: '60', rate: 0.08, manual: true },
  { box: '61', label: 'Rregullimet për të ulur TVSH-në me normë 18%', vat: '62', rate: 0.18, manual: true },
  { box: '63', label: 'Rregullimet për të ulur TVSH-në me normë 8%', vat: '64', rate: 0.08, manual: true },
  { box: '65', label: 'E drejta e kreditimit të TVSH-së në lidhje me ngarkesën e kundërt me normë 18%', vat: '66', rate: 0.18, manual: true },
]

const OUT_VAT = ['13', '15', '17', '19', '21', '23', '25', '27', '29']
const IN_VAT = ['36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64', '66']

/** Final boxes: computed + manual bases (VAT of the manual part = base × rate) and the calculation [30]–[72]. */
export function finalBoxes(computed: Boxes, manual: Boxes, carry68: number, refund70: number): Boxes {
  const out: Boxes = {}
  for (const l of [...OUTPUTS, ...INPUTS]) {
    const add = manual[l.box] ?? 0
    out[l.box] = r2((computed[l.box] ?? 0) + add)
    if (l.vat) out[l.vat] = r2((computed[l.vat] ?? 0) + (l.rate ? add * l.rate : 0))
  }
  out['10'] = r2(out['10a'] + out['10b'] + out['10c'])
  out['30'] = r2(OUT_VAT.reduce((s, b) => s + (out[b] ?? 0), 0))
  out['67'] = r2(IN_VAT.reduce((s, b) => s + (out[b] ?? 0), 0))
  out['68'] = r2(carry68)
  out['69'] = r2(Math.max(0, out['67'] + out['68'] - out['30']))
  out['70'] = r2(Math.min(Math.max(0, refund70), out['69']))
  out['71'] = r2(out['69'] - out['70'])
  out['72'] = r2(Math.max(0, out['30'] - out['67'] - out['68']))
  return out
}

// ---------------------------------------------------------------------------
// Income tax
// ---------------------------------------------------------------------------
/**
 * Personal income tax (annual) since 23.08.2024, Law 08/L-142 amending 05/L-028: 0–3,000 0%, 3,000–5,400 8%,
 * over 5,400 10% (ATK, "General Information on Taxes in Kosovo"). The 4% band (960–3,000) no longer exists.
 */
export function personalIncomeTax(annual: number): number {
  const x = Math.max(0, annual)
  return r2(Math.max(0, Math.min(x, 5400) - 3000) * 0.08 + Math.max(0, x - 5400) * 0.1)
}

/** Income tax estimate for one quarter. */
export function quarterTax(regime: TaxRegime, turnover: number, costs: number): number {
  const profit = turnover - costs
  switch (regime) {
    case 'corporate':
      return r2(Math.max(0, profit) * 0.1)
    case 'individual_small_3':
      return r2(Math.max(0, turnover) * 0.03)
    case 'individual_small_9':
      return r2(Math.max(0, turnover) * 0.09)
    default:
      return r2(personalIncomeTax(profit * 4) / 4)
  }
}

