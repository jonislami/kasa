import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Search } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Input, StatCard, Table, Tabs, Td, Th } from '@/components/ui'
import { ROLE_LABELS } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
import { formatQty, unitLabel } from '@/lib/units'
import { VAT_LABELS, VAT_RATES, type VatCode } from '@/lib/vat'
import { fetchPeople } from '@/features/stock/api'
import {
  dayLabel,
  fetchInvoices,
  fetchReport,
  formatRange,
  PAY_LABEL,
  pctChange,
  periodRange,
  ReportsNotMigrated,
  today,
  type InvoiceRow,
  type PeriodKey,
  type ReportSummary,
} from './api'
import { BarChart, BarLabels, Delta } from './charts'
import { InvoiceDialog } from './InvoiceDialog'

const dtFmt = new Intl.DateTimeFormat('sq-AL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const PERIOD_LABEL: Record<PeriodKey, string> = { today: 'nga dje', yesterday: 'nga pardje', '7': 'nga java e kaluar', month: 'nga periudha e kaluar', custom: 'nga periudha e kaluar' }

export function ReportsPage() {
  const [period, setPeriod] = useState<PeriodKey>('7')
  const [custom, setCustom] = useState({ from: today(), to: today() })
  const [customOpen, setCustomOpen] = useState(false)
  const range = periodRange(period, custom)

  const report = useQuery({ queryKey: ['report', range.from, range.to], queryFn: () => fetchReport(range.from, range.to) })
  const invoices = useQuery({ queryKey: ['invoices', range.from, range.to], queryFn: () => fetchInvoices(range.from, range.to) })
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, staleTime: 5 * 60_000 })

  const r = report.data
  const t = r?.totals

  const exportExcel = async () => {
    if (!r) return
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const b = (v: string) => ({ value: v, fontWeight: 'bold' as const })
    const num = (v: number) => ({ value: Math.round(v * 100) / 100, type: Number, format: '0.00' })
    const str = (v: string) => ({ value: v, type: String })
    const sheets = [
      [
        [b('Raporti'), str(formatRange(r.from, r.to))],
        [str('Shitjet'), num(r.totals.total)],
        [str('Pa TVSH'), num(r.totals.net_total)],
        [str('TVSH'), num(r.totals.vat_total)],
        [str('Fatura'), { value: r.totals.invoices, type: Number }],
        [str('Fitimi bruto'), num(r.totals.profit)],
        [str('Kesh'), num(r.totals.cash)],
        [str('Kartelë'), num(r.totals.card)],
        [str('Kthime'), num(r.totals.refund_total)],
        [str('Anulime'), num(r.totals.void_total)],
      ],
      [[b('Data'), b('Shitjet'), b('Fatura')], ...r.daily.map((d) => [str(d.date), num(d.total), { value: d.invoices, type: Number }])],
      [[b('Norma'), b('Shitjet (me TVSH)'), b('Baza'), b('TVSH')], ...r.vat.map((v) => [str(VAT_LABELS[v.code]), num(v.gross), num(v.net), num(v.vat)])],
      [[b('Produkti'), b('Sasia'), b('Njësia'), b('Shitjet'), b('Fitimi')], ...r.top.map((p) => [str(p.name), { value: p.quantity, type: Number }, str(unitLabel(p.unit)), num(p.total), num(p.profit)])],
      [[b('Punëtori'), b('Fatura'), b('Shitjet'), b('Kesh'), b('Kartelë')], ...r.workers.map((w) => [str(w.name), { value: w.invoices, type: Number }, num(w.total), num(w.cash), num(w.card)])],
      [
        [b('Nr.'), b('Lloji'), b('Data / ora'), b('Punëtori'), b('Pagesa'), b('Totali')],
        ...(invoices.data ?? []).map((s) => [
          { value: s.invoice_no, type: Number },
          str(s.kind === 'sale' ? 'Shitje' : s.kind === 'void' ? 'Anulim' : 'Kthim'),
          str(dtFmt.format(new Date(s.created_at))),
          str(people.data?.get(s.worker_id) ?? ''),
          str(PAY_LABEL[s.payment_method]),
          num(s.total),
        ]),
      ],
    ]
    const names = ['Përmbledhje', 'Ditore', 'TVSH', 'Produktet', 'Punëtorët', 'Faturat']
    const columns = [{ width: 26 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 12 }]
    await writeXlsxFile(sheets.map((data, i) => ({ data, sheet: names[i], columns }))).toFile(`raporti-${r.from}-${r.to}.xlsx`)
  }

  if (report.error instanceof ReportsNotMigrated) {
    return (
      <>
        <PageHeader title="Raportet" />
        <div className="px-4 py-5 md:px-8 md:py-0">
          <Card>
            <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Raportet nuk janë aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0004_reports.sql në Supabase." />
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={<span className="md:hidden">{formatRange(range.from, range.to)}</span>}
        title="Raportet"
        actions={
          <div className="flex flex-wrap gap-2">
            <Tabs
              value={period}
              onChange={(v) => {
                if (v === 'custom') setCustomOpen(true)
                setPeriod(v)
              }}
              className="max-w-full overflow-x-auto"
              options={[
                { value: 'today', label: 'Sot' },
                { value: 'yesterday', label: 'Dje' },
                { value: '7', label: '7 ditë' },
                { value: 'month', label: 'Ky muaj' },
                { value: 'custom', label: period === 'custom' ? formatRange(custom.from, custom.to) : 'I zgjedhur…' },
              ]}
            />
            <Button variant="secondary" onClick={() => void exportExcel()} disabled={!r}>
              Eksporto
            </Button>
          </div>
        }
      />
      <p className="-mt-5 hidden px-8 pb-5 text-muted md:block">{formatRange(range.from, range.to)}</p>

      <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-4">
        <StatCard label="Shitjet" value={t ? formatEUR(t.total) : '—'} sub={t && r ? <Delta value={pctChange(t.total, r.prev.total)} label={PERIOD_LABEL[period]} /> : undefined} />
        <StatCard label="Fatura" value={t ? String(t.invoices) : '—'} sub={t && t.invoices ? `Mesatarja ${formatEUR(t.total / t.invoices)}` : undefined} />
        <StatCard label="Fitimi bruto" value={t ? formatEUR(t.profit) : '—'} sub={t && t.total > 0 ? `Marzha ${((t.profit / t.total) * 100).toFixed(1)}%` : undefined} />
        <StatCard label="TVSH e mbledhur" value={t ? formatEUR(t.vat_total) : '—'} sub={t ? `Pa TVSH ${formatEUR(t.net_total)}` : undefined} />
      </div>

      {report.isLoading ? (
        <p className="py-16 text-center text-muted">Duke ngarkuar…</p>
      ) : r ? (
        <ReportBody r={r} invoices={invoices.data ?? []} people={people.data ?? new Map()} />
      ) : (
        <p className="px-8 py-10 text-warn-700">{(report.error as Error)?.message}</p>
      )}

      <Dialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Zgjidh periudhën"
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setCustomOpen(false)}>Shfaq</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Nga" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <Input label="Deri" type="date" value={custom.to} min={custom.from} max={today()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      </Dialog>
    </>
  )
}

