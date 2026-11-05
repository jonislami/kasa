/**
 * Units of measure. `code` is stored in the database; `atk` is sent as CouponItem.Unit.
 * TODO(ATK): confirm the `atk` values against the official "Njësitë matëse dhe kategoritë" list
 * (only "cope" is confirmed by the ATK examples so far).
 */
export type UnitCode = 'cope' | 'kg' | 'pako' | 'liter'

export const UNITS: Record<UnitCode, { label: string; atk: string; decimals: number }> = {
  cope: { label: 'copë', atk: 'cope', decimals: 0 },
  kg: { label: 'kg', atk: 'kg', decimals: 3 },
  pako: { label: 'pako', atk: 'pako', decimals: 0 },
  liter: { label: 'litër', atk: 'l', decimals: 0 },
}

export const UNIT_OPTIONS = (Object.keys(UNITS) as UnitCode[]).map((value) => ({ value, label: UNITS[value].label }))

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
  return null
}

export function formatQty(value: number, unit: string): string {
  const d = UNITS[unit as UnitCode]?.decimals ?? 0
  const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(value)
  return `${n} ${unitLabel(unit)}`
}
