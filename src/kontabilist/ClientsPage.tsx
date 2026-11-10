import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, KeyRound, LayoutGrid, List, LogOut, MoreVertical, Plus, Search } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { LogoMark } from '@/components/Logo'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { cn } from '@/lib/cn'
import { kosovoDateISO, serverNow } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated, addMonths, formatDay, monthName, monthStart, vatDueDate } from '@/features/accounting/api'
import { fetchClients, type AccMe, type ClientRow } from './api'
import { ClientDialog, EMPTY_CLIENT } from './ClientDialog'

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

/** Initials and a steady colour per company (same name → same colour). */
const AVATAR = ['bg-[#1D4ED8]', 'bg-[#047857]', 'bg-[#C2410C]', 'bg-[#7E22CE]', 'bg-[#BE123C]', 'bg-[#0E7490]', 'bg-[#4338CA]', 'bg-[#B45309]', 'bg-[#0E6B4E]']
const avatarColor = (name: string) => AVATAR[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR.length]
const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase()

function VatBadge({ c, late, ended }: { c: ClientRow; late: boolean; ended: boolean }) {
  if (!c.active || c.vat_status === 'na') return null
  if (c.vat_status === 'filed') return <Badge tone="success">TVSH e dorëzuar</Badge>
  if (!ended) return null
  return <Badge tone={late ? 'warn' : 'amber'}>TVSH për t'u bërë</Badge>
}

function LinkBadge({ c }: { c: ClientRow }) {
  if (c.link_status === 'approved') return <span className="rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-2.5 py-0.5 text-xs font-semibold text-[#4338CA]">Lidhur me Kasa</span>
  if (c.link_status === 'pending') return <span className="rounded-full border border-[#FDE68A] bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Kasa · në pritje</span>
  return null
}

type Filter = 'all' | 'todo' | 'kasa' | 'archived'

