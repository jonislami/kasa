import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { buildRows, nuiCell, totals, type BookDoc } from '@/kontabilist/atkBooks'
import { DataTable, Segments, type Column } from '@/kontabilist/DataTable'
import { demoSale } from './screens'

/**
 * KontoSef Kontabilist with demo data for the public site: the program's own table (DataTable) and the ATK sales
 * book built by the program's own book logic (atkBooks.ts), around the frame of the program. The client
 * "SHEMBULL SH.P.K." and its partners are examples.
 */
export interface DemoDoc {
  id: string
  date: string
  no: string
  partner: string
  nui: string
  net: number
  vat: number
  total: number
  open: number
  status: 'E paguar' | 'E papaguar' | 'Pjesërisht'
}

const doc = (id: string, date: string, no: string, partner: string, nui: string, net: number, open = 0): DemoDoc => {
  const vat = Math.round(net * 0.18 * 100) / 100
  const total = Math.round((net + vat) * 100) / 100
  return { id, date, no, partner, nui, net, vat, total, open, status: open === 0 ? 'E paguar' : open >= total ? 'E papaguar' : 'Pjesërisht' }
}

export const DEMO_SALES: DemoDoc[] = [
  doc('1', '03.11.2026', '2026-0141', 'Shembull Distribucion SH.P.K.', '810000002', 1250),
  doc('2', '06.11.2026', '2026-0142', 'Hotel Shembull', '810000003', 860, 1014.8),
  doc('3', '10.11.2026', '2026-0143', 'Klinika Shembull', '810000004', 420),
  doc('4', '14.11.2026', '2026-0144', 'Shembull Ndërtim SH.P.K.', '810000005', 2300, 1000),
  doc('5', '19.11.2026', '2026-0145', 'Kafe Shembull', '810000006', 185),
  doc('6', '24.11.2026', '2026-0146', 'Shembull Distribucion SH.P.K.', '810000002', 940, 1109.2),
]

const columns: Column<DemoDoc>[] = [
  { id: 'date', label: 'Data', width: 96, text: (d) => d.date, render: (d) => <span className="tabular-nums">{d.date}</span> },
  { id: 'no', label: 'Nr.', width: 92, text: (d) => d.no, render: (d) => <span className="tabular-nums">{d.no}</span> },
  { id: 'partner', label: 'Blerësi', width: 230, fixed: true, text: (d) => d.partner, render: (d) => <span className="font-medium">{d.partner}</span> },
  { id: 'nui', label: 'NUI', width: 96, text: (d) => d.nui, render: (d) => <span className="tabular-nums">{d.nui}</span> },
  { id: 'net', label: 'Baza', width: 100, money: (d) => d.net, render: (d) => formatEUR(d.net) },
  { id: 'vat', label: 'TVSH', width: 90, money: (d) => d.vat, render: (d) => formatEUR(d.vat) },
  { id: 'total', label: 'Totali', width: 104, money: (d) => d.total, render: (d) => <b>{formatEUR(d.total)}</b> },
  {
    id: 'status',
    label: 'Statusi',
    width: 110,
    text: (d) => d.status,
    render: (d) => (
      <span className={cn('rounded-md px-2 py-[3px] text-[12px] font-medium', d.status === 'E paguar' ? 'bg-ok-100 text-ok-700' : d.status === 'Pjesërisht' ? 'bg-amber-100 text-amber-700' : 'bg-warn-100 text-warn-700')}>{d.status}</span>
    ),
  },
]

