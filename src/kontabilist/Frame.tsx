import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronsLeft, ChevronsRight, ChevronsUpDown, Keyboard, KeyRound, LogOut, Menu, Search, X } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { LogoMark } from '@/components/Logo'
import { cn } from '@/lib/cn'
import type { AccMe, Client } from './api'
import { GlobalSearch } from './GlobalSearch'
import { MENU, OFFICE_NAV, menuItem } from './nav'
import { PasswordDialog } from './PasswordDialog'
import { ShortcutsDialog } from './shortcuts'
import { fetchOfficeProfile } from './work'
import { setReportClient, setReportOffice } from './reportApi'

const RAIL_KEY = 'acc.nav.rail'
const CLOSED_KEY = 'acc.nav.closed'
const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

/**
 * The one layout of KontoSef Kontabilist: a dark top bar (office, global search, account), a compact left menu
 * (office pages, then the open company's menu, collapsible to icons) and a one-line page header.
 */
export function Frame({
  me,
  client,
  linked = false,
  active,
  title,
  toolbar,
  onPassword,
  children,
}: {
  me: AccMe
  client?: Client | null
  linked?: boolean
  /** Menu key of the company page. */
  active?: string
  /** Page title; company pages take it from the menu. */
  title?: ReactNode
  toolbar?: ReactNode
  onPassword?: () => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const [rail, setRail] = useState(() => load(RAIL_KEY, false))
  const [closed, setClosed] = useState<Record<string, boolean>>(() => load(CLOSED_KEY, {}))
  const [drawer, setDrawer] = useState(false)
  const [search, setSearch] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const [pw, setPw] = useState(false)
  const [keys, setKeys] = useState(false)
  const office = useQuery({ queryKey: ['acc-office-profile'], queryFn: fetchOfficeProfile, staleTime: 5 * 60_000, retry: false })
  const name = me.accountant?.full_name || me.accountant?.email || 'Kontabilist'
  const id = client?.id

  useEffect(() => setDrawer(false), [location.pathname])
  // the Excel reports carry the open company and the office (name, logo) in their title block
  useEffect(() => setReportClient(client ?? null), [client])
  useEffect(() => setReportOffice(office.data?.office_name || me.accountant?.office_name, office.data?.logo), [office.data, me.accountant?.office_name])
  useEffect(() => save(RAIL_KEY, rail), [rail])
  useEffect(() => save(CLOSED_KEY, closed), [closed])

  // global shortcuts: Ctrl+K search, ? list of shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch(true)
      } else if (!typing && e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setKeys(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const groups = useMemo(() => MENU.map((g) => ({ ...g, items: g.items.filter((i) => !i.kasaOnly || linked) })).filter((g) => g.items.length), [linked])
  const here = active ? menuItem(active) : null

  const doSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const link = (key: string) => (key === 'paneli' ? `/klient/${id}` : `/klient/${id}/${key}`)
  const narrow = rail && !drawer

  const nav = (
    <nav className="flex h-full flex-col bg-white" aria-label="Menyja">
      <div className={cn('flex-1 overflow-y-auto py-2', narrow ? 'px-1.5' : 'px-2')}>
        {OFFICE_NAV.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            title={narrow ? i.label : undefined}
            className={({ isActive }) =>
              cn('flex h-8 items-center gap-2.5 rounded-ctl px-2 text-[13px]', isActive && !client ? 'bg-brand-100 font-semibold text-brand-700' : 'text-[#344054] hover:bg-[#F2F4F7]', narrow && 'justify-center px-0')
            }
          >
            <i.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {!narrow && <span className="truncate">{i.label}</span>}
          </NavLink>
        ))}

        {client && (
          <>
            <div className="my-2 border-t border-line" />
            {narrow ? (
              <button type="button" onClick={() => setSearch(true)} title={`${client.name} – ndrysho kompaninë (Ctrl+K)`} className="flex h-8 w-full items-center justify-center rounded-ctl bg-[#F2F4F7] text-[12px] font-bold text-ink">
                {(client.name.trim()[0] ?? '?').toUpperCase()}
              </button>
            ) : (
              <button type="button" onClick={() => setSearch(true)} className="flex w-full items-center gap-2 rounded-ctl border border-line px-2.5 py-1.5 text-left hover:border-field" title="Ndrysho kompaninë (Ctrl+K)">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{client.name}</span>
                  <span className="block truncate text-[11px] text-muted">{[client.nui && `NUI ${client.nui}`, client.vat_registered ? 'TVSH' : 'jo TVSH', linked && 'KontoSef'].filter(Boolean).join(' · ')}</span>
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" />
              </button>
            )}
            {groups.map((g) => {
              const open = narrow || !closed[g.group] || g.items.some((i) => i.key === active)
              return (
                <div key={g.group} className={narrow ? 'mt-1.5' : 'mt-2'}>
                  {!narrow && (
                    <button
                      type="button"
                      onClick={() => setClosed({ ...closed, [g.group]: open })}
                      className="flex h-6 w-full items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8A94A6] hover:text-muted"
                    >
                      <span className="flex-1 text-left">{g.group}</span>
                      <ChevronDown className={cn('h-3 w-3', !open && '-rotate-90')} />
                    </button>
                  )}
                  {open &&
                    g.items.map((i) => (
                      <NavLink
                        key={i.key}
                        to={link(i.key)}
                        end
                        title={narrow ? `${g.group} · ${i.label}` : undefined}
                        className={() =>
                          cn('flex h-8 items-center gap-2.5 rounded-ctl px-2 text-[13px]', active === i.key ? 'bg-brand-100 font-semibold text-brand-700' : 'text-[#344054] hover:bg-[#F2F4F7]', narrow && 'justify-center px-0')
                        }
                      >
                        <i.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                        {!narrow && <span className="truncate">{i.label}</span>}
                      </NavLink>
                    ))}
                </div>
              )
            })}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => setRail(!rail)}
        className={cn('hidden h-9 items-center gap-2 border-t border-line text-[12px] text-muted hover:text-ink md:flex', narrow ? 'justify-center' : 'px-4')}
        title={rail ? 'Zgjero menunë' : 'Ngushto menunë'}
      >
        {rail ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        {!narrow && 'Ngushto menunë'}
      </button>
    </nav>
  )

  return (
    <div className="min-h-dvh bg-bg">
      <div className="fixed inset-x-0 top-0 z-50 h-safe-top bg-brand-900" />
      {/* top bar */}
      <header className="sticky top-0 z-40 bg-brand-900 pt-safe text-white">
        <div className="flex h-12 items-center gap-2 px-2 md:h-11 md:px-3">
          <button type="button" aria-label="Menyja" onClick={() => setDrawer(true)} className="flex h-10 w-10 items-center justify-center rounded-ctl text-white/80 hover:bg-white/10 md:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-2 rounded-ctl px-1.5 py-1 hover:bg-white/[0.06]" title="Kompanitë">
            {office.data?.logo ? <img src={office.data.logo} alt="" className="h-6 w-6 rounded-sm bg-white object-contain" /> : <LogoMark size={24} />}
            <span className="hidden max-w-[220px] truncate text-[13px] font-semibold sm:block">{me.accountant?.office_name || 'KontoSef Kontabilist'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSearch(true)}
            className="mx-auto flex h-8 min-w-0 max-w-[520px] flex-1 items-center gap-2 rounded-ctl bg-white/[0.08] px-3 text-left text-[13px] text-white/60 ring-1 ring-white/10 hover:bg-white/[0.12]"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">Kërko kompani, faturë, partner ose faqe…</span>
            <kbd className="ml-auto hidden shrink-0 rounded-sm bg-white/10 px-1.5 text-[11px] sm:block">Ctrl K</kbd>
          </button>
          <div className="relative">
            <button type="button" onClick={() => setUserMenu((m) => !m)} className="flex h-8 items-center gap-2 rounded-ctl px-2 text-[13px] text-white/85 hover:bg-white/10" aria-label="Llogaria">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold">{(name.trim()[0] ?? '?').toUpperCase()}</span>
              <span className="hidden max-w-[160px] truncate lg:block">{name}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {userMenu && (
              <div className="absolute right-0 top-10 z-50 w-[250px] overflow-hidden rounded-card border border-line bg-white text-[13px] text-ink shadow-pop" onMouseLeave={() => setUserMenu(false)}>
                <div className="border-b border-line px-3.5 py-2.5">
                  <div className="truncate font-semibold">{name}</div>
                  <div className="truncate text-[12px] text-muted">{me.accountant?.email}</div>
                </div>
                <MenuButton icon={KeyRound} label="Ndrysho fjalëkalimin" onClick={() => (setUserMenu(false), onPassword ? onPassword() : setPw(true))} />
                <MenuButton icon={Keyboard} label="Shkurtesat e tastierës (?)" onClick={() => (setUserMenu(false), setKeys(true))} />
                <MenuButton icon={LogOut} label="Dil" onClick={() => void doSignOut()} border />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className={cn('sticky top-11 hidden h-[calc(100dvh-2.75rem)] shrink-0 border-r border-line md:block', rail ? 'w-12' : 'w-[228px]')}>{nav}</aside>
        {drawer && (
          <div className="fixed inset-0 z-50 flex bg-[#0F172A]/40 md:hidden" onClick={() => setDrawer(false)}>
            <div className="h-full w-[290px] max-w-[85vw] pt-safe" onClick={(e) => e.stopPropagation()}>
              {nav}
            </div>
            <button type="button" aria-label="Mbyll menunë" className="m-3 flex h-10 w-10 items-center justify-center rounded-full bg-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        <main className="min-w-0 flex-1">
          {(client || title || toolbar) && (
            <div className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-white px-3 py-2 md:px-5">
              <div className="min-w-0 flex-1">
                {client && (
                  <div className="truncate text-[12px] text-muted">
                    {client.name}
                    {here && ` › ${here.group}`}
                  </div>
                )}
                <h1 className="truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink md:text-[16px]">{title ?? here?.item.label ?? client?.name ?? ''}</h1>
              </div>
              {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
            </div>
          )}
          <div className={cn(client || title ? 'px-3 pb-10 pt-3 md:px-5 md:pt-4' : '')}>{children}</div>
        </main>
      </div>

      <GlobalSearch open={search} onClose={() => setSearch(false)} clientId={id} active={active} linked={linked} />
      {!onPassword && <PasswordDialog open={pw} onClose={() => setPw(false)} />}
      <ShortcutsDialog open={keys} onClose={() => setKeys(false)} />
    </div>
  )
}

function MenuButton({ icon: Icon, label, onClick, border }: { icon: typeof Search; label: string; onClick: () => void; border?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-bg', border && 'border-t border-line')}>
      <Icon className="h-4 w-4 text-muted" /> {label}
    </button>
  )
}
