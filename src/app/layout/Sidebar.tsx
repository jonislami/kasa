import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import type { NavItem } from '@/app/nav'
import { initials, Wordmark } from '@/components/Logo'
import { cn } from '@/lib/cn'

/** Desktop navigation (md and up): a quiet light rail, items grouped by function. */
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
  // Items with the same group share one section (in the order the groups first appear).
  const sections: { group?: string; items: NavItem[] }[] = []
  for (const item of main) {
    const s = sections.find((x) => x.group === item.group)
    if (s) s.items.push(item)
    else sections.push({ group: item.group, items: [item] })
  }
  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-white md:flex">
      <div className="border-b border-line px-4 py-4">{brand}</div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        {sections.map((s, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {s.group && <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#98A2B3]">{s.group}</div>}
            {s.items.map((item) => (
              <SideLink key={item.to} item={item} />
            ))}
          </div>
        ))}
      </nav>
      <div className="flex flex-col gap-0.5 px-3 pb-3">
        {bottom.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F0F2F5] text-[12px] font-semibold text-[#344054]">
          {initials(userName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{userName}</div>
          <div className="truncate text-[12px] text-muted">{userSub}</div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Dil"
          aria-label="Dil"
          className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-[#F0F2F5] hover:text-ink"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      <div className="px-4 pb-3 text-[11px] text-[#98A2B3]">
        <Wordmark size={11} className="text-[#98A2B3]" />
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
          'group flex min-h-[38px] items-center gap-2.5 rounded-ctl px-2.5 text-[14px] font-medium transition-colors',
          isActive ? 'bg-brand-100 text-brand-700' : 'text-[#344054] hover:bg-[#F5F6F8] hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('h-[17px] w-[17px]', isActive ? 'text-brand-600' : 'text-[#98A2B3] group-hover:text-muted')} strokeWidth={2} />
          {item.label}
        </>
      )}
    </NavLink>
  )
}
