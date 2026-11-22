import { useMemo, useState, type ReactNode } from 'react'
import { Check, Eye, FileText, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { Button, Input, Select } from '@/components/ui'
import { REGISTRATION_TYPES, type BusinessType } from '@/lib/business'
import { cn } from '@/lib/cn'
import { COUNTRIES, KOSOVO_CITIES, LEGAL_FORMS, TAX_CATEGORIES, TAX_CENTERS, legalFormLabel, taxCategoryLabel, type LegalForm } from '@/lib/taxProfile'
import { DOC_ACCEPT, docProblem, type Activity, type TaxInput, type UnitInput } from './applicationApi'

// ---------------------------------------------------------------------------
// The data of the form
// ---------------------------------------------------------------------------
export interface CompanyData {
  name: string
  nui: string
  address: string
  country: string
  city: string
  owner_name: string
  phone: string
  email: string
  type: BusinessType
}

export interface ApplicationData {
  company: CompanyData
  tax: TaxInput
  units: UnitInput[]
  partner_code: string
}

export const emptyUnit = (c?: Partial<CompanyData>): UnitInput => ({
  name: '',
  unit_no: '',
  country: c?.country || 'Kosovë',
  city: c?.city ?? '',
  address: c?.address ?? '',
  activities: [],
  registers: 1,
})

export const EMPTY_APPLICATION: ApplicationData = {
  company: { name: '', nui: '', address: '', country: 'Kosovë', city: '', owner_name: '', phone: '', email: '', type: 'market' },
  tax: { legal_form: '', tax_category: '', real_income: false, vat_registered: null, vat_number: '', vat_date: '', tax_center: '' },
  units: [emptyUnit()],
  partner_code: '',
}

export type Errors = Record<string, string>
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Errors of one step (1 company, 2 taxes, 3 units); the keys are the fields. */
export function validateStep(step: number, d: ApplicationData, opts: { account: boolean }): Errors {
  const e: Errors = {}
  const c = d.company
  if (step === 1) {
    if (!c.name.trim()) e.name = 'Shkruaj emrin e kompanisë'
    if (!/^\d{9}$/.test(c.nui)) e.nui = 'NUI ka 9 shifra'
    if (!c.address.trim()) e.address = 'Shkruaj adresën'
    if (!c.country) e.country = 'Zgjidh shtetin'
    if (!c.city.trim()) e.city = 'Shkruaj qytetin'
    if (opts.account) {
      if (!c.owner_name.trim()) e.owner_name = 'Shkruaj emrin dhe mbiemrin'
      if (c.phone.replace(/\D/g, '').length < 8) e.phone = 'Shkruaj numrin e telefonit'
      if (!EMAIL_RE.test(c.email.trim())) e.email = 'Email-i nuk është i saktë'
    }
  }
  if (step === 2) {
    const t = d.tax
    if (!t.legal_form) e.legal_form = 'Zgjidh formën juridike'
    if (!t.tax_category) e.tax_category = 'Zgjidh kategorinë tatimore'
    if (t.vat_registered === null) e.vat_registered = 'Zgjidh statusin e TVSH-së'
    if (t.vat_registered) {
      if (!t.vat_number.trim()) e.vat_number = 'Shkruaj numrin e TVSH-së'
      if (!t.vat_date) e.vat_date = 'Zgjidh datën e regjistrimit'
    }
  }
  if (step === 3) {
    if (!d.units.length) e.units = 'Shto të paktën një njësi'
    d.units.forEach((u, i) => {
      if (!u.name.trim()) e[`u${i}.name`] = 'Shkruaj emrin e njësisë'
      if (!u.country) e[`u${i}.country`] = 'Zgjidh shtetin'
      if (!u.city.trim()) e[`u${i}.city`] = 'Shkruaj qytetin'
      if (!u.address.trim()) e[`u${i}.address`] = 'Shkruaj adresën'
      if (!u.activities.length) e[`u${i}.activities`] = 'Zgjidh të paktën një veprimtari'
    })
  }
  return e
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------
export function Section({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

const req = (s: string) => (
  <>
    {s} <span className="text-warn-700">*</span>
  </>
)

function CityInput({ id, label, value, onChange, error, country }: { id: string; label: ReactNode; value: string; onChange: (v: string) => void; error?: string; country: string }) {
  return (
    <>
      <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error} list={country === 'Kosovë' ? `${id}-cities` : undefined} autoComplete="address-level2" />
      {country === 'Kosovë' && (
        <datalist id={`${id}-cities`}>
          {KOSOVO_CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 1 – company
// ---------------------------------------------------------------------------
export function CompanyStep({
  d,
  setCompany,
  setTax,
  errors,
  account,
  nuiState,
  onNuiBlur,
}: {
  d: ApplicationData
  setCompany: (p: Partial<CompanyData>) => void
  setTax: (p: Partial<TaxInput>) => void
  errors: Errors
  account: boolean
  nuiState?: 'checking' | 'taken' | 'free' | null
  onNuiBlur?: () => void
}) {
  const c = d.company
  return (
    <div className="flex flex-col gap-6">
      <Section title="Informacionet e kompanisë">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input label={req('Emri i kompanisë')} value={c.name} onChange={(e) => setCompany({ name: e.target.value })} error={errors.name} autoComplete="organization" />
          </div>
          <Input
            label={req('Numri unik i biznesit (NUI)')}
            inputMode="numeric"
            maxLength={9}
            value={c.nui}
            onChange={(e) => setCompany({ nui: e.target.value.replace(/\D/g, '') })}
            onBlur={onNuiBlur}
            error={errors.nui ?? (nuiState === 'taken' ? 'Ky NUI është regjistruar tashmë' : undefined)}
            hint={nuiState === 'checking' ? 'Duke kontrolluar…' : nuiState === 'free' ? 'NUI është i lirë' : '9 shifra, si në certifikatën e ARBK-së'}
            className="num"
          />
          <Select
            label="Qendra tatimore"
            value={d.tax.tax_center}
            onChange={(e) => setTax({ tax_center: e.target.value })}
            options={[{ value: '', label: 'Zgjidh (opsionale)' }, ...TAX_CENTERS.map((t) => ({ value: t, label: t }))]}
          />
          <div className="md:col-span-2">
            <Input label={req('Adresa e kompanisë')} value={c.address} onChange={(e) => setCompany({ address: e.target.value })} error={errors.address} autoComplete="street-address" />
          </div>
          <Select label={req('Shteti')} value={c.country} onChange={(e) => setCompany({ country: e.target.value })} options={COUNTRIES.map((x) => ({ value: x, label: x }))} />
          <CityInput id="company" label={req('Qyteti')} value={c.city} onChange={(v) => setCompany({ city: v })} error={errors.city} country={c.country} />
        </div>
      </Section>

      {account && (
        <Section title="Veprimtaria e lokalit" hint="Sipas punës kryesore të lokalit. Nuk ndryshohet pas regjistrimit.">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {REGISTRATION_TYPES.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => setCompany({ type: t.code as BusinessType })}
                aria-pressed={c.type === t.code}
                className={cn(
                  'flex min-h-[64px] flex-col items-start justify-center rounded-ctl border px-3 py-2 text-left transition-colors',
                  c.type === t.code ? 'border-brand-600 bg-brand-100/60 text-ink' : 'border-line text-muted hover:border-field',
                )}
              >
                <span className="text-sm font-semibold text-ink">{t.label}</span>
                <span className="text-[12px] leading-tight">{t.description}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {account && (
        <Section title="Kontakti">
          <div className="grid gap-4 md:grid-cols-2">
            <Input label={req('Emri dhe mbiemri i pronarit')} value={c.owner_name} onChange={(e) => setCompany({ owner_name: e.target.value })} error={errors.owner_name} autoComplete="name" />
            <Input label={req('Telefoni')} type="tel" value={c.phone} onChange={(e) => setCompany({ phone: e.target.value })} error={errors.phone} autoComplete="tel" />
            <div className="md:col-span-2">
              <Input label={req('Email')} type="email" value={c.email} onChange={(e) => setCompany({ email: e.target.value })} error={errors.email} autoComplete="email" hint="Me këtë email hyn në KontoSef." />
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 – taxes
// ---------------------------------------------------------------------------
function Choice({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn('flex items-start gap-3 rounded-ctl border px-4 py-3 text-left transition-colors', on ? 'border-brand-600 bg-brand-100/60' : 'border-line hover:border-field')}
    >
      <span className={cn('mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border', on ? 'border-brand-600 bg-brand-600' : 'border-field bg-white')}>
        {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-[14px] font-semibold text-ink">{title}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-muted">{hint}</span>}
      </span>
    </button>
  )
}

export function TaxStep({ d, setTax, errors }: { d: ApplicationData; setTax: (p: Partial<TaxInput>) => void; errors: Errors }) {
  const t = d.tax
  const cats = t.legal_form ? TAX_CATEGORIES[t.legal_form] : []
  const cat = cats.find((c) => c.value === t.tax_category)
  return (
    <div className="flex flex-col gap-6">
      <Section title="Forma juridike">
        <div className="grid gap-2 md:grid-cols-2">
          {LEGAL_FORMS.map((f) => (
            <Choice
              key={f.value}
              on={t.legal_form === f.value}
              title={`${f.label} (${f.short})`}
              onClick={() => {
                const keep = TAX_CATEGORIES[f.value].some((c) => c.value === t.tax_category)
                setTax({ legal_form: f.value as LegalForm, tax_category: keep ? t.tax_category : '', real_income: keep ? t.real_income : false })
              }}
            />
          ))}
        </div>
        {errors.legal_form && <p className="mt-2 text-[13px] text-warn-700">{errors.legal_form}</p>}
      </Section>

      <Section title="Kategoria tatimore" hint={t.legal_form ? `Sipas formës juridike: ${legalFormLabel(t.legal_form)}` : 'Zgjidh fillimisht formën juridike'}>
        {cats.length > 0 && (
          <div className="grid gap-2">
            {cats.map((c) => (
              <Choice key={c.value} on={t.tax_category === c.value} title={c.label} hint={c.hint} onClick={() => setTax({ tax_category: c.value, real_income: c.realOption ? t.real_income : false })} />
            ))}
          </div>
        )}
        {cat?.realOption && (
          <label className="mt-3 flex items-start gap-3 rounded-ctl bg-bg px-4 py-3 text-[14px]">
            <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] accent-brand-600" checked={t.real_income} onChange={(e) => setTax({ real_income: e.target.checked })} />
            <span>
              <b className="font-semibold">Zgjedh vullnetarisht tatimin në të ardhura reale</b>
              <span className="block text-[13px] text-muted">Mban libra të plotë kontabël dhe tatohet në fitim, jo në qarkullim.</span>
            </span>
          </label>
        )}
        {errors.tax_category && <p className="mt-2 text-[13px] text-warn-700">{errors.tax_category}</p>}
      </Section>

      <Section title="Statusi i TVSH-së">
        <div className="grid gap-2 md:grid-cols-2">
          <Choice on={t.vat_registered === true} title="Po – i regjistruar në TVSH" onClick={() => setTax({ vat_registered: true })} />
          <Choice on={t.vat_registered === false} title="Jo – nuk është i regjistruar në TVSH" onClick={() => setTax({ vat_registered: false, vat_number: '', vat_date: '' })} />
        </div>
        {errors.vat_registered && <p className="mt-2 text-[13px] text-warn-700">{errors.vat_registered}</p>}
        {t.vat_registered && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Input label={req('Numri i TVSH-së')} value={t.vat_number} onChange={(e) => setTax({ vat_number: e.target.value })} error={errors.vat_number} className="num" />
            <Input label={req('Data e regjistrimit në TVSH')} type="date" value={t.vat_date} onChange={(e) => setTax({ vat_date: e.target.value })} error={errors.vat_date} />
          </div>
        )}
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 – units
// ---------------------------------------------------------------------------
function ActivityPicker({ all, value, onChange, error }: { all: Activity[]; value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter((a) => (a.active || value.includes(a.name)) && (!s || a.name.toLowerCase().includes(s)))
  }, [all, q, value])
  const toggle = (n: string) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n])
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-[#344054]">{req('Veprimtaritë e njësisë')}</span>
        {all.length > 8 && (
          <div className="relative w-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko" className="h-9 w-full rounded-ctl border border-field pl-8 pr-2 text-[14px] focus:border-brand-600 focus:outline-none" />
          </div>
        )}
      </div>
      <div className={cn('grid grid-cols-1 gap-x-4 gap-y-1 rounded-ctl border p-3 sm:grid-cols-2 lg:grid-cols-3', error ? 'border-warn-700' : 'border-line')}>
        {list.map((a) => (
          <label key={a.id} className="flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-[14px] hover:bg-bg">
            <input type="checkbox" className="h-[18px] w-[18px] accent-brand-600" checked={value.includes(a.name)} onChange={() => toggle(a.name)} />
            {a.name}
          </label>
        ))}
        {list.length === 0 && <p className="px-1.5 py-1 text-sm text-muted">Asnjë veprimtari me këtë emër.</p>}
      </div>
      {error && <p className="mt-1.5 text-[13px] text-warn-700">{error}</p>}
    </div>
  )
}

const UNIT_STATUS: Record<string, { label: string; cls: string }> = {
  approved: { label: 'Aprovuar', cls: 'bg-ok-100 text-ok-700' },
  rejected: { label: 'Refuzuar', cls: 'bg-warn-100 text-warn-700' },
}

export function UnitsStep({ d, setUnits, activities, errors }: { d: ApplicationData; setUnits: (u: UnitInput[]) => void; activities: Activity[]; errors: Errors }) {
  const set = (i: number, p: Partial<UnitInput>) => setUnits(d.units.map((u, k) => (k === i ? { ...u, ...p } : u)))
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Çdo vend ku shitet ose punohet (dyqan, lokal, depo) është një njësi. Fillo me njësinë kryesore.</p>
      {d.units.map((u, i) => (
        <div key={i} className="rounded-card border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-5">
            <div className="flex items-center gap-2.5">
              <span className="num flex h-6 w-6 items-center justify-center rounded-full bg-bg text-xs font-semibold text-muted">{i + 1}</span>
              <span className="font-semibold">{u.name.trim() || `Njësia ${i + 1}`}</span>
              {u.status && UNIT_STATUS[u.status] && <span className={cn('rounded-md px-2 py-0.5 text-[12px] font-medium', UNIT_STATUS[u.status].cls)}>{UNIT_STATUS[u.status].label}</span>}
            </div>
            {d.units.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setUnits(d.units.filter((_, k) => k !== i))} aria-label={`Hiq njësinë ${i + 1}`}>
                <Trash2 className="h-4 w-4" /> Hiq
              </Button>
            )}
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2 md:p-5">
            <Input label={req('Emri i njësisë')} value={u.name} onChange={(e) => set(i, { name: e.target.value })} error={errors[`u${i}.name`]} placeholder="p.sh. Dyqani qendror" />
            <Input label="Numri i njësisë" value={u.unit_no} onChange={(e) => set(i, { unit_no: e.target.value })} hint="Si në ATK, nëse e ke" className="num" />
            <Select label={req('Shteti')} value={u.country} onChange={(e) => set(i, { country: e.target.value })} options={COUNTRIES.map((x) => ({ value: x, label: x }))} />
            <CityInput id={`unit${i}`} label={req('Qyteti')} value={u.city} onChange={(v) => set(i, { city: v })} error={errors[`u${i}.city`]} country={u.country} />
            <div className="md:col-span-2">
              <Input label={req('Adresa e njësisë')} value={u.address} onChange={(e) => set(i, { address: e.target.value })} error={errors[`u${i}.address`]} />
            </div>
            <div className="md:col-span-2">
              <ActivityPicker all={activities} value={u.activities} onChange={(v) => set(i, { activities: v })} error={errors[`u${i}.activities`]} />
            </div>
            <Select
              label="Arka në këtë njësi"
              value={String(u.registers)}
              onChange={(e) => set(i, { registers: Number(e.target.value) })}
              options={[1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
        </div>
      ))}
      {errors.units && <p className="text-[13px] text-warn-700">{errors.units}</p>}
      <div>
        <Button variant="secondary" onClick={() => setUnits([...d.units, emptyUnit(d.company)])} disabled={d.units.length >= 50}>
          <Plus className="h-4 w-4" /> Shto njësi
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 – documents (files kept in the browser until the application is sent, or already on the server)
// ---------------------------------------------------------------------------
export interface DocItem {
  key: string
  name: string
  size: number | null
  open: () => void | Promise<void>
  remove: () => void | Promise<void>
}

const kb = (n: number | null) => (n == null ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function FileButton({ label, icon, multiple, onFiles, variant = 'secondary', disabled }: { label: string; icon: ReactNode; multiple?: boolean; onFiles: (f: File[]) => void; variant?: 'primary' | 'secondary'; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex min-h-btn cursor-pointer items-center gap-2 rounded-ctl px-4 text-[14px] font-semibold', variant === 'primary' ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-field bg-white text-ink hover:bg-[#F9FAFB]', disabled && 'pointer-events-none opacity-50')}>
      {icon} {label}
      <input
        type="file"
        accept={DOC_ACCEPT}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </label>
  )
}

function DocRow({ item, busy }: { item: DocItem; busy?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <FileText className="h-5 w-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{item.name}</div>
        <div className="text-xs text-muted">{kb(item.size)}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={() => void item.open()} aria-label={`Shiko ${item.name}`}>
        <Eye className="h-4 w-4" /> <span className="hidden sm:inline">Shiko</span>
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void item.remove()} aria-label={`Fshi ${item.name}`}>
        <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Fshi</span>
      </Button>
    </li>
  )
}

export function DocumentsBlock({
  certificate,
  others,
  onCertificate,
  onOthers,
  busy,
  error,
  setError,
  locked,
}: {
  certificate: DocItem | null
  others: DocItem[]
  onCertificate: (f: File) => void | Promise<void>
  onOthers: (f: File[]) => void | Promise<void>
  busy?: boolean
  error?: string | null
  setError: (e: string | null) => void
  locked?: boolean
}) {
  const pick = (files: File[], one: boolean) => {
    const bad = files.map(docProblem).find(Boolean)
    if (bad) return setError(bad)
    setError(null)
    if (one) void onCertificate(files[0])
    else void onOthers(files)
  }
  return (
    <div className="flex flex-col gap-6">
      <Section title="Certifikata e regjistrimit të biznesit" hint="E detyrueshme · PDF, PNG, JPG ose WebP, deri 10 MB">
        {certificate ? (
          <ul className="rounded-card border border-line">
            <DocRow item={certificate} busy={busy || locked} />
          </ul>
        ) : (
          <div className="rounded-card border border-dashed border-field px-4 py-6 text-center">
            <p className="mb-3 text-sm text-muted">Ngarko certifikatën e ARBK-së.</p>
            <FileButton label="Ngarko certifikatën" icon={<Upload className="h-4 w-4" />} variant="primary" onFiles={(f) => pick(f, true)} disabled={busy || locked} />
          </div>
        )}
        {certificate && !locked && (
          <div className="mt-3">
            <FileButton label="Zëvendëso" icon={<RefreshCw className="h-4 w-4" />} onFiles={(f) => pick(f, true)} disabled={busy} />
          </div>
        )}
      </Section>
      <Section title="Dokumente shtesë" hint="Opsionale · p.sh. leja e punës, kontrata e qirasë, vendimi i TVSH-së">
        {others.length > 0 && (
          <ul className="mb-3 divide-y divide-line rounded-card border border-line">
            {others.map((o) => (
              <DocRow key={o.key} item={o} busy={busy || locked} />
            ))}
          </ul>
        )}
        {!locked && <FileButton label="Shto dokumente" icon={<Plus className="h-4 w-4" />} multiple onFiles={(f) => pick(f, false)} disabled={busy} />}
      </Section>
      {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The review before sending
// ---------------------------------------------------------------------------
function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5 text-[14px] md:grid-cols-[190px_1fr]">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 break-words font-medium text-ink">{v || '—'}</dd>
    </div>
  )
}

export function Review({ d, onEdit, docs }: { d: ApplicationData; onEdit: (step: number) => void; docs: number }) {
  const c = d.company
  const t = d.tax
  const block = (title: string, step: number, children: ReactNode) => (
    <div className="rounded-card border border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h4 className="text-[14px] font-semibold">{title}</h4>
        <button type="button" onClick={() => onEdit(step)} className="text-[13px] font-semibold text-brand-600 hover:underline">
          Ndrysho
        </button>
      </div>
      <dl className="px-4 py-2">{children}</dl>
    </div>
  )
  return (
    <div className="grid gap-3">
      {block(
        'Kompania',
        1,
        <>
          <Row k="Emri" v={c.name} />
          <Row k="NUI" v={<span className="num">{c.nui}</span>} />
          <Row k="Adresa" v={[c.address, c.city, c.country].filter(Boolean).join(', ')} />
          <Row k="Qendra tatimore" v={t.tax_center} />
          {c.owner_name && <Row k="Pronari" v={`${c.owner_name} · ${c.phone} · ${c.email}`} />}
        </>,
      )}
      {block(
        'Tatimet',
        2,
        <>
          <Row k="Forma juridike" v={legalFormLabel(t.legal_form)} />
          <Row k="Kategoria tatimore" v={`${taxCategoryLabel(t.legal_form, t.tax_category)}${t.real_income ? ' · e ardhur reale (vullnetare)' : ''}`} />
          <Row k="TVSH" v={t.vat_registered ? `Po · ${t.vat_number} · nga ${t.vat_date.split('-').reverse().join('.')}` : 'Jo'} />
        </>,
      )}
      {block(
        `Njësitë (${d.units.length})`,
        3,
        <>
          {d.units.map((u, i) => (
            <Row key={i} k={u.name || `Njësia ${i + 1}`} v={`${[u.address, u.city].filter(Boolean).join(', ')} · ${u.activities.join(', ')} · ${u.registers} ${u.registers === 1 ? 'arkë' : 'arka'}`} />
          ))}
        </>,
      )}
      <p className="flex items-center gap-2 text-sm text-muted">
        <Check className="h-4 w-4 text-brand-600" /> {docs} {docs === 1 ? 'dokument' : 'dokumente'} të bashkëngjitura
      </p>
    </div>
  )
}

/** The step titles shown above the form. */
export const STEPS = ['Kompania', 'Tatimet', 'Njësitë', 'Dokumentet'] as const

export function Stepper({ step, done, onGo }: { step: number; done: number; onGo: (s: number) => void }) {
  return (
    <ol className="grid grid-cols-4 gap-2">
      {STEPS.map((label, i) => {
        const n = i + 1
        const reachable = n <= done + 1
        const current = n === step
        const complete = n <= done && !current
        return (
          <li key={label}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onGo(n)}
              aria-current={current ? 'step' : undefined}
              className={cn('flex w-full flex-col gap-2 text-left disabled:cursor-default')}
            >
              <span className={cn('h-1 rounded-full', current || complete ? 'bg-brand-600' : 'bg-line')} />
              <span className={cn('flex items-center gap-1.5 text-[12px] font-semibold md:text-[13px]', current ? 'text-ink' : complete ? 'text-brand-600' : 'text-muted')}>
                <span className="num hidden md:inline">{n}.</span>
                {complete && <Check className="h-3.5 w-3.5 md:hidden" />}
                {label}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
