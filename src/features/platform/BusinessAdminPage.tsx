import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Copy, CreditCard, KeyRound, MonitorSmartphone, ShieldCheck, Trash2 } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, Input, Select } from '@/components/ui'
import { businessType } from '@/lib/business'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { APP_STATUS, DEVICE_LABELS, EVENT_LABELS, LICENSE_LABELS, PRINTER_LABELS, STATUS_LABELS, type RegisterApplication } from '@/features/onboarding/api'
import {
  confirmPayment,
  createActivationKey,
  decide,
  decideRegister,
  deletePayment,
  fetchActivationKeys,
  fetchAdminDetail,
  fetchPlatformSettings,
  revokeActivationKey,
  saveLicense,
  setDevice,
  type ActivationKey,
  type Decision,
} from './onboardingApi'
import { PlatformShell } from './PlatformPage'
import { statusTone } from './ApplicationsPage'

const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '—')

/** /platforma/biznes/:id – everything about one business: data, decision, payment, license, tills, devices, history. */
export function BusinessAdminPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const data = useQuery({ queryKey: ['platform-business', id], queryFn: () => fetchAdminDetail(id) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform-business', id] })
    void qc.invalidateQueries({ queryKey: ['platform-onboarding'] })
    void qc.invalidateQueries({ queryKey: ['platform-businesses'] })
  }
  const [decision, setDecision] = useState<Decision | null>(null)
  const [pay, setPay] = useState(false)
  const d = data.data
  const b = d?.business

  return (
    <PlatformShell>
      <PageHeader
        eyebrow={
          <button type="button" onClick={() => navigate('/platforma/aplikimet')} className="flex items-center gap-1 hover:underline">
            <ChevronLeft className="h-4 w-4" /> Aplikimet
          </button>
        }
        title={b?.name ?? 'Biznesi'}
        actions={
          b && (
            <div className="flex flex-wrap gap-2">
              {(b.status === 'pending' || b.status === 'needs_info') && (
                <>
                  <Button onClick={() => setDecision('approve')}>Prano</Button>
                  <Button variant="secondary" onClick={() => setDecision('request_info')}>
                    Kërko të dhëna
                  </Button>
                  <Button variant="danger" onClick={() => setDecision('reject')}>
                    Refuzo
                  </Button>
                </>
              )}
              {['approved', 'active', 'suspended'].includes(b.status) && (
                <Button onClick={() => setPay(true)}>
                  <CreditCard className="h-4 w-4" /> Konfirmo pagesën
                </Button>
              )}
              {b.status === 'active' && (
                <Button variant="danger" onClick={() => setDecision('suspend')}>
                  Pezullo
                </Button>
              )}
              {(b.status === 'suspended' || b.status === 'rejected') && (
                <Button variant="secondary" onClick={() => setDecision('reactivate')}>
                  Riaktivizo
                </Button>
              )}
            </div>
          )
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        {data.isLoading ? (
          <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
        ) : data.error || !d || !b ? (
          <Card className="p-5 text-sm text-warn-700">{(data.error as Error)?.message ?? 'Biznesi nuk u gjet'}</Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(b.status)}>{STATUS_LABELS[b.status]}</Badge>
              <Badge tone={b.active ? 'success' : 'neutral'}>{b.active ? 'Qasja e hapur' : 'Pa qasje'}</Badge>
              <span className="text-sm text-muted">
                {businessType(b.type).label} · {b.applied_at ? `regjistruar ${formatKosovoDateTime(b.applied_at)}` : `krijuar ${day(b.created_at)}`}
                {d.owner_last_sign_in && ` · pronari hyri së fundi ${formatKosovoDateTime(d.owner_last_sign_in)}`}
              </span>
            </div>
            {b.status_note && <p className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">Mesazhi për klientin: {b.status_note}</p>}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="text-[17px] font-semibold">Të dhënat e regjistrimit</h2>
                <dl className="mt-3 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-sm">
                  {(
                    [
                      ['Pronari', b.owner_name],
                      ['Email', b.owner_email],
                      ['Telefoni', b.phone],
                      ['NUI', b.nui],
                      ['Nr. fiskal', b.fiscal_number],
                      ['Nr. TVSH', b.vat_number],
                      ['Adresa', [b.address, b.city].filter(Boolean).join(', ')],
                      ['Veprimtaria', b.activity],
                      ['Arka të kërkuara', b.registration?.registers ? String(b.registration.registers) : null],
                      ['Shënimi', b.registration?.note],
                    ] as [string, string | null | undefined][]
                  ).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="break-words">{v || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <LicenseCard id={id} d={d} onSaved={refresh} />
            </div>

            <PaymentsCard d={d} onChanged={refresh} />
            <RegistersCard d={d} onChanged={refresh} />
            <ActivationKeysCard d={d} onChanged={refresh} />
            <DevicesCard d={d} onChanged={refresh} />

            <Card className="p-5">
              <h2 className="text-[17px] font-semibold">Historiku</h2>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {d.events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-[140px] shrink-0 text-muted">{formatKosovoDateTime(e.created_at)}</span>
                    <span>
                      {EVENT_LABELS[e.action] ?? e.action}
                      {e.note && <span className="text-muted"> – {e.note}</span>}
                      {e.by_name && <span className="text-muted"> · {e.by_name}</span>}
                    </span>
                  </li>
                ))}
                {d.events.length === 0 && <li className="text-muted">Asgjë ende.</li>}
              </ul>
            </Card>
          </>
        )}
      </div>
      {b && <DecisionDialog id={id} action={decision} onClose={() => setDecision(null)} onDone={refresh} />}
      {b && <PaymentDialog id={id} open={pay} plan={d?.license?.plan ?? 'monthly'} price={d?.license?.price ?? null} onClose={() => setPay(false)} onDone={refresh} />}
    </PlatformShell>
  )
}

const DECISION_TEXT: Record<Decision, { title: string; note: string; needsNote: boolean; cta: string }> = {
  approve: { title: 'Prano regjistrimin', note: 'Mesazh për klientin (opsional)', needsNote: false, cta: 'Prano' },
  request_info: { title: 'Kërko të dhëna', note: 'Çka duhet të plotësojë klienti', needsNote: true, cta: 'Dërgo kërkesën' },
  reject: { title: 'Refuzo regjistrimin', note: 'Arsyeja (e sheh klienti)', needsNote: true, cta: 'Refuzo' },
  suspend: { title: 'Pezullo llogarinë', note: 'Arsyeja (e sheh klienti)', needsNote: false, cta: 'Pezullo' },
  reactivate: { title: 'Riaktivizo llogarinë', note: 'Shënim (opsional)', needsNote: false, cta: 'Riaktivizo' },
}

function DecisionDialog({ id, action, onClose, onDone }: { id: string; action: Decision | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  useEffect(() => setNote(''), [action])
  const run = useMutation({
    mutationFn: () => decide(id, action!, note),
    onSuccess: () => {
      onDone()
      onClose()
    },
  })
  const t = action ? DECISION_TEXT[action] : null
  return (
    <Dialog
      open={Boolean(action)}
      onClose={onClose}
      title={t?.title ?? ''}
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button variant={action === 'reject' || action === 'suspend' ? 'danger' : 'primary'} loading={run.isPending} disabled={Boolean(t?.needsNote && !note.trim())} onClick={() => run.mutate()}>
            {t?.cta}
          </Button>
        </div>
      }
    >
      {action === 'approve' && <p className="mb-3 text-sm text-muted">Klientit i del pagesa; qasja hapet kur ta konfirmosh pagesën.</p>}
      {action === 'suspend' && <p className="mb-3 text-sm text-muted">Qasja në Kasa ndalet menjëherë për të gjithë përdoruesit e biznesit.</p>}
      <Input label={t?.note} value={note} onChange={(e) => setNote(e.target.value)} />
      {run.error && <p className="mt-3 text-sm text-warn-700">{(run.error as Error).message}</p>}
    </Dialog>
  )
}

function PaymentDialog({ id, open, plan, price, onClose, onDone }: { id: string; open: boolean; plan: string; price: number | null; onClose: () => void; onDone: () => void }) {
  const settings = useQuery({ queryKey: ['platform-settings'], queryFn: fetchPlatformSettings, enabled: open })
  const [f, setF] = useState({ amount: '', months: '1', method: 'bank', paid_on: kosovoDateISO(), reference: '', note: '' })
  useEffect(() => {
    if (!open) return
    const months = plan === 'yearly' ? 12 : 1
    const def = price ?? (months === 12 ? settings.data?.yearly_price : settings.data?.monthly_price) ?? 0
    setF({ amount: def ? String(def) : '', months: String(months), method: 'bank', paid_on: kosovoDateISO(), reference: '', note: '' })
  }, [open, plan, price, settings.data])
  const run = useMutation({
    mutationFn: () => confirmPayment({ business_id: id, amount: Number(f.amount.replace(',', '.')) || 0, months: Number(f.months), method: f.method, paid_on: f.paid_on, reference: f.reference, note: f.note }),
    onSuccess: () => {
      onDone()
      onClose()
    },
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Konfirmo pagesën"
      subtitle="Licenca zgjatet nga data e skadimit (ose nga sot nëse ka skaduar)"
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={run.isPending} onClick={() => run.mutate()}>
            Konfirmo
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Shuma (€)" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Select
          label="Zgjat licencën me"
          value={f.months}
          onChange={(e) => setF({ ...f, months: e.target.value })}
          options={[
            { value: '1', label: '1 muaj' },
            { value: '3', label: '3 muaj' },
            { value: '6', label: '6 muaj' },
            { value: '12', label: '12 muaj' },
            { value: '0', label: 'Pa zgjatur (vetëm regjistro pagesën)' },
          ]}
        />
        <Select label="Mënyra" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={[{ value: 'bank', label: 'Bankë' }, { value: 'cash', label: 'Kesh' }, { value: 'other', label: 'Tjetër' }]} />
        <Input label="Data e pagesës" type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} />
        <Input label="Referenca (nr. i transaksionit)" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        <Input label="Shënim" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      {run.error && <p className="mt-3 text-sm text-warn-700">{(run.error as Error).message}</p>}
    </Dialog>
  )
}

function LicenseCard({ id, d, onSaved }: { id: string; d: AdminDetailT; onSaved: () => void }) {
  const l = d.license
  const [f, setF] = useState({ plan: 'monthly', price: '', status: 'active', expires_on: '', max_devices: '3', note: '' })
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (l) setF({ plan: l.plan, price: l.price == null ? '' : String(l.price), status: l.status, expires_on: l.expires_on ?? '', max_devices: String(l.max_devices), note: l.note ?? '' })
  }, [l])
  const save = useMutation({
    mutationFn: () => saveLicense({ business_id: id, ...f, price: f.price.replace(',', '.'), max_devices: Number(f.max_devices) || 3 }),
    onSuccess: () => (setOk(true), onSaved()),
  })
  const c = l?.computed
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-brand-600" />
        <h2 className="text-[17px] font-semibold">Licenca</h2>
        {c && (
          <Badge tone={c.state === 'active' ? 'success' : c.state === 'expiring' || c.state === 'grace' ? 'amber' : 'warn'}>
            {LICENSE_LABELS[c.state]}
            {c.days_left != null && c.state !== 'expired' && ` · ${c.days_left} ditë`}
          </Badge>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Select label="Plani" value={f.plan} onChange={(e) => (setOk(false), setF({ ...f, plan: e.target.value }))} options={[{ value: 'monthly', label: 'Mujor' }, { value: 'yearly', label: 'Vjetor' }, { value: 'custom', label: 'I veçantë' }]} />
        <Input label="Çmimi për këtë biznes (€, bosh = sipas planit)" inputMode="decimal" value={f.price} onChange={(e) => (setOk(false), setF({ ...f, price: e.target.value }))} />
        <Select
          label="Statusi"
          value={f.status}
          onChange={(e) => (setOk(false), setF({ ...f, status: e.target.value }))}
          options={[{ value: 'active', label: 'Aktive' }, { value: 'suspended', label: 'E pezulluar' }, { value: 'cancelled', label: 'E çaktivizuar' }]}
        />
        <Input label="Skadon më (bosh = pa afat)" type="date" value={f.expires_on} onChange={(e) => (setOk(false), setF({ ...f, expires_on: e.target.value }))} />
        <Input label="Pajisje maksimale" inputMode="numeric" value={f.max_devices} onChange={(e) => (setOk(false), setF({ ...f, max_devices: e.target.value }))} />
        <Input label="Shënim" value={f.note} onChange={(e) => (setOk(false), setF({ ...f, note: e.target.value }))} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>
          Ruaj licencën
        </Button>
        {ok && <span className="text-sm text-brand-600">U ruajt.</span>}
        {save.error && <span className="text-sm text-warn-700">{(save.error as Error).message}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">Licenca e pezulluar ose e çaktivizuar mbyll qasjen; pas skadimit + tolerancës ndalen vetëm shitjet e reja.</p>
    </Card>
  )
}
type AdminDetailT = Awaited<ReturnType<typeof fetchAdminDetail>>

function PaymentsCard({ d, onChanged }: { d: AdminDetailT; onChanged: () => void }) {
  const del = useMutation({ mutationFn: deletePayment, onSuccess: onChanged })
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Pagesat</h2>
      {d.payments.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Asnjë pagesë e konfirmuar.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {d.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-[90px]">{day(p.paid_on)}</span>
              <span className="min-w-0 flex-1 text-muted">
                {[p.method === 'bank' ? 'bankë' : p.method === 'cash' ? 'kesh' : 'tjetër', p.reference, p.months ? `+${p.months} muaj` : null, p.extended_to && `deri ${day(p.extended_to)}`, p.confirmed_by_name, p.note].filter(Boolean).join(' · ')}
              </span>
              <b className="tabular-nums">{formatEUR(p.amount)}</b>
              <button type="button" aria-label="Fshi" onClick={() => confirm('Ta fshij pagesën? Afati i licencës nuk ndryshon vetë.') && del.mutate(p.id)} className="text-muted hover:text-warn-700">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RegistersCard({ d, onChanged }: { d: AdminDetailT; onChanged: () => void }) {
  const [act, setAct] = useState<{ app: RegisterApplication; action: 'approve' | 'reject' | 'request_info' } | null>(null)
  const [note, setNote] = useState('')
  const [reg, setReg] = useState('')
  useEffect(() => {
    setNote('')
    setReg('')
  }, [act])
  const run = useMutation({
    mutationFn: () => decideRegister(act!.app.id, act!.action, note, reg || null),
    onSuccess: () => {
      onChanged()
      setAct(null)
    },
  })
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <MonitorSmartphone className="h-5 w-5 text-brand-600" />
        <h2 className="text-[17px] font-semibold">Aplikimet për arkë</h2>
        <span className="text-sm text-muted">· arkat: {d.registers.map((r) => r.name).join(', ') || '—'}</span>
      </div>
      {d.register_applications.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Asnjë aplikim.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {d.register_applications.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-muted">
                  {[a.location, DEVICE_LABELS[a.device_type], PRINTER_LABELS[a.printer], a.printer !== 'none' && `${a.paper_width} mm`, a.fiscal ? 'fiskale' : 'jo fiskale', a.contact, a.note].filter(Boolean).join(' · ')}
                </div>
                {a.admin_note && <div className="text-xs text-amber-700">{a.admin_note}</div>}
              </div>
              <Badge tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'warn' : 'amber'}>{APP_STATUS[a.status]}</Badge>
              {(a.status === 'pending' || a.status === 'needs_info') && (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setAct({ app: a, action: 'approve' })}>
                    Aprovo
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAct({ app: a, action: 'request_info' })}>
                    Kërko të dhëna
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAct({ app: a, action: 'reject' })}>
                    Refuzo
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={Boolean(act)}
        onClose={() => setAct(null)}
        title={act?.action === 'approve' ? `Aprovo: ${act.app.name}` : act?.action === 'reject' ? 'Refuzo aplikimin' : 'Kërko të dhëna'}
        width="md:max-w-[480px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAct(null)}>
              Anulo
            </Button>
            <Button loading={run.isPending} disabled={act?.action !== 'approve' && !note.trim()} onClick={() => run.mutate()}>
              {act?.action === 'approve' ? 'Aprovo' : 'Dërgo'}
            </Button>
          </div>
        }
      >
        {act?.action === 'approve' && (
          <div className="mb-3">
            <Select
              label="Arka"
              value={reg}
              onChange={(e) => setReg(e.target.value)}
              options={[{ value: '', label: 'Automatikisht (arka e lirë ose e re)' }, ...d.registers.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))]}
            />
          </div>
        )}
        <Input label={act?.action === 'approve' ? 'Shënim (opsional)' : 'Arsyeja / çka mungon'} value={note} onChange={(e) => setNote(e.target.value)} />
        {run.error && <p className="mt-3 text-sm text-warn-700">{(run.error as Error).message}</p>}
      </Dialog>
    </Card>
  )
}

