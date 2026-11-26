/**
 * Units of measure: every unit of the official ATK list "Njësitë matëse" (src/lib/atk/catalog.ts). `code` is stored in
 * the database (the first four as before, the rest as the ATK code in small letters); `atk` is sent as CouponItem.Unit;
 * `decimals` is how a quantity is rounded – the same numbers as public._unit_decimals on the server (0042).
 */
export type UnitCode =
  | 'cope' | 'kg' | 'pako' | 'liter'
  | 'ea' | 'sec' | 'min' | 'hur' | 'day' | 'mon' | 'ann' | 'kgb' | 'tn' | 'grm' | 'm4' | 'udh' | 'kmt' | 'lm' | 'mts' | 'mtv'
  | 'msk' | 'kwh' | 'nfj' | 'nfq' | 'prq' | 'dp' | 'op' | 'prd' | 'pal' | 'xbx' | 'set'

export const UNITS: Record<UnitCode, { label: string; atk: string; decimals: number }> = {
  cope: { label: 'copë', atk: 'CP', decimals: 0 },
  kg: { label: 'kg', atk: 'KGN', decimals: 4 },
  pako: { label: 'pako', atk: 'PK', decimals: 0 },
  liter: { label: 'litër', atk: 'LTR', decimals: 0 },
  ea: { label: 'njësi', atk: 'EA', decimals: 0 },
  xbx: { label: 'kuti', atk: 'XBX', decimals: 0 },
  set: { label: 'set', atk: 'SET', decimals: 0 },
  pal: { label: 'palë', atk: 'PAL', decimals: 0 },
  kgb: { label: 'kg bruto', atk: 'KGB', decimals: 4 },
  grm: { label: 'gram', atk: 'GRM', decimals: 0 },
  tn: { label: 'ton', atk: 'TN', decimals: 4 },
  lm: { label: 'metër', atk: 'LM', decimals: 4 },
  mts: { label: 'm²', atk: 'MTS', decimals: 4 },
  mtv: { label: 'm³', atk: 'MTV', decimals: 4 },
  kmt: { label: 'km', atk: 'KMT', decimals: 4 },
  msk: { label: 'm/s²', atk: 'MSK', decimals: 4 },
  kwh: { label: 'kWh', atk: 'KWH', decimals: 4 },
  sec: { label: 'sekondë', atk: 'SEC', decimals: 0 },
  min: { label: 'minutë', atk: 'MIN', decimals: 0 },
  hur: { label: 'orë', atk: 'HUR', decimals: 4 },
  op: { label: 'orë pune', atk: 'OP', decimals: 4 },
  day: { label: 'ditë', atk: 'DAY', decimals: 0 },
  dp: { label: 'ditë pune', atk: 'DP', decimals: 0 },
  mon: { label: 'muaj', atk: 'MON', decimals: 0 },
  ann: { label: 'vit', atk: 'ANN', decimals: 0 },
  udh: { label: 'udhëtim', atk: 'UDH', decimals: 0 },
  prd: { label: 'përdorim', atk: 'PRD', decimals: 0 },
  nfj: { label: 'fjalë', atk: 'NFJ', decimals: 0 },
  nfq: { label: 'faqe', atk: 'NFQ', decimals: 0 },
  prq: { label: 'përqindje', atk: 'PRQ', decimals: 0 },
  m4: { label: 'vlerë monetare', atk: 'M4', decimals: 0 },
}

export const UNIT_OPTIONS = (Object.keys(UNITS) as UnitCode[]).map((value) => ({ value, label: UNITS[value].label }))

/** Decimals of a quantity in this unit (kg, metres, m², hours… up to 4 – 0056; the rest whole). */
export const unitDecimals = (code: string | null | undefined): number => UNITS[code as UnitCode]?.decimals ?? 0

/** The step of a quantity input for this unit. */
export const unitStep = (code: string | null | undefined): string => (unitDecimals(code) ? String(10 ** -unitDecimals(code)) : '1')

/** A quantity rounded for its unit. */
export const roundQty = (q: number, unit: string | null | undefined): number => {
  const f = 10 ** unitDecimals(unit)
  return Math.round(q * f) / f
}

export function unitLabel(code: string): string {
  return UNITS[code as UnitCode]?.label ?? code
}

/** Accepts what people type in Excel: "copë", "cope", "copa", "kg", "litër", "l", "pako"… */
export function parseUnit(raw: unknown): UnitCode | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace('ë', 'e')
    .replace('ç', 'c')
  if (!s) return null
  if (['cope', 'copa', 'cp', 'pcs', 'pc', 'copë'].includes(s)) return 'cope'
  if (['kg', 'kilogram', 'kilogramë', 'kilogram'].includes(s)) return 'kg'
  if (['pako', 'pk', 'pack'].includes(s)) return 'pako'
  if (['l', 'liter', 'litër', 'liter', 'litra', 'lit'].includes(s)) return 'liter'
  // the rest of the ATK list: the code (m2 → MTS…), the label or the ATK name
  const plain = (x: string) => x.toLowerCase().replace(/ë/g, 'e').replace(/ç/g, 'c')
  const alias: Record<string, UnitCode> = { m: 'lm', metër: 'lm', meter: 'lm', m2: 'mts', 'm²': 'mts', m3: 'mtv', 'm³': 'mtv', g: 'grm', gr: 'grm', ore: 'hur', h: 'hur' }
  if (alias[s]) return alias[s]
  return (Object.keys(UNITS) as UnitCode[]).find((c) => c === s || plain(UNITS[c].label) === s || UNITS[c].atk.toLowerCase() === s) ?? null
}

export function formatQty(value: number, unit: string): string {
  const d = UNITS[unit as UnitCode]?.decimals ?? 0
  const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(value)
  return `${n} ${unitLabel(unit)}`
}
