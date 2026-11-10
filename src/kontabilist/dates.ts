export { kosovoDateISO } from '@/lib/clock'
import { monthName } from '@/features/accounting/api'

/** 'Tetor 2026' for any date of the month. */
export const monthLabel = (iso: string) => monthName(iso.slice(0, 7) + '-01')
