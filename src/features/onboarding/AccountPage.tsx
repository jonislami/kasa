import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Circle, Clock, CreditCard, Download, LogOut, MonitorSmartphone, Plus, XCircle } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { LogoMark } from '@/components/Logo'
import { Badge, Button, Card, Dialog, Input, Select } from '@/components/ui'
import { businessType } from '@/lib/business'
import { formatKosovoDateTime } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { DownloadCards } from '@/features/download/DownloadPage'
import {
  APP_STATUS,
  DEVICE_LABELS,
  EVENT_LABELS,
  fetchOnboarding,
  LICENSE_LABELS,
  PRINTER_LABELS,
  STATUS_LABELS,
  submitRegisterApplication,
  updateOnboarding,
  type OnboardingState,
  type RegisterApplication,
} from './api'

// dd.mm.yyyy: browsers without Albanian locale data would print English month names
const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')

/**
 * /llogaria – the owner's panel: status of the registration, data, payment, license, application for a till,
 * Install SEF. Works while the business waits (active = false) through security-definer RPCs.
 */
export function AccountPage() {
  const { ctx, signOut, refresh } = useAuth()
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['onboarding'], queryFn: fetchOnboarding, staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 60_000 })
  const s = state.data
  // when the admin activates the business, the session context must follow
  useEffect(() => {
    if (!s || !ctx?.business) return
    const b = ctx.business
    if (s.business.active !== b.active || s.can_install !== (b.can_install ?? s.can_install) || (b.license && s.license.state !== b.license.state)) refresh()
  }, [s, ctx?.business, refresh])

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['onboarding'] })
    refresh()
  }

  return (
    <div className="min-h-dvh bg-bg pb-12">
      <SafeAreaStrip />
      <header className="bg-brand-900 pt-safe text-white">
        <div className="mx-auto flex h-[68px] max-w-[1000px] items-center gap-3 px-4 md:px-6">
          <LogoMark size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-bold">{s?.business.name ?? ctx?.business?.name ?? 'Kasa'}</div>
            <div className="text-xs font-semibold text-brand-400">Llogaria dhe aktivizimi</div>
          </div>
          {ctx?.business?.active && (
            <Link to="/" className="hidden h-10 items-center rounded-ctl bg-white/10 px-3 text-sm font-semibold hover:bg-white/20 sm:flex">
              Hap Kasa
            </Link>
          )}
          <button type="button" onClick={() => void signOut()} className="flex h-10 items-center gap-2 rounded-ctl bg-white/10 px-3 text-sm font-semibold hover:bg-white/20">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Dil</span>
          </button>
        </div>
      </header>
      <main className="mx-auto mt-6 flex max-w-[1000px] flex-col gap-5 px-4 md:px-6">
        {state.isLoading ? (
          <p className="py-16 text-center text-muted">Duke ngarkuar…</p>
        ) : state.error || !s ? (
          <Card className="p-6 text-sm text-warn-700">{(state.error as Error)?.message ?? 'Të dhënat nuk u ngarkuan'}</Card>
        ) : (
          <>
            <Steps s={s} />
            <StatusCard s={s} />
            {['pending', 'needs_info', 'approved'].includes(s.business.status) && <DataCard s={s} onSaved={reload} />}
            {['approved', 'active', 'suspended'].includes(s.business.status) && <PaymentCard s={s} />}
            {s.business.status === 'active' && <RegisterCard s={s} onSaved={reload} />}
            {s.can_install && (
              <Card className="p-5 md:p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-white">
                    <Download className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-[19px] font-bold">Install SEF</h2>
                    <p className="text-sm text-muted">Shkarko Kasa për pajisjen e arkës dhe hyr me këtë llogari; biznesi dhe konfigurimi ngarkohen vetë.</p>
                  </div>
                </div>
                <DownloadCards businessLabel={businessType(s.business.type).label} />
              </Card>
            )}
            <HistoryCard s={s} />
          </>
        )}
      </main>
    </div>
  )
}

