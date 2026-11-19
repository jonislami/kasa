import type { Business } from '@/app/AuthProvider'
import type { Sale } from '@/features/pos/api'
import type { ReceiptSettings } from '@/features/settings/api'
import { charsPerLine, EscPos } from './escpos'
import { n2, receiptFacts, type ReceiptLine } from './receiptFacts'
import { RKS_MARK } from './rksLogo'

const markBytes = () => Uint8Array.from(atob(RKS_MARK.data), (c) => c.charCodeAt(0))

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

/** The same receipt as the on-screen one (Receipt.tsx), as ESC/POS bytes – laid out as the ATK samples (Shtojca F). */
export function receiptBytes(sale: Sale, business: Business, s: ReceiptSettings, opts: { copy?: boolean; drawer?: boolean } = {}): Uint8Array {
  const w = charsPerLine(s.paper_width, s.settings?.line_chars)
  const p = new EscPos(w, s.printer_charset)
  const opt = s.settings
  const f = sale.fiscal ?? null
  const x = receiptFacts(sale, business, opts.copy)

  // Taxpayer and unit (the free header text stands in for the business logo)
  p.feed(1).align('center')
  if (s.receipt_header) p.bold(true).size(2).wrap(s.receipt_header).size(1).bold(false)
  p.wrap(`${x.L.taxpayer}: ${business.name}`)
  for (const [k, v] of x.header) {
    const strong = /NUI|JIB|TVSH|PDV/.test(k)
    if (strong) p.bold(true)
    p.wrap(`${k}: ${v}`)
    if (strong) p.bold(false)
  }
  p.align('left').rule('#')

  // Worker, title, the original coupon of a cancel / return
  if (sale.worker_name) p.align('right').wrap(`${x.L.worker}: ${sale.worker_name}`)
  p.align('center').bold(true).size(w >= 42 ? 2 : 1).wrap(x.title).size(1).bold(false)
  for (const m of x.marks) p.line(m)
  if (x.refLine) p.wrap(x.refLine)
  if (x.reasonLine) p.wrap(x.reasonLine)
  p.align('left').feed(1)

  // Items: ARTIKULLI | SASIA X ÇMIMI | SHUMA (with the VAT letter); long names continue on the next lines
  // the name takes what the quantity and amount columns leave (32 → 10, 42 → 16, 48 → 22, 64 → 38)
  const cw = w >= 42 ? [w - 26, 14, 12] : [w - 22, 13, 9]
  const lines = (ls: ReceiptLine[]) => {
    p.cols([x.L.item, x.L.qtyPrice, x.L.amount], cw)
    p.rule('-')
    for (const l of ls) {
      const name = chunks(l.name, cw[0] - 1)
      p.cols([name[0], l.qtyPrice, l.amount], cw)
      for (const more of name.slice(1)) p.line(more)
      if (l.discount) p.pair(`  ${l.discount.label}`, l.discount.amount)
    }
  }
  lines(x.main.lines)
  if (x.main.subtotal) {
    p.bold(true).pair(x.L.subtotal, x.main.subtotal.value).bold(false)
    p.pair(x.main.subtotal.label, x.main.subtotal.discount)
  }
  p.rule('-')
  p.bold(true).pair(x.L.total, `${x.main.total} EUR`).bold(false)
  p.pair(x.L.payment, x.main.payment)
  if (!x.returned && sale.kind === 'sale' && sale.tendered != null && sale.tendered !== sale.cash_amount) p.pair(x.L.paid, n2(sale.tendered))
  if (!x.returned && sale.change_amount > 0) p.pair(x.L.change, n2(sale.change_amount))
  for (const [k, v] of x.main.vat) p.pair(k, `${v} EUR`)
  if (x.hasVat) p.pair(x.L.net, `${x.main.net} EUR`)
  p.rule('-')

  // Return: what is returned and what remains
  if (x.returned) {
    p.rule('#').align('center').line(x.L.returnedTitle).align('left').rule('#')
    lines(x.returned.lines)
    p.rule('-').pair(x.L.returnedTotal, `${x.returned.total} EUR`)
    p.bold(true).pair(x.L.remaining, `${x.returned.remaining} EUR`).bold(false)
    p.rule('-')
  }

  // Fiscal block
  p.align('right').line(x.returned ? `${x.L.itemsReturned} - ${x.returned.count}` : `${x.L.items} - ${x.main.itemsCount}`).align('left')
  p.line(x.number)
  // label + value on one line, or the value right-aligned under its label when the paper is too narrow
  const field = (label: string, value: string) => (label.length + 1 + value.length <= w ? p.pair(label, value) : p.line(label).align('right').line(value).align('left'))
  field(x.L.dateTime, x.dateTime)
  if (f) {
    field(x.L.sefNo, f.sef_no)
    p.feed(1).bold(true).line(`NUIKF: ${f.verification_no}`).bold(false)
  }
  p.feed(1).align('center').line(`${x.L.daily} ${x.dailyNo}`)

  if (f) {
    // ATK: QR = citizen coupon + signature, then the fiscal logo (coat of arms + RKS / MF, 19 x 9.5 mm)
    p.qr(f.qr, s.paper_width < 70 ? 5 : 6).raw(0x0a)
    if (f.status === 'failed') p.wrap(`${x.L.rejected}: ${f.error ?? ''}`)
    p.image(RKS_MARK.width / 8, RKS_MARK.height, markBytes()).raw(0x0a)
  } else {
    p.feed(1).line(x.L.notFiscal)
  }
  if (s.receipt_footer) p.wrap(s.receipt_footer.toUpperCase())
  p.line(x.L.poweredBy)
  if (opt.show_barcode && sale.invoice_no && !f) p.feed(1).barcode128(String(sale.invoice_no)).raw(0x0a)
  p.align('left')
  if (opt.cut !== false) p.cut()
  else p.feed(4)
  if (opts.drawer) p.drawer()
  return p.build()
}

/** A short test page for Settings → Printeri. */
export function testPageBytes(businessName: string, s: Pick<ReceiptSettings, 'paper_width' | 'printer_charset'> & { settings?: ReceiptSettings['settings'] }): Uint8Array {
  const w = charsPerLine(s.paper_width, s.settings?.line_chars)
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