function ReportBody({ r, invoices, people }: { r: ReportSummary; invoices: InvoiceRow[]; people: Map<string, string> }) {
  const [q, setQ] = useState('')
  const [openSale, setOpenSale] = useState<string | null>(null)
  const t = today()
  const single = r.from === r.to

  const bars = single
    ? r.hours.map((h) => ({ key: String(h.hour), label: `${h.hour}h`, value: h.total, title: `${h.hour}:00 – ${formatEUR(h.total)}` }))
    : r.daily.map((d) => ({ key: d.date, label: r.daily.length > 10 ? String(Number(d.date.slice(8))) : dayLabel(d.date, true), value: d.total, highlight: d.date === t }))

  const voided = useMemo(() => new Set(invoices.filter((s) => s.kind === 'void' && s.ref_sale_id).map((s) => s.ref_sale_id!)), [invoices])
  const list = useMemo(() => {
    const s = q.trim().replace(',', '.').replace('#', '')
    if (!s) return invoices
    return invoices.filter((x) => String(x.invoice_no).includes(s.replace(/^0+/, '')) || x.total.toFixed(2).includes(s))
  }, [invoices, q])

  const vatOrder: VatCode[] = ['E', 'D', 'C', 'A']
  const vatRows = vatOrder.map((code) => r.vat.find((v) => v.code === code) ?? { code, gross: 0, net: 0, vat: 0 }).filter((v) => v.gross !== 0 || v.code === 'E' || v.code === 'D')
  const vatSum = r.vat.reduce((a, v) => ({ gross: a.gross + v.gross, net: a.net + v.net, vat: a.vat + v.vat }), { gross: 0, net: 0, vat: 0 })

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 md:gap-5 md:px-8 md:py-5">
      <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">{single ? 'Shitjet sipas orës' : 'Shitjet ditore'}</h2>
          <div className="mt-6">
            <BarChart bars={bars} />
            <BarLabels bars={bars} />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <h2 className="px-5 pt-5 text-[17px] font-semibold">Më të shiturat</h2>
          {r.top.length === 0 ? (
            <EmptyState title="Ende pa shitje" />
          ) : (
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th className="pl-5">Produkti</Th>
                  <Th className="text-right">Sasia</Th>
                  <Th className="text-right">Shitjet</Th>
                  <Th className="pr-5 text-right">Fitimi</Th>
                </tr>
              </thead>
              <tbody>
                {r.top.map((p) => (
                  <tr key={p.key}>
                    <Td className="pl-5">{p.name}</Td>
                    <Td className="text-right">{formatQty(p.quantity, p.unit).replace(/ copë$/, '')}</Td>
                    <Td className="text-right">{formatEUR(p.total)}</Td>
                    <Td className={cn('pr-5 text-right', p.profit < 0 && 'text-warn-700')}>{formatEUR(p.profit)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <h2 className="px-5 pt-5 text-[17px] font-semibold">TVSH sipas normës</h2>
          <Table className="mt-3">
            <thead>
              <tr>
                <Th className="pl-5">Norma</Th>
                <Th className="text-right">Shitjet (me TVSH)</Th>
                <Th className="text-right">Baza</Th>
                <Th className="pr-5 text-right">TVSH</Th>
              </tr>
            </thead>
            <tbody>
              {vatRows.map((v) => (
                <tr key={v.code}>
                  <Td className="pl-5">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#EEF1EE] text-xs font-bold">{v.code}</span>
                    {v.code === 'A' ? 'E liruar' : `${Math.round(VAT_RATES[v.code] * 100)}%`}
                  </Td>
                  <Td className="text-right">{formatEUR(v.gross)}</Td>
                  <Td className="text-right">{formatEUR(v.net)}</Td>
                  <Td className="pr-5 text-right font-semibold">{v.code === 'A' ? '—' : formatEUR(v.vat)}</Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td className="pl-5">Gjithsej</Td>
                <Td className="text-right">{formatEUR(vatSum.gross)}</Td>
                <Td className="text-right">{formatEUR(vatSum.net)}</Td>
                <Td className="pr-5 text-right">{formatEUR(vatSum.vat)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <h2 className="px-5 pt-5 text-[17px] font-semibold">Sipas arkëtarit</h2>
          {r.workers.length === 0 ? (
            <EmptyState title="Ende pa shitje" />
          ) : (
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th className="pl-5">Arkëtari</Th>
                  <Th className="text-right">Fatura</Th>
                  <Th className="text-right">Shitjet</Th>
                  <Th className="pr-5 text-right">Kesh / Kartelë</Th>
                </tr>
              </thead>
              <tbody>
                {r.workers.map((w) => (
                  <tr key={w.worker_id}>
                    <Td className="pl-5">
                      {w.name}
                      {w.role && w.role !== 'worker' && <span className="text-muted"> ({ROLE_LABELS[w.role].toLowerCase()})</span>}
                    </Td>
                    <Td className="text-right">{w.invoices}</Td>
                    <Td className="text-right font-semibold">{formatEUR(w.total)}</Td>
                    <Td className="pr-5 text-right text-muted">
                      {formatEUR(w.cash)} / {formatEUR(w.card)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="grid grid-cols-2 gap-3 border-t border-line px-5 py-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-muted">Kesh</div>
              <div className="font-semibold tabular-nums">{formatEUR(r.totals.cash)}</div>
            </div>
            <div>
              <div className="text-muted">Kartelë</div>
              <div className="font-semibold tabular-nums">{formatEUR(r.totals.card)}</div>
            </div>
            <div>
              <div className="text-muted">Kthime ({r.totals.refunds})</div>
              <div className="font-semibold tabular-nums">{formatEUR(r.totals.refund_total)}</div>
            </div>
            <div>
              <div className="text-muted">Anulime ({r.totals.voids})</div>
              <div className="font-semibold tabular-nums">{formatEUR(r.totals.void_total)}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <h2 className="text-[17px] font-semibold">Faturat</h2>
          <div className="relative md:w-[340px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nr. i faturës ose shuma"
              className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none"
            />
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState title="Asnjë faturë" />
        ) : (
          <Table>
            <thead className="bg-[#F8FAF8]">
              <tr>
                <Th className="pl-5">Nr.</Th>
                <Th>Data / ora</Th>
                <Th className="hidden md:table-cell">Arkëtari</Th>
                <Th className="hidden md:table-cell">Pagesa</Th>
                <Th>Statusi</Th>
                <Th className="text-right">Totali</Th>
                <Th className="pr-5" />
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 300).map((s) => {
                const isVoided = s.kind === 'sale' && voided.has(s.id)
                return (
                  <tr key={s.id}>
                    <Td className={cn('pl-5 font-semibold', isVoided && 'text-muted line-through')}>{formatInvoiceNo(s.invoice_no)}</Td>
                    <Td className="whitespace-nowrap">{dtFmt.format(new Date(s.created_at))}</Td>
                    <Td className="hidden md:table-cell">{people.get(s.worker_id) ?? '—'}</Td>
                    <Td className="hidden md:table-cell">{PAY_LABEL[s.payment_method]}</Td>
                    <Td>
                      {s.kind === 'void' ? (
                        <Badge tone="warn">Anulim</Badge>
                      ) : s.kind === 'refund' ? (
                        <Badge tone="amber">Kthim</Badge>
                      ) : isVoided ? (
                        <Badge tone="warn">Anuluar</Badge>
                      ) : s.offline ? (
                        <Badge tone="amber">Offline</Badge>
                      ) : (
                        <Badge>Jo-fiskal</Badge>
                      )}
                    </Td>
                    <Td className={cn('text-right font-semibold', isVoided && 'text-muted')}>{formatEUR(s.total)}</Td>
                    <Td className="pr-5 text-right">
                      <button type="button" onClick={() => setOpenSale(s.id)} className="font-semibold text-brand-600 underline">
                        Shiko
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
        {list.length > 300 && <p className="px-5 py-3 text-sm text-muted">Shfaqen 300 të parat. Përdor kërkimin ose eksportin për të gjitha.</p>}
      </Card>
      <InvoiceDialog saleId={openSale} onClose={() => setOpenSale(null)} />
    </div>
  )
}
