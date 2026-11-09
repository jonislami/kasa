import { VAT_LABELS, type VatCode } from '@/lib/vat'
import { unitLabel } from '@/lib/units'
import {
  EXPENSE_LABELS,
  formatDay,
  mergeVat,
  PAYMENT_LABELS,
  profitAndLoss,
  sumVat,
  vatDueDate,
  type Expense,
  type PurchaseDoc,
  type SaleDoc,
  type StockRow,
  type Summary,
} from './api'

export type Cell = { value: string | number; type?: StringConstructor | NumberConstructor; format?: string; fontWeight?: 'bold' } | null
export type Sheet = { name: string; rows: Cell[][]; widths: number[] }

const b = (v: string): Cell => ({ value: v, fontWeight: 'bold' })
const s = (v: string | null | undefined): Cell => ({ value: v ?? '', type: String })
const num = (v: number): Cell => ({ value: Math.round(v * 100) / 100, type: Number, format: '0.00' })
const qty = (v: number): Cell => ({ value: v, type: Number })
const int = (v: number): Cell => ({ value: v, type: Number, format: '0' })

const CODES: VatCode[] = ['E', 'D', 'C', 'A']
const KIND = { sale: 'Shitje', void: 'Anulim', refund: 'Kthim' } as const
const PAY = { cash: 'Kesh', card: 'Kartelë', mixed: 'Kesh + Kartelë' } as const

function head(sm: Summary, title: string): Cell[][] {
  return [
    [b(title)],
    [s(sm.business.name), s(sm.business.nui ? `NUI ${sm.business.nui}` : ''), s(sm.business.vat_number ? `Nr. TVSH ${sm.business.vat_number}` : 'Jo në TVSH')],
    [s(`Periudha: ${formatDay(sm.from)} – ${formatDay(sm.to)}`)],
    [],
  ]
}

/** Columns "Baza X / TVSH X" for the two taxed rates, then 0% and exempt as one amount each. */
const rateHead = [b('Baza 18%'), b('TVSH 18%'), b('Baza 8%'), b('TVSH 8%'), b('0%'), b('E liruar')]
function rateCells(get: (c: VatCode) => { net: number; vat: number; gross: number } | undefined): Cell[] {
  const e = get('E')
  const d = get('D')
  return [num(e?.net ?? 0), num(e?.vat ?? 0), num(d?.net ?? 0), num(d?.vat ?? 0), num(get('C')?.gross ?? 0), num(get('A')?.gross ?? 0)]
}

export function salesDailySheet(sm: Summary): Sheet {
  const t = sumVat(sm.vat_out)
  return {
    name: 'Libri i shitjeve',
    widths: [12, 10, 10, 9, ...Array(6).fill(12), 12, 12, 12, 12],
    rows: [
      ...head(sm, 'Libri i shitjeve – ditor'),
      [b('Data'), b('Nga nr.'), b('Deri nr.'), b('Kuponë'), ...rateHead, b('TVSH gjithsej'), b('Totali'), b('Kesh'), b('Kartelë')],
      ...sm.daily.map((d) => [s(formatDay(d.date)), int(d.first_no), int(d.last_no), int(d.docs + d.corrections), ...rateCells((c) => d.rates[c]), num(d.vat), num(d.gross), num(d.cash), num(d.card)]),
      [b('Gjithsej'), null, null, int(sm.sales.docs + sm.sales.voids + sm.sales.refunds), ...rateCells((c) => sm.vat_out.find((v) => v.code === c)), num(t.vat), num(t.gross), num(sm.sales.cash), num(sm.sales.card)],
    ],
  }
}

