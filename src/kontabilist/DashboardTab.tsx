import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Banknote, CalendarClock, ChevronLeft, ChevronRight, Landmark } from 'lucide-react'
import { Badge, Card } from '@/components/ui'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { fetchDashboard, type Client } from './api'

const SHORT = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj']
const ACTION: Record<string, string> = { create: 'u krijua', update: 'u ndryshua', payment: 'pagesë', payment_deleted: 'pagesa u fshi', converted: 'u kthye në faturë', file: 'skedar', correction_deleted: 'korrigjim u fshi' }

/** One company at a glance (Paneli). */
export function DashboardTab({ client, onGo }: { client: Client; onGo: (tab: string) => void }) {
  const [year, setYear] = useState(() => Number(kosovoDateISO().slice(0, 4)))
  const dash = useQuery({ queryKey: ['client', client.id, 'dashboard', year], queryFn: () => fetchDashboard(client.id, year) })
  const d = dash.data
  if (!d) return <p className={dash.error ? 'text-sm text-warn-700' : 'py-12 text-center text-muted'}>{dash.error ? (dash.error as Error).message : 'Duke ngarkuar…'}</p>

  const sales = d.months.reduce((s, m) => s + m.sales, 0)
  const costs = d.months.reduce((s, m) => s + m.purchases + m.expenses, 0)
  const money = d.accounts.reduce((s, a) => s + a.balance, 0)
  const max = Math.max(1, ...d.months.map((m) => Math.max(m.sales, m.purchases + m.expenses)))
  const nowMonth = kosovoDateISO().slice(0, 7)
  const vatToPay = Math.round((d.vat_prev.out - d.vat_prev.in) * 100) / 100
  const vatLate = d.vat_prev.status !== 'filed' && kosovoDateISO() > d.vat_prev.due

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[19px] font-semibold">Paneli i kompanisë</h2>
        <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
          <button type="button" aria-label="Viti i kaluar" className="flex h-9 w-9 items-center justify-center hover:bg-bg" onClick={() => setYear(year - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 font-semibold tabular-nums">{year}</span>
          <button type="button" aria-label="Viti tjetër" className="flex h-9 w-9 items-center justify-center hover:bg-bg" onClick={() => setYear(year + 1)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Stat label={`Të hyrat ${year} (pa TVSH)`} value={formatEUR(sales)} />
        <Stat label="Blerjet dhe shpenzimet" value={formatEUR(costs)} />
        <Stat label="Rezultati (para tatimit)" value={formatEUR(sales - costs)} tone={sales - costs < 0 ? 'warn' : 'good'} />
        <Stat label="Paraja sot (arka + banka)" value={formatEUR(money)} />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Të hyrat dhe kostot sipas muajve</h3>
          <div className="flex gap-4 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-brand-600" /> Të hyrat
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#F59E0B]" /> Kostot
            </span>
          </div>
        </div>
        <div className="flex h-[220px] items-end gap-1.5 border-b border-line sm:gap-3">
          {d.months.map((m, i) => {
            const c = m.purchases + m.expenses
            return (
              <div key={m.month} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5" title={`${SHORT[i]}: të hyrat ${formatEUR(m.sales)} · kostot ${formatEUR(c)}`}>
                <div className={cn('w-1/2 max-w-[18px] rounded-t', m.month.startsWith(nowMonth) ? 'bg-brand-600' : 'bg-brand-600/80')} style={{ height: `${(m.sales / max) * 100}%` }} />
                <div className="w-1/2 max-w-[18px] rounded-t bg-[#F59E0B]/85" style={{ height: `${(c / max) * 100}%` }} />
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex gap-1.5 sm:gap-3">
          {d.months.map((m, i) => (
            <span key={m.month} className={cn('min-w-0 flex-1 text-center text-[11px] sm:text-[13px]', m.month.startsWith(nowMonth) ? 'font-semibold' : 'text-muted')}>
              {SHORT[i]}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="font-semibold">Borxhet</h3>
          <button type="button" onClick={() => onGo('borxhet')} className="mt-3 w-full rounded-ctl bg-[#F4F6F3] p-3 text-left hover:bg-brand-100">
            <div className="text-sm text-muted">Klientët na detyrohen</div>
            <div className="text-[20px] font-bold tabular-nums">{formatEUR(d.receivable)}</div>
            {d.overdue_receivable > 0 && <div className="text-sm text-warn-700">me vonesë {formatEUR(d.overdue_receivable)}</div>}
          </button>
          <button type="button" onClick={() => onGo('borxhet')} className="mt-2 w-full rounded-ctl bg-[#F4F6F3] p-3 text-left hover:bg-brand-100">
            <div className="text-sm text-muted">I detyrohemi furnitorëve</div>
            <div className="text-[20px] font-bold tabular-nums">{formatEUR(d.payable)}</div>
            {d.overdue_payable > 0 && <div className="text-sm text-warn-700">me vonesë {formatEUR(d.overdue_payable)}</div>}
          </button>
          {d.overdue_docs > 0 && <p className="mt-2 text-sm text-warn-700">{d.overdue_docs} fatura kanë kaluar afatin.</p>}
        </Card>

        <Card className="p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="h-5 w-5 text-muted" /> Afatet
          </h3>
          <div className={cn('mt-3 rounded-ctl p-3', vatLate ? 'bg-warn-100' : 'bg-[#F4F6F3]')}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">TVSH · {SHORT[Number(d.vat_prev.month.slice(5, 7)) - 1]} {d.vat_prev.month.slice(0, 4)}</span>
              {d.vat_prev.status === 'filed' ? <Badge tone="success">E dorëzuar</Badge> : <Badge tone={vatLate ? 'warn' : 'amber'}>Afati {formatDay(d.vat_prev.due)}</Badge>}
            </div>
            <div className="mt-1 text-sm text-muted">
              Dalëse {formatEUR(d.vat_prev.out)} · hyrëse {formatEUR(d.vat_prev.in)}
            </div>
            <div className="mt-1 font-semibold tabular-nums">{vatToPay >= 0 ? `Për pagesë ${formatEUR(vatToPay)}` : `Për bartje ${formatEUR(-vatToPay)}`}</div>
            {vatLate && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-warn-700">
                <AlertTriangle className="h-4 w-4" /> Afati ka kaluar
              </div>
            )}
          </div>
          <button type="button" onClick={() => onGo('tvsh')} className="mt-2 text-sm font-semibold text-brand-600 hover:underline">
            Hap TVSH-në →
          </button>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold">Arka dhe banka</h3>
          {d.accounts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Shto arkën dhe llogaritë bankare te "Arka & banka".</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {d.accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {a.kind === 'cash' ? <Banknote className="h-4 w-4 shrink-0 text-muted" /> : <Landmark className="h-4 w-4 shrink-0 text-muted" />}
                    <span className="truncate">{a.name}</span>
                    {a.to_match > 0 && <Badge tone="amber">{a.to_match}</Badge>}
                  </span>
                  <span className={cn('font-semibold tabular-nums', a.balance < 0 && 'text-warn-700')}>{formatEUR(a.balance)}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => onGo('banka')} className="mt-3 text-sm font-semibold text-brand-600 hover:underline">
            Hap arkën dhe bankën →
          </button>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-semibold">Aktivitetet e fundit</h3>
        {d.recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Ende pa aktivitet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {d.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <strong>{r.doc_no ?? '—'}</strong> {r.partner && <span className="text-muted">· {r.partner}</span>} · {ACTION[r.action] ?? r.action}
                  {r.details?.amount != null && ` ${formatEUR(Number(r.details.amount))}`}
                </span>
                <span className="text-muted">{formatKosovoDateTime(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'good' }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={cn('mt-1 text-[22px] font-bold tabular-nums', tone === 'warn' && 'text-warn-700', tone === 'good' && 'text-brand-600')}>{value}</div>
    </Card>
  )
}
