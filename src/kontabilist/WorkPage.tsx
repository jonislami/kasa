import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDot, FileSpreadsheet, FileText, Mail, MessageCircle, Plus, Printer, Receipt, Repeat, Trash2 } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, formatDay, monthName, monthStart } from '@/features/accounting/api'
import { addDays } from '@/features/reports/api'
import { fetchClients, type AccMe } from './api'
import { PasswordDialog, TopShell } from './ClientsPage'
import { fetchOffice } from './office'
import {
  addOfficePayment,
  billMonth,
  bulkRequests,
  cancelOfficeInvoice,
  deleteOfficePayment,
  deleteRequest,
  deleteTask,
  fetchOfficeInvoices,
  fetchOfficeProfile,
  fetchRequests,
  fetchTasks,
  fetchWorkSummary,
  mailtoLink,
  PRIORITY,
  reminderText,
  REQUEST_STATUS,
  REQUEST_TEMPLATES,
  saveOfficeInvoice,
  saveRequest,
  saveTask,
  setRequestStatus,
  setTaskStatus,
  TASK_STATUS,
  whatsappLink,
  type DocRequest,
  type OfficeInvoice,
  type OfficeProfile,
  type Priority,
  type RequestStatus,
  type Task,
  type TaskStatus,
} from './work'
import { ContractsPanel } from './ContractsPanel'
import { downloadSheets } from './xls'
import { fetchInbox } from './portal/api'

type Tab = 'detyrat' | 'kerkesat' | 'faturimi' | 'kontratat'

