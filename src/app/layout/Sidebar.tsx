import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import type { NavItem } from '@/app/nav'
import { initials } from '@/components/Logo'
import { cn } from '@/lib/cn'

export function Sidebar({
  brand,
  main,
  bottom,
  userName,
  userSub,
  onSignOut,
}: {
  brand: ReactNode
  main: NavItem[]
  bottom: NavItem[]
  userName: string
  userSub: string
  onSignOut: () => void
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col bg-brand-900 px-4 pb-4 pt-6 text-white md:flex">
      <div className="px-2 pb-6">{brand}</div>
      <nav className="flex flex-1 flex-col gap-1">
        {main.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="flex flex-col gap-1 pb-3">
        {bottom.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-white/10 px-2 pt-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-800 text-sm font-semibold">
          {initials(userName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{userName}</div>
          <div className="truncate text-xs text-white/60">{userSub}</div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Dil"
          aria-label="Dil"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-brand-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}

function SideLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end ?? item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors',
          isActive ? 'bg-brand-100 text-brand-900' : 'text-white/85 hover:bg-brand-800 hover:text-white',
        )
      }
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      {item.label}
    </NavLink>
  )
}
