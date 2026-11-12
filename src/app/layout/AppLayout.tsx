import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { ensureDeviceLinked, getLink } from '@/lib/deviceLink'
import { isSefApp } from '@/lib/device'
import { ClockBar, FiscalBar, OfflineBar } from '@/app/AppStatus'
import { LicenseBanner } from '@/app/LicenseBanner'
import { TillFiscalBanner } from '@/features/fiscal/TillFiscalCard'
import { useQueryClient } from '@tanstack/react-query'
import { fetchCategories, fetchProducts } from '@/features/products/api'
import { fetchEntries, fetchSuppliers } from '@/features/stock/api'
import { hasModule } from '@/lib/business'
import { useAuth, useBusiness } from '@/app/AuthProvider'
import { navFor, type NavItem } from '@/app/nav'
import { LogoMark } from '@/components/Logo'
import { businessType, isManagerRole, ROLE_LABELS } from '@/lib/business'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { WorkerShell } from './WorkerShell'

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
      <main className="min-w-0 flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] pt-safe md:pb-0 md:pt-0">
        <LicenseBanner />
        {children}
      </main>
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

  // While online, load the main lists once so the screens also open without internet later
  // (they are kept encrypted on the device, see lib/queryPersist).
  const qc = useQueryClient()
  useEffect(() => {
    if (!isManagerRole(profile.role) || !navigator.onLine) return
    const opts = { staleTime: 5 * 60_000 }
    void qc.prefetchQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true), ...opts })
    void qc.prefetchQuery({ queryKey: ['categories'], queryFn: fetchCategories, ...opts })
    if (hasModule(business.type, 'stock')) {
      void qc.prefetchQuery({ queryKey: ['stock', 'suppliers'], queryFn: fetchSuppliers, ...opts })
      void qc.prefetchQuery({ queryKey: ['stock', 'entries'], queryFn: () => fetchEntries(), ...opts })
    }
  }, [qc, profile.role, business.type])

  // SEF app: a session left from an older version (e-mail sign-in) or from another business is closed,
  // so the till always opens on its own business's PIN screen (or asks for the activation key).
  const { signOut } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isSefApp) return
    let alive = true
    void getLink().then(async (l) => {
      if (!alive || (l && l.business_id === business.id)) return
      await signOut()
      navigate('/login', { replace: true })
    })
    return () => {
      alive = false
    }
  }, [business.id, signOut, navigate])

  // The installed SEF app keeps its link alive (heartbeat, register of the till). The web app has no PIN
  // sign-in, so browsers are never linked as devices (they would take the license's device slots).
  useEffect(() => {
    if (!isSefApp || profile.role === 'accountant') return
    void ensureDeviceLinked({ id: business.id, name: business.name }, isManagerRole(profile.role)).catch(() => undefined)
  }, [business.id, business.name, profile.role])

  if (profile.role === 'worker') {
    return (
      <WorkerShell type={business.type} businessName={business.name} userName={profile.full_name || 'Punëtori'} userSub={sub} tabs={main}>
        <ClockBar />
        <OfflineBar />
        {isSefApp && <FiscalBar />}
        {isSefApp && <TillFiscalBanner />}
        <Outlet />
      </WorkerShell>
    )
  }

  return (
    <Shell
      brand={
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold leading-tight">{business.name}</div>
            <div className="truncate text-xs text-white/60">{profile.role === 'accountant' ? `Klient · ${info.shortLabel}` : business.city || info.label}</div>
          </div>
        </div>
      }
      main={main}
      bottom={bottom}
      userName={profile.full_name || profile.email || 'Përdorues'}
      userSub={sub}
    >
      <ClockBar />
      <OfflineBar />
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
