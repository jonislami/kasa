import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { cn } from '@/lib/cn'
import { kosovoDateISO, serverNow } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { AccountingNotMigrated, addMonths, formatDay, monthName, monthStart, vatDueDate } from '@/features/accounting/api'
import { fetchClients, type AccMe, type ClientRow } from './api'
import { ClientDialog, EMPTY_CLIENT } from './ClientDialog'
import { DataTable, Segments, type Column } from './DataTable'
import { Frame } from './Frame'
import { PasswordDialog } from './PasswordDialog'
import { fetchCalendar, FILING_LABELS } from './vat'
import { fetchRequests, fetchTasks } from './work'

export { PasswordDialog }

function ago(iso: string | null | undefined): string | null {
  if (!iso) return null
  const min = Math.max(0, Math.round((serverNow() - new Date(iso).getTime()) / 60_000))
  if (min < 60) return min < 1 ? 'tani' : `para ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `para ${h} orë`
  const d = Math.round(h / 24)
  if (d <= 60) return `para ${d} ditë`
  return formatDay(new Date(iso).toISOString().slice(0, 10))
}

const vatDue = (c: ClientRow) => c.vat_out - c.vat_in
const vatText = (c: ClientRow, ended: boolean) => (!c.active || c.vat_status === 'na' ? '' : c.vat_status === 'filed' ? 'TVSH e dorëzuar' : ended ? "TVSH për t'u bërë" : '')

function VatBadge({ c, late, ended }: { c: ClientRow; late: boolean; ended: boolean }) {
  if (!c.active || c.vat_status === 'na') return <span className="text-muted">—</span>
  if (c.vat_status === 'filed') return <Badge tone="success">E dorëzuar</Badge>
  if (!ended) return <span className="text-muted">muaji vazhdon</span>
  return <Badge tone={late ? 'warn' : 'amber'}>{late ? 'Me vonesë' : "Për t'u bërë"}</Badge>
}

type Filter = 'all' | 'todo' | 'kasa' | 'archived'

/**
 * "Kompanitë" – the office's start page. On top what needs doing (deadlines, tasks, documents asked from
 * clients – the whole team's for an admin, one's own otherwise), below every client company in one table.
 */
export function ClientsPage({ me }: { me: AccMe }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1)) // the month being closed
  const [filter, setFilter] = useState<Filter>('all')
  const [newOpen, setNewOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const admin = (me.accountant?.role ?? 'admin') === 'admin'

  const clients = useQuery({ queryKey: ['clients', month], queryFn: () => fetchClients(month), retry: (count, e) => !(e instanceof AccountingNotMigrated) && count < 1 })
  const all = clients.data ?? []
  const active = all.filter((c) => c.active)
  const ended = monthStart() > month
  const late = kosovoDateISO() > vatDueDate(month)
  const todo = (c: ClientRow) => c.active && c.vat_status === 'open' && ended

  const rows = useMemo(
    () => all.filter((c) => (filter === 'archived' ? !c.active : c.active)).filter((c) => (filter === 'todo' ? todo(c) : filter === 'kasa' ? c.link_status === 'approved' || c.link_status === 'pending' : true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients.data, filter, month],
  )

  const stats = {
    todo: active.filter(todo).length,
    vat: active.filter((c) => c.vat_status === 'open').reduce((s, c) => s + Math.max(0, vatDue(c)), 0),
  }

  const columns: Column<ClientRow>[] = [
    {
      id: 'name',
      label: 'Kompania',
      fixed: true,
      width: 280,
      text: (c) => `${c.name} ${c.activity ?? ''}`,
      sort: (c) => c.name.toLowerCase(),
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{c.name}</span>
          {c.link_status === 'approved' && <span className="shrink-0 text-[11px] font-semibold text-brand-600">KontoSef</span>}
          {c.link_status === 'pending' && <span className="shrink-0 text-[11px] text-amber-700">KontoSef në pritje</span>}
        </span>
      ),
    },
    { id: 'nui', label: 'NUI', width: 110, text: (c) => c.nui ?? '', render: (c) => <span className="tabular-nums">{c.nui || '—'}</span> },
    { id: 'city', label: 'Qyteti', width: 110, text: (c) => c.city ?? '', render: (c) => c.city || '—' },
    { id: 'activity', label: 'Aktiviteti', hidden: true, text: (c) => c.activity ?? '', render: (c) => c.activity || '—' },
    {
      id: 'vat',
      label: `TVSH ${monthName(month)}`,
      width: 150,
      text: (c) => vatText(c, ended),
      sort: (c) => (c.vat_status === 'open' ? 0 : c.vat_status === 'filed' ? 2 : 1),
      render: (c) => <VatBadge c={c} late={late} ended={ended} />,
    },
    { id: 'sales', label: 'Shitjet', width: 120, money: (c) => c.sales, render: (c) => formatEUR(c.sales) },
    { id: 'purchases', label: 'Blerjet', width: 120, money: (c) => c.purchases, render: (c) => formatEUR(c.purchases) },
    { id: 'vatdue', label: 'TVSH për pagesë', width: 130, money: (c) => (c.vat_status === 'na' ? 0 : vatDue(c)), render: (c) => (c.vat_status === 'na' ? '—' : formatEUR(vatDue(c))) },
    { id: 'docs', label: 'Dokumente', width: 90, align: 'right', hidden: true, sort: (c) => c.docs, text: (c) => String(c.docs), render: (c) => c.docs },
    { id: 'seen', label: 'Aktiviteti i fundit', width: 130, sort: (c) => c.last_activity ?? '', text: (c) => ago(c.last_activity) ?? '', render: (c) => <span className="text-muted">{ago(c.last_activity) ?? '—'}</span> },
  ]

  const toolbar = (
    <>
      <MonthStepper month={month} onChange={setMonth} max={monthStart()} />
      {me.accountant?.role !== 'assistant' && (
        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> Kompani e re
        </Button>
      )}
    </>
  )

  return (
    <TopShell me={me} onPassword={() => setPasswordOpen(true)} title="Kompanitë" toolbar={toolbar}>
      <div className="flex flex-col gap-3 md:gap-4">
        {clients.error instanceof AccountingNotMigrated ? (
          <Card>
            <EmptyState icon={<Building2 className="h-6 w-6" />} title="Programi nuk është aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0013_accountant_app.sql në Supabase." />
          </Card>
        ) : loadState(clients) === 'offline' ? (
          <OfflineEmpty />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 border border-line bg-white px-3 py-2 text-[13px]">
              <Fact label="Kompani aktive" value={String(active.length)} />
              <Fact label={`TVSH ${monthName(month)} për t'u bërë`} value={String(stats.todo)} tone={stats.todo && late ? 'warn' : undefined} sub={ended ? `afati ${formatDay(vatDueDate(month))}` : 'muaji vazhdon'} />
              <Fact label="TVSH për pagesë (të hapura)" value={formatEUR(stats.vat)} />
              <Fact label="Shitjet e klientëve" value={formatEUR(active.reduce((s, c) => s + c.sales, 0))} />
            </div>

            <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-3">
              <DeadlinesPanel onOpen={(clientId, tab) => navigate(`/klient/${clientId}/${tab}`)} />
              <TasksPanel admin={admin} onOpen={(clientId) => navigate(clientId ? `/klient/${clientId}/zyra` : '/puna')} />
              <RequestsPanel onOpen={(clientId) => navigate(`/klient/${clientId}/zyra`)} />
            </div>

            <DataTable
              id="office-clients"
              rows={rows}
              columns={columns}
              rowKey={(c) => c.id}
              onOpen={(c) => navigate(`/klient/${c.id}`)}
              loading={loadState(clients) === 'loading'}
              error={loadState(clients) === 'error' ? (clients.error as Error).message : null}
              exportName={`Kompanitë ${monthName(month)}`}
              title={`Kompanitë – ${monthName(month)}`}
              empty="Asnjë kompani. Shto të parën me “Kompani e re”."
              filters={
                <Segments
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'Aktive', count: active.length },
                    { value: 'todo', label: 'TVSH e hapur', count: stats.todo },
                    { value: 'kasa', label: 'KontoSef' },
                    ...(all.some((c) => !c.active) ? [{ value: 'archived' as const, label: 'Arkivuar', count: all.filter((c) => !c.active).length }] : []),
                  ]}
                />
              }
            />
          </>
        )}
      </div>

      <ClientDialog
        value={newOpen ? EMPTY_CLIENT : null}
        onClose={() => setNewOpen(false)}
        onSaved={(id) => {
          setNewOpen(false)
          void qc.invalidateQueries({ queryKey: ['clients'] })
          navigate(`/klient/${id}`)
        }}
      />
      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </TopShell>
  )
}

