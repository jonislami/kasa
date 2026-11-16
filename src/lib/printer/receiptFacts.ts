// Content of the receipt, shared by the screen / browser print (Receipt.tsx) and the thermal printer (receipt.ts),
// so both print the same thing. Built on the ATK samples of SEF coupons (Kërkesat specifike, Shtojca F):
//   KUPON FISKAL · KUPON FISKAL ME ULJE (në artikull / në total) · KUPON FISKAL KTHIMI · KUPON FISKAL I ANULUAR
// Order: taxpayer and unit, worker, title, items (ARTIKULLI | SASIA X ÇMIMI | SHUMA), total and payment, VAT by
// rate and total without VAT, ARTIKUJ - n, number, date and time, SEF number, NUIKF, daily number, QR, RKS / MF,
// free text.
import type { Business } from '@/app/AuthProvider'
import type { Sale, SaleRef } from '@/features/pos/api'

export const n2 = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(v)
export const qty = (v: number, unit: string) => new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 'kg' ? 3 : 0, useGrouping: false }).format(v)
/** Unit price as on the ATK sample: 2 decimals, up to 4 when the price has them (2.5012). */
const price = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false }).format(v)
const pad = (v: number, n: number) => String(Math.max(0, Math.trunc(v))).padStart(n, '0')
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

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
export function receiptDateTime(iso: string, seconds = true): string {
  const p = Object.fromEntries(kosovoFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}${seconds ? `:${p.second}` : ''}`
}

const PAYMENT = { cash: 'KESH', card: 'KARTELË', mixed: 'KESH + KARTELË' } as Record<string, string>

/** "Ulje 10%" when the discount is a round percentage of the amount, otherwise "Ulje". */
function discountLabel(word: string, discount: number, of: number): string {
  if (!of || !discount) return word
  const pct = (Math.abs(discount) / Math.abs(of)) * 100
  return Math.abs(pct - Math.round(pct)) < 0.05 && Math.round(pct) > 0 ? `${word} ${Math.round(pct)}%` : word
}

export interface ReceiptLine {
  name: string
  /** "2 X 2.50" */
  qtyPrice: string
  /** Amount before the line discount, with the VAT letter: "5.00 D". */
  amount: string
  /** "Ulje 10%" and "-0.50" under the item. */
  discount: { label: string; amount: string } | null
}

export interface ReceiptBlock {
  lines: ReceiptLine[]
  /** NËNTOTALI and the discount on the whole bill (ULJE 10%  -1.29). */
  subtotal: { value: string; label: string; discount: string } | null
  total: string
  payment: string
  /** "TVSH D 8%" → "0.37" */
  vat: [string, string][]
  net: string
  itemsCount: number
}

export interface ReceiptFacts {
  /** [label, value] under TATIMPAGUESI. */
  header: [string, string][]
  /** KUPON FISKAL / KUPON FISKAL I ANULUAR / KUPON FISKAL KTHIMI / KUPON JO-FISKAL … */
  title: string
  /** Smaller lines under the title (KOPJE E KUPONIT, OFFLINE, TEST). */
  marks: string[]
  /** "KUPON FISKAL NR. 0000000013  DATË: 13/11/2026 23:43" – the original of a cancel / return. */
  refLine: string | null
  /** "ARSYEJA E ANULIMIT: …" */
  reasonLine: string | null
  /** The items and totals shown at the top: the sale itself, or the original sale on a cancel / return. */
  main: ReceiptBlock
  /** Return coupon: the returned items with minus, TOTALI I KTHIMIT, TOTALI I MBETUR, ARTIKUJ TË KTHYER - n. */
  returned: { lines: ReceiptLine[]; total: string; remaining: string; count: number } | null
  /** Coupon number on its own line (10 digits). */
  number: string
  dateTime: string
  dailyNo: string
  /** Kept for the reports. */
  refInvoice: string | null
}

type Item = { name: string; unit: string; quantity: number; unit_price: number; line_discount: number; vat_code: string }

function linesOf(items: Item[], sign: 1 | -1): ReceiptLine[] {
  return items.map((i) => {
    const q = Math.abs(i.quantity)
    const gross = r2(q * i.unit_price)
    const disc = Math.abs(i.line_discount)
    return {
      name: i.name,
      qtyPrice: `${qty(q, i.unit)} X ${price(i.unit_price)}`,
      amount: `${n2(sign * gross)} ${i.vat_code}`,
      discount: disc > 0.004 ? { label: discountLabel('Ulje', disc, gross), amount: n2(-sign * disc) } : null,
    }
  })
}

function blockOf(
  items: Item[],
  totals: { total: number; invoice_discount: number; net_total: number; payment_method: string; vat_lines: Sale['vat_lines'] | SaleRef['vat_lines']; items_count?: number },
  extraPayment: string | null,
): ReceiptBlock {
  const lines = linesOf(items, 1)
  const after = r2(items.reduce((a, i) => a + Math.abs(i.quantity) * i.unit_price - Math.abs(i.line_discount), 0))
  const inv = Math.abs(totals.invoice_discount ?? 0)
  return {
    lines,
    subtotal: inv > 0.004 ? { value: n2(after), label: discountLabel('ULJE', inv, after), discount: n2(-inv) } : null,
    total: n2(Math.abs(totals.total)),
    payment: extraPayment ?? PAYMENT[totals.payment_method] ?? totals.payment_method.toUpperCase(),
    vat: (totals.vat_lines ?? [])
      .filter((v) => v.code === 'D' || v.code === 'E')
      .filter((v) => Math.abs(v.vat) > 0.004)
      .map((v) => [`TVSH ${v.code} ${Math.round(Number(v.rate) * 100)}%`, n2(Math.abs(v.vat))]),
    net: n2(Math.abs(totals.net_total)),
    itemsCount: items.length,
  }
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
  if (business.nui) header.push(['NF-NUI', business.nui])
  if (business.vat_number) header.push(['NUMRI I TVSH-SË', business.vat_number])

  const fiscal = Boolean(f)
  const title =
    sale.kind === 'void'
      ? fiscal
        ? 'KUPON FISKAL I ANULUAR'
        : 'KUPON I ANULUAR'
      : sale.kind === 'refund'
        ? fiscal
          ? 'KUPON FISKAL KTHIMI'
          : 'KUPON KTHIMI'
        : fiscal
          ? 'KUPON FISKAL'
          : 'KUPON JO-FISKAL'
  const marks: string[] = []
  if (!fiscal && sale.kind !== 'sale') marks.push('JO-FISKAL')
  if (sale.note?.startsWith('Blloku i veçantë')) marks.push(sale.note.toUpperCase())
  if (copy) marks.push('KOPJE E KUPONIT')
  if (offline) marks.push('OFFLINE')
  if (f?.env === 'test') marks.push('TEST – PA VLERË FISKALE')

  const ref = sale.ref ?? null
  const refNo = sale.ref_invoice_no != null ? pad(sale.ref_invoice_no, 10) : null
  const refLine = sale.kind !== 'sale' && sale.ref_invoice_no != null ? `KUPON FISKAL NR. ${sale.ref_invoice_no}${ref?.created_at ? ` DATË: ${receiptDateTime(ref.created_at, false)}` : ''}` : null
  const reasonLine = sale.reason ? `${sale.kind === 'void' ? 'ARSYEJA E ANULIMIT' : 'ARSYEJA'}: ${sale.reason}` : null

  const mixed = (cash: number, card: number) => `KESH ${n2(Math.abs(cash))} + KARTELË ${n2(Math.abs(card))}`
  const ownPayment = sale.payment_method === 'mixed' ? mixed(sale.cash_amount, sale.card_amount) : null

  let main: ReceiptBlock
  let returned: ReceiptFacts['returned'] = null
  if (sale.kind === 'refund' && ref) {
    // ATK sample "KUPON FISKAL KTHIMI": the original bill, then what is returned and what remains
    main = blockOf(ref.items, ref, null)
    const lines = linesOf(sale.items, -1)
    returned = {
      lines,
      total: n2(-Math.abs(sale.total)),
      remaining: n2(Math.max(0, r2(ref.total + ref.returned))),
      count: sale.items.length,
    }
  } else if (sale.kind === 'void' && ref) {
    // ATK sample "KUPON FISKAL I ANULUAR": the cancelled bill as it was
    main = blockOf(ref.items, ref, null)
  } else {
    main = blockOf(sale.items, sale, ownPayment)
  }

  const invoice = sale.offline_no && sale.invoice_no === 0 ? sale.offline_no : pad(sale.invoice_no, 10)
  return {
    header,
    title,
    marks,
    refLine,
    reasonLine,
    main,
    returned,
    number: invoice,
    dateTime: receiptDateTime(sale.client_created_at ?? sale.created_at),
    dailyNo: pad(sale.daily_no || 0, 4),
    refInvoice: refNo,
  }
}
