import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, formatDay, monthName, monthStart } from '@/features/accounting/api'
import { fetchDashboard, fetchDebts, fetchDocs, type Client } from './api'
import { checkBooks } from './atkBooks'
import { fetchBookDocs } from './atkBooksApi'
import { DueText, Panel, PanelRow } from './ClientsPage'
import { Segments, ToolButton } from './DataTable'
import { fetchCalendar, FILING_LABELS } from './vat'
import { fetchRequests, fetchTasks } from './work'

const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor']
const addDays = (iso: string, d: number) => {
  const x = new Date(iso + 'T12:00:00')
  x.setDate(x.getDate() + d)
  return x.toISOString().slice(0, 10)
}
const lastDay = (m: string) => addDays(addMonths(m, 1), -1)
const Muted = ({ children }: { children: React.ReactNode }) => <p className="px-3 py-3 text-[13px] text-muted">{children}</p>

interface Todo {
  tone: 'warn' | 'amber' | 'info'
  title: string
  sub: string
  due?: string
  tab: string
}

/**
 * Paneli of one company: what needs doing (ATK check of last month, VAT, bills, bank lines to match, overdue
 * customers), its deadlines, tasks and documents asked for, the financial position, the year by month and the
 * latest documents. Only real figures; nothing decorative.
 */
