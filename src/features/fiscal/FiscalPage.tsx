import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, KeyRound, Monitor, RefreshCw, ShieldCheck } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, Input, Select } from '@/components/ui'
import { formatKosovoDateTime } from '@/lib/clock'
import { device } from '@/lib/device'
import {
  fetchFiscalContext,
  fetchFiscalRegisters,
  fiscalQueueState,
  flushFiscal,
  hoursLeft,
  onFiscalQueueChange,
  registerOnDevice,
  saveFiscalUnit,
  setPosId,
  unregister,
  type FiscalEnv,
  type FiscalQueueState,
  type FiscalRegisterRow,
} from '@/lib/fiscal'

const PLATFORM: Record<string, string> = { web: 'Shfletues', electron: 'Windows', capacitor: 'Android / iPhone' }
const ENV_LABEL: Record<FiscalEnv, string> = { test: 'Test (fiskalizimi-test)', prod: 'Prodhim (ATK)' }

/**
 * /fiskalizimi – the steps of the ATK (SEF) fiscalization, as ATK's portal asks for them:
 *   1. the fiscal unit: NUI, fiscal number (EDI), unit number (Branch ID), environment
 *   2. the POS: a POS ID for every register (the number ATK gives in its portal)
 *   3. registering a register on this device: key → CSR → certificate from ATK
 * plus the registers' state and the coupons this device still has to send.
 */
export function FiscalPage() {
  const { profile } = useBusiness()
  const owner = profile.role === 'admin'
  const qc = useQueryClient()
  const ctx = useQuery({ queryKey: ['fiscal-context'], queryFn: () => fetchFiscalContext(null) })
  const regs = useQuery({ queryKey: ['fiscal-registers'], queryFn: fetchFiscalRegisters, enabled: ctx.data !== null })
  const thisDevice = useQuery({ queryKey: ['this-device-id'], queryFn: () => device.getDeviceId(), staleTime: Infinity })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['fiscal-context'] })
    void qc.invalidateQueries({ queryKey: ['fiscal-registers'] })
  }

  if (ctx.data === null) {
    return (
      <>
        <PageHeader title="Fiskalizimi" />
        <div className="px-4 md:px-8">
          <Card className="p-6">
            <h2 className="text-[17px] font-semibold">Fiskalizimi nuk është aktivizuar ende</h2>
            <p className="mt-1 text-muted">Administratori duhet të ekzekutojë migrimin supabase/migrations/0015_fiscal.sql dhe të vendosë Edge Function "fiscal-relay".</p>
          </Card>
        </div>
      </>
    )
  }

  const c = ctx.data
  const unitDone = Boolean(c?.nui && c?.fiscal_number && c?.branch_id)
  const rows = regs.data ?? []
  const registered = rows.filter((r) => r.status === 'registered')

  return (
    <>
      <PageHeader eyebrow="ATK · Sistemi Elektronik Fiskal (SEF)" title="Fiskalizimi" />
      <div className="flex flex-col gap-4 px-4 pb-10 md:gap-5 md:px-8">
        {c && !c.application_id && (
          <p className="flex items-start gap-2 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Kasa nuk e ka ende Application ID nga ATK për mjedisin {c.env === 'prod' ? 'prodhim' : 'test'}. Hapat 1 dhe 2 mund t'i plotësosh; regjistrimi i arkës hapet kur ta vendosë
            administratori i platformës.
          </p>
        )}

        <Steps unitDone={unitDone} posDone={rows.some((r) => r.pos_id)} registered={registered.length > 0} />

        {c && <UnitCard ctx={c} owner={owner} hasRegistered={registered.length > 0} onSaved={refresh} />}

        <RegistersCard rows={rows} loading={regs.isLoading} owner={owner} unitDone={unitDone} canRegister={Boolean(c?.application_id)} thisDevice={thisDevice.data ?? null} onChanged={refresh} />

        <QueueCard />
      </div>
    </>
  )
}

