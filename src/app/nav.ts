import type { LucideIcon } from 'lucide-react'
import {
  LayoutGrid,
  ShoppingCart,
  Package,
  Truck,
  BarChart3,
  Users,
  CalendarDays,
  Armchair,
  Settings,
  Printer,
  ClipboardList,
} from 'lucide-react'
import { businessType, hasModule, isManagerRole, type BusinessType, type Role } from '@/lib/business'

export interface NavItem {
  to: string
  label: string
  short?: string // label in the phone tab bar
  icon: LucideIcon
}

/**
 * Two separate panels:
 *  - admin/manager: everything of the business
 *  - worker: only what is needed to do the job (no catalog, stock, reports, other workers)
 * The database enforces the same limits with RLS/RPC.
 */
export function navFor(type: BusinessType, role: Role): { main: NavItem[]; bottom: NavItem[] } {
  const info = businessType(type)
  const manager = isManagerRole(role)

  if (!manager) {
    const main: NavItem[] = [{ to: '/', label: 'Paneli', icon: LayoutGrid }]
    if (hasModule(type, 'tables')) main.push({ to: '/tavolinat', label: 'Tavolinat', icon: Armchair })
    if (hasModule(type, 'appointments')) main.push({ to: '/terminet', label: 'Terminet e mia', short: 'Terminet', icon: CalendarDays })
    main.push({ to: '/arka', label: hasModule(type, 'tables') ? 'Arka' : 'Arka / Shitja', short: 'Arka', icon: ShoppingCart })
    main.push({ to: '/puna', label: 'Puna ime sot', short: 'Puna ime', icon: ClipboardList })
    return { main, bottom: [{ to: '/cilesimet', label: 'Printeri', icon: Printer }] }
  }

  const main: NavItem[] = [{ to: '/', label: 'Paneli', icon: LayoutGrid }]
  if (hasModule(type, 'tables')) main.push({ to: '/tavolinat', label: 'Tavolinat', icon: Armchair })
  if (hasModule(type, 'appointments')) main.push({ to: '/terminet', label: 'Terminet', icon: CalendarDays })
  main.push({ to: '/arka', label: 'Arka / Shitja', short: 'Arka', icon: ShoppingCart })
  main.push({ to: '/produktet', label: info.terms.catalog, icon: Package })
  if (hasModule(type, 'stock')) main.push({ to: '/stoku', label: 'Stoku & Hyrjet', short: 'Stoku', icon: Truck })
  main.push({ to: '/raportet', label: 'Raportet', icon: BarChart3 })
  main.push({ to: '/puna', label: 'Puna e punëtorëve', short: 'Puna', icon: Users })
  return { main, bottom: [{ to: '/cilesimet', label: 'Cilësimet', icon: Settings }] }
}
