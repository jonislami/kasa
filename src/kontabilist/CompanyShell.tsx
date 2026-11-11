import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  BookOpen,
  BookText,
  Boxes,
  ListTree,
  Lock,
  Scale,
  Building2,
  Calculator,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileBarChart,
  FileText,
  HandCoins,
  LayoutGrid,
  Landmark,
  LogOut,
  MapPin,
  Menu,
  Package,
  Percent,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { LogoMark } from '@/components/Logo'
import { cn } from '@/lib/cn'
import type { AccMe, Client } from './api'

export interface MenuItem {
  key: string
  label: string
  icon: LucideIcon
  kasaOnly?: boolean
}

/** The company menu, grouped like an accountant works through the month. */
export const MENU: { group: string; icon: LucideIcon; items: MenuItem[] }[] = [
  { group: 'Të përgjithshme', icon: LayoutGrid, items: [{ key: 'paneli', label: 'Paneli', icon: LayoutGrid }, { key: 'pasqyra', label: 'Pasqyra e periudhës', icon: FileBarChart }] },
  { group: 'Subjektet', icon: Users, items: [{ key: 'partneret', label: 'Klientët dhe furnitorët', icon: Users }] },
  { group: 'Shitjet', icon: Receipt, items: [{ key: 'shitjet', label: 'Faturat e shitjes', icon: Receipt }, { key: 'proformat', label: 'Proformat', icon: FileText }] },
  { group: 'Blerjet', icon: ShoppingCart, items: [{ key: 'blerjet', label: 'Blerjet dhe shpenzimet', icon: ShoppingCart }] },
  {
    group: 'Kontabiliteti',
    icon: Calculator,
    items: [
      { key: 'banka', label: 'Arka dhe banka', icon: Landmark },
      { key: 'borxhet', label: 'Llogaritë e arkëtueshme & pagueshme', icon: HandCoins },
      { key: 'fitimi', label: 'Fitimi dhe humbja (përmbledhje)', icon: TrendingUp },
      { key: 'konto', label: 'Plani kontabël', icon: ListTree },
      { key: 'ditari', label: 'Ditari', icon: BookOpen },
      { key: 'libri', label: 'Libri kryesor', icon: BookText },
      { key: 'bilanci', label: 'Bilanci provues', icon: Scale },
      { key: 'pasqyrat', label: 'Pasqyrat financiare', icon: FileBarChart },
      { key: 'asetet', label: 'Mjetet themelore', icon: Boxes },
      { key: 'mbyllja', label: 'Mbyllja e muajit', icon: Lock },
    ],
  },
  {
    group: 'Administrata tatimore',
    icon: Percent,
    items: [
      { key: 'tvsh', label: 'Formulari i TVSH-së dhe librat', icon: Percent },
      { key: 'tvsh_permbledhje', label: 'TVSH sipas normave', icon: FileBarChart },
      { key: 'tatimet', label: 'Tatimet e tjera dhe afatet', icon: CalendarDays },
    ],
  },
  {
    group: 'Arka Kasa',
    icon: Store,
    items: [
      { key: 'arka', label: 'Arka (shitjet e arkës)', icon: ArrowLeftRight, kasaOnly: true },
      { key: 'stoku', label: 'Stoku', icon: Package, kasaOnly: true },
    ],
  },
  { group: 'Kompania', icon: Building2, items: [{ key: 'klienti', label: 'Të dhënat e kompanisë', icon: Building2 }] },
]

const longDate = new Intl.DateTimeFormat('sq-AL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Belgrade' })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase()

/**
 * Layout of one company in Kasa Kontabilist: light sidebar with grouped sections and a menu search,
 * a floating top bar (period / export / account) and the company card above the content.
 */