function Steps({ unitDone, posDone, registered }: { unitDone: boolean; posDone: boolean; registered: boolean }) {
  const steps = [
    { n: 1, title: 'Njësia fiskale', text: 'NUI, numri i fiskalizimit, nr. i njësisë', done: unitDone },
    { n: 2, title: 'POS ID e arkave', text: 'numri që jep ATK për çdo arkë', done: posDone },
    { n: 3, title: 'Arka e regjistruar', text: 'çelësi në pajisje + certifikata e ATK-së', done: registered },
  ]
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {steps.map((s) => (
        <Card key={s.n} className="flex items-center gap-3 p-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${s.done ? 'bg-brand-600 text-white' : 'bg-[#EEF1EE] text-muted'}`}>
            {s.done ? <CheckCircle2 className="h-5 w-5" /> : s.n}
          </div>
          <div className="min-w-0">
            <div className="font-semibold">{s.title}</div>
            <div className="text-sm text-muted">{s.done ? 'E plotësuar' : s.text}</div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function UnitCard({ ctx, owner, hasRegistered, onSaved }: { ctx: NonNullable<Awaited<ReturnType<typeof fetchFiscalContext>>>; owner: boolean; hasRegistered: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({ nui: ctx.nui ?? '', fiscal_number: ctx.fiscal_number ?? '', branch_id: ctx.branch_id ? String(ctx.branch_id) : '', env: ctx.env })
  useEffect(() => setForm({ nui: ctx.nui ?? '', fiscal_number: ctx.fiscal_number ?? '', branch_id: ctx.branch_id ? String(ctx.branch_id) : '', env: ctx.env }), [ctx])
  const save = useMutation({ mutationFn: () => saveFiscalUnit(form), onSuccess: onSaved })
  const dirty = form.nui !== (ctx.nui ?? '') || form.fiscal_number !== (ctx.fiscal_number ?? '') || form.branch_id !== (ctx.branch_id ? String(ctx.branch_id) : '') || form.env !== ctx.env

  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Hapi 1 – Njësia fiskale</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Të dhënat nga aplikimi i njësisë në portalin e ATK-së. Numri i fiskalizimit merret nga EDI. {ctx.unit_saved_at && `Ruajtur më ${formatKosovoDateTime(ctx.unit_saved_at)}.`}
      </p>
      <form
        className="mt-4 grid gap-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Input label="NUI" inputMode="numeric" maxLength={11} value={form.nui} disabled={!owner} onChange={(e) => setForm({ ...form, nui: e.target.value })} />
        <Input label="Numri i fiskalizimit (EDI)" value={form.fiscal_number} disabled={!owner} onChange={(e) => setForm({ ...form, fiscal_number: e.target.value })} />
        <Input label="Nr. i njësisë (Branch ID)" inputMode="numeric" value={form.branch_id} disabled={!owner} onChange={(e) => setForm({ ...form, branch_id: e.target.value.replace(/\D/g, '') })} />
        <Select
          label="Mjedisi"
          value={form.env}
          disabled={!owner}
          onChange={(e) => setForm({ ...form, env: e.target.value as FiscalEnv })}
          options={(['test', 'prod'] as FiscalEnv[]).map((v) => ({ value: v, label: ENV_LABEL[v] }))}
        />
        {owner && (
          <div className="flex flex-wrap items-center gap-3 md:col-span-4">
            <Button type="submit" loading={save.isPending} disabled={!dirty}>
              Ruaj njësinë
            </Button>
            {hasRegistered && <span className="text-sm text-muted">NUI-ja, njësia dhe mjedisi nuk ndryshohen sa ka arka të regjistruara.</span>}
            {save.error && <span className="text-sm text-warn-700">{(save.error as Error).message}</span>}
          </div>
        )}
      </form>
      {!owner && <p className="mt-3 text-sm text-muted">Vetëm pronari i ndryshon këto të dhëna.</p>}
    </Card>
  )
}

function RegistersCard({
  rows,
  loading,
  owner,
  unitDone,
  canRegister,
  thisDevice,
  onChanged,
}: {
  rows: FiscalRegisterRow[]
  loading: boolean
  owner: boolean
  unitDone: boolean
  canRegister: boolean
  thisDevice: string | null
  onChanged: () => void
}) {
  const [posEdit, setPosEdit] = useState<FiscalRegisterRow | null>(null)
  const [registering, setRegistering] = useState<FiscalRegisterRow | null>(null)
  const [removing, setRemoving] = useState<FiscalRegisterRow | null>(null)

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5">
        <h2 className="text-[17px] font-semibold">Hapi 2 dhe 3 – Arkat (POS)</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Çdo arkë ka POS ID-në që ATK e jep në portal dhe çelësin e vet që nuk del kurrë nga pajisja. Regjistrimi bëhet <strong>në pajisjen ku punon arka</strong>.
        </p>
      </div>
      {loading ? (
        <p className="px-5 py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-muted">Nuk ka arka. Shtoji te Cilësimet → Arkat.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {rows.map((r) => {
            const here = r.device_id && r.device_id === thisDevice
            const left = hoursLeft(r.oldest_pending)
            return (
              <li key={r.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-sm text-muted">POS ID: {r.pos_id ?? '—'}</span>
                    {r.status === 'registered' ? <Badge tone="success">E regjistruar</Badge> : <Badge>Pa regjistruar</Badge>}
                    {r.status === 'registered' && r.env === 'test' && <Badge tone="info">Test</Badge>}
                    {here && <Badge tone="info">Kjo pajisje</Badge>}
                    {r.failed > 0 && <Badge tone="warn">{r.failed} të refuzuar</Badge>}
                    {r.pending > 0 && <Badge tone={left !== null && left < 12 ? 'warn' : 'amber'}>{r.pending} pa u dërguar</Badge>}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {r.status === 'registered'
                      ? [
                          r.platform && (PLATFORM[r.platform] ?? r.platform),
                          r.registered_at && `regjistruar ${formatKosovoDateTime(r.registered_at)}`,
                          `${r.sent} kuponë të dërguar`,
                          r.last_sent_at && `i fundit ${formatKosovoDateTime(r.last_sent_at)}`,
                          r.app_version && `versioni ${r.app_version}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : r.pos_id
                        ? 'Gati për regjistrim në pajisjen e arkës'
                        : 'Vendos POS ID-në nga portali i ATK-së'}
                    {left !== null && r.pending > 0 && ` · afati 48 orë: ${left > 0 ? `edhe ${Math.floor(left)} orë` : 'ka kaluar'}`}
                  </div>
                </div>
                {owner && (
                  <div className="flex flex-wrap gap-2">
                    {r.status !== 'registered' && (
                      <Button size="sm" variant="secondary" onClick={() => setPosEdit(r)}>
                        POS ID
                      </Button>
                    )}
                    {r.status !== 'registered' && (
                      <Button size="sm" disabled={!unitDone || !r.pos_id || !canRegister} onClick={() => setRegistering(r)}>
                        <KeyRound className="h-4 w-4" /> Regjistro këtë pajisje
                      </Button>
                    )}
                    {r.status === 'registered' && (
                      <Button size="sm" variant="danger" onClick={() => setRemoving(r)}>
                        Çregjistro
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!owner && <p className="border-t border-line px-5 py-3 text-sm text-muted">Vetëm pronari i regjistron dhe i çregjistron arkat.</p>}

      <PosIdDialog reg={posEdit} onClose={() => setPosEdit(null)} onSaved={onChanged} />
      <RegisterDialog reg={registering} onClose={() => setRegistering(null)} onDone={onChanged} />
      <UnregisterDialog reg={removing} onClose={() => setRemoving(null)} onDone={onChanged} />
    </Card>
  )
}

function PosIdDialog({ reg, onClose, onSaved }: { reg: FiscalRegisterRow | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('')
  useEffect(() => setValue(reg?.pos_id ?? ''), [reg])
  const save = useMutation({
    mutationFn: () => setPosId(reg!.id, value),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(reg)}
      onClose={onClose}
      title={`POS ID – ${reg?.name ?? ''}`}
      width="md:max-w-[420px]"
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
      <Input label="POS ID nga portali i ATK-së" inputMode="numeric" maxLength={4} value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} error={save.error ? (save.error as Error).message : null} />
      <p className="mt-2 text-sm text-muted">Numri që ATK ia jep kësaj arke kur aplikon për POS (Hapi 2 në portal). ATK e refuzon një POS ID që nuk e njeh.</p>
    </Dialog>
  )
}

function RegisterDialog({ reg, onClose, onDone }: { reg: FiscalRegisterRow | null; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () => registerOnDevice(reg!.id, setStep),
    onSuccess: () => {
      setStep(null)
      onDone()
    },
    onError: () => setStep(null),
  })
  useEffect(() => {
    if (!reg) run.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg])
  const done = run.isSuccess
  return (
    <Dialog
      open={Boolean(reg)}
      onClose={() => !run.isPending && onClose()}
      title={`Regjistro ${reg?.name ?? ''} në ATK`}
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          {done ? (
            <Button onClick={onClose}>Mbyll</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={run.isPending} onClick={onClose}>
                Anulo
              </Button>
              <Button loading={run.isPending} onClick={() => run.mutate()}>
                <ShieldCheck className="h-4 w-4" /> Regjistro
              </Button>
            </>
          )}
        </div>
      }
    >
      {done ? (
        <p className="flex items-start gap-2 rounded-ctl bg-brand-100 px-4 py-3 text-brand-600">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> Arka u regjistrua. Nga tani çdo shitje në këtë pajisje nënshkruhet dhe dërgohet në ATK para printimit.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-[15px]">
          <p className="flex items-start gap-2">
            <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
            Bëje këtë <strong>në pajisjen ku do të punojë arka</strong> ({PLATFORM[device.platform] ?? device.platform}). Çelësi krijohet këtu dhe nuk mund të kopjohet.
          </p>
          <p className="text-sm text-muted">
            Nëse të dhënat e shfletuesit fshihen ose pajisja ndërrohet, arka duhet çregjistruar dhe regjistruar përsëri. Për arkë të përhershme përdor programin për Windows ose aplikacionin.
          </p>
          {step && <p className="rounded-ctl bg-[#F2F5F2] px-4 py-2.5 text-sm">{step}</p>}
          {run.error && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{(run.error as Error).message}</p>}
        </div>
      )}
    </Dialog>
  )
}

function UnregisterDialog({ reg, onClose, onDone }: { reg: FiscalRegisterRow | null; onClose: () => void; onDone: () => void }) {
  const run = useMutation({
    mutationFn: () => unregister(reg!.id),
    onSuccess: () => {
      onDone()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(reg)}
      onClose={onClose}
      title="Të çregjistrohet arka?"
      width="md:max-w-[460px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button variant="danger" loading={run.isPending} onClick={() => run.mutate()}>
            Çregjistro
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-[15px]">
        <p>
          <strong>{reg?.name}</strong> nuk do të lëshojë më kuponë fiskalë derisa të regjistrohet përsëri. Numërimi i kuponëve vazhdon nga aty ku mbeti.
        </p>
        {(reg?.pending ?? 0) > 0 && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">Kjo arkë ka {reg?.pending} kuponë pa u dërguar në ATK. Dërgoji para se ta çregjistrosh.</p>}
        <p className="text-sm text-muted">Ndryshimin (pajisje e re, arkë e mbyllur) njoftoje edhe në portalin e ATK-së.</p>
        {run.error && <p className="text-sm text-warn-700">{(run.error as Error).message}</p>}
      </div>
    </Dialog>
  )
}

function QueueCard() {
  const [state, setState] = useState<FiscalQueueState | null>(null)
  const load = () => void fiscalQueueState().then(setState)
  useEffect(() => {
    load()
    return onFiscalQueueChange(load)
  }, [])
  const flush = useMutation({ mutationFn: flushFiscal, onSettled: load })
  if (!state || (state.waiting === 0 && state.failed === 0)) return null
  const left = hoursLeft(state.oldest)
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Kuponët në këtë pajisje</h2>
      <p className="mt-1 text-sm text-muted">
        {state.waiting} pa u dërguar{state.failed > 0 && `, ${state.failed} të refuzuar nga ATK`}.
        {left !== null && ` Afati i ATK-së (48 orë): ${left > 0 ? `edhe ${Math.floor(left)} orë` : 'ka kaluar – njofto ATK-në'}.`}
      </p>
      <Button className="mt-3" variant="secondary" loading={flush.isPending} onClick={() => flush.mutate()}>
        <RefreshCw className="h-4 w-4" /> Dërgo tani
      </Button>
    </Card>
  )
}
