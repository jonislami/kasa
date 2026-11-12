// Text of the receipt, shared by the screen / browser print (Receipt.tsx) and the thermal printer
// (receipt.ts), so both print the same thing. Layout follows the usual ATK fiscal coupon:
// taxpayer and unit on top, worker, coupon title, items table, total and payment, then the fiscal
// block (coupon number, date and time, SEF number, NUIKF, daily number), QR and RKS.
import type { Business } from '@/app/AuthProvider'
import type { Sale } from '@/features/pos/api'

export const n2 = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(v)
export const qty = (v: number, unit: string) => new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 'kg' ? 3 : 0, useGrouping: false }).format(v)
const pad = (v: number, n: number) => String(Math.max(0, Math.trunc(v))).padStart(n, '0')

/** 12/11/2026 13:51:36 (Kosovo time). */
const kosovoFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Belgrade',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
export function receiptDateTime(iso: string): string {
  const p = Object.fromEntries(kosovoFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`
}

const PAYMENT = { cash: 'KESH', card: 'KARTELË', mixed: 'KESH + KARTELË' } as const

export interface ReceiptFacts {
  header: [string, string][]
  /** Big centred title: KUPON FISKAL / KUPON JO-FISKAL / ANULIM / KTHIM MALLI. */
  title: string
  /** Smaller lines under the title (KOPJE E KUPONIT, OFFLINE, TEST). */
  marks: string[]
  payment: string
  /** Coupon number on its own line (10 digits). */
  number: string
  dateTime: string
  dailyNo: string
  itemsCount: number
  refInvoice: string | null
}

export function receiptFacts(sale: Sale, business: Business, copy?: boolean): ReceiptFacts {
  const f = sale.fiscal ?? null
  const offline = sale.offline || Boolean(f?.offline)
  const unitNo = f?.sef_no ? f.sef_no.split('-')[0] : null
  const header: [string, string][] = []
  header.push(['EMRI I NJËSISË', business.name])
  if (unitNo) header.push(['NUMRI I NJËSISË', unitNo])
  if (business.address) header.push(['ADRESA E NJËSISË', business.address])
  if (business.city) header.push(['VENDI', business.city])
  if (business.phone) header.push(['TELEFONI', business.phone])
  if (business.nui) header.push(['NUI', business.nui])
  if (business.vat_number) header.push(['NR. I TVSH-SË', business.vat_number])

  const fiscalWord = f ? 'KUPON FISKAL' : 'KUPON JO-FISKAL'
  const title = sale.kind === 'void' ? 'ANULIM' : sale.kind === 'refund' ? 'KTHIM MALLI' : fiscalWord
  const marks: string[] = []
  if (sale.kind !== 'sale') marks.push(fiscalWord)
  if (copy) marks.push('KOPJE E KUPONIT')
  if (offline) marks.push('OFFLINE')
  if (f?.env === 'test') marks.push('TEST – PA VLERË FISKALE')

  const invoice = sale.offline_no && sale.invoice_no === 0 ? sale.offline_no : pad(sale.invoice_no, 10)
  return {
    header,
    title,
    marks,
    payment: PAYMENT[sale.payment_method] ?? sale.payment_method.toUpperCase(),
    number: invoice,
    dateTime: receiptDateTime(sale.client_created_at ?? sale.created_at),
    dailyNo: pad(sale.daily_no || 0, 4),
    itemsCount: sale.items.length,
    refInvoice: sale.ref_invoice_no != null ? pad(sale.ref_invoice_no, 10) : null,
  }
}