export function MonthStepper({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  return (
    <div className="flex h-[44px] items-center border border-field bg-white md:h-8">
      <button type="button" aria-label="Muaji i kaluar" className="flex h-full w-9 items-center justify-center hover:bg-bg md:w-8" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[118px] px-1 text-center text-[13px] font-semibold">{monthName(month)}</span>
      <button type="button" aria-label="Muaji tjetër" className="flex h-full w-9 items-center justify-center hover:bg-bg disabled:text-[#B5BCC7] md:w-8" disabled={Boolean(max) && month >= max!} onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <b className={cn('tabular-nums', tone === 'warn' ? 'text-warn-700' : 'text-ink')}>{value}</b>
      {sub && <span className="text-[12px] text-muted">({sub})</span>}
    </span>
  )
}

/** A compact list with a header: the work lists of the start page and of the company panel. */
export function Panel({ title, meta, more, children }: { title: string; meta?: ReactNode; more?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section className="flex min-h-[120px] flex-col border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex-1 text-[13px] font-semibold text-ink">{title}</h2>
        {meta && <span className="text-[12px] text-muted">{meta}</span>}
      </div>
      <div className="flex-1">{children}</div>
      {more && (
        <button type="button" onClick={more.onClick} className="border-t border-line px-3 py-1.5 text-left text-[12px] font-semibold text-brand-600 hover:bg-bg">
          {more.label}
        </button>
      )}
    </section>
  )
}

export const PanelRow = ({ onClick, children }: { onClick?: () => void; children: ReactNode }) => (
  <li>
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left text-[13px] hover:bg-[#F7F8FA]">
      {children}
    </button>
  </li>
)

const plusDays = (iso: string, n: number) => {
  const x = new Date(iso + 'T12:00:00')
  x.setDate(x.getDate() + n)
  return x.toISOString().slice(0, 10)
}

export function DueText({ today, due }: { today: string; due: string }) {
  const left = Math.round((Date.parse(due + 'T12:00:00') - Date.parse(today + 'T12:00:00')) / 86_400_000)
  return (
    <span className={cn('shrink-0 text-[12px] tabular-nums', left < 0 ? 'font-semibold text-warn-700' : left <= 3 ? 'text-amber-700' : 'text-muted')}>{left < 0 ? `${-left} ditë vonë` : left === 0 ? 'sot' : formatDay(due)}</span>
  )
}

const Muted = ({ children }: { children: ReactNode }) => <p className="px-3 py-3 text-[13px] text-muted">{children}</p>

/** Deadlines of all companies the user sees: late ones and the next 30 days that are not filed yet. */
function DeadlinesPanel({ onOpen }: { onOpen: (clientId: string, tab: string) => void }) {
  const today = kosovoDateISO()
  const cal = useQuery({ queryKey: ['calendar', 'all', today], queryFn: () => fetchCalendar(plusDays(today, -60), plusDays(today, 30)) })
  const open = (cal.data ?? []).filter((d) => d.status === 'open' || d.status === 'draft')
  const late = open.filter((d) => d.due < today).length
  const [all, setAll] = useState(false)
  return (
    <Panel title="Afatet tatimore" meta={cal.data ? `${open.length} të hapura${late ? ` · ${late} vonë` : ''}` : undefined} more={open.length > 7 ? { label: all ? 'Më pak' : `Të gjitha (${open.length})`, onClick: () => setAll(!all) } : undefined}>
      {!cal.data ? (
        <Muted>Duke ngarkuar…</Muted>
      ) : !open.length ? (
        <Muted>Asnjë afat i hapur në 30 ditët e ardhshme.</Muted>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto">
          {(all ? open : open.slice(0, 7)).map((d) => (
            <PanelRow key={d.client_id + d.kind + d.period} onClick={() => onOpen(d.client_id, d.kind === 'vat' ? 'tvsh' : d.kind === 'payroll' ? 'pagat' : 'tatimet')}>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{d.client}</span>{' '}
                <span className="text-muted">
                  · {FILING_LABELS[d.kind]} {d.kind === 'income_annual' ? d.period.slice(0, 4) : monthName(d.period)}
                </span>
              </span>
              <DueText today={today} due={d.due} />
            </PanelRow>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function TasksPanel({ admin, onOpen }: { admin: boolean; onOpen: (clientId: string | null) => void }) {
  const today = kosovoDateISO()
  const tasks = useQuery({ queryKey: ['acc-tasks', admin ? 'all' : 'mine', null, false], queryFn: () => fetchTasks(admin ? 'all' : 'mine'), retry: false })
  const list = [...(tasks.data ?? [])].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  return (
    <Panel title={admin ? 'Detyrat e ekipit' : 'Detyrat e mia'} meta={tasks.data ? `${list.length} të hapura` : undefined} more={{ label: 'Hap punën dhe detyrat', onClick: () => onOpen(null) }}>
      {tasks.isLoading ? (
        <Muted>Duke ngarkuar…</Muted>
      ) : tasks.error ? (
        <Muted>Detyrat nuk u ngarkuan.</Muted>
      ) : !list.length ? (
        <Muted>Asnjë detyrë e hapur.</Muted>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto">
          {list.slice(0, 7).map((t) => (
            <PanelRow key={t.id} onClick={() => onOpen(t.client_id)}>
              {t.priority === 'high' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn-700" title="Prioritet i lartë" />}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{t.title}</span>
                <span className="text-muted">
                  {[t.client_name, admin ? t.assigned_name : null]
                    .filter(Boolean)
                    .map((x) => ` · ${x}`)
                    .join('')}
                </span>
              </span>
              {t.due_date ? <DueText today={today} due={t.due_date} /> : <span className="text-[12px] text-muted">pa afat</span>}
            </PanelRow>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RequestsPanel({ onOpen }: { onOpen: (clientId: string) => void }) {
  const today = kosovoDateISO()
  const req = useQuery({ queryKey: ['acc-requests', 'requested', null], queryFn: () => fetchRequests('requested'), retry: false })
  const list = [...(req.data ?? [])].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  return (
    <Panel title="Dokumentet e kërkuara nga klientët" meta={req.data ? `${list.length} në pritje` : undefined}>
      {req.isLoading ? (
        <Muted>Duke ngarkuar…</Muted>
      ) : req.error ? (
        <Muted>Kërkesat nuk u ngarkuan.</Muted>
      ) : !list.length ? (
        <Muted>Asnjë dokument në pritje.</Muted>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto">
          {list.slice(0, 7).map((r) => (
            <PanelRow key={r.id} onClick={() => onOpen(r.client_id)}>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.client_name}</span> <span className="text-muted">· {r.title}</span>
              </span>
              {r.due_date ? <DueText today={today} due={r.due_date} /> : null}
            </PanelRow>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Office pages (Kompanitë, Puna, Arkiva, Zyra) in the common frame. */
export function TopShell({ me, onPassword, title, toolbar, children }: { me: AccMe; onPassword: () => void; title?: ReactNode; toolbar?: ReactNode; children: ReactNode }) {
  return (
    <Frame me={me} onPassword={onPassword} title={title} toolbar={toolbar}>
      {children}
    </Frame>
  )
}
