import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  ChevronRight,
  Landmark,
  Package,
  Percent,
  Plus,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Wallet,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { Card } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay, monthName } from '@/features/accounting/api'
import { fetchDashboard, fetchDebts, fetchDocs, type Client, type Doc } from './api'

const SHORT = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj']
const addDays = (iso: string, d: number) => {
  const x = new Date(iso + 'T12:00:00')
  x.setDate(x.getDate() + d)
  return x.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86_400_000)

/** One company at a glance (Paneli): today's tasks, quick actions, the month, the year, money, latest documents. */
export function DashboardTab({ client, onGo }: { client: Client; onGo: (tab: string) => void }) {
  const today = kosovoDateISO()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [recentKind, setRecentKind] = useState<'sale' | 'purchase'>('sale')
  const dash = useQuery({ queryKey: ['client', client.id, 'dashboard', year], queryFn: () => fetchDashboard(client.id, year) })
  const payable = useQuery({ queryKey: ['client', client.id, 'debts', 'payable', today], queryFn: () => fetchDebts(client.id, 'payable', today) })
  const receivable = useQuery({ queryKey: ['client', client.id, 'debts', 'receivable', today], queryFn: () => fetchDebts(client.id, 'receivable', today) })
  const recent = useQuery({ queryKey: ['client', client.id, 'recent', recentKind], queryFn: () => fetchDocs(client.id, recentKind, addDays(today, -365), addDays(today, 31)) })
  const d = dash.data

  const tasks = useMemo(() => {
    const out: { tone: 'warn' | 'amber' | 'info'; icon: LucideIcon; title: string; sub: string; when: string; action: string; tab: string }[] = []
    const week = addDays(today, 7)
    const payDocs = (payable.data?.partners ?? []).flatMap((p) => p.docs.map((x) => ({ ...x, partner: p.name }))).filter((x) => x.open > 0 && x.due_date <= week)
    if (payDocs.length) {
      const late = payDocs.filter((x) => x.due_date < today)
      const first = [...payDocs].sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
      out.push({
        tone: late.length ? 'warn' : 'amber',
        icon: Wallet,
        title: `${payDocs.length} ${payDocs.length === 1 ? 'faturë e furnitorit' : 'fatura të furnitorëve'} për t'u paguar deri ${formatDay(week)}`,
        sub: `${formatEUR(payDocs.reduce((s, x) => s + x.open, 0))} · e para ka afat ${formatDay(first.due_date)}${late.length ? ` · ${late.length} tashmë të vonuara` : ''}`,
        when: late.length ? `${daysBetween(first.due_date, today)} ditë vonë` : `pas ${daysBetween(today, first.due_date)} ditësh`,
        action: 'Hap detyrimet',
        tab: 'borxhet',
      })
    }
    if (d) {
      if (d.vat_prev.status !== 'filed' && client.vat_registered) {
        const left = daysBetween(today, d.vat_prev.due)
        out.push({
          tone: left < 0 ? 'warn' : left <= 5 ? 'amber' : 'info',
          icon: Percent,
          title: `Deklarata e TVSH-së për ${monthName(d.vat_prev.month)}`,
          sub: `Për pagesë ${formatEUR(Math.max(0, d.vat_prev.out - d.vat_prev.in))}${d.vat_prev.out - d.vat_prev.in < 0 ? ` · për bartje ${formatEUR(d.vat_prev.in - d.vat_prev.out)}` : ''}`,
          when: `${formatDay(d.vat_prev.due)} · ${left < 0 ? `${-left} ditë vonë` : left === 0 ? 'sot' : `pas ${left} ditësh`}`,
          action: 'Hap formularin e TVSH-së',
          tab: 'tvsh',
        })
      }
      const toMatch = d.accounts.reduce((s, a) => s + a.to_match, 0)
      if (toMatch) out.push({ tone: 'info', icon: Wand2, title: `${toMatch} lëvizje bankare pa rakorduar`, sub: 'Lidhi me faturat ose regjistroji si lëvizje / shpenzim.', when: 'pa afat', action: 'Hap arkën dhe bankën', tab: 'banka' })
    }
    const overdueIn = receivable.data ? receivable.data.total - receivable.data.buckets.current : 0
    if (overdueIn > 0.005) {
      out.push({
        tone: 'amber',
        icon: AlertTriangle,
        title: `Klientët kanë ${formatEUR(overdueIn)} me vonesë`,
        sub: `${(receivable.data?.partners ?? []).filter((p) => p.overdue > 0).length} klientë · më e vjetra ${Math.max(0, ...(receivable.data?.partners ?? []).map((p) => p.max_days))} ditë`,
        when: 'kujto klientët',
        action: 'Hap borxhet',
        tab: 'borxhet',
      })
    }
    return out
  }, [payable.data, receivable.data, d, today, client.vat_registered])

  if (!d) return <p className={dash.error ? 'text-sm text-warn-700' : 'py-12 text-center text-muted'}>{dash.error ? (dash.error as Error).message : 'Duke ngarkuar…'}</p>

  // this month vs the month before (from the year's series)
  const mi = Number(today.slice(5, 7)) - 1
  const cur = year === Number(today.slice(0, 4)) ? d.months[mi] : d.months[11]
  const prev = year === Number(today.slice(0, 4)) ? d.months[mi - 1] : d.months[10]
  const vatNow = d.vat_prev.out - d.vat_prev.in
  const yearIn = d.months.reduce((s, m) => s + m.sales, 0)
  const yearOut = d.months.reduce((s, m) => s + m.purchases + m.expenses, 0)
  const max = Math.max(1, ...d.months.map((m) => Math.max(m.sales, m.purchases + m.expenses)))
  const money = d.accounts.reduce((s, a) => s + a.balance, 0)

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {/* today */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E3F1EA] text-brand-600">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Sot</h2>
            <p className="text-sm text-muted">Çka duhet bërë sot dhe këtë javë · {formatDay(today)}</p>
          </div>
        </div>
        {tasks.length === 0 ? (
          <p className="px-5 py-5 text-[15px] text-brand-600">Asgjë urgjente – të gjitha afatet janë në rregull.</p>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((t, i) => (
              <li key={i} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center">
                <span className={cn('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full md:mt-0', t.tone === 'warn' ? 'bg-[#DC2626]' : t.tone === 'amber' ? 'bg-[#F59E0B]' : 'bg-brand-600')} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.title}</div>
                  <div className="text-sm text-muted">{t.sub}</div>
                </div>
                <span className={cn('text-sm', t.tone === 'warn' ? 'font-semibold text-[#DC2626]' : 'text-muted')}>{t.when}</span>
                <button type="button" onClick={() => onGo(t.tab)} className="flex h-9 items-center gap-1 self-start rounded-lg border border-line px-3 text-sm font-semibold hover:bg-bg md:self-auto">
                  {t.action} <ChevronRight className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* quick actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted">Veprime të shpejta</span>
        {[
          { label: 'Shitje e re', icon: Receipt, tab: 'shitjet?new=1', tone: 'text-brand-600' },
          { label: 'Blerje e re', icon: ShoppingCart, tab: 'blerjet?new=1', tone: 'text-[#EA580C]' },
          { label: 'Transaksion bankar', icon: Landmark, tab: 'banka', tone: 'text-brand-600' },
          { label: 'Klient i ri', icon: UserPlus, tab: 'partneret?new=1', tone: 'text-[#7E22CE]' },
        ].map((a) => (
          <button key={a.label} type="button" onClick={() => onGo(a.tab)} className="flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold shadow-sm hover:bg-bg">
            <a.icon className={cn('h-4 w-4', a.tone)} /> {a.label}
          </button>
        ))}
      </div>

      {/* the month */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-4">
        <Kpi label="Të ardhurat" sub="Shitjet pa TVSH · ky muaj" value={cur?.sales ?? 0} prev={prev?.sales} icon={TrendingUp} tone="green" />
        <Kpi label="Blerjet e mallit" sub="Malli dhe mjetet · ky muaj" value={cur?.purchases ?? 0} prev={prev?.purchases} icon={Package} tone="amber" inverse />
        <Kpi label="Shpenzimet" sub="Shpenzimet operative · ky muaj" value={cur?.expenses ?? 0} prev={prev?.expenses} icon={Banknote} tone="red" inverse />
        <Kpi label="TVSH për pagesë" sub={`Muaji ${monthName(d.vat_prev.month).toLowerCase()}`} value={vatNow} icon={Percent} tone="blue" />
      </div>

      <div className="grid gap-4 md:gap-5 xl:grid-cols-[1fr_360px]">
        {/* the year */}
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 font-semibold">
                <TrendingUp className="h-4 w-4 text-muted" /> Të ardhura vs Kostot
              </h3>
              <p className="text-sm text-muted">Pa TVSH, sipas muajve të vitit</p>
            </div>
            <div className="flex items-center gap-1 rounded-ctl border border-line p-1">
              {[year - 1, year, year + 1].filter((y) => y <= Number(today.slice(0, 4))).map((y) => (
                <button key={y} type="button" onClick={() => setYear(y)} className={cn('h-8 rounded-lg px-3 text-sm font-semibold', y === year ? 'bg-bg text-ink' : 'text-muted')}>
                  {y}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Legend color="bg-brand-600" label="Të ardhurat" value={formatEUR(yearIn)} />
            <Legend color="bg-[#F59E0B]" label="Kostot" value={formatEUR(yearOut)} />
            <Legend label="Diferenca" value={formatEUR(yearIn - yearOut)} red={yearIn - yearOut < 0} />
          </div>
          <div className="mt-4 flex h-[220px] items-end gap-1.5 border-b border-line sm:gap-3">
            {d.months.map((m, i) => {
              const c = m.purchases + m.expenses
              return (
                <div key={m.month} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5" title={`${SHORT[i]}: të ardhurat ${formatEUR(m.sales)} · kostot ${formatEUR(c)}`}>
                  <div className="w-1/2 max-w-[16px] rounded-t bg-brand-600" style={{ height: `${(m.sales / max) * 100}%` }} />
                  <div className="w-1/2 max-w-[16px] rounded-t bg-[#F59E0B]" style={{ height: `${(c / max) * 100}%` }} />
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex gap-1.5 sm:gap-3">
            {d.months.map((m, i) => (
              <span key={m.month} className={cn('min-w-0 flex-1 text-center text-[11px] sm:text-[12px]', i === mi && year === Number(today.slice(0, 4)) ? 'font-semibold' : 'text-muted')}>
                {SHORT[i]}
              </span>
            ))}
          </div>
        </Card>

        {/* money and debts */}
        <Card className="flex flex-col p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-semibold">
                <Landmark className="h-4 w-4 text-muted" /> Arka dhe banka
              </h3>
              <p className="text-sm text-muted">Gjendja sot {formatEUR(money)}</p>
            </div>
            <button type="button" onClick={() => onGo('banka')} className="text-sm font-semibold text-brand-600 hover:underline">
              Shiko →
            </button>
          </div>
          {d.accounts.length === 0 ? (
            <button type="button" onClick={() => onGo('banka')} className="mt-3 flex items-center gap-2 rounded-ctl border border-dashed border-field px-3 py-3 text-sm text-muted hover:border-brand-600 hover:text-brand-600">
              <Plus className="h-4 w-4" /> Shto arkën dhe llogaritë bankare
            </button>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {d.accounts.map((a) => (
                <li key={a.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {a.kind === 'cash' ? <Banknote className="h-4 w-4 shrink-0 text-muted" /> : <Landmark className="h-4 w-4 shrink-0 text-muted" />}
                      <span className="truncate">{a.name}</span>
                    </span>
                    <span className={cn('font-semibold tabular-nums', a.balance < 0 && 'text-warn-700')}>{formatEUR(a.balance)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#E3ECE6]">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${money > 0 ? Math.max(2, (Math.max(0, a.balance) / money) * 100) : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-4 text-sm">
            <button type="button" onClick={() => onGo('borxhet')} className="rounded-ctl bg-[#EEF3EF] p-3 text-left hover:bg-[#E3ECE6]">
              <div className="text-muted">Na detyrohen</div>
              <div className="font-bold tabular-nums">{formatEUR(d.receivable)}</div>
              {d.overdue_receivable > 0 && <div className="text-xs text-[#DC2626]">vonë {formatEUR(d.overdue_receivable)}</div>}
            </button>
            <button type="button" onClick={() => onGo('borxhet')} className="rounded-ctl bg-[#EEF3EF] p-3 text-left hover:bg-[#E3ECE6]">
              <div className="text-muted">I detyrohemi</div>
              <div className="font-bold tabular-nums">{formatEUR(d.payable)}</div>
              {d.overdue_payable > 0 && <div className="text-xs text-[#DC2626]">vonë {formatEUR(d.overdue_payable)}</div>}
            </button>
          </div>
        </Card>
      </div>

      {/* latest documents */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h3 className="font-semibold">Transaksionet e fundit</h3>
          <div className="flex items-center gap-1 rounded-ctl border border-line p-1">
            {(['sale', 'purchase'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setRecentKind(k)} className={cn('h-8 rounded-lg px-3 text-sm font-semibold', recentKind === k ? 'bg-bg text-ink' : 'text-muted')}>
                {k === 'sale' ? 'Shitjet' : 'Blerjet'}
              </button>
            ))}
          </div>
        </div>
        {!recent.data ? (
          <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
        ) : recent.data.length === 0 ? (
          <p className="px-5 py-5 text-sm text-muted">Ende pa {recentKind === 'sale' ? 'shitje' : 'blerje'}.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.data.slice(0, 6).map((x: Doc) => (
              <li key={x.id}>
                <button type="button" onClick={() => onGo(recentKind === 'sale' ? 'shitjet' : 'blerjet')} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#F6F9F7]">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', recentKind === 'sale' ? 'bg-brand-100 text-brand-600' : 'bg-[#FFF1F2] text-[#E11D48]')}>
                    {recentKind === 'sale' ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{x.partner_name || '—'}</span>
                    <span className="block truncate text-sm text-muted">{[x.doc_no, x.description].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm text-muted">{formatDay(x.doc_date)}</span>
                    <span className={cn('block font-semibold tabular-nums', recentKind === 'purchase' && 'text-[#E11D48]')}>
                      {recentKind === 'purchase' ? '−' : ''}
                      {formatEUR(Math.abs(x.total))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

const TONES = {
  green: 'bg-brand-100 text-brand-600',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-[#FFF1F2] text-[#E11D48]',
  blue: 'bg-[#E3F1EA] text-brand-600',
}

function Kpi({ label, sub, value, prev, icon: Icon, tone, inverse }: { label: string; sub: string; value: number; prev?: number; icon: LucideIcon; tone: keyof typeof TONES; inverse?: boolean }) {
  const delta = prev ? ((value - prev) / Math.abs(prev)) * 100 : null
  const good = delta === null ? null : inverse ? delta <= 0 : delta >= 0
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{label}</div>
          <div className="truncate text-xs text-muted">{sub}</div>
        </div>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONES[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-[26px] font-bold leading-none tabular-nums">{formatEUR(value)}</div>
      <div className={cn('mt-2 text-sm', good === null ? 'text-muted' : good ? 'text-brand-600' : 'text-[#E11D48]')}>
        {delta === null ? '— nga muaji i kaluar' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% nga muaji i kaluar`}
      </div>
    </Card>
  )
}

function Legend({ color, label, value, red }: { color?: string; label: string; value: string; red?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-sm text-muted">
        {color && <span className={cn('h-2.5 w-2.5 rounded-full', color)} />}
        {label}
      </div>
      <div className={cn('text-[17px] font-bold tabular-nums', red && 'text-[#E11D48]')}>{value}</div>
    </div>
  )
}
