import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { ensureDeviceLinked, getLink } from '@/lib/deviceLink'
import { device, isSefApp } from '@/lib/device'
import { supabase } from '@/lib/supabase'
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
    // ATK: the SEF keeps a trail of changes to the software – every new version on this device goes to the audit log
    const key = 'kasa.sef.version'
    const last = localStorage.getItem(key)
    if (last !== device.appVersion) {
      void device.getDeviceId().then((id) =>
        supabase.rpc('log_action', { p_action: 'sef_update', p_entity: 'device', p_entity_id: id, p_details: { from: last, to: device.appVersion, platform: device.platform } }).then(({ error }) => {
          if (!error) localStorage.setItem(key, device.appVersion)
        }),
      )
    }
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
          <LogoMark size={34} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold leading-tight text-ink">{business.name}</div>
            <div className="truncate text-[12px] text-muted">{profile.role === 'accountant' ? `Klient · ${info.shortLabel}` : business.city || info.label}</div>
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
    <header className="bg-brand-900 px-5 pb-5 pt-4 text-white md:flex md:items-end md:justify-between md:gap-4 md:bg-transparent md:px-8 md:pb-5 md:pt-7 md:text-ink">
      <div className="min-w-0">
        {eyebrow && <div className="mb-0.5 text-[13px] text-white/60 md:text-muted">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] md:text-[26px]">{title}</h1>
      </div>
      {actions && <div className="mt-4 flex min-w-0 max-w-full flex-wrap gap-2 md:mt-0 [&>*]:min-w-0 [&>*]:max-w-full">{actions}</div>}
    </header>
  )
}
