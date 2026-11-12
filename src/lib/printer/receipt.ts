import { formatKosovoDateTime } from '@/lib/clock'
import type { Business } from '@/app/AuthProvider'
import { formatInvoiceNo } from '@/lib/money'
import type { Sale } from '@/features/pos/api'
import type { ReceiptSettings } from '@/features/settings/api'
import { charsPerLine, EscPos } from './escpos'

const n2 = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(v)
const qty = (v: number, unit: string) => new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 'kg' ? 3 : 0, useGrouping: false }).format(v)

function dateTime(iso: string) {
  return formatKosovoDateTime(iso)
}

const TITLES = { sale: null, void: 'ANULIM', refund: 'KTHIM MALLI' } as const

/** The same receipt as the on-screen one (Receipt.tsx), as ESC/POS bytes. */
export function receiptBytes(sale: Sale, business: Business, s: ReceiptSettings, opts: { copy?: boolean; drawer?: boolean } = {}): Uint8Array {
  const w = charsPerLine(s.paper_width)
  const p = new EscPos(w, s.printer_charset)
  const opt = s.settings

  p.align('center').bold(true).size(2).wrap(business.name.toUpperCase()).size(1).bold(false)
  if (s.receipt_header) p.wrap(s.receipt_header)
  const addr = [business.address, business.city].filter(Boolean).join(', ')
  if (addr) p.wrap(addr)
  if (business.phone) p.line(`Tel: ${business.phone}`)
  if (business.nui) p.line(`NUI: ${business.nui}`)
  if (business.vat_number) p.line(`Nr. TVSH: ${business.vat_number}`)
  p.align('left').rule()

  const title = TITLES[sale.kind]
  const f = sale.fiscal ?? null
  const offline = sale.offline || Boolean(f?.offline)
  if (title || opts.copy || offline) {
    p.align('center').bold(true)
    if (title) p.line(title)
    if (opts.copy) p.line('KOPJE E KUPONIT')
    if (offline) p.line('OFFLINE')
    p.bold(false).align('left')
  }
  p.pair('Fatura:', sale.offline_no && sale.invoice_no === 0 ? sale.offline_no : formatInvoiceNo(sale.invoice_no))
  if (sale.ref_invoice_no != null) p.pair('Per faturen:', formatInvoiceNo(sale.ref_invoice_no))
  p.pair('Nr. ditor:', String(sale.daily_no || '-'))
  p.pair('Data:', dateTime(sale.client_created_at ?? sale.created_at))
  if (sale.register_name) p.pair('Arka:', sale.register_name)
  if (sale.worker_name) p.pair('Operatori:', sale.worker_name)
  p.rule()

  for (const i of sale.items) {
    p.wrap(i.name)
    p.pair(`${qty(i.quantity, i.unit)} x ${n2(i.unit_price)}`, `${n2(i.total)} ${i.vat_code}`)
    const disc = i.line_discount + i.invoice_discount
    if (disc !== 0) p.pair('  zbritje', `-${n2(Math.abs(disc))}`)
  }
  p.rule()
  if (sale.discount_total !== 0) p.pair('Zbritje gjithsej', `-${n2(Math.abs(sale.discount_total))}`)
  p.bold(true).size(2).pair('TOTALI', n2(sale.total), Math.floor(w / 2)).size(1).bold(false)
  if (sale.cash_amount !== 0) p.pair('Kesh', n2(sale.kind === 'sale' && sale.tendered != null ? sale.tendered : sale.cash_amount))
  if (sale.card_amount !== 0) p.pair('Kartele', n2(sale.card_amount))
  if (sale.change_amount > 0) p.bold(true).pair('Kusuri', n2(sale.change_amount)).bold(false)

  if (opt.show_vat !== false) {
    p.rule()
    const cw = [Math.floor(w / 3), Math.ceil(w / 3), w - Math.floor(w / 3) - Math.ceil(w / 3)]
    p.bold(true).cols(['TVSH', 'Baza', 'Tvsh'], cw).bold(false)
    for (const v of sale.vat_lines) p.cols([`${v.code} ${v.code === 'A' ? 'lir.' : `${Math.round(v.rate * 100)}%`}`, n2(v.net), n2(v.vat)], cw)
    p.cols(['Gjithsej', n2(sale.net_total), n2(sale.vat_total)], cw)
  }
  p.rule()
  if (sale.reason) p.wrap(`Arsyeja: ${sale.reason}`)
  p.align('center')
  if (s.receipt_footer) p.bold(true).wrap(s.receipt_footer).bold(false)
  if (opt.show_barcode && sale.invoice_no && !f) p.feed(1).barcode128(String(sale.invoice_no)).raw(0x0a)
  if (f) {
    // ATK: QR (citizen coupon + signature), NUIKF, SEF number, coupon number and type.
    p.align('left').rule()
    // RKS mark (ATK asks for the RKS logo; text until the official image is printed as a bitmap)
    p.align('center').bold(true).size(2).line('RKS').size(1).bold(false).align('left')
    p.pair('Nr. SEF:', f.sef_no)
    p.pair('Nr. kuponit:', f.coupon_id)
    p.pair('NUIKF:', f.verification_no)
    p.align('center').feed(1).qr(f.qr, s.paper_width === 58 ? 3 : 4).raw(0x0a)
    p.bold(true).line(f.env === 'test' ? 'KUPON FISKAL - TEST' : 'KUPON FISKAL').bold(false)
    if (offline) p.line('Leshuar pa lidhje me ATK')
  } else {
    p.line('Kupon jo-fiskal')
  }
  p.align('left')
  if (opt.cut !== false) p.cut()
  else p.feed(4)
  if (opts.drawer) p.drawer()
  return p.build()
}

/** A short test page for Settings → Printeri. */
export function testPageBytes(businessName: string, s: Pick<ReceiptSettings, 'paper_width' | 'printer_charset'>): Uint8Array {
  const w = charsPerLine(s.paper_width)
  const p = new EscPos(w, s.printer_charset)
  p.align('center').bold(true).size(2).line('KASA').size(1).bold(false)
  p.line(businessName)
  p.line(`Leter ${s.paper_width}mm - ${w} shenja`)
  p.align('left').rule()
  p.line('Shkronjat: ë Ë ç Ç - çmimi, këpucë')
  p.pair('Majtas', 'Djathtas')
  p.rule('=')
  p.align('center').bold(true).size(2).line('12.50 EUR').size(1).bold(false)
  p.qr('https://kasa.app', 5).raw(0x0a)
  p.line('Printeri punon!')
  p.cut()
  return p.build()
}
