import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { FullScreenLoader, SetupMissing } from '@/app/AuthGuard'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { LogoMark } from '@/components/Logo'
import { Button, Input } from '@/components/ui'
import { supabase, supabaseConfigured } from '@/lib/supabase'

export function LoginPage() {
  const { status, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'loading' && busy) return <FullScreenLoader />
  if (status === 'ready') return <Navigate to="/" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return setError('Shkruaj email-in dhe fjalëkalimin')
    setBusy(true)
    setError(null)
    const err = await signIn(email, password, remember)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <SafeAreaStrip />
      <section className="flex flex-col bg-brand-900 px-6 pb-8 pt-[calc(env(safe-area-inset-top)+24px)] text-white md:w-[44%] md:max-w-[620px] md:px-12 md:py-11">
        <div className="flex items-center gap-3">
          <LogoMark size={34} />
          <div>
            <div className="text-[17px] font-semibold leading-tight tracking-[-0.02em]">KontoSef<span className="font-medium text-white/50">.app</span></div>
            <div className="text-[13px] text-brand-400">Kontabilist</div>
          </div>
        </div>
        <div className="mt-8 md:my-auto">
          <h1 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em] md:text-[38px]">Librat e të gjithë klientëve në një vend.</h1>
          <p className="mt-4 hidden max-w-md text-[16px] leading-relaxed text-white/60 md:block">
            Libri i shitjeve dhe i blerjeve, TVSH-ja, fitimi dhe eksporti për çdo klient – edhe për bizneset që nuk përdorin KontoSef.
          </p>
        </div>
        <ul className="mt-auto hidden flex-col gap-2.5 border-t border-white/10 pt-6 text-[14px] text-white/65 md:flex">
          {['Klientë pa kufi', 'Lidhje me arkën KontoSef', 'Eksport në Excel'].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-brand-400" strokeWidth={2.2} /> {t}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-1 items-start justify-center bg-white px-6 py-8 md:items-center md:py-12">
        <div className="w-full max-w-[400px]">
          <h2 className="text-[24px] font-semibold tracking-[-0.025em]">Mirë se erdhe</h2>
          <p className="mt-1 text-muted">Hyr me llogarinë e kontabilistit</p>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5" noValidate>
            <Input label="Email" type="email" autoComplete="username" inputMode="email" placeholder="zyra@shembull.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Fjalëkalimi" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[#344054]">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-brand-600" />
              Më mbaj të kyçur në këtë pajisje
            </label>
            {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
            <Button type="submit" size="lg" block loading={busy}>
              Hyr
            </Button>
            <ForgotPassword email={email} />
          </form>
        </div>
      </section>
    </div>
  )
}

/** "Forgot password": Supabase sends a link to /fjalekalimi where a new password is set. */
function ForgotPassword({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | string>('idle')
  const send = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setState('Shkruaj email-in lart, pastaj kliko këtu.')
    setState('busy')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/fjalekalimi` })
    setState(error ? (/rate|seconds/i.test(error.message) ? 'Prit pak minuta para se ta kërkosh përsëri.' : error.message) : 'sent')
  }
  return (
    <div className="text-center text-sm text-muted">
      {state === 'sent' ? (
        <span className="text-brand-600">Nëse llogaria ekziston, të erdhi një email me lidhjen për fjalëkalimin e ri.</span>
      ) : (
        <button type="button" className="font-semibold text-brand-600 hover:underline disabled:opacity-60" disabled={state === 'busy'} onClick={() => void send()}>
          Ke harruar fjalëkalimin?
        </button>
      )}
      {state !== 'idle' && state !== 'busy' && state !== 'sent' && <div className="mt-1 text-warn-700">{state}</div>}
    </div>
  )
}
