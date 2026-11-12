import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronLeft, Delete, KeyRound, Lock } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { activateWithKey, clearLink, fetchPinWorkers, getLink, pinLogin, PinLoginError, type DeviceLink, type PinWorker } from '@/lib/deviceLink'

const COLORS = ['bg-brand-600', 'bg-bt-600', 'bg-[#A16207]', 'bg-[#7C3AED]', 'bg-[#BE123C]', 'bg-[#0F766E]']
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('')

/**
 * SEF app sign-in: an unlinked device asks for the activation key once; then pick your name, type the 4-digit PIN.
 */
export function PinLogin() {
  const [link, setLink] = useState<DeviceLink | null | undefined>(undefined)
  const [workers, setWorkers] = useState<PinWorker[] | null>(null)
  const [business, setBusiness] = useState<string>('')
  const [selected, setSelected] = useState<PinWorker | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [relink, setRelink] = useState(false)

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
        if (e instanceof PinLoginError && e.code === 'device') {
          // the admin turned this device off (or it was linked again elsewhere) – a new key is needed
          void clearLink()
          setLink(null)
        }
        setError(e.message)
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
        setPin('')
        if (e instanceof PinLoginError && e.code === 'device') {
          void clearLink()
          setLink(null)
        }
        setError((e as Error).message)
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

  if (!link || relink)
    return (
      <ActivationForm
        error={relink ? null : error}
        replacing={relink && link ? link.business_name : null}
        onCancel={relink ? () => setRelink(false) : undefined}
        onActivated={(l) => {
          setError(null)
          setRelink(false)
          setWorkers(null)
          setSelected(null)
          setLink(l)
        }}
      />
    )

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
        <button type="button" onClick={() => setRelink(true)} className="mt-6 w-full text-center text-sm text-muted underline">
          Aktivizo me çelës tjetër (biznes ose arkë tjetër)
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

/** SEF app, first start: the key the platform admin sent (KASA-XXXX-XXXX-XXXX) links this device to the business. */
function ActivationForm({
  error: outerError,
  replacing,
  onCancel,
  onActivated,
}: {
  error: string | null
  /** Name of the business this till is linked to now; it stays linked until the new key is accepted. */
  replacing?: string | null
  onCancel?: () => void
  onActivated: (l: DeviceLink) => void
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onActivated(await activateWithKey(key))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const shown = error ?? outerError
  return (
    <form onSubmit={submit} className="mt-6 rounded-card border border-line bg-white p-6">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
        <KeyRound className="h-6 w-6" />
      </div>
      <div className="text-lg font-semibold">Aktivizo arkën</div>
      <p className="mt-1 text-sm text-muted">
        {replacing
          ? `Kjo arkë është e lidhur tani me ${replacing}. Me çelës të ri lidhet me biznesin ose arkën e çelësit; lidhja e vjetër mbetet derisa çelësi i ri të pranohet.`
          : 'Shkruaj çelësin e aktivizimit që të dërgoi administratori i Kasa-s. Kjo bëhet vetëm njëherë në këtë pajisje.'}
      </p>
      <label className="mt-5 block text-sm font-medium" htmlFor="activation-key">
        Çelësi i aktivizimit
      </label>
      <input
        id="activation-key"
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase())}
        placeholder="KASA-XXXX-XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus
        className="mt-1.5 h-[52px] w-full rounded-ctl border border-field px-4 text-center font-mono text-lg tracking-[0.12em] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
      />
      {shown && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{shown}</p>}
      <Button type="submit" className="mt-5" size="lg" block loading={busy} disabled={key.replace(/[^A-Za-z0-9]/g, '').length < 12}>
        Aktivizo
      </Button>
      {onCancel && (
        <Button type="button" variant="secondary" className="mt-2" size="lg" block onClick={onCancel}>
          Anulo
        </Button>
      )}
    </form>
  )
}
