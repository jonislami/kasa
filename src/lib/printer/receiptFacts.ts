// Content of the receipt, shared by the screen / browser print (Receipt.tsx) and the thermal printer (receipt.ts),
// so both print the same thing. Built on the ATK samples of SEF coupons (Kërkesat specifike, Shtojca F):
//   KUPON FISKAL · KUPON FISKAL ME ULJE (në artikull / në total) · KUPON FISKAL KTHIMI · KUPON FISKAL I ANULUAR
// Order: taxpayer and unit, worker, title, items (ARTIKULLI | SASIA X ÇMIMI | SHUMA), total and payment, VAT by
// rate and total without VAT, ARTIKUJ - n, number, date and time, SEF number, NUIKF, daily number, QR, RKS / MF,
// free text.
import type { Business } from '@/app/AuthProvider'
import type { Sale, SaleRef } from '@/features/pos/api'
import { getLang, t, type Lang } from '../i18n'

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
const payLabel = (m: string, lang: Lang) => (m === 'mixed' ? `${t('KESH', lang)} + ${t('KARTELË', lang)}` : t(PAYMENT[m] ?? m.toUpperCase(), lang))

/** "Ulje 10%" when the discount is a round percentage of the amount, otherwise "Ulje". */
function discountLabel(word: string, discount: number, of: number, lang: Lang = getLang()): string {
  word = t(word, lang)
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

/** Fixed texts of the coupon in the language of the till. */
export interface ReceiptLabels {
  taxpayer: string
  worker: string
  item: string
  qtyPrice: string
  amount: string
  subtotal: string
  total: string
  payment: string
  paid: string
  change: string
  net: string
  returnedTitle: string
  returnedTotal: string
  remaining: string
  items: string
  itemsReturned: string
  dateTime: string
  sefNo: string
  daily: string
  notFiscal: string
  poweredBy: string
  rejected: string
}

export interface ReceiptFacts {
  L: ReceiptLabels
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

/**
 * ATK (neni 25 pika 18): "nëse artikulli është i njëjtë duhet të bëhet grupimi me një rresht" – the same item
 * (name, price, VAT, unit) is printed once, e.g. one service done by two workers in a salon.
 */
export function groupItems<T extends Item & { total?: number; atk_type?: string | null }>(items: T[]): T[] {
  const out: T[] = []
  const at = new Map<string, number>()
  for (const i of items) {
    const key = [i.name, i.unit, i.unit_price, i.vat_code, i.atk_type ?? '', Math.sign(i.quantity)].join('|')
    const k = at.get(key)
    if (k == null) {
      at.set(key, out.length)
      out.push({ ...i })
    } else {
      const g = out[k]
      g.quantity = Math.round((g.quantity + i.quantity) * 1000) / 1000
      g.line_discount = r2(g.line_discount + i.line_discount)
      if (g.total != null && i.total != null) g.total = r2(g.total + i.total)
    }
  }
  return out
}

function linesOf(items: Item[], sign: 1 | -1): ReceiptLine[] {
  return groupItems(items).map((i) => {
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
    payment: extraPayment ?? payLabel(totals.payment_method, getLang()),
    vat: (totals.vat_lines ?? [])
      .filter((v) => v.code === 'D' || v.code === 'E')
      .filter((v) => Math.abs(v.vat) > 0.004)
      .map((v) => [`${t('TVSH')} ${v.code} ${Math.round(Number(v.rate) * 100)}%`, n2(Math.abs(v.vat))]),
    net: n2(Math.abs(totals.net_total)),
    itemsCount: groupItems(items).length,
  }
}

export function receiptFacts(sale: Sale, business: Business, copy?: boolean, lang: Lang = getLang()): ReceiptFacts {
  const f = sale.fiscal ?? null
  const offline = sale.offline || Boolean(f?.offline)
  const unitNo = f?.sef_no ? f.sef_no.split('-')[0] : null
  const header: [string, string][] = []
  header.push([t('EMRI I NJËSISË', lang), business.name])
  if (unitNo) header.push([t('NUMRI I NJËSISË', lang), unitNo])
  if (business.address) header.push([t('ADRESA E NJËSISË', lang), business.address])
  if (business.city) header.push([t('VENDI', lang), business.city])
  if (business.phone) header.push([t('TELEFONI', lang), business.phone])
  if (business.nui) header.push([t('NF-NUI', lang), business.nui])
  if (business.vat_number) header.push([t('NUMRI I TVSH-SË', lang), business.vat_number])

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
  const titleText = t(title, lang)
  const marks: string[] = []
  if (!fiscal && sale.kind !== 'sale') marks.push(t('JO-FISKAL', lang))
  if (sale.note?.startsWith('Blloku i veçantë')) marks.push(sale.note.toUpperCase().replace('BLLOKU I VEÇANTË I KUPONËVE – NR.', t('BLLOKU I VEÇANTË I KUPONËVE – NR.', lang)))
  if (copy) marks.push(t('KOPJE E KUPONIT', lang))
  if (offline) marks.push('OFFLINE')
  if (f?.env === 'test') marks.push(t('TEST – PA VLERË FISKALE', lang))

  const ref = sale.ref ?? null
  const refNo = sale.ref_invoice_no != null ? pad(sale.ref_invoice_no, 10) : null
  const refLine = sale.kind !== 'sale' && sale.ref_invoice_no != null ? `${t('KUPON FISKAL NR.', lang)} ${sale.ref_invoice_no}${ref?.created_at ? ` ${t('DATË:', lang)} ${receiptDateTime(ref.created_at, false)}` : ''}` : null
  const reasonLine = sale.reason ? `${t(sale.kind === 'void' ? 'ARSYEJA E ANULIMIT' : 'ARSYEJA', lang)}: ${sale.reason}` : null

  const mixed = (cash: number, card: number) => `${t('KESH', lang)} ${n2(Math.abs(cash))} + ${t('KARTELË', lang)} ${n2(Math.abs(card))}`
  const KIND: Record<string, string> = { bank: 'TRANSFER BANKAR', voucher: 'VAUÇER', cheque: 'ÇEK' }
  const kindLabel = sale.payment_kind ? t(KIND[sale.payment_kind], lang) : null
  const ownPayment =
    sale.payment_method === 'mixed'
      ? kindLabel
        ? `${t('KESH', lang)} ${n2(Math.abs(sale.cash_amount))} + ${kindLabel} ${n2(Math.abs(sale.card_amount))}`
        : mixed(sale.cash_amount, sale.card_amount)
      : sale.payment_method === 'card' && kindLabel
        ? kindLabel
        : null

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
      count: groupItems(sale.items).length,
    }
  } else if (sale.kind === 'void' && ref) {
    // ATK sample "KUPON FISKAL I ANULUAR": the cancelled bill as it was
    main = blockOf(ref.items, ref, null)
  } else {
    main = blockOf(sale.items, sale, ownPayment)
  }

  const invoice = sale.offline_no && sale.invoice_no === 0 ? sale.offline_no : pad(sale.invoice_no, 10)
  const L: ReceiptLabels = {
    taxpayer: t('TATIMPAGUESI', lang),
    worker: t('EMRI I PUNËTORIT', lang),
    item: t('ARTIKULLI', lang),
    qtyPrice: t('SASIA X ÇMIMI', lang),
    amount: t('SHUMA', lang),
    subtotal: t('NËNTOTALI', lang),
    total: t('TOTALI PËR PAGESË', lang),
    payment: t('MËNYRA E PAGESËS', lang),
    paid: t('PAGUAR', lang),
    change: t('KUSURI', lang),
    net: t('TOTALI PA TVSH', lang),
    returnedTitle: t('KTHIMI I ARTIKUJVE', lang),
    returnedTotal: t('TOTALI I KTHIMIT', lang),
    remaining: t('TOTALI I MBETUR', lang),
    items: t('ARTIKUJ', lang),
    itemsReturned: t('ARTIKUJ TË KTHYER', lang),
    dateTime: t('DATA DHE ORA', lang),
    sefNo: t('NR. IDENTIFIKUES I SEF', lang),
    daily: t(fiscal ? 'KUPON FISKAL DITOR NR.' : 'KUPON DITOR NR.', lang),
    notFiscal: t('Ky kupon nuk është fiskal.', lang),
    poweredBy: t('Mundësuar nga Kasa', lang),
    rejected: t('ATK e refuzoi', lang),
  }
  return {
    L,
    header,
    title: titleText,
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
