import { useState, type FormEvent } from 'react'
import { Button, Dialog, Input } from '@/components/ui'
import { BUSINESS_TYPE_LIST, businessType, type BusinessType } from '@/lib/business'
import { cn } from '@/lib/cn'
import { createBusiness, generatePassword } from './api'
import type { Credentials } from './CredentialsDialog'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function NewBusinessDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (c: Credentials) => void
}) {
  const [type, setType] = useState<BusinessType>('market')
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(() => generatePassword())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setType('market')
    setName('')
    setCity('')
    setOwnerName('')
    setEmail('')
    setPassword(generatePassword())
    setError(null)
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return setError('Shkruaj emrin e biznesit')
    if (!ownerName.trim()) return setError('Shkruaj emrin e pronarit')
    if (!EMAIL_RE.test(email.trim())) return setError('Email-i nuk është i saktë')
    setBusy(true)
    setError(null)
    try {
      const res = await createBusiness({
        type,
        name: name.trim(),
        city: city.trim() || undefined,
        owner_name: ownerName.trim(),
        email: email.trim().toLowerCase(),
        password,
      })
      onCreated({ title: `${name.trim()} u krijua`, ownerName: ownerName.trim(), email: res.email, password })
      reset()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Biznes i ri"
      subtitle="Krijo llogarinë dhe përdoruesin e parë (pronarin)"
      footer={
        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="hidden text-sm text-muted sm:inline">
            Lloji i zgjedhur: <strong className="text-ink">{businessType(type).shortLabel}</strong>
          </span>
          <div className="flex gap-2.5">
            <Button variant="secondary" size="lg" className="flex-1 sm:flex-none" onClick={close} disabled={busy}>
              Anulo
            </Button>
            <Button size="lg" className="flex-1 sm:flex-none" loading={busy} onClick={() => void submit()}>
              Krijo biznesin
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="text-[15px] font-semibold">1. Lloji i biznesit</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          {BUSINESS_TYPE_LIST.map((t) => {
            const Icon = t.icon
            const sel = t.code === type
            return (
              <button
                key={t.code}
                type="button"
                onClick={() => setType(t.code)}
                aria-pressed={sel}
                className={cn(
                  'flex flex-col items-start rounded-xl border p-3.5 text-left transition-colors',
                  sel ? 'border-2 border-brand-600 bg-[#F0F7F3] p-[13px]' : 'border-line hover:bg-bg',
                )}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg',
                    sel ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-600',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-3 text-[15px] font-semibold leading-tight">{t.code === 'restaurant' ? 'Kafiterie / Restorant' : t.shortLabel}</div>
                <div className="mt-1 text-xs text-muted">{t.description}</div>
              </button>
            )
          })}
        </div>
        <div className="rounded-ctl bg-amber-100 px-4 py-2.5 text-sm text-amber-700">Lloji nuk ndryshohet më pasi të krijohet biznesi.</div>

        <div className="mt-2 text-[15px] font-semibold">2. Biznesi dhe pronari</div>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Input label="Emri i biznesit" value={name} onChange={(e) => setName(e.target.value)} placeholder="Market Lisi" />
          <Input label="Qyteti" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Prishtinë" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Emri i pronarit" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Blerim Hasani" />
          <Input
            label="Email-i i hyrjes"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="blerim@marketlisi.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Fjalëkalimi (gjenerohet automatikisht)</span>
          <div className="flex gap-2.5">
            <div className="min-w-0 flex-1">
              <Input aria-label="Fjalëkalimi" readOnly mono value={password} />
            </div>
            <Button variant="secondary" className="h-[46px] shrink-0" onClick={() => setPassword(generatePassword())}>
              Rigjenero
            </Button>
          </div>
        </div>
        {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  )
}
