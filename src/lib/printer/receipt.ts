import type { Business } from '@/app/AuthProvider'
import type { Sale } from '@/features/pos/api'
import type { ReceiptSettings } from '@/features/settings/api'
import { charsPerLine, EscPos } from './escpos'
import { n2, qty, receiptFacts } from './receiptFacts'

/** Word-wraps `text` into lines of at most `width` characters (long words are cut). */
function chunks(text: string, width: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (w.length > width) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      out.push(w.slice(0, width))
      w = w.slice(width)
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}

/** The same receipt as the on-screen one (Receipt.tsx), as ESC/POS bytes. */
export function receiptBytes(sale: Sale, business: Business, s: ReceiptSettings, opts: { copy?: boolean; drawer?: boolean } = {}): Uint8Array {
  const w = charsPerLine(s.paper_width)
  const p = new EscPos(w, s.printer_charset)
  const opt = s.settings
  const f = sale.fiscal ?? null
  const x = receiptFacts(sale, business, opts.copy)

  // Taxpayer and unit
  p.feed(1).align('center').bold(true).wrap(`TATIMPAGUESI: ${business.name}`).bold(false)
  if (s.receipt_header) p.wrap(s.receipt_header)
  for (const [k, v] of x.header) p.wrap(`${k}: ${v}`)
  p.align('left').rule()

  // Worker and title
  if (sale.worker_name) p.align('right').wrap(`EMRI I PUNËTORIT: ${sale.worker_name}`)
  p.align('center').bold(true).size(2).wrap(x.title).size(1)
  for (const m of x.marks) p.line(m)
  p.bold(false)
  if (x.refInvoice) p.line(`PËR KUPONIN: ${x.refInvoice}`)
  p.align('left').rule()

  // Items: ARTIKULLI | SASIA | ÇMIMI | SHUMA (+ VAT letter); long names continue on the next lines
  const cw = w >= 48 ? [20, 6, 9, 13] : [11, 5, 7, 9]
  p.bold(true).cols(['ARTIKULLI', 'SASIA', 'ÇMIMI', 'SHUMA'], cw).bold(false)
  for (const i of sale.items) {
    const name = chunks(i.name, cw[0] - 1)
    p.cols([name[0], qty(i.quantity, i.unit), n2(i.unit_price), `${n2(i.total)} ${i.vat_code}`], cw)
    for (const more of name.slice(1)) p.line(more)
    const disc = i.line_discount + i.invoice_discount
    if (disc !== 0) p.pair('  zbritje', `-${n2(Math.abs(disc))}`)
  }
  p.rule()

  // Total and payment
  if (sale.discount_total !== 0) p.pair('ZBRITJE GJITHSEJ', `-${n2(Math.abs(sale.discount_total))} EUR`)
  p.bold(true).pair(sale.kind === 'sale' ? 'TOTALI PËR PAGESË' : 'TOTALI', `${n2(sale.total)} EUR`).bold(false)
  p.pair('MËNYRA E PAGESËS', x.payment)
  if (sale.payment_method === 'mixed') {
    p.pair('  Kesh', n2(sale.cash_amount))
    p.pair('  Kartelë', n2(sale.card_amount))
  }
  if (sale.kind === 'sale' && sale.tendered != null && sale.tendered !== sale.cash_amount) p.pair('PAGUAR', n2(sale.tendered))
  if (sale.change_amount > 0) p.bold(true).pair('KUSURI', n2(sale.change_amount)).bold(false)

  // VAT by rate (ATK: VAT per rate and the total without VAT)
  if (opt.show_vat !== false) {
    p.rule()
    const vw = [Math.floor(w / 3), Math.ceil(w / 3), w - Math.floor(w / 3) - Math.ceil(w / 3)]
    p.bold(true).cols(['TVSH', 'PA TVSH', 'TVSH'], vw).bold(false)
    for (const v of sale.vat_lines) p.cols([`${v.code} ${v.code === 'A' ? 'e liruar' : `${Math.round(v.rate * 100)}%`}`, n2(v.net), n2(v.vat)], vw)
    p.cols(['Gjithsej', n2(sale.net_total), n2(sale.vat_total)], vw)
  }
  p.rule()

  // Fiscal block
  p.align('right').line(`ARTIKUJ - ${x.itemsCount}`).align('left')
  p.line(x.number)
  // label + value on one line, or the value right-aligned under its label when the paper is too narrow
  const field = (label: string, value: string) => (label.length + 1 + value.length <= w ? p.pair(label, value) : p.line(label).align('right').line(value).align('left'))
  field('DATA DHE ORA', x.dateTime)
  if (f) {
    field('NR. IDENTIFIKUES I SEF', f.sef_no)
    p.line(`NUIKF: ${f.verification_no}`)
  }
  p.align('center').line(`${f ? 'KUPON FISKAL' : 'KUPON'} DITOR NR. ${x.dailyNo}`).align('left')
  if (sale.reason) p.wrap(`ARSYEJA: ${sale.reason}`)

  p.align('center')
  if (f) {
    // ATK: QR = citizen coupon + signature, then the RKS mark
    p.feed(1).qr(f.qr, s.paper_width === 58 ? 5 : 6).raw(0x0a)
    if (f.status === 'failed') p.wrap(`ATK e refuzoi: ${f.error ?? ''}`)
    p.bold(true).line('RKS / MF').bold(false)
  } else {
    p.feed(1).line('Ky kupon nuk është fiskal.')
  }
  if (s.receipt_footer) p.bold(true).wrap(s.receipt_footer.toUpperCase()).bold(false)
  p.line('Mundësuar nga Kasa')
  if (opt.show_barcode && sale.invoice_no && !f) p.feed(1).barcode128(String(sale.invoice_no)).raw(0x0a)
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