function Steps({ s }: { s: OnboardingState }) {
  const st = s.business.status
  const paid = s.payments.length > 0 || (st === 'active' && !s.business.applied_at)
  const regApproved = s.register_applications.some((a) => a.status === 'approved')
  const steps: { label: string; done: boolean; active: boolean; bad?: boolean }[] = [
    { label: 'Regjistrimi', done: true, active: false },
    { label: 'Shqyrtimi', done: ['approved', 'active', 'suspended'].includes(st), active: st === 'pending' || st === 'needs_info', bad: st === 'rejected' },
    { label: 'Pagesa', done: paid && st !== 'approved', active: st === 'approved' },
    { label: 'Aplikimi për arkë', done: regApproved || s.can_install, active: st === 'active' && !regApproved && !s.can_install },
    { label: 'Install SEF', done: false, active: s.can_install },
  ]
  return (
    <Card className="p-5">
      <ol className="grid grid-cols-5 gap-2">
        {steps.map((x, i) => {
          const Icon = x.bad ? XCircle : x.done ? CheckCircle2 : x.active ? Clock : Circle
          return (
            <li key={x.label} className="flex flex-col items-center gap-1 text-center">
              <Icon className={cn('h-7 w-7', x.bad ? 'text-warn-700' : x.done ? 'text-brand-600' : x.active ? 'text-amber-700' : 'text-[#C3CCC6]')} />
              <span className={cn('text-[12px] font-semibold leading-tight md:text-[13px]', x.done || x.active ? 'text-ink' : 'text-muted')}>
                <span className="hidden md:inline">{i + 1}. </span>
                {x.label}
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

function StatusCard({ s }: { s: OnboardingState }) {
  const st = s.business.status
  const lic = s.license
  const text: Record<string, string> = {
    pending: 'Regjistrimi është në shqyrtim. Zakonisht përgjigjemi brenda një dite pune; do të të njoftojmë me email.',
    needs_info: 'Për të vazhduar na duhen disa të dhëna. Plotësoji më poshtë dhe kliko “Dërgo të dhënat”.',
    approved: 'Regjistrimi u aprovua. Kryej pagesën sipas udhëzimeve më poshtë; pas konfirmimit hapet aplikimi për arkë.',
    active: s.can_install ? 'Llogaria është aktive. Shkarko Kasa te “Install SEF” dhe fillo punën.' : 'Llogaria është aktive. Apliko për arkë; pas aprovimit të del “Install SEF”.',
    rejected: 'Regjistrimi u refuzua. Për sqarime na kontakto.',
    suspended: 'Llogaria është pezulluar. Kasa nuk punon derisa të riaktivizohet – kontrollo pagesën ose na kontakto.',
  }
  return (
    <Card className={cn('p-5', st === 'needs_info' || st === 'rejected' || st === 'suspended' ? 'border-warn-700/30' : '')}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[19px] font-bold">Statusi</h2>
        <Badge tone={st === 'active' ? 'success' : st === 'rejected' || st === 'suspended' ? 'warn' : 'amber'}>{STATUS_LABELS[st]}</Badge>
        {st === 'active' && (
          <Badge tone={lic.state === 'active' ? 'success' : lic.state === 'expiring' || lic.state === 'grace' ? 'amber' : 'warn'}>
            Licenca: {LICENSE_LABELS[lic.state]}
            {lic.expires_on && ` · deri ${day(lic.expires_on)}`}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-[15px]">{text[st]}</p>
      {s.business.status_note && (
        <p className="mt-3 flex gap-2 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> <span><b>Mesazh nga administratori:</b> {s.business.status_note}</span>
        </p>
      )}
      {st === 'active' && (lic.state === 'expiring' || lic.state === 'grace' || lic.state === 'expired') && (
        <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">
          {lic.state === 'expiring'
            ? `Abonimi skadon më ${day(lic.expires_on)}. Paguaje me kohë që Kasa të mos ndalet.`
            : lic.state === 'grace'
              ? `Abonimi ka skaduar. Deri më ${day(lic.grace_until)} Kasa punon normalisht; pastaj ndalen shitjet e reja.`
              : 'Abonimi ka skaduar: shitjet e reja janë ndalur. Raportet dhe të dhënat shihen. Paguaj abonimin për ta riaktivizuar.'}
        </p>
      )}
    </Card>
  )
}

function DataCard({ s, onSaved }: { s: OnboardingState; onSaved: () => void }) {
  const b = s.business
  const [f, setF] = useState({
    name: b.name,
    nui: b.nui ?? '',
    fiscal_number: b.fiscal_number ?? '',
    vat_number: b.vat_number ?? '',
    address: b.address ?? '',
    city: b.city ?? '',
    phone: b.phone ?? '',
    owner_name: b.owner_name ?? '',
    activity: b.activity ?? '',
    message: '',
  })
  const [ok, setOk] = useState(false)
  const save = useMutation({ mutationFn: () => updateOnboarding(f), onSuccess: () => (setOk(true), onSaved()) })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => (setOk(false), setF({ ...f, [k]: e.target.value }))
  return (
    <Card className="p-5 md:p-6">
      <h2 className="text-[19px] font-bold">Të dhënat e biznesit</h2>
      <p className="text-sm text-muted">{businessType(b.type).label} · regjistruar {day(b.created_at)} · {b.owner_email}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Input label="Emri i biznesit" value={f.name} onChange={set('name')} />
        <Input label="Pronari" value={f.owner_name} onChange={set('owner_name')} />
        <Input label="NUI" inputMode="numeric" maxLength={9} value={f.nui} onChange={set('nui')} />
        <Input label="Numri fiskal" value={f.fiscal_number} onChange={set('fiscal_number')} />
        <Input label="Nr. i TVSH-së" value={f.vat_number} onChange={set('vat_number')} />
        <Input label="Veprimtaria" value={f.activity} onChange={set('activity')} />
        <Input label="Adresa" value={f.address} onChange={set('address')} />
        <Input label="Qyteti" value={f.city} onChange={set('city')} />
        <Input label="Telefoni" value={f.phone} onChange={set('phone')} />
        <Input label={b.status === 'needs_info' ? 'Përgjigje për administratorin' : 'Shënim'} value={f.message} onChange={set('message')} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {b.status === 'needs_info' ? 'Dërgo të dhënat' : 'Ruaj'}
        </Button>
        {ok && <span className="text-sm text-brand-600">U ruajt.</span>}
        {save.error && <span className="text-sm text-warn-700">{(save.error as Error).message}</span>}
      </div>
    </Card>
  )
}

function PaymentCard({ s }: { s: OnboardingState }) {
  const p = s.payment_info
  const price = s.license.price ?? (s.license.plan === 'yearly' ? p.yearly_price : p.monthly_price)
  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[19px] font-bold">Pagesa e abonimit</h2>
          <p className="text-sm text-muted">Me bankë ose kesh; pagesën e konfirmon administratori dhe licenca zgjatet vetë.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-card bg-bg p-4 text-[15px]">
          {p.iban ? (
            <>
              <div className="text-sm text-muted">Paguaj në llogarinë</div>
              <div className="font-semibold">{p.account_holder ?? 'Kasa'}</div>
              <div>{p.bank_name}</div>
              <div className="select-all break-all font-mono text-[16px]">{p.iban}</div>
              <div className="mt-2 text-sm text-muted">Përshkrimi: “Kasa – {s.business.name} – NUI {s.business.nui ?? ''}”</div>
            </>
          ) : (
            <div className="text-sm text-muted">Udhëzimet e pagesës do të shfaqen këtu së shpejti.</div>
          )}
          {p.payment_note && <div className="mt-2 text-sm">{p.payment_note}</div>}
        </div>
        <div className="rounded-card bg-bg p-4 text-[15px]">
          {Number(p.monthly_price) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted">Mujore</span> <b>{formatEUR(p.monthly_price)}</b>
            </div>
          )}
          {Number(p.yearly_price) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted">Vjetore</span> <b>{formatEUR(p.yearly_price)}</b>
            </div>
          )}
          {!(Number(p.monthly_price) > 0) && !(Number(p.yearly_price) > 0) && !(price != null && Number(price) > 0) && (
            <div className="text-sm text-muted">Çmimin ta tregon administratori.</div>
          )}
          {price != null && Number(price) > 0 && (
            <div className="mt-2 flex justify-between border-t border-line pt-2">
              <span className="text-muted">Çmimi yt</span> <b>{formatEUR(Number(price))}</b>
            </div>
          )}
          {s.license.expires_on && (
            <div className="mt-2 text-sm text-muted">
              Licenca vlen deri më <b className="text-ink">{day(s.license.expires_on)}</b>
            </div>
          )}
        </div>
      </div>
      {s.payments.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line text-sm">
          {s.payments.map((x, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span>
                {day(x.paid_on)} · {x.method === 'bank' ? 'bankë' : x.method === 'cash' ? 'kesh' : 'tjetër'}
                {x.reference && ` · ${x.reference}`}
              </span>
              <span className="tabular-nums">
                {formatEUR(x.amount)}
                {x.extended_to && <span className="text-muted"> · deri {day(x.extended_to)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RegisterCard({ s, onSaved }: { s: OnboardingState; onSaved: () => void }) {
  const [edit, setEdit] = useState<Partial<RegisterApplication> | null>(null)
  const apps = s.register_applications
  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <MonitorSmartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[19px] font-bold">Apliko për arkë</h2>
            <p className="text-sm text-muted">Për çdo arkë (pajisje) ku do të shitet; pas aprovimit konfigurohet edhe në ATK.</p>
          </div>
        </div>
        <Button onClick={() => setEdit({ device_type: 'windows', printer: 'bluetooth', paper_width: 80, fiscal: true, name: `Arka ${apps.length + 1}` })}>
          <Plus className="h-4 w-4" /> Apliko për arkë
        </Button>
      </div>
      {apps.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line">
          {apps.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-muted">
                  {[a.location, DEVICE_LABELS[a.device_type], PRINTER_LABELS[a.printer], a.printer !== 'none' && `${a.paper_width} mm`, a.fiscal && 'fiskale'].filter(Boolean).join(' · ')}
                </div>
                {a.admin_note && <div className="mt-1 text-sm text-amber-700">{a.admin_note}</div>}
              </div>
              <Badge tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'warn' : 'amber'}>{APP_STATUS[a.status]}</Badge>
              {(a.status === 'pending' || a.status === 'needs_info') && (
                <Button size="sm" variant="secondary" onClick={() => setEdit(a)}>
                  Ndrysho
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RegisterDialog value={edit} onClose={() => setEdit(null)} onSaved={onSaved} />
    </Card>
  )
}

function RegisterDialog({ value, onClose, onSaved }: { value: Partial<RegisterApplication> | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<RegisterApplication>>({})
  useEffect(() => {
    if (value) setF(value)
  }, [value])
  const save = useMutation({
    mutationFn: () => submitRegisterApplication(f),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title="Aplikimi për arkë"
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Dërgo aplikimin
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Emri i arkës" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="p.sh. Arka 1 – banaku" />
        <Input label="Vendi" value={f.location ?? ''} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="p.sh. kati përdhes" />
        <Select
          label="Pajisja"
          value={f.device_type ?? 'windows'}
          onChange={(e) => setF({ ...f, device_type: e.target.value as RegisterApplication['device_type'] })}
          options={(Object.keys(DEVICE_LABELS) as RegisterApplication['device_type'][]).map((k) => ({ value: k, label: DEVICE_LABELS[k] }))}
        />
        <Select
          label="Printeri"
          value={f.printer ?? 'bluetooth'}
          onChange={(e) => setF({ ...f, printer: e.target.value as RegisterApplication['printer'] })}
          options={(Object.keys(PRINTER_LABELS) as RegisterApplication['printer'][]).map((k) => ({ value: k, label: PRINTER_LABELS[k] }))}
        />
        {f.printer !== 'none' && (
          <Select label="Gjerësia e letrës" value={String(f.paper_width ?? 80)} onChange={(e) => setF({ ...f, paper_width: Number(e.target.value) as 58 | 80 })} options={[{ value: '80', label: '80 mm' }, { value: '58', label: '58 mm' }]} />
        )}
        <Input label="Kontakti në vend (emri, telefoni)" value={f.contact ?? ''} onChange={(e) => setF({ ...f, contact: e.target.value })} />
        <div className="sm:col-span-2">
          <Input label="Shënim" value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-[15px] sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.fiscal !== false} onChange={(e) => setF({ ...f, fiscal: e.target.checked })} />
          Arkë fiskale (kuponi dërgohet në ATK)
        </label>
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

function HistoryCard({ s }: { s: OnboardingState }) {
  if (!s.events.length) return null
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Historiku</h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {s.events.map((e, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-[140px] shrink-0 text-muted">{formatKosovoDateTime(e.created_at)}</span>
            <span>
              {EVENT_LABELS[e.action] ?? e.action}
              {e.note && <span className="text-muted"> – {e.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
