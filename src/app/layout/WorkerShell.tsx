import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChefHat, ClipboardList, LogOut, Menu, Printer, X } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { LogoMark } from '@/components/Logo'
import { hasModule, type BusinessType } from '@/lib/business'
import { cn } from '@/lib/cn'
import type { NavItem } from '@/app/nav'

/**
 * The worker's screen: no sidebar and no tab bar – one dark bar on top and the work itself
 * (tables at a café, the till at a market…). Everything else sits in the small menu on the right.
 * CSS variables let the till/order screens size themselves without the tab bar.
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
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menu, setMenu] = useState(false)
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

  return (
    <div className="min-h-dvh bg-bg" style={{ '--topbar': '56px', '--tabbar': '0px', '--chrome': '56px' } as CSSProperties}>
      <header className="sticky top-0 z-40 bg-brand-900 pt-safe text-white print:hidden">
        <div className="flex h-14 items-center gap-3 px-3 md:px-5">
          <LogoMark size={30} />
          <div className="min-w-0 shrink">
            <div className="truncate text-[15px] font-bold leading-tight">{businessName}</div>
            <div className="truncate text-xs text-white/60">{userName}</div>
          </div>
          {tabs.length > 1 && (
            <nav className="ml-2 flex gap-1 rounded-xl bg-white/10 p-1">
              {tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    cn('flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold', isActive ? 'bg-white text-brand-900' : 'text-white/80 hover:bg-white/10')
                  }
                >
                  <t.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.short ?? t.label}</span>
                </NavLink>
              ))}
            </nav>
          )}
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Menuja"
            onClick={() => setMenu(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="min-w-0 pb-safe">{children}</main>

      {menu && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setMenu(false)}>
          <div className="flex h-full w-[300px] max-w-[85vw] flex-col bg-white pt-safe shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="truncate font-semibold">{userName}</div>
                <div className="truncate text-sm text-muted">{userSub}</div>
              </div>
              <button type="button" aria-label="Mbyll" onClick={() => setMenu(false)} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-bg">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col p-2">
              {[...(tabs.length > 1 ? [] : tabs), ...extra].map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  className={({ isActive }) => cn('flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium', isActive ? 'bg-brand-100 text-brand-600' : 'hover:bg-bg')}
                >
                  <i.icon className="h-5 w-5" />
                  {i.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto border-t border-line p-2 pb-safe">
              <button type="button" onClick={() => void doSignOut()} className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-warn-700 hover:bg-warn-100">
                <LogOut className="h-5 w-5" /> Dil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
