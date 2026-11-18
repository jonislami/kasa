import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Archive,
  ArrowLeftRight,
  Briefcase,
  BookOpen,
  BookText,
  Boxes,
  ListTree,
  Lock,
  Scale,
  ScanLine,
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
  UserCog,
  Warehouse,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { LogoMark } from '@/components/Logo'
import { cn } from '@/lib/cn'
import type { AccMe, Client } from './api'
import { SqDateFormat } from '@/lib/sqDate'

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
  { group: 'Blerjet', icon: ShoppingCart, items: [{ key: 'blerjet', label: 'Blerjet dhe shpenzimet', icon: ShoppingCart }, { key: 'skanimi', label: 'Skanimi me AI (blerje, shpenzim, investim, shitje)', icon: ScanLine }] },
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
    group: 'Burimet njerëzore',
    icon: UserCog,
    items: [
      { key: 'punonjesit', label: 'Punonjësit dhe kontratat', icon: Users },
      { key: 'vijueshmeria', label: 'Orari dhe vijueshmëria', icon: CalendarDays },
      { key: 'pushimet', label: 'Pushimet, vendimet dhe raportet', icon: FileText },
      { key: 'pagat', label: 'Pagat', icon: UserCog },
    ],
  },
  {
    group: 'Administrata tatimore',
    icon: Percent,
    items: [
      { key: 'tvsh', label: 'Formulari i TVSH-së dhe librat', icon: Percent },
      { key: 'librat_atk', label: 'Libri i shitjes dhe i blerjes (ATK)', icon: BookOpen },
      { key: 'tvsh_permbledhje', label: 'TVSH sipas normave', icon: FileBarChart },
      { key: 'tatimet', label: 'Tatimet e tjera dhe afatet', icon: CalendarDays },
    ],
  },
  { group: 'Inventari', icon: Warehouse, items: [{ key: 'inventari', label: 'Artikujt, stoku dhe depot', icon: Warehouse }] },
  {
    group: 'Arka KontoSef',
    icon: Store,
    items: [
      { key: 'arka', label: 'Arka (shitjet e arkës)', icon: ArrowLeftRight, kasaOnly: true },
      { key: 'stoku', label: 'Stoku', icon: Package, kasaOnly: true },
    ],
  },
  { group: 'Kompania', icon: Building2, items: [{ key: 'klienti', label: 'Të dhënat e kompanisë', icon: Building2 }, { key: 'zyra', label: 'Zyra: kontrata, detyrat, kërkesat', icon: Briefcase }, { key: 'arkiva', label: 'Arkiva e dokumenteve', icon: Archive }] },
]

const longDate = new SqDateFormat({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Belgrade' })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase()

/**
 * Layout of one company in KontoSef Kontabilist: light sidebar with grouped sections and a menu search,
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
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0F2F5] text-[13px] font-semibold text-[#344054]">{initial(name)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-tight text-ink">{name}</div>
          <div className="text-[12px] text-muted">Kontabilist</div>
        </div>
        <button type="button" onClick={() => void doSignOut()} title="Dil" aria-label="Dil" className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-[#F0F2F5] hover:text-ink">
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      <button type="button" onClick={() => navigate('/')} className="mx-3 mt-3 flex items-center gap-3 rounded-card border border-line bg-[#F9FAFB] px-3 py-2.5 text-left hover:border-field hover:bg-white" title="Kalo te një kompani tjetër">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl border border-line bg-white text-muted">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-[0.05em] text-muted">Kompania aktive</span>
          <span className="block truncate text-[14px] font-semibold text-ink">{client?.name ?? '…'}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted" />
      </button>

      <div className="relative mx-3 mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko në menu…" className="h-9 w-full rounded-ctl border border-field bg-white pl-9 pr-3 text-[14px] focus:border-brand-600 focus:outline-none focus:ring-[3px] focus:ring-brand-600/15" />
      </div>

      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-4" aria-label="Menyja e kompanisë">
        {groups.map((g) => {
          const open = q.trim() !== '' || !closed[g.group]
          return (
            <div key={g.group} className="mt-2">
              <button type="button" onClick={() => setClosed({ ...closed, [g.group]: open })} className="flex w-full items-center gap-2 rounded-ctl px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#98A2B3] hover:text-muted">
                <g.icon className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{g.group}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
              </button>
              {open && (
                <div className="flex flex-col gap-0.5">
                  {g.items.map((i) => (
                    <NavLink
                      key={i.key}
                      to={i.key === 'paneli' ? `/klient/${id}` : `/klient/${id}/${i.key}`}
                      end
                      className={() => cn('flex min-h-[36px] items-center gap-2.5 rounded-ctl px-2.5 text-[14px] font-medium', active === i.key ? 'bg-brand-100 text-brand-700' : 'text-[#344054] hover:bg-[#F5F6F8] hover:text-ink')}
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
        <div className="fixed inset-0 z-50 flex bg-[#0F172A]/45 md:hidden" onClick={() => setDrawer(false)}>
          <div className="h-full w-[300px] max-w-[85vw] pt-safe shadow-pop" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
          <button type="button" aria-label="Mbyll menunë" className="m-3 flex h-10 w-10 items-center justify-center rounded-full bg-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="min-w-0 flex-1 pt-safe md:pt-0">
        <div className="sticky top-0 z-30 px-3 pt-3 md:px-6 md:pt-4">
          <header className="flex min-h-[60px] flex-wrap items-center gap-3 rounded-card border border-line bg-white/95 px-3 py-2 shadow-card backdrop-blur md:px-5">
            <button type="button" aria-label="Menyja" onClick={() => setDrawer(true)} className="flex h-10 w-10 items-center justify-center rounded-ctl border border-line text-ink md:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <LogoMark size={32} />
            <div className="hidden min-w-0 sm:block">
              <div className="text-[15px] font-semibold leading-tight tracking-[-0.015em] text-ink">KontoSef Kontabilist</div>
              <div className="truncate text-[12px] text-muted">{me.accountant?.office_name || 'Kontabilist'}</div>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{toolbar}</div>
          </header>
        </div>

        <div className="px-3 pb-10 pt-4 md:px-6 md:pt-5">
          <section className="mb-4 rounded-[16px] border border-line bg-white px-5 py-4 shadow-sm md:mb-5 md:px-7 md:py-5">
            <h1 className="flex flex-wrap items-center gap-2.5 text-[22px] font-semibold tracking-[-0.015em] leading-tight md:text-[26px]">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600"><Building2 className="h-4 w-4" /></span>
              {client?.name ?? '…'}
              {linked && <span className="rounded-full border border-[#D3DEF2] bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">Lidhur me KontoSef</span>}
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
