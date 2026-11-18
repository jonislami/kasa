import { useMemo, useState } from 'react'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Plus, ReceiptText, ShoppingCart } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { isSefApp } from '@/lib/device'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, CardHeader, EmptyState, StatCard, Table, Tabs, Td, Th } from '@/components/ui'
import { businessType, hasModule, isManagerRole } from '@/lib/business'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
import { VAT_LABELS } from '@/lib/vat'
import { kosovoParts, serverDate, KOSOVO_TZ } from '@/lib/clock'
import { formatQty } from '@/lib/units'
import { fetchProducts, stockLevel } from '@/features/products/api'
import {
  addDays,
  dayLabel,
  fetchInvoices,
  fetchReport,
  fetchSeries,
  monthLabel,
  PAY_LABEL,
  pctChange,
  ReportsNotMigrated,
  today as todayISO,
} from '@/features/reports/api'
import { BarChart, BarLabels, Delta, RankBars } from '@/features/reports/charts'
import { InvoiceDialog } from '@/features/reports/InvoiceDialog'
import { MyWork } from '@/features/reports/MyWork'
import { ShiftCard } from '@/features/reports/ShiftCard'
import { ExpiryCard } from '@/features/stock/LotsTab'
import { fetchLots } from '@/lib/lots'
import { SqDateFormat } from '@/lib/sqDate'