export function CompanyShell({
  me,
  client,
  linked,
  active,
  toolbar,
  children,
}: {
  me: AccMe
  client: Client | null
  linked: boolean
  active: string
  toolbar?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const [q, setQ] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  useEffect(() => setDrawer(false), [location.pathname])
  const id = client?.id
  const name = me.accountant?.full_name || me.accountant?.email || 'Kontabilist'

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    return MENU.map((g) => ({ ...g, items: g.items.filter((i) => (!i.kasaOnly || linked) && (!s || i.label.toLowerCase().includes(s) || g.group.toLowerCase().includes(s))) })).filter((g) => g.items.length)
  }, [q, linked])

  const doSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-3 bg-brand-900 px-4 py-4 text-white">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-400 text-[15px] font-bold text-brand-900">{initial(name)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">{name}</div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-400">Kontabilist</div>
        </div>
        <button type="button" onClick={() => void doSignOut()} title="Dil" aria-label="Dil" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white">
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      <button type="button" onClick={() => navigate('/')} className="mx-3 mt-3 flex items-center gap-3 rounded-card bg-[#EEF3EF] px-3 py-3 text-left hover:bg-[#E3ECE6]" title="Kalo te një kompani tjetër">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E3F1EA] text-brand-600">
          <Building2 className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Kompania aktive</span>
          <span className="block truncate font-semibold">{client?.name ?? '…'}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted" />
      </button>

      <div className="relative mx-3 mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko në menu…" className="h-10 w-full rounded-ctl border border-line bg-white pl-9 pr-3 text-[15px] focus:border-brand-600 focus:outline-none" />
      </div>

      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-4" aria-label="Menyja e kompanisë">
        {groups.map((g) => {
          const open = q.trim() !== '' || !closed[g.group]
          return (
            <div key={g.group} className="mt-2">
              <button type="button" onClick={() => setClosed({ ...closed, [g.group]: open })} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[14px] font-semibold text-ink hover:bg-[#EEF3EF]">
                <g.icon className="h-4 w-4 text-muted" />
                <span className="flex-1 text-left">{g.group}</span>
                <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', !open && '-rotate-90')} />
              </button>
              {open && (
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">
                  {g.items.map((i) => (
                    <NavLink
                      key={i.key}
                      to={i.key === 'paneli' ? `/klient/${id}` : `/klient/${id}/${i.key}`}
                      end
                      className={() => cn('flex min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 text-[14px]', active === i.key ? 'bg-[#E3F1EA] font-semibold text-brand-600 shadow-[inset_3px_0_0_#0E6B4E]' : 'text-muted hover:bg-[#EEF3EF] hover:text-ink')}
                    >
                      <i.icon className="h-4 w-4 shrink-0" />
                      <span className="leading-tight">{i.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {!groups.length && <p className="px-2 py-4 text-sm text-muted">Asgjë me "{q}"</p>}
      </nav>

      <button type="button" onClick={() => navigate('/')} className="flex items-center gap-2 border-t border-line px-5 py-3.5 text-sm font-semibold text-muted hover:text-ink">
        <ChevronRight className="h-4 w-4 rotate-180" /> Të gjitha kompanitë
      </button>
    </div>
  )

  return (
    <div className="min-h-dvh bg-bg md:flex">
      <div className="fixed inset-x-0 top-0 z-50 h-safe-top bg-white md:hidden" />
      <aside className="sticky top-0 hidden h-dvh w-[272px] shrink-0 border-r border-line md:block">{sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-50 flex bg-black/40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="h-full w-[300px] max-w-[85vw] pt-safe shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
          <button type="button" aria-label="Mbyll menunë" className="m-3 flex h-10 w-10 items-center justify-center rounded-full bg-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="min-w-0 flex-1 pt-safe md:pt-0">
        <div className="sticky top-0 z-30 px-3 pt-3 md:px-6 md:pt-4">
          <header className="flex min-h-[64px] flex-wrap items-center gap-3 rounded-[16px] bg-brand-900 px-3 py-2 text-white shadow-md md:px-5 [&_button]:text-ink">
            <button type="button" aria-label="Menyja" onClick={() => setDrawer(true)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 !text-white md:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <LogoMark size={32} />
            <div className="hidden min-w-0 sm:block">
              <div className="text-[17px] font-bold leading-tight">Kasa Kontabilist</div>
              <div className="truncate text-xs font-semibold text-brand-400">{me.accountant?.office_name || 'Kontabilist'}</div>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{toolbar}</div>
          </header>
        </div>

        <div className="px-3 pb-10 pt-4 md:px-6 md:pt-5">
          <section className="mb-4 rounded-[16px] border border-line bg-white px-5 py-4 shadow-sm md:mb-5 md:px-7 md:py-5">
            <h1 className="flex flex-wrap items-center gap-2.5 text-[22px] font-bold leading-tight md:text-[26px]">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600"><Building2 className="h-5 w-5" /></span>
              {client?.name ?? '…'}
              {linked && <span className="rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-2.5 py-0.5 text-xs font-semibold text-[#4338CA]">Lidhur me Kasa</span>}
            </h1>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-muted">
              {client?.city && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" /> {client.city}
                </span>
              )}
              {client?.nui && <span>NUI {client.nui}</span>}
              <span>{client?.vat_registered ? `Nr. TVSH ${client.vat_number || '—'}` : 'Jo në sistemin e TVSH-së'}</span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" /> {cap(longDate.format(new Date()))}
              </span>
            </div>
          </section>
          {children}
        </div>
      </div>
    </div>
  )
}
