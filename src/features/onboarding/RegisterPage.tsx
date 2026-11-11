import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { PublicFooter, PublicHeader } from '@/features/landing/LandingPage'
import { Button, Input, Select } from '@/components/ui'
import { BUSINESS_TYPE_LIST, type BusinessType } from '@/lib/business'
import { cn } from '@/lib/cn'
import { registerBusiness, type RegisterInput } from './api'

const EMPTY: RegisterInput = {
  owner_name: '',
  business_name: '',
  type: 'market',
  nui: '',
  fiscal_number: '',
  vat_number: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  password: '',
  activity: '',
  registers: 1,
  note: '',
  website: '',
}

/** /regjistrohu – the client applies; the account waits for the approval of the platform admin. */
export function RegisterPage() {
  const { status, signIn } = useAuth()
  const navigate = useNavigate()
  const [f, setF] = useState<RegisterInput>(EMPTY)
  const [password2, setPassword2] = useState('')
  const [accept, setAccept] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  if (status === 'ready' && !done) return <Navigate to="/" replace />

  const set = (k: keyof RegisterInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (f.password !== password2) return setError('Fjalëkalimet nuk përputhen')
    if (!accept) return setError('Prano kushtet e përdorimit')
    setBusy(true)
    try {
      await registerBusiness({ ...f, nui: f.nui.replace(/\D/g, '') })
      setDone(true)
      // sign in right away: the owner sees the status of the application at /llogaria
      // one retry: a brief network drop must not leave the owner on the "Hyr" screen
      let err = await signIn(f.email, f.password, true)
      if (err) {
        await new Promise((r) => setTimeout(r, 1500))
        err = await signIn(f.email, f.password, true)
      }
      if (!err) navigate('/llogaria', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <section className="bg-brand-900 pb-24 text-white">
        <div className="mx-auto max-w-[900px] px-5 pt-8 md:pt-12">
          <h1 className="text-[32px] font-bold tracking-tight md:text-[44px]">Regjistro biznesin</h1>
          <p className="mt-3 max-w-xl text-[17px] text-white/75">
            Plotëso të dhënat e biznesit. E shqyrtojmë regjistrimin, pastaj të dërgojmë udhëzimet për pagesën; pas pagesës aplikon për arkë dhe instalon Kasa.
          </p>
          <ol className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
            {['Regjistrimi', 'Shqyrtimi', 'Pagesa', 'Aplikimi për arkë', 'Instalimi'].map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-xs font-bold">{i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </div>
      </section>
      <main className="mx-auto -mt-16 max-w-[900px] px-5 pb-16">
        {done ? (
          <div className="rounded-[20px] border border-line bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" />
            <h2 className="mt-3 text-[22px] font-bold">Regjistrimi u dërgua</h2>
            <p className="mt-2 text-muted">E shqyrtojmë së shpejti. Statusin e sheh duke hyrë me email-in dhe fjalëkalimin tënd.</p>
            <Link to="/login" className="mt-5 inline-block">
              <Button size="lg">Hyr</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="rounded-[20px] border border-line bg-white p-6 shadow-sm md:p-8">
            <h2 className="text-[19px] font-bold">Lloji i biznesit</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              {BUSINESS_TYPE_LIST.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setF({ ...f, type: t.code as BusinessType })}
                  className={cn('flex flex-col items-center gap-1.5 rounded-card border-2 px-2 py-3 text-center', f.type === t.code ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line text-muted hover:border-field')}
                >
                  <t.icon className="h-6 w-6" />
                  <span className="text-sm font-semibold leading-tight">{t.label}</span>
                  <span className="text-[11px] leading-tight">{t.description}</span>
                </button>
              ))}
            </div>

            <h2 className="mt-7 text-[19px] font-bold">Biznesi</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input label="Emri i biznesit" value={f.business_name} onChange={set('business_name')} autoComplete="organization" />
              </div>
              <Input label="Numri unik i biznesit (NUI)" inputMode="numeric" maxLength={9} value={f.nui} onChange={(e) => setF({ ...f, nui: e.target.value.replace(/\D/g, '') })} />
              <Input label="Numri fiskal" value={f.fiscal_number} onChange={set('fiscal_number')} />
              <Input label="Numri i TVSH-së (nëse ke)" value={f.vat_number ?? ''} onChange={set('vat_number')} />
              <Input label="Veprimtaria" placeholder="p.sh. kafe-bar, market ushqimor" value={f.activity ?? ''} onChange={set('activity')} />
              <Input label="Adresa" value={f.address} onChange={set('address')} autoComplete="street-address" />
              <Input label="Qyteti" value={f.city} onChange={set('city')} autoComplete="address-level2" />
              <Select
                label="Sa arka të duhen"
                value={String(f.registers ?? 1)}
                onChange={(e) => setF({ ...f, registers: Number(e.target.value) })}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 5 ? '5 ose më shumë' : String(n) }))}
              />
            </div>

            <h2 className="mt-7 text-[19px] font-bold">Pronari dhe llogaria</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input label="Emri dhe mbiemri i pronarit" value={f.owner_name} onChange={set('owner_name')} autoComplete="name" />
              <Input label="Telefoni" type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" />
              <div className="sm:col-span-2">
                <Input label="Email" type="email" value={f.email} onChange={set('email')} autoComplete="email" />
              </div>
              <Input label="Fjalëkalimi (të paktën 8 shenja)" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
              <Input label="Përsërite fjalëkalimin" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
              <div className="sm:col-span-2">
                <Input label="Shënim (opsional)" value={f.note ?? ''} onChange={set('note')} />
              </div>
              {/* honeypot: hidden from people, filled by bots */}
              <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} className="hidden" aria-hidden="true" />
            </div>

            <label className="mt-6 flex items-start gap-3 text-[15px]">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>
                Pranoj kushtet e përdorimit dhe që të dhënat të përdoren për aktivizimin e arkës dhe fiskalizimin në ATK.
              </span>
            </label>
            {error && <p className="mt-4 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">
                Ke llogari?{' '}
                <Link to="/login" className="font-semibold text-brand-600 hover:underline">
                  Hyr
                </Link>
              </span>
              <Button type="submit" size="lg" loading={busy}>
                Dërgo regjistrimin
              </Button>
            </div>
          </form>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}
