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
  ScrollText,
 BadgeCheck } from 'lucide-react'
import { businessType, hasModule, isManagerRole, type BusinessType, type Role } from '@/lib/business'
import { isSefApp } from '@/lib/device'

export interface NavItem {
  to: string
  label: string
  short?: string // label in the phone tab bar
  icon: LucideIcon
  end?: boolean // active only on the exact path
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
    // The worker has no sidebar (WorkerShell); these are the screens of the job, the first one is home.
    return { main: workerScreens(type), bottom: [] }
  }

  const main: NavItem[] = [{ to: '/', label: 'Paneli', icon: LayoutGrid }]
  // Selling happens only in the installed SEF app; the web app manages the business and shows how it goes.
  if (hasModule(type, 'tables')) main.push({ to: '/tavolinat', label: isSefApp ? 'Tavolinat' : 'Plani i tavolinave', short: 'Tavolinat', icon: Armchair })
  if (hasModule(type, 'appointments')) main.push({ to: '/terminet', label: 'Terminet', icon: CalendarDays })
  if (isSefApp) main.push({ to: '/arka', label: 'Arka / Shitja', short: 'Arka', icon: ShoppingCart })
  main.push({ to: '/produktet', label: info.terms.catalog, icon: Package })
  if (hasModule(type, 'stock')) main.push({ to: '/stoku', label: 'Stoku & Hyrjet', short: 'Stoku', icon: Truck })
  main.push({ to: '/raportet', label: 'Raportet', icon: BarChart3 })
  main.push({ to: '/puna', label: 'Puna e punëtorëve', short: 'Puna', icon: Users })
  main.push({ to: '/regjistri', label: 'Regjistri', icon: ScrollText })
  const bottom: NavItem[] = [{ to: '/cilesimet', label: 'Cilësimet', icon: Settings }]
  if (role === 'admin') bottom.unshift({ to: '/llogaria', label: 'Llogaria dhe abonimi', short: 'Llogaria', icon: BadgeCheck })
  return { main, bottom }
}

/**
 * The worker's screens, only what the job needs:
 *  café / restaurant → the tables (choose a table, add what the guest orders, confirm)
 *  salon             → own appointments and the till
 *  market, pharmacy, boutique → the till
 * "Puna ime sot", the printer and "Dil" are in the worker's menu.
 */
export function workerScreens(type: BusinessType): NavItem[] {
  if (hasModule(type, 'tables')) return [{ to: '/tavolinat', label: 'Tavolinat', icon: Armchair }]
  if (hasModule(type, 'appointments'))
    return [
      { to: '/terminet', label: 'Terminet e mia', short: 'Terminet', icon: CalendarDays },
      { to: '/arka', label: 'Arka', icon: ShoppingCart },
    ]
  return [{ to: '/arka', label: 'Arka', icon: ShoppingCart }]
}

export const workerHome = (type: BusinessType) => workerScreens(type)[0].to