/** Puna e zyrës: tasks, document requests, contracts and the office's invoices to its clients. */
export function WorkPage({ me }: { me: AccMe }) {
  const navigate = useNavigate()
  const admin = (me.accountant?.role ?? 'admin') === 'admin'
  const [tab, setTab] = useState<Tab>('detyrat')
  const [pw, setPw] = useState(false)
  const summary = useQuery({ queryKey: ['acc-work-summary'], queryFn: fetchWorkSummary })
  const s = summary.data
  const inbox = useQuery({ queryKey: ['acc-portal-inbox'], queryFn: fetchInbox, refetchInterval: 60_000 })
  const tabs: [Tab, string, number | null][] = [
    ['detyrat', 'Detyrat', s?.my_tasks ?? null],
    ['kerkesat', 'Kërkesat për dokumente', s?.open_requests ?? null],
    ...(admin ? ([['kontratat', 'Kontratat dhe tarifat', null], ['faturimi', 'Faturimi i klientëve', null]] as [Tab, string, null][]) : []),
  ]
  return (
    <TopShell me={me} onPassword={() => setPw(true)}>
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-12 pt-6 md:px-8 md:pt-10">
        <button type="button" onClick={() => navigate('/')} className="mb-3 flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> Kompanitë
        </button>
        <h1 className="text-[30px] font-bold leading-tight md:text-[34px]">Puna e zyrës</h1>
        {s && (
          <p className="mt-1 text-muted">
            {s.my_tasks} detyra të mia · {s.overdue_tasks > 0 && <span className="font-semibold text-warn-700">{s.overdue_tasks} me afat të kaluar · </span>}
            {s.open_requests} dokumente në pritje{s.unpaid != null && ` · klientët i detyrohen zyrës ${formatEUR(s.unpaid)}`}
          </p>
        )}
        {(inbox.data?.length ?? 0) > 0 && (
          <Card className="mt-4 overflow-hidden">
            <h2 className="px-5 pt-4 text-[15px] font-semibold">Nga portali i klientëve</h2>
            <ul className="mt-2 divide-y divide-line">
              {inbox.data!.map((r) => (
                <li key={r.client_id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.client_name}</span>
                  {r.unread > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/klient/${r.client_id}/zyra`)}>
                      {r.unread} mesazh{r.unread > 1 ? 'e' : ''}
                    </Button>
                  )}
                  {r.uploads > 0 && (
                    <Button size="sm" onClick={() => navigate(`/klient/${r.client_id}/skanimi`)}>
                      {r.uploads} dokument{r.uploads > 1 ? 'e' : ''} për regjistrim
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {tabs.map(([k, l, c]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn('flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold', tab === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
              {l}
              {c != null && c > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{c}</span>}
            </button>
          ))}
        </div>
        <div className="mt-5">
          {tab === 'detyrat' && <TasksPanel />}
          {tab === 'kerkesat' && <RequestsPanel />}
          {tab === 'kontratat' && admin && <ContractsPanel />}
          {tab === 'faturimi' && admin && <BillingPanel />}
        </div>
      </div>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </TopShell>
  )
}

const useClientOptions = (enabled = true) =>
  useQuery({ queryKey: ['acc-clients-min'], queryFn: () => fetchClients(monthStart()), enabled, staleTime: 60_000 })

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
const STATUS_ICON: Record<TaskStatus, typeof Circle> = { todo: Circle, doing: CircleDot, done: CheckCircle2 }
const NEXT: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo' }

export function TasksPanel({ clientId }: { clientId?: string }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<'mine' | 'all'>(clientId ? 'all' : 'mine')
  const [edit, setEdit] = useState<Partial<Task> | null>(null)
  const today = kosovoDateISO()
  const tasks = useQuery({ queryKey: ['acc-tasks', scope, clientId ?? null], queryFn: () => fetchTasks(scope, clientId) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['acc-tasks'] })
    void qc.invalidateQueries({ queryKey: ['acc-work-summary'] })
  }
  const status = useMutation({ mutationFn: ({ id, s }: { id: string; s: TaskStatus }) => setTaskStatus(id, s), onSuccess: refresh })
  const del = useMutation({ mutationFn: deleteTask, onSuccess: refresh })
  const list = tasks.data ?? []
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex gap-2">
          {!clientId &&
            (
              [
                ['mine', 'Të miat'],
                ['all', 'Të gjitha'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setScope(k)} className={cn('h-9 rounded-full border px-3 text-sm font-semibold', scope === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
                {l}
              </button>
            ))}
          {clientId && <h2 className="text-[17px] font-semibold">Detyrat</h2>}
        </div>
        <Button size="sm" onClick={() => setEdit({ client_id: clientId ?? null, priority: 'normal', repeat: 'none', due_date: addDays(today, 7) })}>
          <Plus className="h-4 w-4" /> Detyrë e re
        </Button>
      </div>
      {tasks.isLoading ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : tasks.error ? (
        <p className="px-5 pb-5 text-sm text-warn-700">{(tasks.error as Error).message}</p>
      ) : list.length === 0 ? (
        <EmptyState title="Asnjë detyrë e hapur" text="Detyrat e kryera zhduken pas 14 ditësh." />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((t) => {
            const Icon = STATUS_ICON[t.status]
            const late = t.status !== 'done' && t.due_date && t.due_date < today
            return (
              <li key={t.id} className={cn('flex items-start gap-3 px-5 py-3', t.status === 'done' && 'opacity-60')}>
                <button type="button" aria-label={TASK_STATUS[NEXT[t.status]]} title={`Kalo te: ${TASK_STATUS[NEXT[t.status]]}`} onClick={() => status.mutate({ id: t.id, s: NEXT[t.status] })} className="mt-0.5 text-brand-600">
                  <Icon className="h-6 w-6" />
                </button>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(t)}>
                  <div className={cn('font-semibold', t.status === 'done' && 'line-through')}>
                    {t.title} {t.priority === 'high' && <Badge tone="warn">E lartë</Badge>} {t.repeat === 'monthly' && <Repeat className="inline h-3.5 w-3.5 text-muted" />}
                  </div>
                  <div className="text-xs text-muted">
                    {[!clientId && (t.client_name ?? 'Zyra'), t.assigned_name && `te ${t.assigned_name}`, t.status === 'doing' && 'në punë'].filter(Boolean).join(' · ')}
                    {t.due_date && <span className={cn(late && 'font-semibold text-warn-700')}> · afati {formatDay(t.due_date)}</span>}
                  </div>
                </button>
                <button type="button" aria-label="Fshi" onClick={() => confirm('Ta fshij detyrën?') && del.mutate(t.id)} className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <TaskDialog value={edit} fixedClient={clientId} onClose={() => setEdit(null)} onSaved={refresh} />
    </Card>
  )
}

function TaskDialog({ value, fixedClient, onClose, onSaved }: { value: Partial<Task> | null; fixedClient?: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Task>>({})
  useEffect(() => {
    if (value) setF(value)
  }, [value])
  const clients = useClientOptions(Boolean(value) && !fixedClient)
  const office = useQuery({ queryKey: ['acc-office'], queryFn: fetchOffice, enabled: Boolean(value) })
  const save = useMutation({
    mutationFn: () => saveTask({ id: f.id, client_id: f.client_id || null, title: f.title, description: f.description, due_date: f.due_date || null, assigned_to: f.assigned_to || null, priority: f.priority, repeat: f.repeat }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={f.id ? 'Detyra' : 'Detyrë e re'}
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input label="Detyra" value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="p.sh. Deklaro TVSH-në e tetorit" />
        </div>
        {!fixedClient && (
          <div className="sm:col-span-2">
            <Select
              label="Klienti"
              value={f.client_id ?? ''}
              onChange={(e) => setF({ ...f, client_id: e.target.value || null })}
              options={[{ value: '', label: '— punë e zyrës —' }, ...(clients.data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>
        )}
        <Input label="Afati" type="date" value={f.due_date ?? ''} onChange={(e) => setF({ ...f, due_date: e.target.value || null })} />
        <Select
          label="Kush e bën"
          value={f.assigned_to ?? ''}
          onChange={(e) => setF({ ...f, assigned_to: e.target.value || null })}
          options={[{ value: '', label: '— pa caktuar —' }, ...(office.data?.members ?? []).filter((m) => m.active).map((m) => ({ value: m.user_id, label: m.full_name }))]}
        />
        <Select label="Prioriteti" value={f.priority ?? 'normal'} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })} options={(Object.keys(PRIORITY) as Priority[]).map((p) => ({ value: p, label: PRIORITY[p] }))} />
        <Select
          label="Përsëritet"
          value={f.repeat ?? 'none'}
          onChange={(e) => setF({ ...f, repeat: e.target.value as Task['repeat'] })}
          options={[
            { value: 'none', label: 'Jo' },
            { value: 'monthly', label: 'Çdo muaj (pas kryerjes krijohet e radhës)' },
          ]}
        />
        <div className="sm:col-span-2">
          <Input label="Shënim" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Document requests
// ---------------------------------------------------------------------------
export function RequestsPanel({ clientId, clientEmail, clientPhone }: { clientId?: string; clientEmail?: string | null; clientPhone?: string | null }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<RequestStatus>('requested')
  const [add, setAdd] = useState(false)
  const today = kosovoDateISO()
  const reqs = useQuery({ queryKey: ['acc-requests', status, clientId ?? null], queryFn: () => fetchRequests(status, clientId) })
  const profile = useQuery({ queryKey: ['acc-office-profile'], queryFn: fetchOfficeProfile, staleTime: 5 * 60_000 })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['acc-requests'] })
    void qc.invalidateQueries({ queryKey: ['acc-work-summary'] })
  }
  const set = useMutation({ mutationFn: ({ id, s }: { id: string; s: RequestStatus | 'reminded' }) => setRequestStatus(id, s), onSuccess: refresh })
  const del = useMutation({ mutationFn: deleteRequest, onSuccess: refresh })
  const list = reqs.data ?? []

  const text = (r: DocRequest) => reminderText(r, profile.data?.office_name ?? null, r.period ? monthName(r.period) : undefined, r.due_date ? formatDay(r.due_date) : undefined)
  const remind = (r: DocRequest, how: 'email' | 'wa') => {
    const email = clientEmail ?? r.client_email
    const phone = clientPhone ?? r.client_phone
    const link = how === 'email' ? (email ? mailtoLink(email, `Kërkesë për dokumente: ${r.title}`, text(r)) : null) : phone ? whatsappLink(phone, text(r)) : null
    if (!link) return alert(how === 'email' ? 'Klienti nuk ka email te të dhënat e kompanisë.' : 'Klienti nuk ka numër telefoni te të dhënat e kompanisë.')
    window.open(link, '_blank', 'noopener')
    set.mutate({ id: r.id, s: 'reminded' })
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {clientId && <h2 className="mr-2 text-[17px] font-semibold">Kërkesat për dokumente</h2>}
          {(Object.keys(REQUEST_STATUS) as RequestStatus[]).map((k) => (
            <button key={k} type="button" onClick={() => setStatus(k)} className={cn('h-9 rounded-full border px-3 text-sm font-semibold', status === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
              {REQUEST_STATUS[k]}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setAdd(true)}>
          <Plus className="h-4 w-4" /> {clientId ? 'Kërko dokument' : 'Kërko nga klientët'}
        </Button>
      </div>
      {reqs.isLoading ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : reqs.error ? (
        <p className="px-5 pb-5 text-sm text-warn-700">{(reqs.error as Error).message}</p>
      ) : list.length === 0 ? (
        <EmptyState title={status === 'requested' ? 'Asnjë dokument në pritje' : 'Asnjë kërkesë'} />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((r) => {
            const late = r.status === 'requested' && r.due_date && r.due_date < today
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <FileText className="h-5 w-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {r.title}
                    {r.period && <span className="font-normal text-muted"> · {monthName(r.period)}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {[!clientId && r.client_name, r.requested_by_name && `kërkuar nga ${r.requested_by_name}`, r.reminders > 0 && `${r.reminders} kujtesa`, r.received_at && `pranuar ${formatDay(r.received_at.slice(0, 10))}`]
                      .filter(Boolean)
                      .join(' · ')}
                    {r.due_date && r.status === 'requested' && <span className={cn(late && 'font-semibold text-warn-700')}> · afati {formatDay(r.due_date)}</span>}
                  </div>
                </div>
                {r.status === 'requested' && (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="secondary" title="Kujtesë me email" onClick={() => remind(r, 'email')}>
                      <Mail className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="secondary" title="Kujtesë me WhatsApp" onClick={() => remind(r, 'wa')}>
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                    <Button size="sm" onClick={() => set.mutate({ id: r.id, s: 'received' })}>
                      <CheckCircle2 className="h-4 w-4" /> U pranua
                    </Button>
                  </div>
                )}
                {r.status !== 'requested' && (
                  <Button size="sm" variant="secondary" onClick={() => set.mutate({ id: r.id, s: 'requested' })}>
                    Rihape
                  </Button>
                )}
                <button type="button" aria-label="Fshi" onClick={() => confirm('Ta fshij kërkesën?') && del.mutate(r.id)} className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {!clientId && status === 'requested' && list.length > 0 && (
        <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted">
          <Bell className="h-4 w-4" /> Kujtesa hap email-in ose WhatsApp-in tënd me mesazhin gati; numërohet te kërkesa.
        </p>
      )}
      <RequestDialog open={add} clientId={clientId} onClose={() => setAdd(false)} onSaved={refresh} />
    </Card>
  )
}

function RequestDialog({ open, clientId, onClose, onSaved }: { open: boolean; clientId?: string; onClose: () => void; onSaved: () => void }) {
  const prev = addMonths(monthStart(), -1)
  const [f, setF] = useState({ title: REQUEST_TEMPLATES[0], period: prev, due_date: addDays(kosovoDateISO(), 7), note: '', all: true, clients: [] as string[] })
  const [done, setDone] = useState<number | null>(null)
  const clients = useClientOptions(open && !clientId)
  useEffect(() => {
    if (open) {
      setF({ title: REQUEST_TEMPLATES[0], period: prev, due_date: addDays(kosovoDateISO(), 7), note: '', all: true, clients: [] })
      setDone(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      const p = { title: f.title, period: f.period || null, due_date: f.due_date || null, note: f.note || null }
      if (clientId) {
        await saveRequest({ ...p, client_id: clientId })
        return 1
      }
      return bulkRequests({ ...p, client_ids: f.all ? [] : f.clients })
    },
    onSuccess: (n) => {
      onSaved()
      if (clientId) onClose()
      else setDone(n)
    },
  })
  const months = [0, -1, -2, -3].map((i) => addMonths(monthStart(), i))
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={clientId ? 'Kërko dokument' : 'Kërko dokumente nga klientët'}
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {done != null ? 'Mbyll' : 'Anulo'}
          </Button>
          {done == null && (
            <Button loading={save.isPending} onClick={() => save.mutate()} disabled={!f.title.trim() || (!clientId && !f.all && !f.clients.length)}>
              Kërko
            </Button>
          )}
        </div>
      }
    >
      {done != null ? (
        <p className="text-[15px]">
          U krijuan <b>{done}</b> kërkesa{done === 0 && ' (klientët e zgjedhur e kishin tashmë këtë kërkesë të hapur)'}. Dërgoju kujtesë me email ose WhatsApp nga lista.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Çka kërkohet" list="req-templates" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <datalist id="req-templates">
              {REQUEST_TEMPLATES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <Select label="Për muajin" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} options={[{ value: '', label: '—' }, ...months.map((m) => ({ value: m, label: monthName(m) }))]} />
          <Input label="Afati" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          <div className="sm:col-span-2">
            <Input label="Shënim" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </div>
          {!clientId && (
            <div className="sm:col-span-2">
              <div className="flex gap-2">
                {[
                  [true, 'Të gjithë klientët aktivë'],
                  [false, 'Klientët e zgjedhur'],
                ].map(([v, l]) => (
                  <button key={String(v)} type="button" onClick={() => setF({ ...f, all: v as boolean })} className={cn('h-10 rounded-full border px-4 text-sm font-semibold', f.all === v ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
                    {l as string}
                  </button>
                ))}
              </div>
              {!f.all && (
                <div className="mt-3 max-h-[240px] overflow-auto rounded-card border border-line">
                  {(clients.data ?? [])
                    .filter((c) => c.active)
                    .map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-bg">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-brand-600"
                          checked={f.clients.includes(c.id)}
                          onChange={(e) => setF({ ...f, clients: e.target.checked ? [...f.clients, c.id] : f.clients.filter((x) => x !== c.id) })}
                        />
                        {c.name}
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Billing of the office's clients
// ---------------------------------------------------------------------------
const INV_STATUS: Record<OfficeInvoice['status'], { label: string; tone: 'amber' | 'success' | 'neutral' }> = {
  open: { label: 'E papaguar', tone: 'amber' },
  paid: { label: 'E paguar', tone: 'success' },
  cancelled: { label: 'E anuluar', tone: 'neutral' },
}

function BillingPanel() {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => monthStart())
  const from = month
  const to = addDays(addMonths(month, 1), -1)
  const invs = useQuery({ queryKey: ['acc-office-invoices', month], queryFn: () => fetchOfficeInvoices(from, to) })
  const profile = useQuery({ queryKey: ['acc-office-profile'], queryFn: fetchOfficeProfile, staleTime: 5 * 60_000 })
  const [newInv, setNewInv] = useState(false)
  const [pay, setPay] = useState<OfficeInvoice | null>(null)
  const [printing, setPrinting] = useState<OfficeInvoice[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['acc-office-invoices'] })
    void qc.invalidateQueries({ queryKey: ['acc-contracts'] })
    void qc.invalidateQueries({ queryKey: ['acc-work-summary'] })
  }
  const bill = useMutation({ mutationFn: () => billMonth(month), onSuccess: (n) => (setMsg(n ? `U krijuan ${n} fatura nga kontratat.` : 'Të gjitha kontratat aktive janë faturuar për këtë muaj.'), refresh()) })
  const cancel = useMutation({ mutationFn: cancelOfficeInvoice, onSuccess: refresh, onError: (e) => setMsg((e as Error).message) })
  useEffect(() => {
    if (!printing) return
    const t = setTimeout(() => {
      window.print()
      setPrinting(null)
    }, 80)
    return () => clearTimeout(t)
  }, [printing])

  const list = invs.data ?? []
  const live = list.filter((i) => i.status !== 'cancelled')
  const t = live.reduce((a, i) => ({ total: a.total + i.total, paid: a.paid + i.paid }), { total: 0, paid: 0 })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
          <button type="button" aria-label="Muaji i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] px-2 text-center font-semibold">{monthName(month)}</span>
          <button type="button" aria-label="Muaji tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setNewInv(true)}>
            <Plus className="h-4 w-4" /> Faturë tjetër
          </Button>
          <Button variant="secondary" disabled={!live.length} onClick={() => setPrinting(live)}>
            <Printer className="h-4 w-4" /> Printo të gjitha
          </Button>
          <Button
            variant="secondary"
            disabled={!list.length}
            onClick={() =>
              void downloadSheets(`faturat-e-zyres-${month.slice(0, 7)}.xlsx`, [
                {
                  name: 'Faturat',
                  columns: ['Nr.', 'Data', 'Klienti', 'NUI', 'Përshkrimi', 'Pa TVSH', 'TVSH', 'Totali', 'Paguar', 'Statusi'],
                  rows: list.map((i) => [i.inv_no, i.issue_date, i.client_name, i.client_nui ?? '', i.description, i.net, i.vat, i.total, i.paid, INV_STATUS[i.status].label]),
                },
              ])
            }
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button loading={bill.isPending} onClick={() => bill.mutate()}>
            <Receipt className="h-4 w-4" /> Fatura mujore nga kontratat
          </Button>
        </div>
      </div>
      {msg && <p className="rounded-ctl bg-brand-100 px-4 py-3 text-sm text-brand-600">{msg}</p>}
      {!profile.data?.nui && profile.data && (
        <p className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">Plotëso NUI-në, adresën dhe IBAN-in e zyrës te Zyra → Siguria dhe zyra, që të dalin në fatura.</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Faturuar', t.total],
          ['Paguar', t.paid],
          ['Pa paguar', t.total - t.paid],
        ].map(([l, v]) => (
          <Card key={l as string} className="p-4">
            <div className="text-sm text-muted">{l}</div>
            <div className="mt-1 text-[20px] font-bold tabular-nums">{formatEUR(v as number)}</div>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        {invs.isLoading ? (
          <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
        ) : invs.error ? (
          <p className="p-5 text-sm text-warn-700">{(invs.error as Error).message}</p>
        ) : list.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="Asnjë faturë këtë muaj" text="Vendos tarifat te Kontratat, pastaj kliko “Fatura mujore nga kontratat”." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <li key={i.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3', i.status === 'cancelled' && 'opacity-50')}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {i.client_name} <span className="font-normal text-muted">· {i.inv_no}</span>
                  </div>
                  <div className="truncate text-xs text-muted">
                    {formatDay(i.issue_date)} · {i.description}
                    {i.due_date && ` · afati ${formatDay(i.due_date)}`}
                    {i.payments.length > 0 && ` · paguar ${i.payments.map((p) => `${formatEUR(p.amount)} më ${formatDay(p.pay_date)}`).join(', ')}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{formatEUR(i.total)}</div>
                  {i.status === 'open' && i.paid > 0 && <div className="text-xs text-muted">mbetet {formatEUR(i.total - i.paid)}</div>}
                </div>
                <Badge tone={INV_STATUS[i.status].tone}>{INV_STATUS[i.status].label}</Badge>
                <div className="flex gap-1">
                  {i.status === 'open' && (
                    <Button size="sm" onClick={() => setPay(i)}>
                      Pagesë
                    </Button>
                  )}
                  {i.status !== 'cancelled' && (
                    <Button size="sm" variant="secondary" aria-label="Printo" onClick={() => setPrinting([i])}>
                      <Printer className="h-4 w-4" />
                    </Button>
                  )}
                  {i.status === 'open' && i.paid === 0 && (
                    <button type="button" aria-label="Anulo" title="Anulo faturën" onClick={() => confirm(`Ta anuloj faturën ${i.inv_no}?`) && cancel.mutate(i.id)} className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <NewInvoiceDialog open={newInv} onClose={() => setNewInv(false)} onSaved={refresh} />
      <PaymentDialog inv={pay} onClose={() => setPay(null)} onSaved={refresh} />
      {printing && profile.data && createPortal(<OfficeInvoicePrint invoices={printing} office={profile.data} />, document.body)}
    </div>
  )
}

function NewInvoiceDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ client_id: '', issue_date: kosovoDateISO(), due_date: addDays(kosovoDateISO(), 15), description: '', total: '', vat_rate: 0 })
  const clients = useClientOptions(open)
  useEffect(() => {
    if (open) setF({ client_id: '', issue_date: kosovoDateISO(), due_date: addDays(kosovoDateISO(), 15), description: '', total: '', vat_rate: 0 })
  }, [open])
  const save = useMutation({
    mutationFn: () => saveOfficeInvoice({ client_id: f.client_id, issue_date: f.issue_date, due_date: f.due_date || null, description: f.description, total: Number(f.total.replace(',', '.')) || 0, vat_rate: f.vat_rate }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Faturë për klientin"
      subtitle="p.sh. deklarata vjetore, regjistrimi i biznesit, shërbim i veçantë"
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} disabled={!f.client_id} onClick={() => save.mutate()}>
            Krijo faturën
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Select label="Klienti" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} options={[{ value: '', label: 'Zgjidh klientin' }, ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Përshkrimi" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <Input label="Shuma me TVSH (€)" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} />
        <Select label="TVSH" value={String(f.vat_rate)} onChange={(e) => setF({ ...f, vat_rate: Number(e.target.value) })} options={[{ value: '0', label: 'Pa TVSH (0%)' }, { value: '18', label: '18%' }, { value: '8', label: '8%' }]} />
        <Input label="Data" type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} />
        <Input label="Afati i pagesës" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

function PaymentDialog({ inv, onClose, onSaved }: { inv: OfficeInvoice | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: '', pay_date: kosovoDateISO(), method: 'bank' as 'cash' | 'bank' })
  useEffect(() => {
    if (inv) setF({ amount: String(Math.round((inv.total - inv.paid) * 100) / 100), pay_date: kosovoDateISO(), method: 'bank' })
  }, [inv])
  const save = useMutation({
    mutationFn: () => addOfficePayment({ invoice_id: inv!.id, amount: Number(f.amount.replace(',', '.')) || undefined, pay_date: f.pay_date, method: f.method }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const delPay = useMutation({ mutationFn: deleteOfficePayment, onSuccess: () => (onSaved(), onClose()) })
  return (
    <Dialog
      open={Boolean(inv)}
      onClose={onClose}
      title={`Pagesë – ${inv?.inv_no ?? ''}`}
      subtitle={inv ? `${inv.client_name} · ${formatEUR(inv.total)}` : undefined}
      width="md:max-w-[440px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj pagesën
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Shuma (€)" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input label="Data" type="date" value={f.pay_date} onChange={(e) => setF({ ...f, pay_date: e.target.value })} />
        <div className="sm:col-span-2">
          <Select label="Mënyra" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as 'cash' | 'bank' })} options={[{ value: 'bank', label: 'Bankë' }, { value: 'cash', label: 'Para në dorë' }]} />
        </div>
      </div>
      {inv && inv.payments.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line text-sm">
          {inv.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2">
              <span>
                {formatDay(p.pay_date)} · {p.method === 'cash' ? 'para në dorë' : 'bankë'}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {formatEUR(p.amount)}
                <button type="button" aria-label="Fshi pagesën" onClick={() => delPay.mutate(p.id)} className="text-muted hover:text-warn-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

/** A4 invoice of the office to its client, one per page. */
function OfficeInvoicePrint({ invoices, office }: { invoices: OfficeInvoice[]; office: OfficeProfile }) {
  const n2 = useMemo(() => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [])
  return (
    <div className="print-root print-a4 hidden bg-white text-[12px] text-black">
      {invoices.map((i, k) => (
        <div key={i.id} style={{ breakAfter: k < invoices.length - 1 ? 'page' : 'auto' }}>
          <div className="flex justify-between border-b-2 border-black pb-3">
            <div>
              {office.logo && <img src={office.logo} alt="" className="mb-2 max-h-14 max-w-[160px] object-contain" />}
              <div className="text-[16px] font-bold">{office.office_name ?? 'Zyra e kontabilitetit'}</div>
              <div>{[office.address, office.city].filter(Boolean).join(', ')}</div>
              {office.nui && <div>NUI {office.nui}{office.vat_no ? ` · TVSH ${office.vat_no}` : ''}</div>}
              <div>{[office.phone, office.email].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="text-right">
              <div className="text-[20px] font-bold">FATURË</div>
              <div>Nr. {i.inv_no}</div>
              <div>Data {formatDay(i.issue_date)}</div>
              {i.due_date && <div>Afati {formatDay(i.due_date)}</div>}
            </div>
          </div>
          <div className="mt-4">
            <div className="text-black/60">Klienti</div>
            <div className="font-semibold">{i.client_name}</div>
            {i.client_nui && <div>NUI {i.client_nui}</div>}
          </div>
          <table className="mt-6 w-full border-collapse">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1.5">Përshkrimi</th>
                <th className="py-1.5 text-right">Pa TVSH</th>
                <th className="py-1.5 text-right">TVSH {i.vat_rate}%</th>
                <th className="py-1.5 text-right">Totali</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-black/20">
                <td className="py-2">{i.description}</td>
                <td className="py-2 text-right">{n2.format(i.net)}</td>
                <td className="py-2 text-right">{n2.format(i.vat)}</td>
                <td className="py-2 text-right">{n2.format(i.total)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-4 flex justify-end">
            <div className="w-[260px]">
              <div className="flex justify-between border-t-2 border-black pt-2 text-[15px] font-bold">
                <span>PËR PAGESË</span>
                <span>{n2.format(i.total - i.paid)} €</span>
              </div>
              {i.paid > 0 && <div className="flex justify-between text-black/60"><span>Paguar më parë</span><span>{n2.format(i.paid)} €</span></div>}
            </div>
          </div>
          {office.iban && (
            <p className="mt-8">
              Pagesa në llogarinë {office.bank ? `${office.bank} ` : ''}IBAN <b>{office.iban}</b>, me përshkrim “Fatura {i.inv_no}”.
            </p>
          )}
          {i.vat_rate === 0 && <p className="mt-2 text-black/60">Shërbimi nuk përfshin TVSH.</p>}
          <div className="mt-16 grid grid-cols-2 gap-16 text-center">
            <div className="border-t border-black pt-1">Lëshoi</div>
            <div className="border-t border-black pt-1">Pranoi</div>
          </div>
        </div>
      ))}
    </div>
  )
}