/** "Kompanitë" – every client company of the accountant: cards (or a list with the month's figures). */
export function ClientsPage({ me }: { me: AccMe }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1)) // the month being closed
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('kasa.acc.view') === 'list' ? 'list' : 'grid'))
  const [newOpen, setNewOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  useEffect(() => localStorage.setItem('kasa.acc.view', view), [view])

  const clients = useQuery({ queryKey: ['clients', month], queryFn: () => fetchClients(month), retry: (count, e) => !(e instanceof AccountingNotMigrated) && count < 1 })
  const all = clients.data ?? []
  const active = all.filter((c) => c.active)
  const ended = monthStart() > month
  const late = kosovoDateISO() > vatDueDate(month)
  const todo = (c: ClientRow) => c.active && c.vat_status === 'open' && ended

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((c) => (filter === 'archived' ? !c.active : c.active))
      .filter((c) => (filter === 'todo' ? todo(c) : filter === 'kasa' ? c.link_status === 'approved' || c.link_status === 'pending' : true))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.nui ?? '').includes(q) || (c.city ?? '').toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.data, search, filter, month])

  const stats = {
    todo: active.filter(todo).length,
    vat: active.filter((c) => c.vat_status === 'open').reduce((s, c) => s + Math.max(0, vatDue(c)), 0),
    sales: active.reduce((s, c) => s + c.sales, 0),
  }

  return (
    <TopShell me={me} onPassword={() => setPasswordOpen(true)}>
      <div className="mx-auto w-full max-w-[1320px] px-4 pb-12 pt-6 md:px-8 md:pt-10">
        {/* title + tools */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <h1 className="text-[30px] font-bold leading-tight md:text-[34px] lg:mr-4">Kompanitë</h1>
          <div className="relative flex-1 lg:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kërko kompaninë, NUI ose qytetin…"
              className="h-[48px] w-full rounded-ctl border border-line bg-white pl-10 pr-3 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <div className="flex h-[48px] items-center gap-1 rounded-ctl border border-line bg-white p-1 shadow-sm">
              {(['grid', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-label={v === 'grid' ? 'Kartat' : 'Lista'}
                  onClick={() => setView(v)}
                  className={cn('flex h-full w-10 items-center justify-center rounded-lg', view === v ? 'bg-bg text-ink' : 'text-muted hover:text-ink')}
                >
                  {v === 'grid' ? <LayoutGrid className="h-5 w-5" /> : <List className="h-5 w-5" />}
                </button>
              ))}
            </div>
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="h-[48px] shadow-sm"
              options={[
                { value: 'all', label: `Të gjitha (${active.length})` },
                { value: 'todo', label: `Punët e hapura (${stats.todo})` },
                { value: 'kasa', label: 'Të lidhura me Kasa' },
                ...(all.some((c) => !c.active) ? [{ value: 'archived', label: `Të arkivuara (${all.filter((c) => !c.active).length})` }] : []),
              ]}
            />
            <Button size="lg" className="h-[48px] bg-brand-600 hover:bg-[#0B5C43]" onClick={() => setNewOpen(true)}>
              <Plus className="h-5 w-5" /> Kompani e re
            </Button>
          </div>
        </div>

        {/* month strip: what the figures and the VAT badges refer to */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
          <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
            <button type="button" aria-label="Muaji i kaluar" className="flex h-9 w-9 items-center justify-center hover:bg-bg" onClick={() => setMonth((m) => addMonths(m, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[120px] px-1 text-center font-semibold text-ink">{monthName(month)}</span>
            <button type="button" aria-label="Muaji tjetër" className="flex h-9 w-9 items-center justify-center hover:bg-bg disabled:text-[#B8C2BC]" disabled={month >= monthStart()} onClick={() => setMonth((m) => addMonths(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <span>
            <strong className="text-ink">{stats.todo}</strong> me TVSH për t'u bërë{ended && ` · afati ${formatDay(vatDueDate(month))}`}
          </span>
          <span>
            TVSH për pagesë <strong className="text-ink">{formatEUR(stats.vat)}</strong>
          </span>
          <span>
            Shitjet e klientëve <strong className="text-ink">{formatEUR(stats.sales)}</strong>
          </span>
        </div>

        <div className="mt-6">
          {clients.error instanceof AccountingNotMigrated ? (
            <Card>
              <EmptyState icon={<Building2 className="h-6 w-6" />} title="Programi nuk është aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0013_accountant_app.sql në Supabase." />
            </Card>
          ) : loadState(clients) === 'offline' ? (
            <OfflineEmpty />
          ) : loadState(clients) === 'loading' ? (
            <p className="py-16 text-center text-muted">Duke ngarkuar…</p>
          ) : loadState(clients) === 'error' ? (
            <p className="py-8 text-sm text-warn-700">{(clients.error as Error).message}</p>
          ) : rows.length === 0 && all.length > 0 ? (
            <Card>
              <EmptyState icon={<Building2 className="h-6 w-6" />} title="Asnjë kompani me këtë kërkim" />
            </Card>
          ) : view === 'grid' ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((c) => (
                <CompanyCard key={c.id} c={c} late={late} ended={ended} onOpen={(tab) => navigate(`/klient/${c.id}${tab ? `/${tab}` : ''}`)} />
              ))}
              {filter !== 'archived' && (
                <button
                  type="button"
                  onClick={() => setNewOpen(true)}
                  className="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-field text-muted hover:border-brand-600 hover:text-brand-600"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                    <Plus className="h-6 w-6" />
                  </span>
                  <span className="font-semibold">Shto kompani</span>
                  <span className="max-w-[240px] text-center text-sm">Çdo biznes – edhe ata që nuk përdorin arkën Kasa.</span>
                </button>
              )}
            </div>
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <thead className="bg-[#F8FAF8]">
                  <tr>
                    <Th className="pl-5">Kompania</Th>
                    <Th className="hidden md:table-cell">NUI</Th>
                    <Th className="hidden lg:table-cell">Aktiviteti i fundit</Th>
                    <Th className="text-right">Shitjet</Th>
                    <Th className="hidden text-right md:table-cell">Blerjet</Th>
                    <Th className="hidden text-right md:table-cell">TVSH</Th>
                    <Th className="pr-5">Muaji</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} onClick={() => navigate(`/klient/${c.id}`)} className="cursor-pointer hover:bg-[#F8FAF8]">
                      <Td className="pl-5">
                        <div className="flex items-center gap-3">
                          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white', avatarColor(c.name))}>{initial(c.name)}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 font-semibold">
                              {c.name} <LinkBadge c={c} />
                            </div>
                            <div className="text-xs text-muted">{[c.city, c.activity].filter(Boolean).join(' · ') || '—'}</div>
                          </div>
                        </div>
                      </Td>
                      <Td className="hidden md:table-cell">{c.nui || '—'}</Td>
                      <Td className="hidden whitespace-nowrap lg:table-cell">{ago(c.last_activity) ?? '—'}</Td>
                      <Td className="text-right">{formatEUR(c.sales)}</Td>
                      <Td className="hidden text-right md:table-cell">{formatEUR(c.purchases)}</Td>
                      <Td className="hidden text-right md:table-cell">{c.vat_status === 'na' ? '—' : formatEUR(vatDue(c))}</Td>
                      <Td className="pr-5">
                        <VatBadge c={c} late={late} ended={ended} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
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

function CompanyCard({ c, late, ended, onOpen }: { c: ClientRow; late: boolean; ended: boolean; onOpen: (tab?: string) => void }) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])
  const seen = ago(c.last_activity)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen()}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group relative flex min-h-[230px] cursor-pointer flex-col rounded-[18px] border border-line bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <span className={cn('flex h-14 w-14 items-center justify-center rounded-2xl text-[22px] font-bold text-white', avatarColor(c.name))}>{initial(c.name)}</span>
        <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="Veprimet" onClick={() => setMenu((m) => !m)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink">
            <MoreVertical className="h-5 w-5" />
          </button>
          {menu && (
            <div className="absolute right-0 top-10 z-20 w-[220px] overflow-hidden rounded-card border border-line bg-white py-1 shadow-xl">
              {[
                ['', 'Hape'],
                ['shitjet', 'Faturat e shitjes'],
                ['blerjet', 'Blerjet & shpenzimet'],
                ['borxhet', 'Borxhet'],
                ['tvsh', 'TVSH'],
                ['klienti', 'Të dhënat e kompanisë'],
              ].map(([tab, label]) => (
                <button key={label} type="button" onClick={() => onOpen(tab || undefined)} className="block w-full px-4 py-2.5 text-left text-[15px] hover:bg-bg">
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-5 text-[20px] font-bold leading-tight">{c.name}</div>
      <div className="mt-1 text-[15px] text-muted">{[c.city, 'Kosovë'].filter(Boolean).join(', ')}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkBadge c={c} />
        <VatBadge c={c} late={late} ended={ended} />
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-line pt-4 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <span className={cn('h-2 w-2 rounded-full', c.active ? 'bg-brand-400' : 'bg-[#B8C2BC]')} />
          {c.active ? 'Aktiv' : 'Arkivuar'}
        </span>
        <span className="flex items-center gap-2 text-muted">
          {seen && `Hapur ${seen}`}
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  )
}

/** The first page has no sidebar: a white bar with the office, the account menu and "Dil". */
function TopShell({ me, onPassword, children }: { me: AccMe; onPassword: () => void; children: React.ReactNode }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const name = me.accountant?.full_name || me.accountant?.email || 'Kontabilist'
  const doSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }
  return (
    <div className="min-h-dvh bg-bg">
      <div className="fixed inset-x-0 top-0 z-50 h-safe-top bg-brand-900" />
      <header className="sticky top-0 z-40 bg-brand-900 pt-safe text-white">
        <div className="flex h-[68px] items-center gap-3 px-4 md:px-8">
          <LogoMark size={36} />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold leading-tight">{me.accountant?.office_name || 'Kasa Kontabilist'}</div>
            <div className="text-xs font-semibold text-brand-400">Kontabilist</div>
          </div>
          <div className="flex-1" />
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Llogaria" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-400 text-[16px] font-bold text-brand-900">
              {initial(name)}
            </button>
            {menu && (
              <div className="absolute right-0 top-12 z-50 w-[260px] overflow-hidden rounded-card border border-line bg-white text-ink shadow-xl" onMouseLeave={() => setMenu(false)}>
                <div className="border-b border-line px-4 py-3">
                  <div className="truncate font-semibold">{name}</div>
                  <div className="truncate text-sm text-muted">{me.accountant?.email}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false)
                    onPassword()
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-bg"
                >
                  <KeyRound className="h-4 w-4" /> Ndrysho fjalëkalimin
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => void doSignOut()} className="flex h-11 items-center gap-2 rounded-ctl bg-white/10 px-4 font-semibold text-white hover:bg-white/20">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Dil</span>
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
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

