import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { FullScreenLoader, SetupMissing } from '@/app/AuthGuard'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { LogoMark } from '@/components/Logo'
import { Button, Input } from '@/components/ui'
import { supabaseConfigured } from '@/lib/supabase'
import { isSefApp } from '@/lib/device'
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
      <section className="flex flex-col bg-brand-900 px-6 pb-8 pt-[calc(env(safe-area-inset-top)+24px)] text-white md:w-[46.5%] md:px-12 md:py-12">
        <Link to="/" className="flex items-center gap-3">
          <LogoMark size={44} />
          <span className="text-xl font-bold">Kasa</span>
        </Link>
        <div className="mt-8 md:my-auto">
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight md:text-[44px]">Shitja, stoku dhe raportet në një vend.</h1>
          <p className="mt-4 hidden max-w-md text-[17px] leading-relaxed text-white/70 md:block">
            Arka e shpejtë me barkod, hyrjet e mallit nga furnitorët dhe pasqyra e ditës – nga kompjuteri ose telefoni.
          </p>
        </div>
        <ul className="mt-auto hidden flex-wrap gap-x-6 gap-y-2 text-sm text-white/70 md:flex">
          {['Punon edhe pa internet', 'Printer me Bluetooth', 'Disa arka e përdorues'].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-brand-400" /> {t}
            </li>
          ))}
        </ul>
      </section>

      {/* Form */}
      <section className="flex flex-1 items-start justify-center bg-bg px-6 py-8 md:items-center md:py-12">
        <div className="w-full max-w-[420px]">
          <h2 className="text-[28px] font-bold tracking-tight">Mirë se erdhe</h2>
          {isSefApp ? (
            <>
              <p className="mt-1 text-muted">Hyr me PIN-in tënd për të shitur</p>
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
                    <button type="button" onClick={() => setShowForgot((v) => !v)} className="text-sm font-semibold text-brand-600 underline">
                      Harrove fjalëkalimin?
                    </button>
                  }
                />
                {showForgot && (
                  <p className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
                    Fjalëkalimin e ri ta jep administratori i Kasa-s (pronari) ose pronari i biznesit (menaxherët).
                  </p>
                )}
                <label className="flex cursor-pointer items-center gap-3 text-[15px]">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 rounded accent-brand-600" />
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
