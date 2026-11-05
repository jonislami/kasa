import { Outlet, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth, useBusiness } from '@/app/AuthProvider'
import { navFor, type NavItem } from '@/app/nav'
import { LogoMark } from '@/components/Logo'
import { businessType, ROLE_LABELS } from '@/lib/business'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

/** Fixed dark strip behind the phone's clock/battery (safe area). */
export function SafeAreaStrip() {
  return <div className="fixed inset-x-0 top-0 z-50 h-safe-top bg-brand-900 md:hidden" />
}

export function Shell({
  brand,
  main,
  bottom,
  userName,
  userSub,
  children,
}: {
  brand: ReactNode
  main: NavItem[]
  bottom: NavItem[]
  userName: string
  userSub: string
  children: ReactNode
}) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const doSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }
  return (
    <div className="flex min-h-dvh">
      <SafeAreaStrip />
      <Sidebar brand={brand} main={main} bottom={bottom} userName={userName} userSub={userSub} onSignOut={doSignOut} />
      <main className="min-w-0 flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] pt-safe md:pb-0 md:pt-0">{children}</main>
      <TabBar items={[...main, ...bottom]} onSignOut={doSignOut} />
    </div>
  )
}

/** Layout of a business (admin panel or worker panel, depending on role). */
export function AppLayout() {
  const { business, profile } = useBusiness()
  const { main, bottom } = navFor(business.type, profile.role)
  const info = businessType(business.type)
  const sub = profile.role === 'worker' ? info.terms.worker : ROLE_LABELS[profile.role]

  return (
    <Shell
      brand={
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold leading-tight">{business.name}</div>
            <div className="truncate text-xs text-white/60">{business.city || info.label}</div>
          </div>
        </div>
      }
      main={main}
      bottom={bottom}
      userName={profile.full_name || profile.email || 'Përdorues'}
      userSub={sub}
    >
      <Outlet />
    </Shell>
  )
}

/** Page header used on every screen: dark on phones, plain on desktop. */
export function PageHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="bg-brand-900 px-5 pb-6 pt-5 text-white md:flex md:items-end md:justify-between md:gap-4 md:bg-transparent md:px-8 md:pb-6 md:pt-8 md:text-ink">
      <div>
        {eyebrow && <div className="text-sm text-white/60 md:text-muted">{eyebrow}</div>}
        <h1 className="text-[26px] font-bold leading-tight md:text-[30px]">{title}</h1>
      </div>
      {actions && <div className="mt-4 flex flex-wrap gap-2 md:mt-0">{actions}</div>}
    </header>
  )
}