export function salesDocsSheet(sm: Summary, docs: SaleDoc[]): Sheet {
  const no = new Map(docs.map((d) => [d.id, d.invoice_no]))
  const reg = new Map(sm.registers.map((r) => [r.id, r.name]))
  return {
    name: 'Kuponët',
    widths: [10, 12, 8, 10, 10, 14, 14, ...Array(6).fill(12), 12, 12, 10],
    rows: [
      ...head(sm, 'Libri i shitjeve – kuponët'),
      [b('Nr.'), b('Data'), b('Ora'), b('Lloji'), b('Për nr.'), b('Arka'), b('Pagesa'), ...rateHead, b('TVSH'), b('Totali'), b('Offline')],
      ...docs.map((d) => [
        int(d.invoice_no),
        s(formatDay(d.sale_date)),
        s(new Date(d.created_at).toLocaleTimeString('sq-AL', { timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit' })),
        s(KIND[d.kind]),
        d.ref_sale_id && no.has(d.ref_sale_id) ? int(no.get(d.ref_sale_id)!) : s(''),
        s(d.register_id ? reg.get(d.register_id) ?? '' : ''),
        s(PAY[d.payment_method]),
        ...rateCells((c) => d.vat_lines.find((v) => v.code === c)),
        num(d.vat_total),
        num(d.total),
        s(d.offline ? 'po' : ''),
      ]),
    ],
  }
}

export function purchasesSheet(sm: Summary, docs: PurchaseDoc[]): Sheet {
  const t = sumVat(sm.vat_in)
  return {
    name: 'Libri i blerjeve',
    widths: [12, 10, 26, 13, 13, 16, 12, ...Array(6).fill(12), 12, 12],
    rows: [
      ...head(sm, 'Libri i blerjeve (hyrjet e mallit)'),
      [b('Data'), b('Hyrja'), b('Furnitori'), b('NUI'), b('Nr. TVSH'), b('Nr. i faturës'), b('Pagesa'), ...rateHead, b('TVSH gjithsej'), b('Totali')],
      ...docs.map((d) => [
        s(formatDay(d.entry_date)),
        s(d.entry_no ? `H-${String(d.entry_no).padStart(4, '0')}` : ''),
        s(d.supplier?.name),
        s(d.supplier?.nui),
        s(d.supplier?.vat_number),
        s(d.invoice_no),
        s(PAYMENT_LABELS[d.payment]),
        ...rateCells((c) => d.vat_lines.find((v) => v.code === c)),
        num(d.vat_total),
        num(d.total),
      ]),
      [b('Gjithsej'), null, null, null, null, null, null, ...rateCells((c) => sm.vat_in.find((v) => v.code === c)), num(t.vat), num(t.gross)],
    ],
  }
}

export function expensesSheet(sm: Summary, list: Expense[]): Sheet {
  return {
    name: 'Shpenzimet',
    widths: [12, 26, 26, 22, 14, 12, 12, 12, 12, 12],
    rows: [
      ...head(sm, 'Shpenzimet'),
      [b('Data'), b('Kategoria'), b('Përshkrimi'), b('Furnitori'), b('Nr. i dokumentit'), b('Pagesa'), b('Norma'), b('Pa TVSH'), b('TVSH'), b('Totali')],
      ...[...list].reverse().map((e) => [s(formatDay(e.expense_date)), s(EXPENSE_LABELS[e.category]), s(e.description), s(e.vendor), s(e.doc_no), s(PAYMENT_LABELS[e.payment]), s(VAT_LABELS[e.vat_code]), num(e.net_total), num(e.vat_total), num(e.total)]),
      [b('Gjithsej'), null, null, null, null, null, null, num(sm.expenses.net), num(sm.expenses.vat), num(sm.expenses.gross)],
    ],
  }
}

export function vatSheet(sm: Summary): Sheet {
  const input = mergeVat(sm.vat_in, sm.expense_vat)
  const out = sumVat(sm.vat_out)
  const inn = sumVat(input)
  const line = (label: string, rows: Summary['vat_out']) => CODES.map((c) => {
    const r = rows.find((v) => v.code === c)
    return [s(`${label} – ${VAT_LABELS[c]}`), num(r?.net ?? 0), num(r?.vat ?? 0), num(r?.gross ?? 0)]
  })
  return {
    name: 'TVSH',
    widths: [40, 14, 14, 14],
    rows: [
      ...head(sm, 'Përmbledhja për deklaratën e TVSH-së'),
      [b('Shitjet'), b('Baza'), b('TVSH'), b('Me TVSH')],
      ...line('Shitje', sm.vat_out),
      [b('Shitjet gjithsej'), num(out.net), num(out.vat), num(out.gross)],
      [],
      [b('Blerjet dhe shpenzimet'), b('Baza'), b('TVSH e zbritshme'), b('Me TVSH')],
      ...line('Blerje', input),
      [b('Blerjet gjithsej'), num(inn.net), num(inn.vat), num(inn.gross)],
      [],
      [b(out.vat - inn.vat >= 0 ? 'TVSH për pagesë' : 'TVSH e kreditueshme'), null, num(Math.abs(out.vat - inn.vat))],
      [s(`Afati i deklarimit dhe pagesës: ${formatDay(vatDueDate(sm.to.slice(0, 8) + '01'))}`)],
    ],
  }
}

export function profitSheet(sm: Summary): Sheet {
  const p = profitAndLoss(sm)
  return {
    name: 'Fitimi dhe humbja',
    widths: [44, 16],
    rows: [
      ...head(sm, p.vat ? 'Fitimi dhe humbja (shumat pa TVSH)' : 'Fitimi dhe humbja'),
      [s('Të hyrat nga shitja'), num(p.revenue)],
      [s('Kosto e mallit të shitur'), num(-p.cogs)],
      [b('Fitimi bruto'), num(p.gross)],
      [s('Shkarkimet dhe dallimet e inventarit'), num(-p.stockLoss)],
      ...p.categories.map((c) => [s(EXPENSE_LABELS[c.category]), num(-c.amount)]),
      [b('Shpenzimet gjithsej'), num(-p.expenses)],
      [b(p.result >= 0 ? 'Fitimi para tatimit' : 'Humbja'), num(p.result)],
    ],
  }
}

export function cashSheet(sm: Summary): Sheet {
  return {
    name: 'Arka',
    widths: [18, 18, 14, 12, 12, 12, 12, 12],
    rows: [
      ...head(sm, 'Barazimi i arkës – ndërrimet'),
      [b('Fillimi'), b('Mbyllja'), b('Arka'), b('Kusuri në fillim'), b('Shitje kesh'), b('Pritet në arkë'), b('E numëruar'), b('Diferenca')],
      ...sm.shifts.map((h) => {
        const expected = h.opening + h.cash_sales
        const fmt = (iso: string) => new Date(iso).toLocaleString('sq-AL', { timeZone: 'Europe/Belgrade', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        return [s(fmt(h.started_at)), s(h.ended_at ? fmt(h.ended_at) : 'e hapur'), s(h.register), num(h.opening), num(h.cash_sales), num(expected), h.counted == null ? s('') : num(h.counted), h.counted == null ? s('') : num(h.counted - expected)]
      }),
    ],
  }
}

export function stockSheet(sm: Summary, list: StockRow[]): Sheet {
  return {
    name: 'Stoku',
    widths: [34, 16, 18, 8, 10, 10, 12, 12, 12],
    rows: [
      ...head(sm, `Stoku më ${formatDay(new Date().toISOString().slice(0, 10))} (me çmim blerjeje)`),
      [b('Artikulli'), b('Barkodi'), b('Kategoria'), b('TVSH'), b('Njësia'), b('Sasia'), b('Çmimi i blerjes'), b('Vlera'), b('Çmimi i shitjes')],
      ...list.filter((r) => r.stock !== 0).map((r) => [s(r.name), s(r.barcode), s(r.category), s(r.vat_code), s(unitLabel(r.unit)), qty(r.stock), num(r.purchase_price), num(r.stock * r.purchase_price), num(r.sale_price)]),
      [b('Gjithsej'), null, null, null, null, null, null, num(sm.stock.gross)],
    ],
  }
}

export async function downloadWorkbook(filename: string, sheets: Sheet[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  await writeXlsxFile(sheets.map((x) => ({ data: x.rows as never, sheet: x.name, columns: x.widths.map((width) => ({ width })) }))).toFile(filename)
}

/** Semicolon CSV with BOM (opens correctly in Excel with Albanian letters). */
export function downloadCsv(filename: string, sheet: Sheet): void {
  const esc = (c: Cell) => {
    if (!c) return ''
    const v = typeof c.value === 'number' ? (c.format === '0.00' ? c.value.toFixed(2) : String(c.value)).replace('.', ',') : c.value
    return `"${String(v).replace(/"/g, '""')}"`
  }
  const blob = new Blob(['﻿' + sheet.rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
