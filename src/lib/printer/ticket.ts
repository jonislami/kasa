import { formatKosovoDateTime } from '@/lib/clock'
import type { Ticket } from '@/features/restaurant/api'
import { STATION_LABELS } from '@/features/restaurant/api'
import type { ReceiptSettings } from '@/features/settings/api'
import { charsPerLine, EscPos } from './escpos'

const qty = (v: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3, useGrouping: false }).format(v)

/** Kitchen / bar ticket: big table name and quantities, no prices. */
export function ticketBytes(t: Ticket, s: Pick<ReceiptSettings, 'paper_width' | 'printer_charset'>, reprint = false): Uint8Array {
  const w = charsPerLine(s.paper_width)
  const p = new EscPos(w, s.printer_charset)
  p.align('center').bold(true).line(STATION_LABELS[t.station].toUpperCase() + (reprint ? ' - KOPJE' : ''))
  p.size(2).line(t.table_name ? `Tavolina ${t.table_name}` : `Porosia #${t.order_no}`).size(1).bold(false)
  p.line(`#${t.order_no} - ${formatKosovoDateTime(t.created_at)}`)
  if (t.waiter_name) p.line(t.waiter_name)
  p.align('left').rule('=')
  for (const i of t.items) {
    p.bold(true).wrap(`${qty(i.quantity)} x ${i.name}`).bold(false)
    for (const m of i.modifiers ?? []) p.line(`   + ${m}`)
    if (i.note) p.bold(true).wrap(`   ! ${i.note}`).bold(false)
    p.rule()
  }
  p.feed(2).cut()
  return p.build()
}
