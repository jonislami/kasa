import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, MoreHorizontal, X } from 'lucide-react'
import type { NavItem } from '@/app/nav'
import { cn } from '@/lib/cn'

/** Phone navigation (below md): 4 tabs + "Më shumë" sheet with the rest. */
export function TabBar({ items, onSignOut }: { items: NavItem[]; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  // Always 4 tabs at most; "Më shumë" holds the rest and "Dil".
  const visible = items.slice(0, 4)
  const rest = items.slice(4)
  const restActive = rest.some((i) => location.pathname.startsWith(i.to) && i.to !== '/')

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-safe md:hidden">
        <div className="flex">
          {visible.map((item) => (
            <Tab key={item.to} item={item} />
          ))}
          {(
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={cn(
                'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium',
                restActive ? 'text-brand-600' : 'text-muted',
              )}
            >
              <MoreHorizontal className="h-6 w-6" strokeWidth={2} />
              Më shumë
            </button>
          )}
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <div className="w-full rounded-t-[20px] bg-white px-4 pb-safe pt-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 py-2">
              <span className="text-lg font-semibold">Më shumë</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Mbyll" className="flex h-11 w-11 items-center justify-center rounded-xl bg-bg">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col pb-4">
              {rest.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cn('flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-base font-medium', isActive ? 'bg-brand-100 text-brand-600' : 'text-ink')
                    }
                  >
                    <Icon className="h-5 w-5" /> {item.label}
                  </NavLink>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
                className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-base font-medium text-warn-700"
              >
                <LogOut className="h-5 w-5" /> Dil
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Tab({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium',
          isActive ? 'text-brand-600' : 'text-muted',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-6 w-6" strokeWidth={isActive ? 2.2 : 2} />
          {item.short ?? item.label}
        </>
      )}
    </NavLink>
  )
}
