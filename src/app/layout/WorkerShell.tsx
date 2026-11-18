import { LicenseBanner } from '@/app/LicenseBanner'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChefHat, ClipboardList, LogOut, Menu, MoreHorizontal, Printer, Square, X } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { Button, Dialog, Input } from '@/components/ui'
import { hasModule, type BusinessType } from '@/lib/business'
import { KOSOVO_TZ } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { endShift, fetchWork } from '@/features/reports/api'
import { t as tr, useLang } from '@/lib/i18n'
import type { NavItem } from '@/app/nav'
import { SqDateFormat } from '@/lib/sqDate'

/** Cash the worker holds now: change at the start of the shift + cash taken today. */
export function useWallet(): number | null {
  const work = useQuery({ queryKey: ['work', 'wallet'], queryFn: () => fetchWork(null), refetchInterval: 60_000, retry: false })
  if (!work.data) return null
  return (work.data.open_shift?.opening_cash ?? 0) + work.data.totals.cash
}

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // D.P.Z. " LON - TON " → letters only, no quotes or dots
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'K'

/** €26 instead of €26.00 in the narrow rail. */
const compactEUR = (v: number) => (Number.isInteger(Math.round(v * 100) / 100) ? `€${Math.round(v)}` : formatEUR(v))

const clockFmt = new SqDateFormat({ timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' })

/**
 * The worker's screen – no sidebar menu of the business, only the work:
 *  computer / tablet: a narrow dark rail (screens, wallet, "Mbyll ditën", "Dil") and a light header
 *  phone:             one dark bar on top with the same things behind ☰
 * CSS variables let the till/order screens size themselves (no tab bar here).
 */
export function WorkerShell({
  type,
  businessName,
  userName,
  userSub,
  tabs,
  children,
}: {
  type: BusinessType
  businessName: string
  userName: string
  userSub: string
  tabs: NavItem[]
  children: ReactNode
}) {
  const lang = useLang()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menu, setMenu] = useState(false)
  const [closing, setClosing] = useState(false)
  const wallet = useWallet()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => setMenu(false), [location.pathname])

  const doSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }
  const extra = [
    { to: '/puna', label: 'Puna ime sot', icon: ClipboardList },
    ...(hasModule(type, 'kitchen') ? [{ to: '/kuzhina', label: 'Ekrani i kuzhinës / barit', icon: ChefHat }] : []),
    { to: '/cilesimet', label: 'Printeri', icon: Printer },
  ]

  const railBtn = 'flex w-[72px] flex-col items-center justify-center gap-1.5 rounded-xl py-3 text-[11px] font-medium'

  return (
    <div className="min-h-dvh bg-bg md:flex" style={{ '--topbar': '56px', '--tabbar': '0px', '--chrome': '56px' } as CSSProperties}>
      {/* ---------- rail (md+) ---------- */}
      <aside className="sticky top-0 hidden h-dvh w-[96px] shrink-0 flex-col items-center gap-3 border-r border-white/5 bg-brand-900 py-4 text-white md:flex print:hidden">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-[16px] font-semibold tracking-[-0.015em] ring-1 ring-white/10" title={businessName}>
          {initials(businessName)}
        </div>
        <nav className="mt-3 flex flex-col gap-2">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => cn(railBtn, 'min-h-[68px]', isActive ? 'bg-white text-brand-900' : 'text-white/65 hover:bg-white/[0.07] hover:text-white')}>
              <t.icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
              <span className="leading-tight">{tr(t.short ?? t.label, lang)}</span>
            </NavLink>
          ))}
          <button type="button" onClick={() => setMenu(true)} className={cn(railBtn, 'text-white/55 hover:bg-white/[0.07] hover:text-white')}>
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.9} />
            {tr('Më shumë', lang)}
          </button>
        </nav>

        <div className="mt-auto flex flex-col items-center gap-2">
          <div className="w-[72px] rounded-xl border border-white/10 bg-white/[0.04] px-1 py-2.5 text-center">
            <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-white/50">Kuleta</div>
            <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-white">{wallet === null ? '…' : compactEUR(wallet)}</div>
          </div>
          <div className="max-w-[80px] truncate text-[11px] text-white/45">{userSub}</div>
          <button type="button" onClick={() => setClosing(true)} className={cn(railBtn, 'text-[#FCD34D] hover:bg-white/[0.07]')}>
            <Square className="h-5 w-5" strokeWidth={1.9} />
            {tr('Mbyll ditën', lang)}
          </button>
          <button type="button" onClick={() => void doSignOut()} className={cn(railBtn, 'text-[#FCA5A5] hover:bg-white/[0.07]')}>
            <LogOut className="h-5 w-5" />
            {tr('Dil', lang)}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* ---------- top bar: phone dark, md+ light header ---------- */}
        <header className="sticky top-0 z-40 bg-brand-900 pt-safe text-white md:static md:border-b md:border-line md:bg-white md:pt-0 md:text-ink print:hidden">
          <div className="flex h-14 items-center gap-3 px-3 md:h-[68px] md:px-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-semibold md:hidden">{initials(businessName)}</div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold leading-tight tracking-[-0.015em] md:text-[17px]">
                <span className="md:hidden">{businessName}</span>
                <span className="hidden md:inline">Mirë se erdhe, {userName}</span>
              </div>
              <div className="truncate text-xs text-white/60 md:hidden">{userName}</div>
            </div>
            {tabs.length > 1 && (
              <nav className="ml-1 flex gap-1 rounded-xl bg-white/10 p-1 md:hidden">
                {tabs.map((t) => (
                  <NavLink key={t.to} to={t.to} className={({ isActive }) => cn('flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold', isActive ? 'bg-white text-brand-900' : 'text-white/75')}>
                    <t.icon className="h-4 w-4" />
                  </NavLink>
                ))}
              </nav>
            )}
            <div className="flex-1" />
            <span className="hidden text-[15px] font-medium tabular-nums text-muted md:block">{clockFmt.format(now)}</span>
            <button type="button" aria-label="Menuja" onClick={() => setMenu(true)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 md:hidden">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="min-w-0 pb-safe">
          <LicenseBanner />
          {children}
        </main>
      </div>

      {/* ---------- menu: Puna ime sot, kitchen, printer, close the day, sign out ---------- */}
      {menu && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#0F172A]/45 md:justify-start" onClick={() => setMenu(false)}>
          <div className="flex h-full w-[300px] max-w-[85vw] flex-col bg-white pt-safe shadow-pop md:ml-[96px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="truncate font-semibold">{userName}</div>
                <div className="truncate text-sm text-muted">
                  {userSub}
                  {wallet !== null && ` · kuleta ${formatEUR(wallet)}`}
                </div>
              </div>
              <button type="button" aria-label="Mbyll" onClick={() => setMenu(false)} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-bg">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col p-2">
              {[...tabs.map((t) => ({ to: t.to, label: t.label, icon: t.icon })), ...extra].map((i) => (
                <NavLink key={i.to} to={i.to} className={({ isActive }) => cn('flex min-h-[46px] items-center gap-3 rounded-ctl px-3 text-[15px] font-medium', isActive ? 'bg-brand-100 text-brand-700' : 'text-[#344054] hover:bg-[#F5F6F8]')}>
                  <i.icon className="h-5 w-5" />
                  {tr(i.label, lang)}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-1 border-t border-line p-2 pb-safe">
              <button
                type="button"
                onClick={() => {
                  setMenu(false)
                  setClosing(true)
                }}
                className="flex min-h-[46px] w-full items-center gap-3 rounded-ctl px-3 text-[15px] font-medium text-amber-700 hover:bg-amber-100"
              >
                <Square className="h-5 w-5" /> {tr('Mbyll ditën', lang)}
              </button>
              <button type="button" onClick={() => void doSignOut()} className="flex min-h-[46px] w-full items-center gap-3 rounded-ctl px-3 text-[15px] font-medium text-warn-700 hover:bg-warn-100">
                <LogOut className="h-5 w-5" /> {tr('Dil', lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      <CloseDayDialog open={closing} onClose={() => setClosing(false)} onDone={doSignOut} />
    </div>
  )
}

/** "Mbyll ditën": today's numbers, the cash counted, then the shift closes and the worker signs out. */
function CloseDayDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const work = useQuery({ queryKey: ['work', 'wallet'], queryFn: () => fetchWork(null), enabled: open })
  const [cash, setCash] = useState('')
  useEffect(() => {
    if (open) setCash('')
  }, [open])
  const close = useMutation({
    mutationFn: async () => {
      if (work.data?.open_shift) await endShift(cash.trim() ? Number(cash.replace(',', '.')) : null)
      await onDone()
    },
  })
  const t = work.data?.totals
  const wallet = work.data ? (work.data.open_shift?.opening_cash ?? 0) + work.data.totals.cash : null
  const counted = cash.trim() ? Number(cash.replace(',', '.')) : null
  const diff = counted !== null && wallet !== null && Number.isFinite(counted) ? Math.round((counted - wallet) * 100) / 100 : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mbyll ditën"
      subtitle={work.data?.open_shift ? 'Mbyllet ndërrimi dhe dilet nga llogaria.' : 'Nuk ke ndërrim të hapur – vetëm dilet nga llogaria.'}
      width="md:max-w-[440px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={close.isPending} onClick={() => close.mutate()}>
            Mbyll dhe dil
          </Button>
        </div>
      }
    >
      {work.isLoading ? (
        <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {t && (
            <div className="grid grid-cols-2 gap-2 text-[15px]">
              <Line l="Fatura" r={String(t.invoices)} />
              <Line l="Totali" r={formatEUR(t.total)} />
              <Line l="Kesh" r={formatEUR(t.cash)} />
              <Line l="Kartelë" r={formatEUR(t.card)} />
              {work.data?.open_shift && <Line l="Kusuri në fillim" r={formatEUR(work.data.open_shift.opening_cash)} />}
              <Line l="Kuleta" r={<b>{formatEUR(wallet ?? 0)}</b>} />
            </div>
          )}
          {work.data?.open_shift && (
            <>
              <Input label="Keshi që dorëzon (€) – opsionale" inputMode="decimal" type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} />
              {diff !== null && diff !== 0 && (
                <p className={cn('rounded-ctl px-4 py-2.5 text-sm', diff < 0 ? 'bg-warn-100 text-warn-700' : 'bg-amber-100 text-amber-700')}>
                  {diff < 0 ? `Mungojnë ${formatEUR(-diff)}` : `Tepricë ${formatEUR(diff)}`} kundrejt kuletës.
                </p>
              )}
            </>
          )}
          {close.error && <p className="text-sm text-warn-700">{(close.error as Error).message}</p>}
        </div>
      )}
    </Dialog>
  )
}

function Line({ l, r }: { l: string; r: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-ctl border border-line bg-[#F9FAFB] px-3 py-2">
      <span className="text-muted">{l}</span>
      <span className="tabular-nums">{r}</span>
    </div>
  )
}
