import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { FullScreenLoader } from '@/app/AuthGuard'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { Logo } from '@/components/Logo'
import { Button, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'

const MIN_PASSWORD = 6

/** What Supabase put in the address when the link no longer works (#error=…&error_code=otp_expired). */
function linkError(): string | null {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search)
  if (!p.get('error') && !p.get('error_code')) return null
  return p.get('error_code') === 'otp_expired' ? 'Linku ka skaduar ose është përdorur një herë.' : p.get('error_description') ?? 'Linku nuk vlen.'
}

/**
 * /fjalekalimi – the owner arrives from the link the platform admin sent ("Dërgo link"):
 * Supabase opens a session from the link, and here the owner chooses the new password.
 */
export function NewPasswordPage() {
  const { status, session } = useAuth()
  const navigate = useNavigate()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [badLink] = useState(linkError)
  // the session from the link may arrive a moment after the page
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500)
    return () => clearTimeout(t)
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (a.length < MIN_PASSWORD) return setError(`Fjalëkalimi duhet të ketë të paktën ${MIN_PASSWORD} shenja`)
    if (a !== b) return setError('Fjalëkalimet nuk përputhen')
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password: a })
    setBusy(false)
    if (err) {
      if (/session|expired|invalid|jwt/i.test(err.message)) return setError('Linku ka skaduar. Kërkoji administratorit një link të ri.')
      if (/different from the old/i.test(err.message)) return setError('Zgjidh një fjalëkalim tjetër nga i vjetri.')
      const len = err.message.match(/at least (\d+) characters/i)
      return setError(len ? `Fjalëkalimi duhet të ketë të paktën ${len[1]} shenja` : err.message)
    }
    void supabase.rpc('log_action', { p_action: 'password_changed', p_entity: 'auth', p_details: { method: 'link' } })
    setDone(true)
  }

  if (!badLink && !session && (status === 'loading' || !waited)) return <FullScreenLoader />

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <SafeAreaStrip />
      <header className="border-b border-line bg-white pt-safe">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center px-5">
          <Link to="/" aria-label="KontoSef.app">
            <Logo size={30} />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-5 py-10 md:items-center">
        <div className="w-full max-w-[420px] rounded-card border border-line bg-white p-6 shadow-card md:p-7">
          {done ? (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Fjalëkalimi u ndryshua</h1>
              <p className="mt-2 text-[15px] text-muted">Tani hyn me fjalëkalimin e ri, në çdo pajisje.</p>
              <Button size="lg" block className="mt-6" onClick={() => navigate('/', { replace: true })}>
                Vazhdo
              </Button>
            </>
          ) : badLink || !session ? (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Linku nuk vlen më</h1>
              <p className="mt-2 text-[15px] text-muted">
                {badLink ?? 'Linku ka skaduar ose është përdorur një herë.'} Kërkoji administratorit një link të ri për fjalëkalimin.
              </p>
              <Link to="/login" className="mt-6 block">
                <Button size="lg" block variant="secondary">
                  Shko te hyrja
                </Button>
              </Link>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Fjalëkalimi i ri</h1>
              <p className="mt-1 text-[15px] text-muted">
                Për <b className="font-medium text-ink">{session.user.email}</b>. Zgjidh fjalëkalimin me të cilin do të hysh.
              </p>
              <div className="mt-6 flex flex-col gap-4">
                <Input
                  label="Fjalëkalimi i ri"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoFocus
                  value={a}
                  onChange={(e) => setA(e.target.value)}
                  hint={`Të paktën ${MIN_PASSWORD} shenja`}
                  labelRight={
                    <button type="button" onClick={() => setShow((v) => !v)} className="flex items-center gap-1 text-[13px] font-medium text-brand-600">
                      {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {show ? 'Fshih' : 'Shfaq'}
                    </button>
                  }
                />
                <Input label="Përsërite" type={show ? 'text' : 'password'} autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
                {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
                <Button type="submit" size="lg" block loading={busy}>
                  Ruaj fjalëkalimin
                </Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
