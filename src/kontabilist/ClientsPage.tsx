import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, KeyRound, Link2, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Input, StatCard, Table, Td, Th } from '@/components/ui'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { cn } from '@/lib/cn'
import { kosovoDateISO, serverNow } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated, addMonths, formatDay, monthName, monthStart, vatDueDate } from '@/features/accounting/api'
import { fetchClients, type ClientRow } from './api'
import { AccShell } from './App'
import { ClientDialog, EMPTY_CLIENT } from './ClientDialog'
import type { AccMe } from './api'

function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const min = Math.max(0, Math.round((serverNow() - new Date(iso).getTime()) / 60_000))
  if (min < 60) return min < 1 ? 'tani' : `para ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return h === 1 ? 'para 1 ore' : `para ${h} orësh`
  const d = Math.round(h / 24)
  if (d <= 30) return d === 1 ? 'dje' : `para ${d} ditësh`
  return formatDay(new Date(iso).toISOString().slice(0, 10))
}

const vatDue = (c: ClientRow) => c.vat_out - c.vat_in

function StatusBadge({ c, late }: { c: ClientRow; late: boolean }) {
  if (!c.active) return <Badge>Arkivuar</Badge>
  if (c.vat_status === 'na') return <Badge>Nuk aplikohet</Badge>
  if (c.vat_status === 'filed') return <Badge tone="success">E dorëzuar</Badge>
  return <Badge tone={late ? 'warn' : 'amber'}>Për t'u bërë</Badge>
}

function LinkBadge({ c }: { c: ClientRow }) {
  if (c.link_status === 'approved') return <Badge tone="info">Kasa</Badge>
  if (c.link_status === 'pending') return <Badge tone="amber">Kasa · në pritje</Badge>
  return null
}

/** "Klientët" – every client of the accountant with the month's figures. */
export function ClientsPage({ me }: { me: AccMe }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  // The month being closed: the one before the current month.
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1))
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'todo' | 'kasa' | 'archived'>('all')
  const [newOpen, setNewOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

  const clients = useQuery({
    queryKey: ['clients', month],
    queryFn: () => fetchClients(month),
    retry: (count, e) => !(e instanceof AccountingNotMigrated) && count < 1,
  })
  const all = clients.data ?? []
  const active = all.filter((c) => c.active)
  const ended = monthStart() > month
  const late = kosovoDateISO() > vatDueDate(month)
  const todo = (c: ClientRow) => c.active && c.vat_status === 'open' && ended

  const stats = {
    clients: active.length,
    todo: active.filter(todo).length,
    vat: active.filter((c) => c.vat_status === 'open').reduce((s, c) => s + Math.max(0, vatDue(c)), 0),
    sales: active.reduce((s, c) => s + c.sales, 0),
    kasa: active.filter((c) => c.link_status === 'approved').length,
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((c) => (filter === 'archived' ? !c.active : c.active))
      .filter((c) => (filter === 'todo' ? todo(c) : filter === 'kasa' ? c.link_status === 'approved' || c.link_status === 'pending' : true))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.nui ?? '').includes(q) || (c.city ?? '').toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.data, search, filter, month])

  const chip = (value: typeof filter, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={cn('flex h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium', filter === value ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-bg')}
    >
      {label}
      {count != null && <span className={cn('text-xs', filter === value ? 'text-white/70' : 'text-muted')}>{count}</span>}
    </button>
  )

  return (
    <AccShell me={me}>
      <PageHeader
        eyebrow={me.accountant?.office_name || 'Kasa Kontabilist'}
        title="Klientët"
        actions={
          <div className="flex flex-wrap items-center gap-2 text-ink">
            <div className="flex items-center overflow-hidden rounded-ctl border border-field bg-white">
              <button type="button" aria-label="Muaji i kaluar" className="flex h-[44px] w-[40px] items-center justify-center hover:bg-bg" onClick={() => setMonth((m) => addMonths(m, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[132px] px-1 text-center text-[15px] font-semibold">{monthName(month)}</span>
              <button
                type="button"
                aria-label="Muaji tjetër"
                className="flex h-[44px] w-[40px] items-center justify-center hover:bg-bg disabled:text-[#B8C2BC] disabled:hover:bg-white"
                disabled={month >= monthStart()}
                onClick={() => setMonth((m) => addMonths(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
              <KeyRound className="h-4 w-4" /> Fjalëkalimi
            </Button>
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> Klient i ri
            </Button>
          </div>
        }
      />

      {clients.error instanceof AccountingNotMigrated ? (
        <div className="px-4 py-5 md:px-8 md:py-0">
          <Card>
            <EmptyState icon={<Building2 className="h-6 w-6" />} title="Programi nuk është aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0013_accountant_app.sql në Supabase." />
          </Card>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-4">
            <StatCard label="Klientë aktivë" value={stats.clients} sub={stats.kasa ? `${stats.kasa} të lidhur me Kasa` : undefined} />
            <StatCard label="Me punë për të bërë" value={stats.todo} tone={stats.todo > 0 && late ? 'warn' : 'default'} sub={ended ? `Afati i TVSH-së ${formatDay(vatDueDate(month))}` : 'Muaji është ende i hapur'} />
            <StatCard label="TVSH për t'u deklaruar" value={formatEUR(stats.vat)} sub={monthName(month)} />
            <StatCard label="Shitjet e klientëve" value={formatEUR(stats.sales)} sub={monthName(month)} />
          </div>

          <div className="px-4 pb-8 md:px-8 md:py-5">
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
                <div className="relative lg:w-[380px]">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Kërko me emër, NUI ose qytet"
                    className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  />
                </div>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
                  {chip('all', 'Të gjithë', active.length)}
                  {chip('todo', 'Punët e hapura', stats.todo)}
                  {chip('kasa', 'Me Kasa', active.filter((c) => c.link_status === 'approved' || c.link_status === 'pending').length)}
                  {all.some((c) => !c.active) && chip('archived', 'Të arkivuar', all.filter((c) => !c.active).length)}
                </div>
              </div>

              {loadState(clients) === 'offline' ? (
                <OfflineEmpty />
              ) : loadState(clients) === 'loading' ? (
                <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
              ) : loadState(clients) === 'error' ? (
                <p className="px-5 py-8 text-sm text-warn-700">{(clients.error as Error).message}</p>
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={<Building2 className="h-6 w-6" />}
                  title={all.length === 0 ? 'Ende pa klientë' : 'Asnjë klient me këto filtra'}
                  text={all.length === 0 ? 'Shto klientin e parë. Mund të jetë çdo biznes; nëse përdor Kasa, e lidh pastaj me NUI.' : undefined}
                  action={all.length === 0 ? <Button onClick={() => setNewOpen(true)}>Klient i ri</Button> : undefined}
                />
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table>
                      <thead className="bg-[#F8FAF8]">
                        <tr>
                          <Th className="pl-5">Klienti</Th>
                          <Th>NUI</Th>
                          <Th>Aktiviteti i fundit</Th>
                          <Th className="text-right">Shitjet</Th>
                          <Th className="text-right">Blerjet</Th>
                          <Th className="text-right">TVSH</Th>
                          <Th className="pr-5">Statusi i muajit</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => (
                          <tr key={c.id} onClick={() => navigate(`/klient/${c.id}`)} className="cursor-pointer hover:bg-[#F8FAF8]">
                            <Td className="pl-5">
                              <div className="flex items-center gap-2 font-semibold">
                                {c.name} <LinkBadge c={c} />
                              </div>
                              <div className="text-xs text-muted">{[c.city, c.activity, c.note].filter(Boolean).join(' · ') || '—'}</div>
                            </Td>
                            <Td>{c.nui || '—'}</Td>
                            <Td className="whitespace-nowrap">{ago(c.last_activity)}</Td>
                            <Td className="text-right">{formatEUR(c.sales)}</Td>
                            <Td className="text-right">{formatEUR(c.purchases)}</Td>
                            <Td className="text-right">{c.vat_status === 'na' ? '—' : formatEUR(vatDue(c))}</Td>
                            <Td className="pr-5">
                              <StatusBadge c={c} late={late} />
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  <ul className="divide-y divide-line md:hidden">
                    {rows.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => navigate(`/klient/${c.id}`)} className="flex w-full flex-col gap-2 p-4 text-left">
                          <div className="flex w-full items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-semibold">
                                <span className="truncate">{c.name}</span> <LinkBadge c={c} />
                              </div>
                              <div className="text-xs text-muted">{[c.nui && `NUI ${c.nui}`, c.city].filter(Boolean).join(' · ')}</div>
                            </div>
                            <StatusBadge c={c} late={late} />
                          </div>
                          <div className="text-sm tabular-nums text-muted">
                            Shitjet <strong className="text-ink">{formatEUR(c.sales)}</strong> · Blerjet {formatEUR(c.purchases)}
                            {c.vat_status !== 'na' && <> · TVSH {formatEUR(vatDue(c))}</>}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <Link2 className="h-4 w-4" /> Klientët që përdorin arkën Kasa i lidh me NUI; pasi pronari ta miratojë, shitjet dhe hyrjet e mallit dalin vetë.
            </p>
          </div>
        </>
      )}

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
    </AccShell>
  )
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [done, setDone] = useState(false)
  const save = useMutation({
    mutationFn: async () => {
      if (a.length < 8) throw new Error('Fjalëkalimi duhet të ketë të paktën 8 shenja')
      if (a !== b) throw new Error('Fjalëkalimet nuk përputhen')
      const { error } = await supabase.auth.updateUser({ password: a })
      if (error) throw new Error(/different from the old/i.test(error.message) ? 'Zgjidh një fjalëkalim të ndryshëm nga i vjetri' : error.message)
    },
    onSuccess: () => {
      setA('')
      setB('')
      setDone(true)
    },
  })
  const close = () => {
    save.reset()
    setDone(false)
    setA('')
    setB('')
    onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Ndrysho fjalëkalimin"
      width="md:max-w-[440px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {done ? 'Mbyll' : 'Anulo'}
          </Button>
          {!done && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Ruaj
            </Button>
          )}
        </div>
      }
    >
      {done ? (
        <p className="rounded-ctl bg-brand-100 px-4 py-3 text-brand-600">Fjalëkalimi u ndryshua.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Input label="Fjalëkalimi i ri" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} hint="Të paktën 8 shenja" />
          <Input label="Përsërite" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} error={save.error ? (save.error as Error).message : null} />
          <button type="submit" className="hidden" />
        </form>
      )}
    </Dialog>
  )
}
