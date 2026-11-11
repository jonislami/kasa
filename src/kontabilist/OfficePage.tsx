import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, FileSpreadsheet, History, KeyRound, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addDays } from '@/features/reports/api'
import { fetchClients, type AccMe } from './api'
import { monthStart } from '@/features/accounting/api'
import { PasswordDialog, TopShell } from './ClientsPage'
import { EnrollForm } from './MfaGate'
import {
  ACTION_LABELS,
  createMember,
  ENTITY_LABELS,
  fetchActivity,
  fetchOffice,
  mfaRemove,
  mfaStatus,
  ROLE_HELP,
  ROLE_LABELS,
  saveMember,
  saveOfficeSettings,
  setMemberPassword,
  type Member,
  type OfficeRole,
} from './office'
import { downloadSheets } from './xls'
import { fetchOfficeProfile, saveOfficeProfile, type OfficeProfile } from './work'

type Tab = 'ekipi' | 'historiku' | 'siguria'

/** Zyra: team and access, history of actions, two-factor login and office settings. */
export function OfficePage({ me }: { me: AccMe }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('ekipi')
  const [pw, setPw] = useState(false)
  const office = useQuery({ queryKey: ['acc-office'], queryFn: fetchOffice })
  const admin = office.data?.is_admin ?? false
  return (
    <TopShell me={me} onPassword={() => setPw(true)}>
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-12 pt-6 md:px-8 md:pt-10">
        <button type="button" onClick={() => navigate('/')} className="mb-3 flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> Kompanitë
        </button>
        <h1 className="text-[30px] font-bold leading-tight md:text-[34px]">{office.data?.office_name || me.accountant?.office_name || 'Zyra'}</h1>
        <p className="mt-1 text-muted">
          {me.accountant?.full_name} · {ROLE_LABELS[(me.accountant?.role ?? 'admin') as OfficeRole]}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {(
            [
              ['ekipi', 'Ekipi dhe qasja', Users],
              ['historiku', 'Historiku i veprimeve', History],
              ['siguria', 'Siguria dhe zyra', ShieldCheck],
            ] as const
          ).map(([k, l, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn('flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold', tab === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
              <Icon className="h-4 w-4" /> {l}
            </button>
          ))}
        </div>
        <div className="mt-5">
          {office.error ? (
            <Card className="p-5 text-sm text-warn-700">{(office.error as Error).message}</Card>
          ) : !office.data ? (
            <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
          ) : tab === 'ekipi' ? (
            <TeamTab members={office.data.members} admin={admin} />
          ) : tab === 'historiku' ? (
            <HistoryTab members={office.data.members} admin={admin} />
          ) : (
            <SecurityTab requireMfa={office.data.require_mfa} officeName={office.data.office_name} admin={admin} />
          )}
        </div>
      </div>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </TopShell>
  )
}

// ---------------------------------------------------------------------------
function TeamTab({ members, admin }: { members: Member[]; admin: boolean }) {
  const [edit, setEdit] = useState<Member | 'new' | null>(null)
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[17px] font-semibold">Ekipi i zyrës</h2>
          <p className="text-sm text-muted">{members.filter((m) => m.active).length} anëtarë aktivë</p>
        </div>
        {admin && (
          <Button onClick={() => setEdit('new')}>
            <UserPlus className="h-4 w-4" /> Anëtar i ri
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <li key={m.user_id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3.5', !m.active && 'opacity-50')}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-600">{(m.full_name.trim()[0] ?? '?').toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {m.full_name} {m.is_owner && <span className="text-xs font-normal text-muted">(pronari i zyrës)</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {[m.email, m.all_clients ? 'të gjithë klientët' : `${m.clients?.length ?? 0} klientë`, m.last_sign_in_at && `hyrja e fundit ${formatKosovoDateTime(m.last_sign_in_at)}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            {m.mfa && <Badge tone="success">2 faktorë</Badge>}
            {!m.active && <Badge tone="warn">Çaktivizuar</Badge>}
            <Badge tone={m.role === 'admin' ? 'info' : m.role === 'accountant' ? 'success' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
            {admin && !m.is_owner && (
              <Button size="sm" variant="secondary" onClick={() => setEdit(m)}>
                Ndrysho
              </Button>
            )}
          </li>
        ))}
      </ul>
      {admin && <MemberDialog value={edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function MemberDialog({ value, onClose }: { value: Member | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isNew = value === 'new'
  const m = value && value !== 'new' ? value : null
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', role: 'accountant' as OfficeRole, active: true, all_clients: true, clients: [] as string[] })
  const [newPw, setNewPw] = useState('')
  const [pwDone, setPwDone] = useState(false)
  const clients = useQuery({ queryKey: ['acc-clients-min'], queryFn: () => fetchClients(monthStart()), enabled: Boolean(value) })
  useEffect(() => {
    if (!value) return
    setNewPw('')
    setPwDone(false)
    setF(
      m
        ? { full_name: m.full_name, email: m.email, phone: m.phone ?? '', password: '', role: m.role, active: m.active, all_clients: m.all_clients, clients: m.clients ?? [] }
        : { full_name: '', email: '', phone: '', password: '', role: 'accountant', active: true, all_clients: true, clients: [] },
    )
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        await createMember({ full_name: f.full_name, email: f.email, password: f.password, role: f.role, phone: f.phone || undefined, all_clients: f.all_clients, clients: f.clients })
      } else if (m) {
        await saveMember({ user_id: m.user_id, full_name: f.full_name, phone: f.phone || null, role: f.role, active: f.active, all_clients: f.all_clients, clients: f.clients })
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['acc-office'] })
      onClose()
    },
  })
  const pw = useMutation({ mutationFn: () => setMemberPassword(m!.user_id, newPw), onSuccess: () => setPwDone(true) })
  const list = (clients.data ?? []).filter((c) => c.active)
  const restricted = f.role !== 'admin' && !f.all_clients

  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={isNew ? 'Anëtar i ri i zyrës' : f.full_name}
      subtitle={isNew ? 'Hyn në Kasa Kontabilist me këtë email dhe fjalëkalim' : m?.email}
      width="md:max-w-[640px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {isNew ? 'Krijo llogarinë' : 'Ruaj'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Emri dhe mbiemri" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        <Input label="Telefoni" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        {isNew && (
          <>
            <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Input label="Fjalëkalimi (të paktën 8 shenja)" type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </>
        )}
        <div className="sm:col-span-2">
          <Select
            label="Roli"
            value={f.role}
            onChange={(e) => setF({ ...f, role: e.target.value as OfficeRole })}
            options={(Object.keys(ROLE_LABELS) as OfficeRole[]).map((r) => ({ value: r, label: `${ROLE_LABELS[r]} – ${ROLE_HELP[r]}` }))}
          />
        </div>
        {f.role !== 'admin' && (
          <div className="sm:col-span-2">
            <div className="mb-2 text-sm font-semibold text-muted">Qasja te klientët</div>
            <div className="flex gap-2">
              {[
                [true, 'Të gjithë klientët'],
                [false, 'Vetëm klientët e zgjedhur'],
              ].map(([v, l]) => (
                <button key={String(v)} type="button" onClick={() => setF({ ...f, all_clients: v as boolean })} className={cn('h-10 rounded-full border px-4 text-sm font-semibold', f.all_clients === v ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
                  {l as string}
                </button>
              ))}
            </div>
            {restricted && (
              <div className="mt-3 max-h-[260px] overflow-auto rounded-card border border-line">
                {list.length === 0 ? (
                  <p className="p-4 text-sm text-muted">{clients.isLoading ? 'Duke ngarkuar…' : 'Asnjë klient'}</p>
                ) : (
                  list.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-bg">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-brand-600"
                        checked={f.clients.includes(c.id)}
                        onChange={(e) => setF({ ...f, clients: e.target.checked ? [...f.clients, c.id] : f.clients.filter((x) => x !== c.id) })}
                      />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.nui && <span className="text-xs text-muted">{c.nui}</span>}
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        {!isNew && (
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktiv (i çaktivizuari nuk mund të hyjë)
          </label>
        )}
        {!isNew && m && (
          <div className="rounded-card bg-[#F4F6F3] p-3 sm:col-span-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input label="Fjalëkalim i ri" type="text" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </div>
              <Button variant="secondary" className="h-[46px]" loading={pw.isPending} disabled={newPw.length < 8} onClick={() => pw.mutate()}>
                <KeyRound className="h-4 w-4" /> Vendos
              </Button>
            </div>
            {pwDone && <p className="mt-2 text-sm text-brand-600">Fjalëkalimi u ndryshua. Jepja anëtarit.</p>}
            {pw.error && <p className="mt-2 text-sm text-warn-700">{(pw.error as Error).message}</p>}
          </div>
        )}
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
function HistoryTab({ members, admin }: { members: Member[]; admin: boolean }) {
  const [from, setFrom] = useState(() => addDays(kosovoDateISO(), -7))
  const [to, setTo] = useState(() => kosovoDateISO())
  const [user, setUser] = useState('')
  const [client, setClient] = useState('')
  const data = useQuery({ queryKey: ['acc-activity', from, to, user], queryFn: () => fetchActivity(from, to, user || null) })
  const rows = useMemo(() => (data.data ?? []).filter((a) => !client || a.client_id === client), [data.data, client])
  const clients = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of data.data ?? []) if (a.client_id && a.client_name) m.set(a.client_id, a.client_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.data])
  const text = (a: (typeof rows)[number]) => `${ACTION_LABELS[a.action]} ${(ENTITY_LABELS[a.entity] ?? a.entity).toLowerCase()}${a.label ? ': ' + a.label : ''}`

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-5 py-4">
        <Input label="Nga" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Deri" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        {admin && (
          <Select label="Anëtari" value={user} onChange={(e) => setUser(e.target.value)} options={[{ value: '', label: 'Të gjithë' }, ...members.map((m) => ({ value: m.user_id, label: m.full_name }))]} />
        )}
        <Select label="Klienti" value={client} onChange={(e) => setClient(e.target.value)} options={[{ value: '', label: 'Të gjithë' }, ...clients.map(([id, name]) => ({ value: id, label: name }))]} />
        <Button
          variant="secondary"
          className="ml-auto h-[46px]"
          disabled={!rows.length}
          onClick={() =>
            void downloadSheets(`historiku-${from}-${to}.xlsx`, [
              { name: 'Historiku', columns: ['Koha', 'Anëtari', 'Veprimi', 'Klienti', 'Shuma'], rows: rows.map((a) => [formatKosovoDateTime(a.created_at), a.user_name ?? '', text(a), a.client_name ?? '', a.amount ?? '']) },
            ])
          }
        >
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </Button>
      </div>
      {!admin && <p className="px-5 pb-3 text-sm text-muted">Shfaqen vetëm veprimet e tua; administratori sheh të gjithë ekipin.</p>}
      {data.isLoading ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : data.error ? (
        <p className="px-5 py-6 text-sm text-warn-700">{(data.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<History className="h-6 w-6" />} title="Asnjë veprim në këtë periudhë" />
      ) : (
        <Table>
          <thead className="bg-[#F6F9F7]">
            <tr>
              <Th className="pl-5">Koha</Th>
              <Th>Anëtari</Th>
              <Th>Veprimi</Th>
              <Th className="hidden md:table-cell">Klienti</Th>
              <Th className="pr-5 text-right">Shuma</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap pl-5 text-sm text-muted">{formatKosovoDateTime(a.created_at)}</Td>
                <Td className="whitespace-nowrap">{a.user_name ?? '—'}</Td>
                <Td>
                  <span className={cn(a.action === 'delete' && 'text-warn-700')}>{text(a)}</span>
                  <div className="text-xs text-muted md:hidden">{a.client_name}</div>
                </Td>
                <Td className="hidden md:table-cell">{a.client_name ?? ''}</Td>
                <Td className="pr-5 text-right tabular-nums">{a.amount != null ? formatEUR(a.amount) : ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
function SecurityTab({ requireMfa, officeName, admin }: { requireMfa: boolean; officeName: string | null; admin: boolean }) {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['mfa'], queryFn: mfaStatus })
  const [enrolling, setEnrolling] = useState(false)
  const [name, setName] = useState(officeName ?? '')
  const done = () => {
    setEnrolling(false)
    void qc.invalidateQueries({ queryKey: ['mfa'] })
    void qc.invalidateQueries({ queryKey: ['acc-me'] })
  }
  const remove = useMutation({ mutationFn: () => mfaRemove(status.data!.factorId!), onSuccess: done })
  const settings = useMutation({
    mutationFn: saveOfficeSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['acc-office'] })
      void qc.invalidateQueries({ queryKey: ['acc-me'] })
    },
  })
  const on = Boolean(status.data?.factorId)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className={cn('h-6 w-6', on ? 'text-brand-600' : 'text-muted')} />
          <div className="flex-1">
            <h2 className="text-[17px] font-semibold">Hyrja me dy faktorë</h2>
            <p className="text-sm text-muted">Pas fjalëkalimit kërkohet kodi nga aplikacioni i autentikimit në telefon.</p>
          </div>
          <Badge tone={on ? 'success' : 'neutral'}>{on ? 'Aktiv' : 'Joaktiv'}</Badge>
        </div>
        <div className="mt-4">
          {status.isLoading ? (
            <p className="text-sm text-muted">Duke kontrolluar…</p>
          ) : on ? (
            <Button variant="secondary" loading={remove.isPending} onClick={() => confirm('Ta çaktivizoj hyrjen me dy faktorë?') && remove.mutate()} disabled={requireMfa}>
              Çaktivizo
            </Button>
          ) : enrolling ? (
            <EnrollForm onDone={done} />
          ) : (
            <Button onClick={() => setEnrolling(true)}>Aktivizo</Button>
          )}
          {requireMfa && on && <p className="mt-2 text-xs text-muted">Zyra e kërkon për të gjithë, prandaj nuk çaktivizohet.</p>}
          {remove.error && <p className="mt-2 text-sm text-warn-700">{(remove.error as Error).message}</p>}
        </div>
      </Card>

      {admin && <OfficeProfileCard />}
      {admin && (
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Cilësimet e zyrës</h2>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input label="Emri i zyrës" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button variant="secondary" className="h-[46px]" loading={settings.isPending} onClick={() => settings.mutate({ office_name: name })}>
                Ruaj
              </Button>
            </div>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-brand-600"
                checked={requireMfa}
                disabled={settings.isPending || (!requireMfa && !on)}
                onChange={(e) => settings.mutate({ require_mfa: e.target.checked })}
              />
              <span>
                <span className="font-semibold">Kërko dy faktorë për të gjithë ekipin</span>
                <span className="block text-sm text-muted">
                  Kush nuk e ka të aktivizuar, e aktivizon në hyrjen e radhës; pa kodin nuk sheh asnjë të dhënë.
                  {!requireMfa && !on && ' Aktivizoje fillimisht për veten.'}
                </span>
              </span>
            </label>
            {settings.error && <p className="text-sm text-warn-700">{(settings.error as Error).message}</p>}
          </div>
        </Card>
      )}
    </div>
  )
}

/** Details of the office printed on its invoices to clients. */
function OfficeProfileCard() {
  const qc = useQueryClient()
  const profile = useQuery({ queryKey: ['acc-office-profile'], queryFn: fetchOfficeProfile })
  const [f, setF] = useState<Partial<OfficeProfile>>({})
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (profile.data) setF(profile.data)
  }, [profile.data])
  const save = useMutation({
    mutationFn: () => saveOfficeProfile({ nui: f.nui ?? '', vat_no: f.vat_no ?? '', address: f.address ?? '', city: f.city ?? '', email: f.email ?? '', phone: f.phone ?? '', bank: f.bank ?? '', iban: f.iban ?? '' }),
    onSuccess: () => {
      setSaved(true)
      void qc.invalidateQueries({ queryKey: ['acc-office-profile'] })
    },
  })
  const field = (k: keyof OfficeProfile, label: string, extra?: { inputMode?: 'numeric'; maxLength?: number }) => (
    <Input label={label} value={(f[k] as string | null) ?? ''} onChange={(e) => (setSaved(false), setF({ ...f, [k]: e.target.value }))} {...extra} />
  )
  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="text-[17px] font-semibold">Të dhënat e zyrës për faturat</h2>
      <p className="text-sm text-muted">Dalin në faturat që zyra u lëshon klientëve (Puna → Faturimi).</p>
      {profile.error ? (
        <p className="mt-3 text-sm text-warn-700">{(profile.error as Error).message}</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field('nui', 'NUI', { inputMode: 'numeric', maxLength: 9 })}
          {field('vat_no', 'Nr. i TVSH-së')}
          {field('address', 'Adresa')}
          {field('city', 'Qyteti')}
          {field('phone', 'Telefoni')}
          {field('email', 'Email')}
          {field('bank', 'Banka')}
          {field('iban', 'IBAN')}
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Ruaj
        </Button>
        {saved && <span className="text-sm text-brand-600">U ruajt.</span>}
        {save.error && <span className="text-sm text-warn-700">{(save.error as Error).message}</span>}
      </div>
    </Card>
  )
}
