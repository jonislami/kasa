import { useEffect, useMemo, useState } from 'react'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { KOSOVO_TZ } from '@/lib/clock'
import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Card, EmptyState, Select, StatCard, Table, Td, Th } from '@/components/ui'
import { businessType, hasModule, isManagerRole, ROLE_LABELS } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
import {
  fetchComparison,
  fetchWork,
  formatMinutes,
  formatRange,
  PAY_LABEL,
  periodRange,
  ReportsNotMigrated,
  type PeriodKey,
  type WorkEvent,
} from '@/features/reports/api'
import { InvoiceDialog } from '@/features/reports/InvoiceDialog'
import { MyWork } from '@/features/reports/MyWork'
import { ShiftCard } from '@/features/reports/ShiftCard'
import { CommissionReport } from '@/features/salon/CommissionReport'

const timeFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' })
const dayTimeFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: KOSOVO_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const COLORS = ['bg-brand-600', 'bg-bt-600', 'bg-[#A16207]', 'bg-[#7C3AED]', 'bg-[#BE123C]', 'bg-[#0F766E]']

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('')
}

function hm(min: number): string {
  return `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`
}

export function WorkPage() {
  const { business, profile } = useBusiness()
  const info = businessType(business.type)
  if (!isManagerRole(profile.role)) {
    return (
      <>
        <PageHeader title="Puna ime sot" />
        <div className="flex flex-col gap-4 px-4 py-5 md:px-8 md:py-0 md:pb-8">
          <ShiftCard />
          <MyWork showCommission={hasModule(business.type, 'commission')} />
        </div>
      </>
    )
  }
  return <ManagerWork workerTerm={info.terms.worker} commission={hasModule(business.type, 'commission')} />
}

