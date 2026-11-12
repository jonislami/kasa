import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AlertTriangle, CheckCircle2, Clock, Download, RefreshCw, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { device } from '@/lib/device'
import { formatEUR } from '@/lib/money'
import { promptInstall, useInstallState } from '@/lib/pwa'
import { checkClock, formatDrift, serverNow, useClock, KOSOVO_TZ } from '@/lib/clock'
import { syncQueue, useOfflineQueue } from '@/features/pos/offline'
import { fiscalQueueState, flushFiscal, hoursLeft, onFiscalQueueChange, type FiscalQueueState } from '@/lib/fiscal'

const timeFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' })

/** A new version is ready (web: service worker · Windows app: GitHub Releases). */
export function UpdatePrompt() {
  return device.appUpdates ? <InstalledAppUpdate /> : device.platform === 'web' ? <WebUpdatePrompt /> : null
}

/** Windows app: the new version is downloaded; it installs when the user taps (or on next start). */
function InstalledAppUpdate() {
  const [version, setVersion] = useState<string | null>(null)
  const [download, setDownload] = useState(false)
  useEffect(
    () =>
      device.appUpdates?.subscribe((i) => {
        setVersion(i.version)
        setDownload(i.mode === 'download')
      }),
    [],
  )
  if (!version) return null
  return (
    <div className="fixed inset-x-3 bottom-6 z-[60] mx-auto flex max-w-[460px] items-center gap-3 rounded-card bg-ink px-4 py-3 text-white shadow-2xl md:left-auto md:right-6">
      <RefreshCw className="h-5 w-5 shrink-0 text-brand-400" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">{download ? `Version i ri: Kasa ${version}` : `Kasa ${version} është gati`}</div>
        <div className="text-white/70">
          {download ? 'Shkarkoje dhe instaloje mbi aplikacionin e tanishëm; të dhënat mbeten.' : 'Instalohet tani ose herën tjetër që hapet programi.'}
        </div>
      </div>
      <Button size="sm" onClick={() => device.appUpdates?.install()}>
        {download ? 'Shkarko' : 'Instalo'}
      </Button>
      <button type="button" aria-label="Më vonë" onClick={() => setVersion(null)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Windows app: Bluetooth / USB device list (Electron has no system picker). Opens when the page asks
 * for a device (printer "Lidh") and closes when one is chosen or the user cancels.
 */
export function DeviceChooserDialog() {
  const chooser = device.deviceChooser
  const [list, setList] = useState<{ kind: 'bluetooth' | 'serial'; devices: { id: string; name: string }[] } | null>(null)
  useEffect(() => chooser?.subscribe(setList), [chooser])
  if (!chooser || !list) return null
  const pick = (id: string | null) => {
    chooser.select(list.kind, id)
    setList(null)
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#4d5c53]/70 p-6">
      <div className="w-full max-w-[440px] rounded-[20px] bg-white p-5 shadow-2xl">
        <div className="text-lg font-semibold">{list.kind === 'bluetooth' ? 'Zgjidh printerin Bluetooth' : 'Zgjidh printerin USB'}</div>
        <p className="mt-1 text-sm text-muted">{list.devices.length ? 'Pajisjet që u gjetën:' : 'Duke kërkuar… ndize printerin dhe afroje.'}</p>
        <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-card border border-line">
          {list.devices.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => pick(d.id)} className="w-full px-4 py-3 text-left font-medium hover:bg-brand-100">
                {d.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => pick(null)}>
            Anulo
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Web/PWA: a new version of the app is ready; the user decides when to reload (never mid-sale). */
function WebUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new version every hour while the app stays open.
      if (reg) setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000)
    },
  })

  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 5000)
    return () => clearTimeout(t)
  }, [offlineReady, setOfflineReady])

  if (!needRefresh && !offlineReady) return null
  return (
    <div className="fixed inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-[460px] items-center gap-3 rounded-card bg-ink px-4 py-3 text-white shadow-2xl md:bottom-6 md:right-6 md:left-auto">
      <RefreshCw className="h-5 w-5 shrink-0 text-brand-400" />
      <div className="min-w-0 flex-1 text-sm">
        {needRefresh ? (
          <>
            <div className="font-semibold">Versioni i ri i Kasa-s është gati</div>
            <div className="text-white/70">Rifreskoje kur të mbarosh shitjen.</div>
          </>
        ) : (
          <div className="font-semibold">Kasa tani punon edhe pa internet</div>
        )}
      </div>
      {needRefresh && (
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          Rifresko
        </Button>
      )}
      <button
        type="button"
        aria-label="Mbyll"
        onClick={() => {
          setNeedRefresh(false)
          setOfflineReady(false)
        }}
        className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Shown on every screen (except the till, which has its own) while offline or while
 * offline sales are waiting. Keeps the queue syncing in the background on any page.
 */
export function OfflineBar() {
  const qc = useQueryClient()
  const { pathname } = useLocation()
  const queue = useOfflineQueue(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: ['today-sales'] })
      void qc.invalidateQueries({ queryKey: ['report'] })
      void qc.invalidateQueries({ queryKey: ['work'] })
    }, [qc]),
  )
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 60_000)
    return () => clearInterval(t)
  }, [])

  const pending = queue.pending.filter((p) => !p.rejected)
  const rejected = queue.pending.length - pending.length
  if (pathname.startsWith('/arka')) return null
  if (queue.online && queue.pending.length === 0) return null

  const oldest = pending[0] ? (now - new Date(pending[0].queued_at).getTime()) / 3_600_000 : 0
  const late = oldest >= 24
  const total = pending.reduce((s, p) => s + p.input.items.reduce((a, i) => a + i.quantity * i.unit_price - (i.discount ?? 0), 0) - (p.input.invoice_discount ?? 0), 0)

  return (
    <div className="px-4 pt-3 md:px-8 md:pt-5">
      <div className={cn('flex flex-wrap items-center gap-3 rounded-card border px-4 py-3', queue.online ? 'border-line bg-white' : 'border-[#F5D98B] bg-amber-100 text-amber-700')}>
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', queue.online ? 'bg-brand-100 text-brand-600' : 'bg-[#FDE68A]')}>
          {queue.syncing ? <RefreshCw className="h-5 w-5 animate-spin" /> : <WifiOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="text-[15px] font-semibold">
            {queue.online ? 'Faturat po dërgohen' : 'Duke punuar pa internet'}
            {pending.length > 0 && ` – ${pending.length} ${pending.length === 1 ? 'faturë' : 'fatura'} në pritje (${formatEUR(total)})`}
          </div>
          <div className={queue.online ? 'text-muted' : ''}>
            Mund të vazhdosh të shesësh. Faturat dërgohen vetë sapo të kthehet lidhja.
            {queue.lastSync && ` Provuar së fundi ${timeFmt.format(new Date(queue.lastSync))}.`}
          </div>
          {late && (
            <div className="mt-1 font-semibold text-warn-700">
              Fatura më e vjetër pret {Math.floor(oldest)} orë. Faturat pa internet duhet të dërgohen brenda 48 orëve – lidhu me një rrjet tjetër (p.sh. hotspot).
            </div>
          )}
          {rejected > 0 && <div className="mt-1 font-semibold text-warn-700">{rejected} fatura u refuzuan nga serveri – hape Arka → Faturat e sotme.</div>}
        </div>
        {pending.length > 0 && (
          <Button size="sm" variant="secondary" loading={queue.syncing} onClick={() => void syncQueue()}>
            Provo tani
          </Button>
        )}
      </div>
    </div>
  )
}

/** "Instalo Kasa" – for the web version (Chrome/Edge/Android) and instructions for iPhone. */
export function InstallCard({ className }: { className?: string }) {
  const state = useInstallState()
  const [msg, setMsg] = useState<string | null>(null)
  if (device.platform !== 'web' || state === 'installed' || state === 'unavailable') return null
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-card border border-line bg-white px-5 py-4', className)}>
      <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Instalo Kasa në këtë pajisje</div>
        <div className="text-sm text-muted">
          {state === 'ios'
            ? 'Në Safari shtyp Ndaj (katrori me shigjetë) → "Shto në ekranin bazë". Hapet si aplikacion dhe punon edhe pa internet.'
            : 'Hapet si aplikacion më vete, pa shiritin e shfletuesit, dhe punon edhe pa internet.'}
        </div>
        {msg && <div className="mt-1 text-sm text-brand-600">{msg}</div>}
      </div>
      {state === 'available' && (
        <Button
          onClick={async () => {
            if (await promptInstall()) setMsg('Kasa u instalua')
          }}
        >
          <Download className="h-4 w-4" /> Instalo
        </Button>
      )}
    </div>
  )
}

