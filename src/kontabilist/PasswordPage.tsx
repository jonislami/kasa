import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { LogoMark } from '@/components/Logo'
import { Button, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'

/**
 * New password after the link in an e-mail (portal invitation or "forgot password"):
 * Supabase opens the session from the link; here the user chooses the password.
 */
export function PasswordPage() {
  const navigate = useNavigate()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (a.length < 8) return setError('Fjalëkalimi duhet të ketë të paktën 8 shenja')
    if (a !== b) return setError('Fjalëkalimet nuk përputhen')
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password: a })
    setBusy(false)
    if (err) return setError(/session|expired|invalid/i.test(err.message) ? 'Lidhja ka skaduar. Kërko një të re.' : err.message)
    navigate('/', { replace: true })
  }
  return (
    <div className="flex min-h-dvh items-start justify-center bg-bg px-6 py-10 md:items-center">
      <SafeAreaStrip />
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-card border border-line bg-white p-6 shadow-sm" noValidate>
        <div className="mb-5 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <div className="text-[18px] font-bold">Fjalëkalimi i ri</div>
            <div className="text-sm text-muted">Zgjidh fjalëkalimin me të cilin do të hysh</div>
          </div>
          <KeyRound className="ml-auto h-6 w-6 text-brand-600" />
        </div>
        <div className="flex flex-col gap-4">
          <Input label="Fjalëkalimi i ri" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
          <Input label="Përsërite" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
          {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
          <Button type="submit" size="lg" loading={busy}>
            Ruaj dhe vazhdo
          </Button>
        </div>
      </form>
    </div>
  )
}