function ManagerWork({ workerTerm, commission }: { workerTerm: string; commission: boolean }) {
  const [period, setPeriod] = useState<PeriodKey>('today')
  const range = periodRange(period)
  const comparison = useQuery({ queryKey: ['work', 'comparison', range.from, range.to], queryFn: () => fetchComparison(range.from, range.to) })
  const rows = comparison.data ?? []
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0].worker_id)
  }, [rows, selected])

  const work = useQuery({
    queryKey: ['work', 'one', selected, range.from, range.to],
    queryFn: () => fetchWork(selected, range.from, range.to),
    enabled: Boolean(selected),
  })
  const [openSale, setOpenSale] = useState<string | null>(null)

  const sum = useMemo(
    () => rows.reduce((a, r) => ({ invoices: a.invoices + r.invoices, total: a.total + r.total, minutes: a.minutes + r.minutes, voids: a.voids + r.voids, refunds: a.refunds + r.refunds }), { invoices: 0, total: 0, minutes: 0, voids: 0, refunds: 0 }),
    [rows],
  )

  if (comparison.error instanceof ReportsNotMigrated) {
    return (
      <>
        <PageHeader title="Puna e punëtorëve" />
        <div className="px-4 py-5 md:px-8 md:py-0">
          <Card>
            <EmptyState icon={<Users className="h-6 w-6" />} title="Puna e punëtorëve nuk është aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0004_reports.sql në Supabase." />
          </Card>
        </div>
      </>
    )
  }

  const w = work.data
  const t = w?.totals
  const multiDay = range.from !== range.to

  return (
    <>
      <PageHeader
        eyebrow={<span className="md:hidden">{formatRange(range.from, range.to)}</span>}
        title="Puna e punëtorëve"
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted md:inline">Periudha</span>
            <Select
              aria-label="Periudha"
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodKey)}
              className="h-11 w-auto"
              options={[
                { value: 'today', label: 'Sot' },
                { value: 'yesterday', label: 'Dje' },
                { value: '7', label: '7 ditë' },
                { value: 'month', label: 'Ky muaj' },
              ]}
            />
          </div>
        }
      />
      <p className="-mt-5 hidden px-8 pb-5 text-muted md:block">{formatRange(range.from, range.to)}</p>

      <div className="flex flex-col gap-4 px-4 pb-8 pt-4 md:gap-5 md:px-8 md:pt-0">
        <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {rows.map((r, i) => (
            <button
              key={r.worker_id}
              type="button"
              onClick={() => setSelected(r.worker_id)}
              className={cn(
                'flex shrink-0 items-center gap-3 rounded-card border bg-white py-2 pl-2 pr-4 text-left',
                selected === r.worker_id ? 'border-2 border-ink' : 'border-line hover:border-field',
                !r.active && 'opacity-60',
              )}
            >
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white', COLORS[i % COLORS.length])}>{initials(r.name)}</span>
              <span>
                <span className="block font-semibold leading-tight">{r.name}</span>
                <span className="block text-xs text-muted">{r.role === 'worker' ? workerTerm : ROLE_LABELS[r.role]}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-5">
          <StatCard label="Fatura" value={t ? String(t.invoices) : '—'} sub={formatRange(range.from, range.to)} />
          <StatCard label="Totali" value={t ? formatEUR(t.total) : '—'} sub={t && t.invoices ? `mesatarja ${formatEUR(t.total / t.invoices)}` : undefined} />
          <StatCard label="Kthime / anulime" value={t ? `${t.refunds} / ${t.voids}` : '—'} sub={t && (t.refund_total || t.void_total) ? `${formatEUR(t.refund_total + t.void_total)}` : undefined} />
          <StatCard label={`Komisioni (${w?.worker.commission_pct ?? 0}%)`} value={w ? formatEUR(w.commission) : '—'} sub={commission ? 'mbi shitjet' : 'vendoset te Cilësimet'} />
          <StatCard label="Orët e punës" value={w ? formatMinutes(w.minutes) : '—'} sub={w ? `${w.shifts} ndërrime${w.open_shift ? ' · në punë tani' : ''}` : undefined} />
        </div>

        <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <h2 className="px-5 pt-5 text-[17px] font-semibold">
              Veprimet {w ? `e ${w.worker.name.split(' ')[0]}` : ''} {multiDay ? '' : period === 'today' ? 'sot' : 'dje'}
            </h2>
            {loadState(work) === 'offline' ? (
              <OfflineEmpty />
            ) : loadState(work) === 'loading' ? (
              <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
            ) : !w || w.events.length === 0 ? (
              <EmptyState title="Asnjë veprim në këtë periudhë" />
            ) : (
              <ul className="mt-2 divide-y divide-line px-5 pb-3">
                {w.events.map((e, i) => (
                  <EventRow key={`${e.sale_id}-${e.type}-${i}`} e={e} multiDay={multiDay} onOpen={() => setOpenSale(e.sale_id)} />
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <h2 className="px-5 pt-5 text-[17px] font-semibold">Krahasimi i punëtorëve</h2>
            <Table className="mt-3">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-5">Punëtori</Th>
                  <Th className="text-right">Fatura</Th>
                  <Th className="text-right">Totali</Th>
                  <Th className="text-right">Orë</Th>
                  <Th className="hidden text-right sm:table-cell">€ / orë</Th>
                  <Th className="pr-5 text-right">Anulime</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.worker_id} onClick={() => setSelected(r.worker_id)} className={cn('cursor-pointer hover:bg-[#F8FAF8]', selected === r.worker_id && 'bg-brand-100/50')}>
                    <Td className="pl-5 font-semibold">{r.name}</Td>
                    <Td className="text-right">{r.invoices}</Td>
                    <Td className="text-right">{formatEUR(r.total)}</Td>
                    <Td className="text-right">{hm(r.minutes)}</Td>
                    <Td className="hidden text-right sm:table-cell">{r.minutes > 0 ? formatEUR(r.total / (r.minutes / 60)) : '—'}</Td>
                    <Td className="pr-5 text-right">{r.voids}</Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td className="pl-5">Gjithsej</Td>
                  <Td className="text-right">{sum.invoices}</Td>
                  <Td className="text-right">{formatEUR(sum.total)}</Td>
                  <Td className="text-right">{hm(sum.minutes)}</Td>
                  <Td className="hidden text-right sm:table-cell">{sum.minutes > 0 ? formatEUR(sum.total / (sum.minutes / 60)) : '—'}</Td>
                  <Td className="pr-5 text-right">{sum.voids}</Td>
                </tr>
              </tbody>
            </Table>
          </Card>
        </div>
        {commission && <CommissionReport />}
      </div>
      <InvoiceDialog saleId={openSale} onClose={() => setOpenSale(null)} />
    </>
  )
}

function EventRow({ e, multiDay, onOpen }: { e: WorkEvent; multiDay: boolean; onOpen: () => void }) {
  const when = (multiDay ? dayTimeFmt : timeFmt).format(new Date(e.at))
  const doc = e.type === 'sale' || e.type === 'void' || e.type === 'refund'
  const tag =
    e.type === 'sale' ? <Badge tone="success">Shitje</Badge> :
    e.type === 'refund' ? <Badge tone="amber">Kthim</Badge> :
    e.type === 'void' ? <Badge tone="warn">Anulim</Badge> :
    e.type === 'shift_start' ? <Badge>Hyrje</Badge> : <Badge>Dalje</Badge>
  const text =
    e.type === 'sale'
      ? `${formatInvoiceNo(e.invoice_no ?? 0)} · ${formatEUR(e.total ?? 0)} · ${e.payment_method ? PAY_LABEL[e.payment_method] : ''}`
      : e.type === 'refund' || e.type === 'void'
        ? `Nga ${formatInvoiceNo(e.ref_invoice_no ?? 0)} · ${formatEUR(e.total ?? 0)}${e.approved_by ? ` · miratuar nga ${e.approved_by}` : ''}`
        : e.type === 'shift_start'
          ? `Filloi ndërrimin · kusur ${formatEUR(e.total ?? 0)}`
          : `Mbylli ndërrimin${e.total != null ? ` · kesh ${formatEUR(e.total)}` : ''}`
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="w-[86px] shrink-0 font-mono text-sm text-muted">{when}</span>
      <span className="shrink-0">{e.offline ? <Badge tone="warn">Offline</Badge> : tag}</span>
      {doc ? (
        <button type="button" onClick={onOpen} className="min-w-0 truncate text-left text-[15px] hover:underline">
          {text}
        </button>
      ) : (
        <span className="min-w-0 truncate text-[15px]">{text}</span>
      )}
    </li>
  )
}