/** The frame of the program: dark top bar, compact menu, one-line page header. */
export function KontabilistFrame({ title, group, children }: { title: string; group: string; children: ReactNode }) {
  const menu = [
    ['Dokumentet', ['Faturat e shitjes', 'Blerjet dhe shpenzimet', 'Skanimi me AI']],
    ['Thesari', ['Arka dhe banka', 'Borxhet dhe detyrimet']],
    ['Tatimet – ATK', ['Kontrolli para dorëzimit', 'Deklarata e TVSH-së', 'Libri i shitjes dhe blerjes']],
  ] as const
  return (
    <div className="flex h-full w-full flex-col bg-[#F7F8FA] font-sans text-[13px] text-[#0F172A]">
      <div className="flex h-10 items-center gap-3 bg-[#0F1B2D] px-3 text-white">
        <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-white/10 text-[10px] font-bold">K</span>
        <span className="text-[12px] font-semibold">Zyra Shembull</span>
        <span className="mx-auto flex h-7 w-[380px] items-center rounded-[4px] bg-white/10 px-2.5 text-[12px] text-white/60">Kërko kompani, faturë, partner ose faqe…</span>
        <span className="text-[12px] text-white/80">Kontabilisti</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[200px] border-r border-[#E6E8EC] bg-white p-2">
          <div className="rounded-[4px] border border-[#E6E8EC] px-2 py-1.5">
            <div className="font-semibold">SHEMBULL SH.P.K.</div>
            <div className="text-[11px] text-[#5F6B7A]">NUI 999999992 · TVSH</div>
          </div>
          {menu.map(([g, items]) => (
            <div key={g} className="mt-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#8A94A6]">{g}</div>
              {items.map((i) => (
                <div key={i} className={cn('rounded-[4px] px-2 py-1.5', i === title ? 'bg-[#EBF1FB] font-semibold text-[#1A4390]' : 'text-[#344054]')}>
                  {i}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-[#E6E8EC] bg-white px-4 py-2">
            <div className="text-[11px] text-[#5F6B7A]">SHEMBULL SH.P.K. › {group}</div>
            <div className="text-[15px] font-semibold">{title}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Faturat e shitjes – the real table of the program with the demo invoices (1100 × 560). */
export function DemoKontabilistTable() {
  return (
    <div className="h-[560px] w-[1100px]">
      <KontabilistFrame title="Faturat e shitjes" group="Dokumentet">
        <DataTable
          id="site-demo-sales"
          rows={DEMO_SALES}
          columns={columns}
          rowKey={(d) => d.id}
          maxHeight="400px"
          filters={<Segments value="all" onChange={() => undefined} options={[{ value: 'all', label: 'Të gjitha', count: 6 }, { value: 'open', label: 'Pa arkëtuar', count: 3 }]} />}
        />
      </KontabilistFrame>
    </div>
  )
}

/** Step 1: choosing the client (Ctrl+K), large. */
export function ClientPickerDemo() {
  const clients = [
    ['SHEMBULL SH.P.K.', 'NUI 999999992 · Prishtinë · në TVSH'],
    ['Shembull Ndërtim SH.P.K.', 'NUI 810000005 · Ferizaj · në TVSH'],
    ['Kafe Shembull', 'NUI 810000006 · Pejë · jo TVSH'],
  ]
  return (
    <div className="overflow-hidden rounded-[6px] border border-[#E6E8EC] bg-white font-sans text-[#0F172A]">
      <div className="flex h-11 items-center gap-2 border-b border-[#E6E8EC] px-3 text-[15px]">
        <span className="text-[#5F6B7A]">⌕</span> shembull
      </div>
      <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#5F6B7A]">Kompanitë</div>
      {clients.map(([n, s], i) => (
        <div key={n} className={cn('px-3 py-2', i === 0 && 'bg-[#EBF1FB]')}>
          <div className="text-[14px] font-medium">{n}</div>
          <div className="text-[12px] text-[#5F6B7A]">{s}</div>
        </div>
      ))}
      <div className="border-t border-[#E6E8EC] bg-[#F9FAFB] px-3 py-1.5 text-[11px] text-[#5F6B7A]">↵ hap · kompania tjetër hapet në të njëjtën faqe</div>
    </div>
  )
}

/** Step 3: reconciling the bank statement with the invoices. */
export function BankDemo() {
  const lines = [
    { date: '07.11.2026', text: 'Pagesë – Hotel Shembull, fat. 2026-0142', amount: 1014.8, match: '2026-0142 · Hotel Shembull · €1,014.80', state: 'suggest' },
    { date: '15.11.2026', text: 'Pagesë – Shembull Ndërtim, avans', amount: 1714.0, match: '2026-0144 · Shembull Ndërtim · mbetet €1,000.00', state: 'done' },
    { date: '20.11.2026', text: 'Provizion bankar', amount: -2.5, match: 'Regjistro si shpenzim bankar', state: 'book' },
  ]
  return (
    <div className="overflow-hidden rounded-[6px] border border-[#E6E8EC] bg-white font-sans text-[13px] text-[#0F172A]">
      <div className="grid grid-cols-[86px_1fr_96px_1.2fr] bg-[#F5F6F8] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#5F6B7A]">
        <span>Data</span>
        <span>Ekstrakti i bankës</span>
        <span className="text-right">Shuma</span>
        <span className="pl-4">Lidhja</span>
      </div>
      {lines.map((l) => (
        <div key={l.text} className="grid grid-cols-[86px_1fr_96px_1.2fr] items-center border-t border-[#EEF0F3] px-3 py-2.5">
          <span className="tabular-nums text-[#5F6B7A]">{l.date}</span>
          <span>{l.text}</span>
          <span className={cn('text-right font-semibold tabular-nums', l.amount < 0 && 'text-warn-700')}>{formatEUR(l.amount)}</span>
          <span className="pl-4">
            <span className={cn('inline-block rounded-[4px] px-2 py-1 text-[12px]', l.state === 'done' ? 'bg-ok-100 text-ok-700' : l.state === 'suggest' ? 'bg-[#EBF1FB] font-semibold text-[#1A4390] ring-1 ring-[#1F4FA8]' : 'bg-[#F0F2F5] text-[#475467]')}>
              {l.state === 'done' ? '✓ ' : l.state === 'suggest' ? 'Lidhe: ' : ''}
              {l.match}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The ATK sales book, from the demo documents and one coupon of the till
// ---------------------------------------------------------------------------
const base = { vat_no: '', vat_nd: 0, asset: false, export: false, category: 'goods', vat_flag: 'none', doc_type: 'invoice', net_d: 0, vat_d: 0, amt_c: 0, amt_a: 0 } as const
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`

export const BOOK_DOCS: BookDoc[] = [
  ...DEMO_SALES.slice(0, 4).map((d): BookDoc => ({ ...base, kind: 'sale', date: iso(d.date), doc_no: d.no, partner: d.partner, nui: d.nui, net_e: d.net, vat_e: d.vat, total: d.total })),
  // a fiscal coupon of the client's till (KontoSef): final consumer "Qytetar", code 1
  kasaRow(),
]

/** The demo coupon of the till (the same sale as the receipt on the site) as the book receives it. */
function kasaRow(): BookDoc {
  const s = demoSale()
  const e = s.vat_lines.find((v) => v.code === 'E')!
  const d = s.vat_lines.find((v) => v.code === 'D')!
  return { ...base, kind: 'sale', source: 'kasa', coupons: 1, date: s.sale_date, doc_no: String(s.invoice_no), partner: 'Qytetar', nui: '1', net_e: e.net, vat_e: e.vat, net_d: d.net, vat_d: d.vat, total: s.total }
}

/** The sales book as the program fills the ATK file: number, date, buyer, NUI/code, bases and VAT. */
export function SalesBookDemo({ highlightKasa }: { highlightKasa?: boolean }) {
  const rows = buildRows('sales_vat', BOOK_DOCS)
  const t = totals(rows)
  // template columns: [12] = 6, [K1] = 11, [14] = 12, [K2] = 16, [30] = 17
  const pick = (a: number[]) => [a[6], a[11], a[12], a[16], a[17]]
  return (
    <div className="overflow-x-auto rounded-[6px] border border-[#E6E8EC] bg-white font-sans text-[12px] text-[#0F172A]">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="bg-[#F5F6F8] text-[11px] font-semibold text-[#5F6B7A]">
            {['Nr.', 'Data', 'Nr. i faturës', 'Blerësi', 'NUI / kodi', '[12] baza 18%', '[K1] TVSH 18%', '[14] baza 8%', '[K2] TVSH 8%', '[30] TVSH'].map((h, i) => (
              <th key={h} className={cn('border-b border-[#E6E8EC] px-2 py-1.5 text-left', i >= 5 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const kasa = r.doc.source === 'kasa'
            return (
              <tr key={i} className={cn(kasa && highlightKasa && 'bg-[#EBF1FB] font-semibold')}>
                <td className="border-b border-[#EEF0F3] px-2 py-1.5 tabular-nums">{i + 1}</td>
                {r.text.slice(0, 4).map((x, k) => (
                  <td key={k} className="border-b border-[#EEF0F3] px-2 py-1.5">
                    {k === 3 ? nuiCell(r.doc) : x}
                  </td>
                ))}
                {pick(r.amounts).map((v, k) => (
                  <td key={k} className="border-b border-[#EEF0F3] px-2 py-1.5 text-right tabular-nums">
                    {v ? v.toFixed(2) : ''}
                  </td>
                ))}
              </tr>
            )
          })}
          <tr className="bg-[#F5F6F8] font-semibold">
            <td colSpan={5} className="px-2 py-1.5">
              Gjithsej
            </td>
            {pick(t).map((v, k) => (
              <td key={k} className="px-2 py-1.5 text-right tabular-nums">
                {v.toFixed(2)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