export function DashboardTab({ client, onGo }: { client: Client; onGo: (tab: string) => void }) {
  const today = kosovoDateISO()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [recentKind, setRecentKind] = useState<'sale' | 'purchase'>('sale')
  const last = addMonths(monthStart(), -1)
  const dash = useQuery({ queryKey: ['client', client.id, 'dashboard', year], queryFn: () => fetchDashboard(client.id, year) })
  const payable = useQuery({ queryKey: ['client', client.id, 'debts', 'payable', today], queryFn: () => fetchDebts(client.id, 'payable', today) })
  const receivable = useQuery({ queryKey: ['client', client.id, 'debts', 'receivable', today], queryFn: () => fetchDebts(client.id, 'receivable', today) })
  const recent = useQuery({ queryKey: ['client', client.id, 'recent', recentKind], queryFn: () => fetchDocs(client.id, recentKind, addDays(today, -365), addDays(today, 31)) })
  const books = useQuery({ queryKey: ['client', client.id, 'atk-books', last, lastDay(last)], queryFn: () => fetchBookDocs(client.id, last, lastDay(last)) })
  const cal = useQuery({ queryKey: ['calendar', 'client', client.id, today], queryFn: async () => (await fetchCalendar(addDays(today, -60), addDays(today, 45))).filter((d) => d.client_id === client.id) })
  const tasks = useQuery({ queryKey: ['acc-tasks', 'all', client.id, false], queryFn: () => fetchTasks('all', client.id), retry: false })
  const requests = useQuery({ queryKey: ['acc-requests', 'requested', client.id], queryFn: () => fetchRequests('requested', client.id), retry: false })
  const d = dash.data

  const todo = useMemo(() => {
    const out: Todo[] = []
    if (books.data) {
      const issues = checkBooks(books.data, client.vat_registered, last, lastDay(last))
      const errors = issues.filter((i) => i.level === 'error').length
      if (errors) out.push({ tone: 'warn', title: `Kontrolli ATK për ${monthName(last)}: ${errors} gabime në dokumente`, sub: `${issues.length - errors} paralajmërime · librat nuk janë gati për EDI`, tab: 'kontrolli' })
    }
    if (d && client.vat_registered && d.vat_prev.status !== 'filed') {
      const net = d.vat_prev.out - d.vat_prev.in
      out.push({
        tone: d.vat_prev.due < today ? 'warn' : 'amber',
        title: `Deklarata e TVSH-së për ${monthName(d.vat_prev.month)}`,
        sub: net >= 0 ? `Për pagesë ${formatEUR(net)}` : `Për bartje ${formatEUR(-net)}`,
        due: d.vat_prev.due,
        tab: 'tvsh',
      })
    }
    const week = addDays(today, 7)
    const bills = (payable.data?.partners ?? []).flatMap((p) => p.docs).filter((x) => x.open > 0 && x.due_date <= week)
    if (bills.length) {
      const first = [...bills].sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
      out.push({ tone: first.due_date < today ? 'warn' : 'amber', title: `${bills.length} fatura furnitorësh për pagesë deri ${formatDay(week)}`, sub: formatEUR(bills.reduce((s, x) => s + x.open, 0)), due: first.due_date, tab: 'borxhet' })
    }
    const toMatch = d?.accounts.reduce((s, a) => s + a.to_match, 0) ?? 0
    if (toMatch) out.push({ tone: 'info', title: `${toMatch} lëvizje bankare pa rakorduar`, sub: 'Lidhi me faturat ose regjistroji', tab: 'banka' })
    const late = receivable.data ? receivable.data.total - receivable.data.buckets.current : 0
    if (late > 0.005) {
      const ps = (receivable.data?.partners ?? []).filter((p) => p.overdue > 0)
      out.push({ tone: 'amber', title: `Klientët kanë ${formatEUR(late)} me vonesë`, sub: `${ps.length} klientë · më e vjetra ${Math.max(0, ...ps.map((p) => p.max_days))} ditë`, tab: 'borxhet' })
    }
    return out
  }, [books.data, d, payable.data, receivable.data, client.vat_registered, last, today])

  const deadlines = (cal.data ?? []).filter((x) => x.status === 'open' || x.status === 'draft')
  const money = d?.accounts.reduce((s, a) => s + a.balance, 0) ?? 0
  const year0 = Number(today.slice(0, 4))
  const months = d?.months ?? []
  const tot = months.reduce((t, m) => ({ s: t.s + m.sales, p: t.p + m.purchases, e: t.e + m.expenses }), { s: 0, p: 0, e: 0 })

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolButton onClick={() => onGo('shitjet?new=1')}>
          <Plus className="h-3.5 w-3.5" /> Faturë shitjeje
        </ToolButton>
        <ToolButton onClick={() => onGo('blerjet?new=1')}>
          <Plus className="h-3.5 w-3.5" /> Blerje / shpenzim
        </ToolButton>
        <ToolButton onClick={() => onGo('banka')}>
          <Plus className="h-3.5 w-3.5" /> Lëvizje bankare
        </ToolButton>
        <ToolButton onClick={() => onGo('partneret?new=1')}>
          <Plus className="h-3.5 w-3.5" /> Partner
        </ToolButton>
        <ToolButton onClick={() => onGo('skanimi')}>Skano fatura</ToolButton>
      </div>

      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-3">
        <Panel title="Për t'u bërë" meta={dash.isLoading ? undefined : todo.length ? `${todo.length}` : undefined}>
          {dash.isLoading ? (
            <Muted>Duke ngarkuar…</Muted>
          ) : !todo.length ? (
            <Muted>Asgjë urgjente.</Muted>
          ) : (
            <ul>
              {todo.map((t) => (
                <PanelRow key={t.title} onClick={() => onGo(t.tab)}>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', t.tone === 'warn' ? 'bg-warn-700' : t.tone === 'amber' ? 'bg-[#D97706]' : 'bg-brand-600')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-[12px] text-muted">{t.sub}</span>
                  </span>
                  {t.due && <DueText today={today} due={t.due} />}
                </PanelRow>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Afatet tatimore" meta={cal.data ? `${deadlines.length} të hapura` : undefined} more={{ label: 'Të gjitha tatimet dhe afatet', onClick: () => onGo('tatimet') }}>
          {!cal.data ? (
            <Muted>Duke ngarkuar…</Muted>
          ) : !deadlines.length ? (
            <Muted>Asnjë afat i hapur në 45 ditët e ardhshme.</Muted>
          ) : (
            <ul>
              {deadlines.slice(0, 6).map((x) => (
                <PanelRow key={x.kind + x.period} onClick={() => onGo(x.kind === 'vat' ? 'tvsh' : x.kind === 'payroll' ? 'pagat' : 'tatimet')}>
                  <span className="min-w-0 flex-1 truncate">
                    {FILING_LABELS[x.kind]} <span className="text-muted">· {x.kind === 'income_annual' ? x.period.slice(0, 4) : monthName(x.period)}</span>
                  </span>
                  {x.amount != null && <span className="text-[12px] tabular-nums text-muted">{formatEUR(x.amount)}</span>}
                  <DueText today={today} due={x.due} />
                </PanelRow>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Detyrat dhe dokumentet në pritje" meta={tasks.data && requests.data ? `${tasks.data.length + requests.data.length}` : undefined} more={{ label: 'Hap detyrat dhe kërkesat', onClick: () => onGo('zyra') }}>
          {tasks.isLoading || requests.isLoading ? (
            <Muted>Duke ngarkuar…</Muted>
          ) : !(tasks.data?.length || requests.data?.length) ? (
            <Muted>Asnjë detyrë apo dokument në pritje.</Muted>
          ) : (
            <ul>
              {(tasks.data ?? []).slice(0, 4).map((t) => (
                <PanelRow key={t.id} onClick={() => onGo('zyra')}>
                  <span className="min-w-0 flex-1 truncate">
                    {t.title}
                    {t.assigned_name && <span className="text-muted"> · {t.assigned_name}</span>}
                  </span>
                  {t.due_date && <DueText today={today} due={t.due_date} />}
                </PanelRow>
              ))}
              {(requests.data ?? []).slice(0, 3).map((r) => (
                <PanelRow key={r.id} onClick={() => onGo('zyra')}>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted">Kërkuar: </span>
                    {r.title}
                  </span>
                  {r.due_date && <DueText today={today} due={r.due_date} />}
                </PanelRow>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* the year by month */}
        <section className="border border-line bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <h2 className="flex-1 text-[13px] font-semibold">Rezultati sipas muajve (pa TVSH)</h2>
            <Segments
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={[year0 - 2, year0 - 1, year0].map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>
          {dash.error ? (
            <p className="px-3 py-3 text-[13px] text-warn-700">{(dash.error as Error).message}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.04em] text-muted">
                    <th className="border-b border-line bg-[#F5F6F8] px-3 py-1.5 text-left font-semibold">Muaji</th>
                    <th className="border-b border-line bg-[#F5F6F8] px-3 py-1.5 text-right font-semibold">Shitjet</th>
                    <th className="border-b border-line bg-[#F5F6F8] px-3 py-1.5 text-right font-semibold">Blerjet</th>
                    <th className="border-b border-line bg-[#F5F6F8] px-3 py-1.5 text-right font-semibold">Shpenzimet</th>
                    <th className="border-b border-line bg-[#F5F6F8] px-3 py-1.5 text-right font-semibold">Rezultati</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m, i) => {
                    const res = m.sales - m.purchases - m.expenses
                    const future = m.month > today
                    return (
                      <tr key={m.month} className={cn(future && 'text-muted', m.month.slice(0, 7) === today.slice(0, 7) && 'bg-brand-50')}>
                        <td className="border-b border-line px-3 py-1">{MONTHS[i]}</td>
                        <td className="border-b border-line px-3 py-1 text-right tabular-nums">{m.sales ? formatEUR(m.sales) : '—'}</td>
                        <td className="border-b border-line px-3 py-1 text-right tabular-nums">{m.purchases ? formatEUR(m.purchases) : '—'}</td>
                        <td className="border-b border-line px-3 py-1 text-right tabular-nums">{m.expenses ? formatEUR(m.expenses) : '—'}</td>
                        <td className={cn('border-b border-line px-3 py-1 text-right tabular-nums', res < 0 && 'text-warn-700')}>{m.sales || m.purchases || m.expenses ? formatEUR(res) : '—'}</td>
                      </tr>
                    )
                  })}
                  {months.length > 0 && (
                    <tr className="bg-[#F5F6F8] font-semibold">
                      <td className="px-3 py-1.5">Viti {year}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatEUR(tot.s)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatEUR(tot.p)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatEUR(tot.e)}</td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums', tot.s - tot.p - tot.e < 0 && 'text-warn-700')}>{formatEUR(tot.s - tot.p - tot.e)}</td>
                    </tr>
                  )}
                  {dash.isLoading && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted">
                        Duke ngarkuar…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* financial position */}
        <section className="flex flex-col border border-line bg-white">
          <div className="flex items-center border-b border-line px-3 py-2">
            <h2 className="flex-1 text-[13px] font-semibold">Pozicioni financiar sot</h2>
          </div>
          <table className="w-full text-[13px]">
            <tbody>
              {(d?.accounts ?? []).map((a) => (
                <Line key={a.id} label={a.name} value={a.balance} onClick={() => onGo('banka')} sub={a.to_match ? `${a.to_match} pa rakorduar` : undefined} />
              ))}
              {d && d.accounts.length === 0 && (
                <tr>
                  <td colSpan={2} className="border-b border-line px-3 py-2">
                    <button type="button" className="text-brand-600 hover:underline" onClick={() => onGo('banka')}>
                      Shto arkën dhe llogaritë bankare
                    </button>
                  </td>
                </tr>
              )}
              {d && d.accounts.length > 1 && <Line label="Gjithsej arka dhe banka" value={money} bold />}
              {d && (
                <>
                  <Line label="Na detyrohen (klientët)" value={d.receivable} sub={d.overdue_receivable > 0 ? `me vonesë ${formatEUR(d.overdue_receivable)}` : undefined} onClick={() => onGo('borxhet')} />
                  <Line label="I detyrohemi (furnitorët)" value={-d.payable} sub={d.overdue_payable > 0 ? `me vonesë ${formatEUR(d.overdue_payable)}` : undefined} onClick={() => onGo('borxhet')} />
                  {client.vat_registered && (
                    <Line
                      label={`TVSH ${monthName(d.vat_prev.month)} ${d.vat_prev.out - d.vat_prev.in >= 0 ? 'për pagesë' : 'për bartje'}`}
                      value={-(d.vat_prev.out - d.vat_prev.in)}
                      sub={d.vat_prev.status === 'filed' ? 'e deklaruar' : `afati ${formatDay(d.vat_prev.due)}`}
                      onClick={() => onGo('tvsh')}
                    />
                  )}
                  <Line label="Neto (para + të arkëtueshme − detyrimet)" value={money + d.receivable - d.payable - (client.vat_registered ? Math.max(0, d.vat_prev.out - d.vat_prev.in) : 0)} bold />
                </>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {/* latest documents */}
      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="flex-1 text-[13px] font-semibold">Dokumentet e fundit</h2>
          <Segments
            value={recentKind}
            onChange={setRecentKind}
            options={[
              { value: 'sale', label: 'Shitjet' },
              { value: 'purchase', label: 'Blerjet' },
            ]}
          />
        </div>
        {!recent.data ? (
          <Muted>Duke ngarkuar…</Muted>
        ) : recent.data.length === 0 ? (
          <Muted>Ende pa {recentKind === 'sale' ? 'shitje' : 'blerje'}.</Muted>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {[...recent.data]
                .sort((a, b) => b.doc_date.localeCompare(a.doc_date))
                .slice(0, 8)
                .map((x) => (
                  <tr key={x.id} className="cursor-pointer hover:bg-[#F7F8FA]" onClick={() => onGo(`${recentKind === 'sale' ? 'shitjet' : 'blerjet'}?doc=${x.id}`)}>
                    <td className="w-[96px] border-b border-line px-3 py-1.5 tabular-nums text-muted">{formatDay(x.doc_date)}</td>
                    <td className="w-[110px] border-b border-line px-3 py-1.5 tabular-nums">{x.doc_no || '—'}</td>
                    <td className="max-w-0 truncate border-b border-line px-3 py-1.5">
                      <span className="font-medium">{x.partner_name || '—'}</span>
                      {x.description && <span className="text-muted"> · {x.description}</span>}
                    </td>
                    <td className="w-[120px] border-b border-line px-3 py-1.5 text-right font-semibold tabular-nums">{formatEUR(x.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Line({ label, value, sub, onClick, bold }: { label: string; value: number; sub?: string; onClick?: () => void; bold?: boolean }) {
  return (
    <tr className={cn(onClick && 'cursor-pointer hover:bg-[#F7F8FA]', bold && 'bg-[#F5F6F8] font-semibold')} onClick={onClick}>
      <td className="border-b border-line px-3 py-1.5">
        {label}
        {sub && <span className="block text-[12px] font-normal text-muted">{sub}</span>}
      </td>
      <td className={cn('border-b border-line px-3 py-1.5 text-right tabular-nums', value < 0 && 'text-warn-700')}>{formatEUR(value)}</td>
    </tr>
  )
}
