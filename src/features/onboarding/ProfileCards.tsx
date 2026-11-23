import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, FileCheck2, Plus, Receipt, Upload, X } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { Badge, Button, Card, Dialog, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { COUNTRIES } from '@/lib/taxProfile'
import { ActivityPicker, CityInput } from './ApplicationForm'
import { DOC_ACCEPT, docProblem, fetchActivities, fetchOwnerApplication } from './applicationApi'
import { addUnit, cancelVatRequest, fetchVatRequests, sendVatRequest, withdrawUnit, type NewUnit } from './profileRequests'
import type { OnboardingState } from './api'

const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')
const UNIT_BADGE = {
  approved: { tone: 'success', label: 'Aktive' },
  pending: { tone: 'amber', label: 'Pret miratim' },
  rejected: { tone: 'warn', label: 'Refuzuar' },
} as const

function CardHead({ icon, title, text, right }: { icon: React.ReactNode; title: string; text: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">{icon}</div>
        <div>
          <h2 className="text-[19px] font-semibold tracking-[-0.015em]">{title}</h2>
          <p className="text-sm text-muted">{text}</p>
        </div>
      </div>
      {right}
    </div>
  )
}

// ---------------------------------------------------------------------------
// "Shto njësi": the units of the business and a new one for a new point of sale
// ---------------------------------------------------------------------------
export function UnitsCard({ s }: { s: OnboardingState }) {
  const qc = useQueryClient()
  const app = useQuery({ queryKey: ['owner-application'], queryFn: fetchOwnerApplication })
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const withdraw = useMutation({
    mutationFn: withdrawUnit,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner-application'] }),
  })
  const units = app.data?.units ?? []

  return (
    <Card className="p-5 md:p-6">
      <CardHead
        icon={<Building2 className="h-5 w-5" />}
        title="Njësitë e biznesit"
        text="Çdo pikë ku shitet (dyqan, lokal, depo) është një njësi me adresën dhe arkat e veta. Kur hap një pikë tjetër, shtoje këtu."
        right={
          <Button className="shrink-0" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Shto njësi
          </Button>
        }
      />
      {app.isLoading ? (
        <p className="py-4 text-sm text-muted">Duke ngarkuar…</p>
      ) : app.error ? (
        <p className="text-sm text-warn-700">{(app.error as Error).message}</p>
      ) : units.length === 0 ? (
        <p className="rounded-ctl bg-bg px-4 py-3 text-sm text-muted">
          {s.business.name}
          {s.business.address ? ` · ${[s.business.address, s.business.city].filter(Boolean).join(', ')}` : ''} – njësia kryesore. Kur shton njësinë e dytë, kjo pikë mbetet njësia kryesore me arkat e saj.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-ctl border border-line">
          {units.map((u) => {
            const badge = UNIT_BADGE[u.status] ?? UNIT_BADGE.pending
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {u.name}
                    {u.unit_no ? <span className="font-normal text-muted"> · nr. {u.unit_no}</span> : null}
                  </div>
                  <div className="text-sm text-muted">
                    {[u.address, u.city, u.country !== 'Kosovë' ? u.country : null].filter(Boolean).join(', ')} · {u.registers} {u.registers === 1 ? 'arkë' : 'arka'}
                    {u.activities.length ? ` · ${u.activities.join(', ')}` : ''}
                  </div>
                </div>
                <Badge tone={badge.tone}>{badge.label}</Badge>
                {u.status === 'pending' && !app.data?.open && (
                  <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === u.id} onClick={() => withdraw.mutate(u.id)}>
                    <X className="h-4 w-4" /> Tërhiq
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {withdraw.error && <p className="mt-2 text-sm text-warn-700">{(withdraw.error as Error).message}</p>}
      {msg && <p className="mt-3 rounded-ctl bg-brand-100 px-4 py-3 text-sm text-brand-600">{msg}</p>}
      <UnitDialog
        open={adding}
        country="Kosovë"
        onClose={() => setAdding(false)}
        onSaved={(name) => {
          setAdding(false)
          setMsg(`"${name}" u dërgua për miratim. Pas miratimit krijohen arkat e saj; çelësat e tyre dalin te "Arkat dhe çelësat", dhe Branch ID-në e njësisë e vendos te Fiskalizimi.`)
          void qc.invalidateQueries({ queryKey: ['owner-application'] })
          void qc.invalidateQueries({ queryKey: ['onboarding'] })
        }}
      />
    </Card>
  )
}

const emptyUnit = (country: string): NewUnit => ({ name: '', unit_no: '', country, city: '', address: '', activities: [], registers: 1 })

function UnitDialog({ open, country, onClose, onSaved }: { open: boolean; country: string; onClose: () => void; onSaved: (name: string) => void }) {
  const activities = useQuery({ queryKey: ['activities'], queryFn: fetchActivities, enabled: open, staleTime: 10 * 60_000 })
  const [u, setU] = useState<NewUnit>(() => emptyUnit(country))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (p: Partial<NewUnit>) => setU((x) => ({ ...x, ...p }))
  const save = useMutation({
    mutationFn: () => addUnit(u),
    onSuccess: () => {
      onSaved(u.name.trim())
      setU(emptyUnit(country))
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (!u.name.trim()) err.name = 'Shkruaj emrin e njësisë'
    if (!u.city.trim()) err.city = 'Shkruaj qytetin'
    if (!u.address.trim()) err.address = 'Shkruaj adresën'
    if (!u.activities.length) err.activities = 'Zgjidh të paktën një veprimtari'
    setErrors(err)
    if (Object.keys(err).length === 0) save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (save.isPending) return
        setU(emptyUnit(country))
        setErrors({})
        save.reset()
        onClose()
      }}
      title="Shto njësi"
      subtitle="Njësia e re pret miratimin e administratorit."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            Anulo
          </Button>
          <Button type="submit" form="new-unit" loading={save.isPending}>
            Dërgo për miratim
          </Button>
        </div>
      }
    >
      <form id="new-unit" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Input label="Emri i njësisë" value={u.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} placeholder="p.sh. Dyqani te Qendra" autoFocus />
        <Input label="Numri i njësisë (opsional)" value={u.unit_no} onChange={(e) => set({ unit_no: e.target.value })} hint="Si në ATK, nëse e ke" />
        <Select label="Shteti" value={u.country} onChange={(e) => set({ country: e.target.value })} options={COUNTRIES.map((x) => ({ value: x, label: x }))} />
        <CityInput id="new-unit" label="Qyteti" value={u.city} onChange={(v) => set({ city: v })} error={errors.city} country={u.country} />
        <div className="md:col-span-2">
          <Input label="Adresa e njësisë" value={u.address} onChange={(e) => set({ address: e.target.value })} error={errors.address} />
        </div>
        <div className="md:col-span-2">
          {activities.isLoading ? (
            <p className="text-sm text-muted">Duke ngarkuar veprimtaritë…</p>
          ) : (
            <ActivityPicker all={activities.data ?? []} value={u.activities} onChange={(v) => set({ activities: v })} error={errors.activities} />
          )}
        </div>
        <Select
          label="Arka në këtë njësi"
          value={String(u.registers)}
          onChange={(e) => set({ registers: Number(e.target.value) })}
          options={[1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: String(n) }))}
        />
        {save.error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700 md:col-span-2">{(save.error as Error).message}</p>}
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// "Kërko kalimin në TVSH": the document of the VAT registration → the admin approves → "Me TVSH"
// ---------------------------------------------------------------------------
export function VatCard({ s }: { s: OnboardingState }) {
  const qc = useQueryClient()
  const { refresh } = useAuth()
  const b = s.business
  const requests = useQuery({ queryKey: ['vat-requests', b.id], queryFn: () => fetchVatRequests(b.id), refetchInterval: 60_000 })
  const [open, setOpen] = useState(false)
  const last = requests.data?.[0]
  const pending = last?.status === 'pending' ? last : null
  const inVat = Boolean(b.vat_number?.trim())
  const cancel = useMutation({
    mutationFn: cancelVatRequest,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vat-requests', b.id] }),
  })

  return (
    <Card className="p-5 md:p-6">
      <CardHead
        icon={<Receipt className="h-5 w-5" />}
        title="TVSH-ja"
        text={inVat ? 'Biznesi është në TVSH: kuponët dalin me normat e TVSH-së (18%, 8%, 0%).' : 'Biznesi është regjistruar pa TVSH: çdo shitje del si "A – e liruar".'}
        right={<Badge tone={inVat ? 'success' : 'neutral'}>{inVat ? 'Me TVSH' : 'Pa TVSH'}</Badge>}
      />
      {inVat ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Nr. i TVSH-së: <b className="tabular-nums">{b.vat_number}</b>
            {last?.status === 'approved' ? ` · nga ${day(last.vat_date)} · miratuar më ${day(last.decided_at)}` : ''}
          </p>
          {last?.status === 'approved' && (
            <p className="rounded-ctl bg-amber-100 px-4 py-3 text-amber-700">
              Kontrollo normat e TVSH-së te{' '}
              <Link to="/produktet" className="font-semibold underline">
                Produktet
              </Link>
              : produktet e shtuara pa TVSH kanë normën "A – e liruar" dhe duhet t'u vendoset norma e saktë (zakonisht 18%).
            </p>
          )}
          <p className="text-muted">Për ndryshim të numrit të TVSH-së kontakto administratorin e KontoSef.</p>
        </div>
      ) : pending ? (
        <div className="flex flex-col gap-3 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <b>Kërkesa pret miratim</b> – Nr. TVSH {pending.vat_number}, nga {day(pending.vat_date)}, dërguar më {day(pending.created_at)}. Statusi kalon në "Me TVSH" pasi
            administratori ta verifikojë dokumentin.
          </div>
          <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(pending.id)}>
            Tërhiq kërkesën
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {last?.status === 'rejected' && (
            <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">
              Kërkesa e {day(last.created_at)} u refuzua{last.note ? `: ${last.note}` : ''}. Mund të dërgosh një kërkesë të re me dokumentin e saktë.
            </p>
          )}
          <p className="text-sm text-muted">
            Nëse biznesi është regjistruar në TVSH, ngarko certifikatën / vendimin e ATK-së për regjistrimin në TVSH. Biznesi mbetet "Pa TVSH" derisa administratori ta verifikojë dokumentin dhe ta miratojë kërkesën.
          </p>
          <div>
            <Button onClick={() => setOpen(true)}>
              <FileCheck2 className="h-4 w-4" /> Kërko kalimin në TVSH
            </Button>
          </div>
        </div>
      )}
      {(cancel.error || requests.error) && <p className="mt-2 text-sm text-warn-700">{((cancel.error ?? requests.error) as Error).message}</p>}
      <VatDialog
        open={open}
        businessId={b.id}
        onClose={() => setOpen(false)}
        onSent={() => {
          setOpen(false)
          void qc.invalidateQueries({ queryKey: ['vat-requests', b.id] })
          void qc.invalidateQueries({ queryKey: ['onboarding'] })
          refresh()
        }}
      />
    </Card>
  )
}

function VatDialog({ open, businessId, onClose, onSent }: { open: boolean; businessId: string; onClose: () => void; onSent: () => void }) {
  const [vat, setVat] = useState('')
  const [date, setDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({ mutationFn: () => sendVatRequest(businessId, { vat_number: vat, vat_date: date, file: file! }), onSuccess: onSent, onError: (e) => setError((e as Error).message) })
  const today = kosovoDateISO()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (vat.replace(/\s/g, '').length < 6) return setError('Shkruaj numrin e TVSH-së')
    if (!date || date > today) return setError('Shkruaj datën e regjistrimit në TVSH')
    if (!file) return setError('Ngarko dokumentin e regjistrimit në TVSH')
    setError(null)
    send.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={() => !send.isPending && onClose()}
      title="Kërko kalimin në TVSH"
      width="md:max-w-[520px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={send.isPending} onClick={onClose}>
            Anulo
          </Button>
          <Button type="submit" form="vat-request" loading={send.isPending}>
            Dërgo kërkesën
          </Button>
        </div>
      }
    >
      <form id="vat-request" onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nr. i TVSH-së" value={vat} onChange={(e) => setVat(e.target.value)} placeholder="330123456" inputMode="numeric" autoFocus />
          <Input label="Data e regjistrimit në TVSH" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-[#344054]">Dokumenti i regjistrimit në TVSH</span>
          <label className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-ctl border border-dashed border-field px-4 py-3 hover:bg-bg">
            <Upload className="h-5 w-5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-sm">{file ? file.name : 'Zgjidh skedarin (PDF, PNG, JPG ose WebP, deri në 10 MB)'}</span>
            <input
              type="file"
              accept={DOC_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                e.target.value = ''
                if (!f) return
                const problem = docProblem(f)
                setError(problem)
                setFile(problem ? null : f)
              }}
            />
          </label>
        </div>
        <p className="text-sm text-muted">Kërkesa i shkon administratorit të KontoSef. Statusi kalon nga "Pa TVSH" në "Me TVSH" vetëm pasi ai ta verifikojë dokumentin.</p>
        {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
      </form>
    </Dialog>
  )
}
