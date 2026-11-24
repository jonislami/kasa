import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { FullScreenLoader, SetupMissing } from '@/app/AuthGuard'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { Logo } from '@/components/Logo'
import { Button, Input } from '@/components/ui'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { isSefApp } from '@/lib/device'
import { t as tr } from '@/lib/i18n'
import { PinLogin } from './PinLogin'

/**
 * Web app: e-mail + password (owners, managers, platform admin, accountants).
 * SEF app (installed): activation key once, then only the workers' PIN – it only sells and prints.
 */
export function LoginPage() {
  const { status, ctx, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForgot, setShowForgot] = useState(false)
  const [resetState, setResetState] = useState<{ busy: boolean; done: string | null; error: string | null }>({ busy: false, done: null, error: null })
  // "Harrove fjalëkalimin?": Supabase sends a one-time link to the address (through the project's SMTP, Resend);
  // the link opens /fjalekalimi where the new password is chosen
  const sendReset = async () => {
    const addr = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setResetState({ busy: false, done: null, error: 'Shkruaj email-in e llogarisë sipër' })
    setResetState({ busy: true, done: null, error: null })
    const { error: e } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: `${window.location.origin}/fjalekalimi` })
    if (e && !/rate|security purposes/i.test(e.message)) return setResetState({ busy: false, done: null, error: /fetch/i.test(e.message) ? 'Nuk ka lidhje me serverin' : e.message })
    // the same answer whether or not the address has an account (nobody learns which addresses exist)
    setResetState({ busy: false, done: e ? 'Linku u dërgua pak më parë – kontrollo email-in (edhe te Spam) ose provo pas një minute.' : `Nëse ${addr} ka llogari, linku për fjalëkalimin e ri u dërgua. Kontrollo email-in (edhe te Spam).`, error: null })
  }

  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'loading' && busy) return <FullScreenLoader />
  if (status === 'ready' && ctx) {
    const from = (location.state as { from?: string } | null)?.from
    const target = ctx.is_platform_admin && !ctx.profile ? '/platforma' : from && from !== '/login' ? from : '/'
    return <Navigate to={target} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Shkruaj email-in dhe fjalëkalimin')
      return
    }
    setBusy(true)
    setError(null)
    const err = await signIn(email, password, remember)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <SafeAreaStrip />
      {/* Brand panel */}
      <section className="flex flex-col bg-brand-900 px-6 pb-7 pt-[calc(env(safe-area-inset-top)+20px)] text-white md:w-[44%] md:max-w-[620px] md:px-12 md:py-11">
        <Link to="/" className="flex items-center gap-2.5" aria-label="KontoSef.app">
          <Logo size={34} tone="light" />
        </Link>
        <div className="mt-7 md:my-auto">
          <h1 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em] md:text-[38px]">Shitja, stoku dhe fiskalizimi – në rregull çdo ditë.</h1>
          <p className="mt-4 hidden max-w-md text-[16px] leading-relaxed text-white/60 md:block">
            Arka, hyrjet e mallit, TVSH-ja dhe raportet e biznesit tënd në një vend – nga kompjuteri ose telefoni.
          </p>
        </div>
        <ul className="mt-auto hidden flex-col gap-2.5 border-t border-white/10 pt-6 text-[14px] text-white/65 md:flex">
          {['Fiskalizim në ATK, edhe pa internet', 'Punëtorë me PIN, të dhëna të ndara për biznes', 'Windows, Android, iPhone dhe shfletues'].map((t) => (
            <li key={t} className="flex items-center gap-2.5">
              <Check className="h-4 w-4 text-brand-400" strokeWidth={2.2} /> {t}
            </li>
          ))}
        </ul>
      </section>

      {/* Form */}
      <section className="flex flex-1 items-start justify-center bg-white px-6 py-8 md:items-center md:py-12">
        <div className="w-full max-w-[400px]">
          <h2 className="text-[24px] font-semibold tracking-[-0.025em]">{tr('Mirë se erdhe')}</h2>
          {isSefApp ? (
            <>
              <p className="mt-1 text-muted">{tr('Hyr me PIN-in tënd për të shitur')}</p>
              <PinLogin />
            </>
          ) : (
            <>
              <p className="mt-1 text-muted">Hyr në llogarinë tënde për të vazhduar</p>
              <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5" noValidate>
                <Input
                  label="Email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="emri@biznesi.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Input
                  label="Fjalëkalimi"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  labelRight={
                    <button type="button" onClick={() => setShowForgot((v) => !v)} className="text-[13px] font-medium text-brand-600 hover:underline">
                      Harrove fjalëkalimin?
                    </button>
                  }
                />
                {showForgot && (
                  <div className="flex flex-col gap-2 rounded-ctl bg-bg px-4 py-3 text-sm">
                    <p className="text-muted">Shkruaj email-in sipër dhe të dërgojmë një link për të zgjedhur fjalëkalimin e ri.</p>
                    <div>
                      <Button type="button" size="sm" variant="secondary" loading={resetState.busy} onClick={() => void sendReset()}>
                        Dërgo linkun në email
                      </Button>
                    </div>
                    {resetState.done && <p className="text-brand-600">{resetState.done}</p>}
                    {resetState.error && <p className="text-warn-700">{resetState.error}</p>}
                  </div>
                )}
                <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[#344054]">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-brand-600" />
                  Më mbaj të kyçur në këtë pajisje
                </label>
                {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
                <Button type="submit" size="lg" block loading={busy}>
                  Hyr
                </Button>
                <p className="text-center text-sm text-muted">
                  Biznes i ri?{' '}
                  <Link to="/regjistrohu" className="font-semibold text-brand-600 hover:underline">
                    Regjistro biznesin
                  </Link>
                </p>
                <p className="text-center text-sm text-muted">
                  Punëtorët hyjnë me PIN në programin e arkës.{' '}
                  <Link to="/shkarko" className="font-semibold text-brand-600 hover:underline">
                    Shkarko
                  </Link>
                </p>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
