import { useMemo, useState } from 'react'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Plus, ReceiptText, ShoppingCart } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, CardHeader, EmptyState, StatCard, Tabs } from '@/components/ui'
import { businessType, hasModule, isManagerRole } from '@/lib/business'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
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

const dateFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: KOSOVO_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' })

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
            className="flex items-center justify-between gap-4 rounded-card bg-brand-600 px-6 py-6 text-white shadow-sm hover:bg-[#0b5a41] md:px-8"
          >
            <div>
              <div className="text-[24px] font-bold md:text-[28px]">{hasModule(business.type, 'tables') ? 'Porosi e re' : 'Shitje e re'}</div>
              <div className="text-white/80">Hap arkën dhe skano produktin e parë</div>
            </div>
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-400 text-ink">
              <Plus className="h-7 w-7" />
            </span>
          </Link>
          <ShiftCard />
          <h2 className="mt-2 text-[17px] font-semibold">Puna ime sot</h2>
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

  const bars = (series.data ?? []).map((p) => ({
    key: p.date,
    label: seriesArgs.bucket === 'month' ? monthLabel(p.date) : range === 'week' ? (p.date === t ? 'Sot' : dayLabel(p.date)) : String(Number(p.date.slice(8))),
    value: p.total,
    highlight: seriesArgs.bucket === 'month' ? p.date.slice(0, 7) === t.slice(0, 7) : p.date === t,
  }))

  return (
    <>
      <PageHeader
        eyebrow={todayLong()}
        title="Paneli i ditës"
        actions={
          <>
            {stockOn && (
              <Link to="/stoku" className="hidden md:block">
                <Button variant="secondary">
                  <Plus className="h-4 w-4" /> Hyrje malli
                </Button>
              </Link>
            )}
            <Link to="/arka" className="hidden md:block">
              <Button>
                <ShoppingCart className="h-4 w-4" /> Shitje e re
              </Button>
            </Link>
          </>
        }
      />

      {notMigrated && (
        <div className="mx-4 mb-4 rounded-card border border-[#F3C9AE] bg-[#FFF4EC] px-4 py-3 text-sm text-warn-700 md:mx-8">
          Numrat e panelit aktivizohen kur administratori të ekzekutojë migrimin supabase/migrations/0004_reports.sql.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-4">
        <StatCard
          label="Shitjet sot"
          value={tot ? formatEUR(tot.total) : '—'}
          sub={tot && prev ? <Delta value={pctChange(tot.total, prev.total)} label="nga dje" /> : undefined}
        />
        <StatCard label="Fatura (kuponë)" value={tot ? String(tot.invoices) : '—'} sub={tot && tot.invoices ? `Mesatarja ${formatEUR(tot.total / tot.invoices)} / faturë` : undefined} />
        <StatCard
          label="Fitimi bruto"
          value={tot ? formatEUR(tot.profit) : '—'}
          sub={tot && tot.total > 0 ? `Marzha ${((tot.profit / tot.total) * 100).toFixed(1)}%` : undefined}
        />
        {stockOn ? (
          <Link to="/stoku" className="contents">
            <StatCard label="Stok i ulët" value={`${low.length} ${itemsLabel}`} sub={low.length > 0 ? 'Shiko listën →' : undefined} tone={low.length > 0 ? 'warn' : 'default'} />
          </Link>
        ) : (
          <StatCard label="Kthime / anulime sot" value={tot ? `${tot.refunds} / ${tot.voids}` : '—'} />
        )}
      </div>

      <div className="grid gap-4 px-4 pb-4 md:px-8 md:py-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold">
              {range === 'week' ? 'Shitjet – 7 ditët e fundit' : range === 'month' ? 'Shitjet – 30 ditët e fundit' : 'Shitjet – 12 muajt e fundit'}
            </h2>
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
          <div className="mt-6">
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

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Më të shiturat sot</h2>
          <div className="mt-4">
            {(report.data?.top ?? []).length === 0 ? (
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Ende pa shitje sot" />
            ) : (
              <RankBars rows={(report.data?.top ?? []).slice(0, 5).map((p) => ({ key: p.key, label: p.name, value: p.quantity, text: formatQty(p.quantity, p.unit) }))} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 px-4 pb-8 md:px-8 lg:grid-cols-2">
        {lotsOn && lots.data && <ExpiryCard lots={lots.data} onOpen={() => navigate('/stoku?tab=afatet')} />}
        {stockOn && (
          <Card className="overflow-hidden">
            <CardHeader
              title="Duhet porositur"
              action={
                <Link to="/stoku" className="text-sm font-semibold text-brand-600 underline">
                  Krijo porosi
                </Link>
              }
            />
            {low.length === 0 ? (
              <EmptyState title="Stoku në rregull" text="Asnjë produkt nën minimum." />
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-[13px] text-muted">
                    <th className="border-b border-line px-5 py-2.5 font-semibold">Produkti</th>
                    <th className="border-b border-line px-3 py-2.5 text-right font-semibold">Në stok</th>
                    <th className="border-b border-line px-3 py-2.5 text-right font-semibold">Minimumi</th>
                    <th className="border-b border-line px-5 py-2.5 font-semibold">Statusi</th>
                  </tr>
                </thead>
                <tbody>
                  {low.slice(0, 6).map((p) => (
                    <tr key={p.id}>
                      <td className="border-b border-line px-5 py-3">{p.name}</td>
                      <td className="border-b border-line px-3 py-3 text-right tabular-nums">{formatQty(p.stock, p.unit).replace(/ .*/, '')}</td>
                      <td className="border-b border-line px-3 py-3 text-right tabular-nums">{formatQty(p.min_stock, p.unit).replace(/ .*/, '')}</td>
                      <td className="border-b border-line px-5 py-3">
                        {stockLevel(p) === 'critical' ? <Badge tone="warn">Kritik</Badge> : <Badge tone="amber">I ulët</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader
            title="Faturat e fundit"
            action={
              <Link to="/raportet" className="text-sm font-semibold text-brand-600 underline">
                Të gjitha
              </Link>
            }
          />
          {(invoices.data ?? []).length === 0 ? (
            <EmptyState icon={<ReceiptText className="h-6 w-6" />} title="Ende pa fatura sot" />
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] text-muted">
                  <th className="border-b border-line px-5 py-2.5 font-semibold">Nr.</th>
                  <th className="border-b border-line px-3 py-2.5 font-semibold">Ora</th>
                  <th className="border-b border-line px-3 py-2.5 font-semibold">Pagesa</th>
                  <th className="hidden border-b border-line px-3 py-2.5 text-right font-semibold sm:table-cell">Artikuj</th>
                  <th className="border-b border-line px-5 py-2.5 text-right font-semibold">Totali</th>
                </tr>
              </thead>
              <tbody>
                {(invoices.data ?? []).map((s) => (
                  <tr key={s.id} onClick={() => setOpenSale(s.id)} className="cursor-pointer hover:bg-[#F8FAF8]">
                    <td className="border-b border-line px-5 py-3 font-medium">
                      {s.kind === 'sale' ? formatInvoiceNo(s.invoice_no) : <Badge tone={s.kind === 'void' ? 'warn' : 'amber'}>{s.kind === 'void' ? 'Anulim' : 'Kthim'}</Badge>}
                    </td>
                    <td className="border-b border-line px-3 py-3 tabular-nums">{timeFmt.format(new Date(s.created_at))}</td>
                    <td className="border-b border-line px-3 py-3">{PAY_LABEL[s.payment_method]}</td>
                    <td className="hidden border-b border-line px-3 py-3 text-right tabular-nums sm:table-cell">{Number(s.items_count)}</td>
                    <td className="border-b border-line px-5 py-3 text-right font-semibold tabular-nums">{formatEUR(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <InvoiceDialog saleId={openSale} onClose={() => setOpenSale(null)} />
    </>
  )
}