/**
 * Clock at the top of every screen: ✓ when the device time matches the server time
 * (fiscal coupons carry date/time; ATK requires a correct clock). Click for details.
 */
export function ClockBar() {
  const clock = useClock()
  const [now, setNow] = useState(() => serverNow())
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000)
    return () => clearInterval(t)
  }, [])

  const ok = clock.status === 'ok'
  const off = clock.status === 'off'
  const time = new Date(now).toLocaleTimeString('sq-AL', { timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const checked = clock.checkedAt ? new Date(clock.checkedAt).toLocaleTimeString('sq-AL', { timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div className="relative flex justify-end bg-brand-900 px-4 pb-1 pt-2 md:bg-transparent md:px-8 md:pb-0 md:pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium tabular-nums',
          ok ? 'bg-brand-100 text-brand-600' : off ? 'bg-warn-100 text-warn-700' : 'bg-white/10 text-white/80 md:bg-[#EEF1EE] md:text-muted',
        )}
        aria-label="Ora dhe kontrolli i saj"
      >
        {ok ? <CheckCircle2 className="h-4 w-4" /> : off ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        <span>{time}</span>
        <span className="hidden sm:inline">· {ok ? 'Ora e saktë' : off ? `Ora e pajisjes gabon ${formatDrift(clock.drift ?? 0)}` : clock.drift !== null ? 'Ora e fundit e njohur' : 'Ora pa kontroll'}</span>
      </button>
      {open && (
        <div className="absolute right-4 top-full z-50 mt-2 w-[300px] rounded-card border border-line bg-white p-4 text-sm text-ink shadow-xl md:right-8">
          <div className="font-semibold">{ok ? 'Ora është e saktë' : off ? 'Ora e pajisjes nuk është e saktë' : 'Ora nuk u kontrollua'}</div>
          <p className="mt-1 text-muted">
            Kasa përdor orën e vet nga serveri (ora zyrtare), jo orën e pajisjes – në ekran dhe në fatura.
            {checked ? ` Kontrolluar ${checked}.` : ' Kontrollohet sapo të ketë internet.'}
          </p>
          {clock.drift !== null && Math.abs(clock.drift) >= 1000 && (
            <p className="mt-1 text-muted">
              Ora e pajisjes: {new Date(Date.now()).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ({formatDrift(clock.drift)} {clock.drift > 0 ? 'përpara' : 'prapa'})
            </p>
          )}
          {off && <p className="mt-2 font-medium text-warn-700">Rregulloje orën e pajisjes: Cilësimet → Data dhe ora → "Vendos automatikisht". Kasa vazhdon me orën e saktë.</p>}
          <p className="mt-2 text-xs text-muted">Kufiri i lejuar: 1 minutë. Me fiskalizimin (Faza 9) ora krahasohet edhe me serverin e ATK-së.</p>
          <button type="button" className="mt-3 font-semibold text-brand-600" onClick={() => void checkClock()}>
            Kontrollo tani
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Fiscal coupons this device has signed but ATK has not confirmed (no answer at the time of the sale,
 * or the sale itself was offline). ATK allows 48 hours; shown on every screen, the till included.
 */
export function FiscalBar() {
  const [state, setState] = useState<FiscalQueueState | null>(null)
  useEffect(() => {
    const load = () => void fiscalQueueState().then(setState, () => setState(null))
    load()
    const off = onFiscalQueueChange(load)
    const t = setInterval(load, 60_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  const flush = useCallback(() => void flushFiscal().then(() => fiscalQueueState().then(setState)), [])
  if (!state || (state.waiting === 0 && state.failed === 0)) return null
  const left = hoursLeft(state.oldest)
  const urgent = state.failed > 0 || (left !== null && left < 12)
  return (
    <div className="px-4 pt-3 md:px-8 md:pt-5 print:hidden">
      <div className={cn('flex flex-wrap items-center gap-3 rounded-card border px-4 py-3 text-sm', urgent ? 'border-[#F3C5A8] bg-warn-100 text-warn-700' : 'border-[#F5D98B] bg-amber-100 text-amber-700')}>
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {state.waiting > 0 && `${state.waiting} ${state.waiting === 1 ? 'kupon fiskal' : 'kuponë fiskalë'} pa u dërguar në ATK`}
            {state.waiting > 0 && state.failed > 0 && ' · '}
            {state.failed > 0 && `${state.failed} të refuzuar nga ATK`}
          </div>
          {left !== null && state.waiting > 0 && <div>{left > 0 ? `Duhen dërguar brenda ${Math.floor(left)} orëve (afati 48 orë).` : 'Afati 48 orë ka kaluar – njofto ATK-në.'}</div>}
          {state.failed > 0 && <div>Shiko Fiskalizimi për gabimin.</div>}
        </div>
        {state.waiting > 0 && (
          <Button size="sm" variant="secondary" onClick={flush}>
            Dërgo tani
          </Button>
        )}
      </div>
    </div>
  )
}
