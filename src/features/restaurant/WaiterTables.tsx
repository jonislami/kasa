import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Armchair, CheckCircle2, ShoppingBag } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { useWallet } from '@/app/layout/WorkerShell'
import { Card, EmptyState } from '@/components/ui'
import { serverNow } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { fetchOpenOrders, fetchTables, RestaurantNotMigrated, type OpenOrderSummary } from './api'

/**
 * The waiter's tables: four counters on top (occupied, free, mine, wallet) and one big tile per
 * table – green free, blue mine, red someone else's – plus "Me vete" for take-away.
 * Tap a table → the bill (OrderPage) → "Konfirmo porosinë" brings the waiter back here.
 */
export function WaiterTables() {
  const { profile } = useBusiness()
  const navigate = useNavigate()
  const location = useLocation()
  const tables = useQuery({ queryKey: ['tables'], queryFn: fetchTables })
  const orders = useQuery({ queryKey: ['open-orders'], queryFn: fetchOpenOrders, refetchInterval: 8000 })
  const wallet = useWallet()

  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null)
  useEffect(() => {
    if (!notice) return
    window.history.replaceState({}, '')
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const byTable = useMemo(() => {
    const m = new Map<string, OpenOrderSummary>()
    for (const o of orders.data ?? []) if (o.table_id) m.set(o.table_id, o)
    return m
  }, [orders.data])
  const list = useMemo(
    () => [...(tables.data ?? [])].sort((a, b) => a.area.localeCompare(b.area, 'sq') || a.y - b.y || a.x - b.x || a.name.localeCompare(b.name, 'sq', { numeric: true })),
    [tables.data],
  )
  const takeaway = (orders.data ?? []).filter((o) => !o.table_id)

  if (tables.error instanceof RestaurantNotMigrated) {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <EmptyState icon={<Armchair className="h-6 w-6" />} title="Tavolinat nuk janë aktivizuar ende" text="Pronari duhet t'i shtojë tavolinat." />
        </Card>
      </div>
    )
  }

  const occupied = list.filter((t) => byTable.has(t.id)).length
  const mine = (orders.data ?? []).filter((o) => o.waiter_id === profile.id).length

  return (
    <div className="flex flex-col gap-4 p-4 md:gap-5 md:p-6">
      {notice && (
        <p className="flex items-center gap-2 rounded-ctl bg-brand-100 px-4 py-3 text-[15px] font-medium text-brand-600">
          <CheckCircle2 className="h-5 w-5 shrink-0" /> {notice}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <Stat label="E zënë" value={occupied} tone="red" />
        <Stat label="Lirë" value={list.length - occupied} tone="green" />
        <Stat label="Imja" value={mine} tone="blue" />
        <Stat label="Kuleta aktuale" value={wallet === null ? '…' : formatEUR(wallet)} tone="green" />
      </div>

      {tables.isLoading ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar tavolinat…</p>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Armchair className="h-6 w-6" />} title="Nuk ka tavolina" text="Pronari i shton te Tavolinat → Ndrysho planin." />
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
        {list.map((t) => {
          const o = byTable.get(t.id)
          const state = !o ? 'free' : o.waiter_id === profile.id ? 'mine' : 'busy'
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/tavolinat/${t.id}`)}
              className={cn(
                'flex min-h-[124px] flex-col justify-between rounded-[18px] p-5 text-left text-white shadow-sm transition-transform active:scale-[0.98]',
                state === 'free' && 'bg-brand-600 hover:bg-[#0B5C43]',
                state === 'mine' && 'bg-bt-600 hover:bg-[#1A43BF]',
                state === 'busy' && 'bg-[#DC2626] hover:bg-[#C21F1F]',
              )}
            >
              <span className="text-[19px] font-bold leading-tight">{t.name}</span>
              <span className="text-[14px] font-medium text-white/85">
                {!o ? (
                  'Lirë'
                ) : (
                  <>
                    <span className="block text-[17px] font-bold text-white tabular-nums">{formatEUR(o.total)}</span>
                    {state === 'mine' ? 'Imja' : 'E zënë'} · {minutesSince(o.opened_at)}
                    {o.ready > 0 && ` · ${o.ready} gati`}
                    {o.unsent > 0 && ` · ${o.unsent} pa konfirmuar`}
                  </>
                )}
              </span>
            </button>
          )
        })}

        {takeaway.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => navigate(`/tavolinat/merr?order=${o.id}`)}
            className="flex min-h-[124px] flex-col justify-between rounded-[18px] bg-[#EA580C] p-5 text-left text-white shadow-sm hover:bg-[#D24E0A] active:scale-[0.98]"
          >
            <span className="text-[19px] font-bold leading-tight">Me vete #{o.order_no}</span>
            <span className="text-[14px] font-medium text-white/85">
              <span className="block text-[17px] font-bold text-white tabular-nums">{formatEUR(o.total)}</span>
              {minutesSince(o.opened_at)}
              {o.ready > 0 && ` · ${o.ready} gati`}
            </span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => navigate('/tavolinat/merr')}
          className="flex min-h-[124px] flex-col justify-between rounded-[18px] bg-[#F97316] p-5 text-left text-white shadow-md shadow-orange-500/20 hover:bg-[#EA580C] active:scale-[0.98]"
        >
          <span className="flex items-center gap-2 text-[19px] font-bold leading-tight">
            <ShoppingBag className="h-5 w-5" /> Me vete
          </span>
          <span className="text-[14px] font-medium text-white/85">Porosi për të marrë</span>
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: 'red' | 'green' | 'blue' }) {
  return (
    <div
      className={cn(
        'min-w-[136px] rounded-card border px-5 py-3.5',
        tone === 'red' && 'border-[#FBCFCF] bg-[#FEF2F2] text-[#DC2626]',
        tone === 'green' && 'border-[#C9EBD9] bg-[#F0FAF4] text-brand-600',
        tone === 'blue' && 'border-[#CBD8F7] bg-[#EFF4FE] text-bt-600',
      )}
    >
      <div className="text-xs font-bold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-[28px] font-bold leading-none tabular-nums">{value}</div>
    </div>
  )
}

function minutesSince(iso: string) {
  const m = Math.max(0, Math.round((serverNow() - Date.parse(iso)) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} orë ${m % 60} min`
}
