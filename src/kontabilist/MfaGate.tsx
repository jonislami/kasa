import { useEffect, useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { LogoMark } from '@/components/Logo'
import { Button, Input } from '@/components/ui'
import { mfaEnroll, mfaVerify } from './office'

/** Code from the authenticator app (Google Authenticator, Microsoft Authenticator, Authy…). */
export function CodeForm({ factorId, onDone, cta = 'Vazhdo' }: { factorId: string; onDone: () => void; cta?: string }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (code.replace(/\s/g, '').length !== 6) return setError('Shkruaj kodin me 6 shifra')
    setBusy(true)
    setError(null)
    try {
      await mfaVerify(factorId, code)
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        label="Kodi me 6 shifra"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        className="text-center text-[22px] tracking-[0.3em] tabular-nums"
      />
      {error && <p className="text-sm text-warn-700">{error}</p>}
      <Button type="submit" size="lg" loading={busy}>
        {cta}
      </Button>
    </form>
  )
}

/** Adding the authenticator app: QR code, secret for typing by hand, first code. */
export function EnrollForm({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    mfaEnroll().then(setState, (e: Error) => setError(e.message))
  }, [])
  if (error) return <p className="text-sm text-warn-700">{error}</p>
  if (!state) return <p className="text-sm text-muted">Duke përgatitur kodin QR…</p>
  return (
    <div className="flex flex-col gap-4">
      <ol className="ml-5 list-decimal text-sm text-muted">
        <li>Hap aplikacionin e autentikimit në telefon (Google Authenticator, Microsoft Authenticator ose Authy).</li>
        <li>Skano kodin QR, ose shkruaj çelësin me dorë.</li>
        <li>Shkruaj kodin me 6 shifra që shfaqet.</li>
      </ol>
      <div className="flex flex-col items-center gap-2">
        <img src={state.qr} alt="Kodi QR" className="h-48 w-48 rounded-card border border-line bg-white p-2" />
        <code className="select-all break-all rounded-md bg-bg px-2 py-1 text-xs">{state.secret}</code>
      </div>
      <CodeForm factorId={state.factorId} onDone={onDone} cta="Aktivizo" />
    </div>
  )
}

/** Full screen before the program: the office requires two-factor login or the account has it turned on. */
export function MfaGate({ mode, factorId, onDone }: { mode: 'verify' | 'enroll'; factorId: string | null; onDone: () => void }) {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-dvh items-start justify-center bg-bg px-6 py-10 md:items-center">
      <SafeAreaStrip />
      <div className="w-full max-w-[420px] rounded-card border border-line bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <div className="text-[18px] font-bold">Hyrja me dy faktorë</div>
            <div className="text-sm text-muted">{mode === 'verify' ? 'Shkruaj kodin nga aplikacioni i autentikimit' : 'Zyra e kërkon për çdo anëtar'}</div>
          </div>
          <ShieldCheck className="ml-auto h-6 w-6 text-brand-600" />
        </div>
        {mode === 'verify' && factorId ? <CodeForm factorId={factorId} onDone={onDone} /> : <EnrollForm onDone={onDone} />}
        <button type="button" onClick={() => void signOut()} className="mt-5 w-full text-center text-sm font-semibold text-muted hover:text-ink">
          Dil nga llogaria
        </button>
      </div>
    </div>
  )
}