const dateFmt = new SqDateFormat({ timeZone: KOSOVO_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeFmt = new SqDateFormat({ timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' })

function todayLong(): string {
  const s = dateFmt.format(serverDate())
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function greeting(): string {
  const h = kosovoParts().h
  return h < 11 ? 'Mirëmëngjes' : h < 18 ? 'Mirëdita' : 'Mirëmbrëma'
}

type Range = 'week' | 'month' | 'year'

export function DashboardPage() {
  const { business, profile } = useBusiness()
  const info = businessType(business.type)
  const manager = isManagerRole(profile.role)
  const first = profile.full_name.split(' ')[0] || ''

  if (!manager) {
    return (
      <>
        <PageHeader eyebrow={todayLong()} title={`${greeting()}${first ? `, ${first}` : ''}`} />
        <div className="flex flex-col gap-4 px-4 py-5 md:px-8 md:py-0 md:pb-8">
          <Link
            to="/arka"
            className="flex items-center justify-between gap-4 rounded-card bg-brand-600 px-6 py-5 text-white shadow-card hover:bg-brand-700 md:px-7"
          >
            <div>
              <div className="text-[20px] font-semibold tracking-[-0.02em] md:text-[24px]">{hasModule(business.type, 'tables') ? 'Porosi e re' : 'Shitje e re'}</div>
              <div className="text-white/75">Hap arkën dhe skano produktin e parë</div>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
              <Plus className="h-6 w-6" />
            </span>
          </Link>
          <ShiftCard />
          <h2 className="mt-2 text-[15px] font-semibold">Puna ime sot</h2>
          <MyWork showCommission={hasModule(business.type, 'commission')} />
        </div>
      </>
    )
  }

  return <ManagerDashboard itemsLabel={info.terms.items} stockOn={hasModule(business.type, 'stock')} lotsOn={hasModule(business.type, 'lots')} />
}

function ManagerDashboard({ itemsLabel, stockOn, lotsOn }: { itemsLabel: string; stockOn: boolean; lotsOn: boolean }) {
  const t = todayISO()
  const [range, setRange] = useState<Range>('week')
  const [openSale, setOpenSale] = useState<string | null>(null)

  const report = useQuery({ queryKey: ['report', t, t], queryFn: () => fetchReport(t, t), refetchInterval: 60_000 })
  const seriesArgs = useMemo(() => {
    if (range === 'week') return { from: addDays(t, -6), to: t, bucket: 'day' as const }
    if (range === 'month') return { from: addDays(t, -29), to: t, bucket: 'day' as const }
    const d = new Date(t + 'T00:00:00')
    d.setMonth(d.getMonth() - 11, 1)
    return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: t, bucket: 'month' as const }
  }, [range, t])
  const series = useQuery({ queryKey: ['series', seriesArgs], queryFn: () => fetchSeries(seriesArgs.from, seriesArgs.to, seriesArgs.bucket) })
  const invoices = useQuery({ queryKey: ['invoices', 'today', t], queryFn: () => fetchInvoices(t, t, 6) })
  const products = useQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true), enabled: stockOn })
  const lots = useQuery({ queryKey: ['lots'], queryFn: fetchLots, enabled: lotsOn })
  const navigate = useNavigate()

  const low = useMemo(
    () =>
      (products.data ?? [])
        .filter((p) => p.active && ['low', 'critical'].includes(stockLevel(p)))
        .sort((a, b) => a.stock / a.min_stock - b.stock / b.min_stock),
    [products.data],
  )

  const notMigrated = report.error instanceof ReportsNotMigrated
  const tot = report.data?.totals
  const prev = report.data?.prev
  const vatRows = (report.data?.vat ?? []).filter((v) => v.gross !== 0)

  const bars = (series.data ?? []).map((p) => ({
    key: p.date,
    label: seriesArgs.bucket === 'month' ? monthLabel(p.date) : range === 'week' ? (p.date === t ? 'Sot' : dayLabel(p.date)) : String(Number(p.date.slice(8))),
    value: p.total,
    highlight: seriesArgs.bucket === 'month' ? p.date.slice(0, 7) === t.slice(0, 7) : p.date === t,
  }))

  // The day in figures, exactly as the report returns them (no calculation here).
  const summary: [string, string][] = [
    ['Pa TVSH (baza)', tot ? formatEUR(tot.net_total) : '—'],
    ['TVSH', tot ? formatEUR(tot.vat_total) : '—'],
    ['Kesh', tot ? formatEUR(tot.cash) : '—'],
    ['Kartelë', tot ? formatEUR(tot.card) : '—'],
    ['Zbritje', tot ? formatEUR(tot.discounts) : '—'],
    ['Kthime / anulime', tot ? `${tot.refunds} / ${tot.voids}` : '—'],
  ]

  return (
    <>
      <PageHeader
        eyebrow={todayLong()}
        title="Paneli"
        actions={
          <>
            {stockOn && (
              <Link to="/stoku" className="hidden md:block">
                <Button variant="secondary">
                  <Plus className="h-4 w-4" /> Hyrje malli
                </Button>
              </Link>
            )}
            {isSefApp && (
              <Link to="/arka" className="hidden md:block">
                <Button>
                  <ShoppingCart className="h-4 w-4" /> Shitje e re
                </Button>
              </Link>
            )}
          </>
        }
      />

      {notMigrated && (
        <div className="mx-4 mb-4 rounded-card border border-[#F3C4BE] bg-warn-100 px-4 py-3 text-sm text-warn-700 md:mx-8">
          Numrat e panelit aktivizohen kur administratori të ekzekutojë migrimin supabase/migrations/0004_reports.sql.
        </div>
      )}

      {/* Key figures of the day */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4 md:gap-4 md:px-8 md:pt-0 lg:grid-cols-4">
        <StatCard
          label="Shitjet sot"
          value={tot ? formatEUR(tot.total) : '—'}
          sub={tot && prev ? <Delta value={pctChange(tot.total, prev.total)} label="nga dje" /> : undefined}
        />
        <StatCard label="Kuponë" value={tot ? String(tot.invoices) : '—'} sub={tot && tot.invoices ? `Mesatarja ${formatEUR(tot.total / tot.invoices)}` : undefined} />
        <StatCard
          label="Fitimi bruto"
          value={tot ? formatEUR(tot.profit) : '—'}
          sub={tot && tot.total > 0 ? `Marzha ${((tot.profit / tot.total) * 100).toFixed(1)}%` : undefined}
        />
        {stockOn ? (
          <Link to="/stoku" className="contents">
            <StatCard
              label="Stok i ulët"
              value={`${low.length} ${itemsLabel}`}
              sub={low.length > 0 ? 'Shiko listën →' : 'Asnjë nën minimum'}
              tone={low.length > 0 ? 'warn' : 'default'}
            />
          </Link>
        ) : (
          <StatCard label="Kthime / anulime sot" value={tot ? `${tot.refunds} / ${tot.voids}` : '—'} />
        )}
      </div>

      <div className="grid gap-3 px-4 pt-3 md:gap-4 md:px-8 md:pt-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Shitjet</h2>
              <p className="text-[13px] text-muted">
                {range === 'week' ? '7 ditët e fundit' : range === 'month' ? '30 ditët e fundit' : '12 muajt e fundit'}
              </p>
            </div>
            <Tabs
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                { value: 'week', label: 'Javë' },
                { value: 'month', label: 'Muaj' },
                { value: 'year', label: 'Vit' },
              ]}
            />
          </div>
          <div className="mt-5">
            {loadState(series) === 'offline' ? (
              <OfflineEmpty />
            ) : loadState(series) === 'loading' ? (
              <div className="h-[220px]" />
            ) : (
              <>
                <BarChart bars={bars} />
                <BarLabels bars={bars} />
              </>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Përmbledhja e ditës" />
          <dl className="mt-3 text-[14px]">
            {summary.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-t border-line px-5 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="num font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {vatRows.length > 0 && (
            <div className="border-t border-line bg-[#F9FAFB] px-5 py-3">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted">TVSH sipas normës</div>
              {vatRows.map((v) => (
                <div key={v.code} className="flex justify-between gap-3 py-0.5 text-[13px]">
                  <span className="text-muted">{VAT_LABELS[v.code]}</span>
                  <span className="num text-ink">{formatEUR(v.vat)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-3 px-4 pb-8 pt-3 md:gap-4 md:px-8 md:pt-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader
            title="Kuponët e fundit"
            action={
              <Link to="/raportet" className="text-[13px] font-medium text-brand-600 hover:underline">
                Të gjithë
              </Link>
            }
          />
          {(invoices.data ?? []).length === 0 ? (
            <EmptyState icon={<ReceiptText />} title="Ende pa kuponë sot" />
          ) : (
            <Table className="mt-4">
              <thead>
                <tr>
                  <Th className="pl-5">Nr.</Th>
                  <Th>Ora</Th>
                  <Th>Pagesa</Th>
                  <Th className="hidden text-right sm:table-cell">Artikuj</Th>
                  <Th className="pr-5 text-right">Totali</Th>
                </tr>
              </thead>
              <tbody>
                {(invoices.data ?? []).map((s) => (
                  <tr key={s.id} onClick={() => setOpenSale(s.id)} className="cursor-pointer">
                    <Td className="pl-5 font-medium">
                      {s.kind === 'sale' ? formatInvoiceNo(s.invoice_no) : <Badge tone={s.kind === 'void' ? 'warn' : 'amber'}>{s.kind === 'void' ? 'Anulim' : 'Kthim'}</Badge>}
                    </Td>
                    <Td className="text-muted">{timeFmt.format(new Date(s.created_at))}</Td>
                    <Td>{PAY_LABEL[s.payment_method]}</Td>
                    <Td className="hidden text-right sm:table-cell">{Number(s.items_count)}</Td>
                    <Td className="pr-5 text-right font-semibold">{formatEUR(s.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Më të shiturat sot</h2>
          <div className="mt-4">
            {(report.data?.top ?? []).length === 0 ? (
              <EmptyState icon={<BarChart3 />} title="Ende pa shitje sot" />
            ) : (
              <RankBars rows={(report.data?.top ?? []).slice(0, 6).map((p) => ({ key: p.key, label: p.name, value: p.quantity, text: formatQty(p.quantity, p.unit) }))} />
            )}
          </div>
        </Card>

        {stockOn && (
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader
              title="Duhet porositur"
              action={
                <Link to="/stoku" className="text-[13px] font-medium text-brand-600 hover:underline">
                  Krijo porosi
                </Link>
              }
            />
            {low.length === 0 ? (
              <EmptyState title="Stoku në rregull" text="Asnjë produkt nën minimum." />
            ) : (
              <Table className="mt-4">
                <thead>
                  <tr>
                    <Th className="pl-5">Produkti</Th>
                    <Th className="text-right">Në stok</Th>
                    <Th className="text-right">Minimumi</Th>
                    <Th className="pr-5">Statusi</Th>
                  </tr>
                </thead>
                <tbody>
                  {low.slice(0, 6).map((p) => (
                    <tr key={p.id}>
                      <Td className="pl-5">{p.name}</Td>
                      <Td className="text-right">{formatQty(p.stock, p.unit).replace(/ .*/, '')}</Td>
                      <Td className="text-right text-muted">{formatQty(p.min_stock, p.unit).replace(/ .*/, '')}</Td>
                      <Td className="pr-5">{stockLevel(p) === 'critical' ? <Badge tone="warn">Kritik</Badge> : <Badge tone="amber">I ulët</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
        {lotsOn && lots.data && <ExpiryCard lots={lots.data} onOpen={() => navigate('/stoku?tab=afatet')} />}
      </div>
      <InvoiceDialog saleId={openSale} onClose={() => setOpenSale(null)} />
    </>
  )
}
