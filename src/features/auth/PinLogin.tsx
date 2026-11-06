import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, Delete, KeyRound, Lock } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { fetchPinWorkers, getLink, pinLogin, PinLoginError, type DeviceLink, type PinWorker } from '@/lib/deviceLink'

const COLORS = ['bg-brand-600', 'bg-bt-600', 'bg-[#A16207]', 'bg-[#7C3AED]', 'bg-[#BE123C]', 'bg-[#0F766E]']
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('')

/** Worker sign-in on a linked device: pick your name, type the 4-digit PIN. */
export function PinLogin({ onUseEmail }: { onUseEmail: () => void }) {
  const [link, setLink] = useState<DeviceLink | null | undefined>(undefined)
  const [workers, setWorkers] = useState<PinWorker[] | null>(null)
  const [business, setBusiness] = useState<string>('')
  const [selected, setSelected] = useState<PinWorker | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getLink().then(setLink)
  }, [])

  useEffect(() => {
    if (!link) return
    fetchPinWorkers(link)
      .then((r) => {
        setWorkers(r.workers.filter((w) => w.has_pin))
        setBusiness(r.business.name)
      })
      .catch((e: Error) => {
        setError(e.message)
        if (e instanceof PinLoginError && e.code === 'device') setLink(null)
      })
  }, [link])

  const submit = useCallback(
    async (code: string) => {
      if (!link || !selected || busy) return
      setBusy(true)
      setError(null)
      try {
        await pinLogin(link, selected.id, code)
        // AuthProvider picks up the new session and LoginPage redirects.
      } catch (e) {
        setError((e as Error).message)
        setPin('')
        if (e instanceof PinLoginError && e.code === 'locked') setWorkers((ws) => ws?.map((w) => (w.id === selected.id ? { ...w, locked: true } : w)) ?? null)
      } finally {
        setBusy(false)
      }
    },
    [link, selected, busy],
  )

  const press = useCallback(
    (d: string) => {
      if (busy || pin.length >= 4) return
      setError(null)
      const next = pin + d
      setPin(next)
      if (next.length === 4) void submit(next)
    },
    [busy, pin, submit],
  )

  // Physical keyboard: digits, Backspace, Escape
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Escape') {
        setSelected(null)
        setPin('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, press])

  if (link === undefined) return <p className="mt-8 text-center text-muted">Duke kontrolluar pajisjen…</p>

  if (!link) {
    return (
      <div className="mt-6 rounded-card border border-line bg-white p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
          <KeyRound className="h-6 w-6" />
        </div>
        <div className="font-semibold">Kjo pajisje nuk është lidhur ende</div>
        <p className="mt-2 text-sm text-muted">
          Hyrja me PIN punon pasi pronari ose menaxheri të hyjë njëherë me email në këtë pajisje. Pastaj punëtorët hyjnë vetëm me PIN.
        </p>
        {error && <p className="mt-3 text-sm text-warn-700">{error}</p>}
        <Button className="mt-5" variant="secondary" block onClick={onUseEmail}>
          Hyr si menaxher
        </Button>
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="mt-6">
        <p className="mb-3 text-sm text-muted">{business ? `${business} · ` : ''}Zgjidh emrin tënd</p>
        {workers === null && !error ? (
          <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
        ) : workers && workers.length === 0 ? (
          <p className="rounded-card border border-line bg-white p-5 text-sm text-muted">Asnjë punëtor me PIN. Pronari i shton te Cilësimet → Përdoruesit & PIN-et.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2.5">
            {(workers ?? []).map((w, i) => (
              <li key={w.id}>
                <button
                  type="button"
                  disabled={w.locked}
                  onClick={() => {
                    setSelected(w)
                    setPin('')
                    setError(null)
                  }}
                  className="flex w-full items-center gap-3 rounded-card border border-line bg-white p-3 text-left hover:border-brand-600 disabled:opacity-50"
                >
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white', COLORS[i % COLORS.length])}>{initials(w.full_name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{w.full_name}</span>
                    <span className="block text-xs text-muted">{w.locked ? 'I bllokuar' : w.role === 'worker' ? 'Punëtor' : w.role === 'manager' ? 'Menaxher' : 'Pronari'}</span>
                  </span>
                  {w.locked && <Lock className="ml-auto h-4 w-4 text-warn-700" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
        <button type="button" onClick={onUseEmail} className="mt-5 w-full text-center text-sm font-semibold text-brand-600 underline">
          Hyr me email
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => {
          setSelected(null)
          setPin('')
          setError(null)
        }}
        className="mb-3 flex items-center gap-1 text-sm font-semibold text-brand-600"
      >
        <ChevronLeft className="h-4 w-4" /> Ndrysho punëtorin
      </button>
      <div className="text-center">
        <div className="text-[20px] font-bold">{selected.full_name}</div>
        <div className="text-sm text-muted">Shkruaj PIN-in 4-shifror</div>
        <div className="mt-5 flex justify-center gap-3" aria-label={`${pin.length} nga 4 shifra`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn('h-4 w-4 rounded-full border-2', i < pin.length ? 'border-brand-600 bg-brand-600' : 'border-field')} />
          ))}
        </div>
        <div className="mt-3 min-h-[44px] text-sm text-warn-700">{busy ? <span className="text-muted">Duke hyrë…</span> : error}</div>
      </div>
      <div className="mx-auto grid max-w-[300px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => press(d)} disabled={busy}>
            {d}
          </Key>
        ))}
        <span />
        <Key onClick={() => press('0')} disabled={busy}>
          0
        </Key>
        <Key onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy} label="Fshi">
          <Delete className="h-6 w-6" />
        </Key>
      </div>
    </div>
  )
}

function Key({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-[64px] items-center justify-center rounded-2xl border border-line bg-white text-[26px] font-semibold active:bg-brand-100 disabled:opacity-60"
    >
      {children}
    </button>
  )
}