function DevicesCard({ d, onChanged }: { d: AdminDetailT; onChanged: () => void }) {
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => setDevice(id, active), onSuccess: onChanged })
  const max = d.license?.max_devices ?? 3
  const active = d.devices.filter((x) => x.active).length
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">
        Pajisjet e licencës <span className={cn('text-sm font-normal', active >= max ? 'text-warn-700' : 'text-muted')}>· {active} / {max} aktive</span>
      </h2>
      {d.devices.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Asnjë pajisje e lidhur ende.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {d.devices.map((x) => (
            <li key={x.id} className={cn('flex flex-wrap items-center gap-3 py-2 text-sm', !x.active && 'opacity-50')}>
              <span className="min-w-0 flex-1">
                <b>{x.name}</b> <span className="text-muted">· {x.platform === 'electron' ? 'Windows' : x.platform === 'capacitor' ? 'Android/iOS' : 'Shfletues'}{x.app_version && ` v${x.app_version}`}{x.register && ` · ${x.register}`} · parë {formatKosovoDateTime(x.last_seen_at)}</span>
              </span>
              <Button size="sm" variant="secondary" loading={toggle.isPending && toggle.variables?.id === x.id} onClick={() => toggle.mutate({ id: x.id, active: !x.active })}>
                {x.active ? 'Çaktivizo' : 'Aktivizo'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const KEY_STATUS: Record<ActivationKey['status'], [string, 'success' | 'info' | 'warn' | 'amber']> = {
  open: ['Pret përdorimin', 'info'],
  used: ['Përdorur', 'success'],
  expired: ['Skaduar', 'amber'],
  revoked: ['Anuluar', 'warn'],
}

/** Keys for the installed SEF app: the client types the key once, then workers sign in with PIN. */
function ActivationKeysCard({ d, onChanged }: { d: AdminDetailT; onChanged: () => void }) {
  const qc = useQueryClient()
  const id = d.business.id
  const keys = useQuery({ queryKey: ['activation-keys', id], queryFn: () => fetchActivationKeys(id) })
  const [open, setOpen] = useState(false)
  const [register, setRegister] = useState('')
  const [label, setLabel] = useState('')
  const [days, setDays] = useState('30')
  const [created, setCreated] = useState<{ key: string; expires_at: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['activation-keys', id] })
    onChanged()
  }
  const create = useMutation({
    mutationFn: () => createActivationKey({ business: id, register: register || null, label, days: Number(days) || 30 }),
    onSuccess: (r) => {
      setCreated(r)
      reload()
    },
  })
  const revoke = useMutation({ mutationFn: revokeActivationKey, onSuccess: reload })
  const close = () => {
    setOpen(false)
    setCreated(null)
    setCopied(false)
    setLabel('')
    setRegister('')
    create.reset()
  }
  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.key)
      setCopied(true)
    } catch {
      /* clipboard not allowed: the key stays on screen to copy by hand */
    }
  }
  const active = d.business.status === 'active'
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-[17px] font-semibold">Çelësat e aktivizimit (programi SEF)</h2>
        <Button size="sm" disabled={!active} onClick={() => setOpen(true)}>
          <KeyRound className="h-4 w-4" /> Gjenero çelës
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {active
          ? 'Klienti instalon programin, shkruan çelësin njëherë dhe arka hapet me PIN-et e punëtorëve. Një çelës vlen për një pajisje.'
          : 'Çelësi jepet pasi biznesi të jetë aktiv (i aprovuar dhe i paguar).'}
      </p>
      {keys.error ? (
        <p className="mt-2 text-sm text-warn-700">{(keys.error as Error).message}</p>
      ) : (keys.data ?? []).length > 0 ? (
        <ul className="mt-2 divide-y divide-line">
          {(keys.data ?? []).map((k) => (
            <li key={k.id} className={cn('flex flex-wrap items-center gap-3 py-2 text-sm', (k.status === 'expired' || k.status === 'revoked') && 'opacity-60')}>
              <span className="font-mono">…{k.hint}</span>
              <span className="min-w-0 flex-1 text-muted">
                {[
                  k.label,
                  k.register,
                  `krijuar ${formatKosovoDateTime(k.created_at)}`,
                  k.used_at ? `përdorur ${formatKosovoDateTime(k.used_at)}${k.device ? ` në ${k.device}` : ''}` : `vlen deri ${formatKosovoDateTime(k.expires_at)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <Badge tone={KEY_STATUS[k.status][1]}>{KEY_STATUS[k.status][0]}</Badge>
              {k.status === 'open' && (
                <Button size="sm" variant="secondary" loading={revoke.isPending && revoke.variables === k.id} onClick={() => revoke.mutate(k.id)}>
                  Anulo
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {revoke.error && <p className="mt-2 text-sm text-warn-700">{(revoke.error as Error).message}</p>}

      <Dialog
        open={open}
        onClose={close}
        title={created ? 'Çelësi u krijua' : 'Gjenero çelës aktivizimi'}
        subtitle={d.business.name}
        width="md:max-w-[520px]"
        footer={
          <div className="flex justify-end gap-2">
            {created ? (
              <Button onClick={close}>Mbyll</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={close}>
                  Anulo
                </Button>
                <Button loading={create.isPending} onClick={() => create.mutate()}>
                  Gjenero
                </Button>
              </>
            )}
          </div>
        }
      >
        {created ? (
          <div>
            <p className="text-sm text-muted">Dërgoja klientit. Çelësi shfaqet vetëm tani; nëse humbet, gjenero një të ri.</p>
            <div className="mt-4 flex items-center gap-2 rounded-card border border-line bg-bg p-4">
              <span className="flex-1 select-all text-center font-mono text-xl font-semibold tracking-[0.1em]">{created.key}</span>
              <Button size="sm" variant="secondary" onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'U kopjua' : 'Kopjo'}
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted">Vlen deri më {formatKosovoDateTime(created.expires_at)}, për një pajisje.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <Select
              label="Arka"
              value={register}
              onChange={(e) => setRegister(e.target.value)}
              options={[{ value: '', label: 'Pa caktuar (zgjidhet në arkë)' }, ...d.registers.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))]}
            />
            <Input label="Shënim (opsional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="p.sh. Kompjuteri te banaku" />
            <Select
              label="Vlen"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              options={[
                { value: '7', label: '7 ditë' },
                { value: '30', label: '30 ditë' },
                { value: '90', label: '90 ditë' },
              ]}
            />
            {create.error && <p className="text-sm text-warn-700">{(create.error as Error).message}</p>}
          </div>
        )}
      </Dialog>
    </Card>
  )
}
