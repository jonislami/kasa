import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { Button } from '@/components/ui'
import { isManagerRole, type BusinessType } from '@/lib/business'
import { supabaseConfigured } from '@/lib/supabase'

export function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
    </div>
  )
}

export function Blocked({ title, text }: { title: string; text: string }) {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-warn-100 text-warn-700">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{text}</p>
        <Button className="mt-6" variant="secondary" block onClick={() => void signOut()}>
          Dil
        </Button>
      </div>
    </div>
  )
}

export function SetupMissing() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="w-full max-w-lg rounded-card border border-line bg-white p-8">
        <h1 className="text-xl font-semibold">Mungon lidhja me Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          Krijo skedarin <code className="font-mono">.env.local</code> (shih <code className="font-mono">.env.example</code>) me{' '}
          <code className="font-mono">VITE_SUPABASE_URL</code> dhe <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>, pastaj rindize
          aplikacionin.
        </p>
      </div>
    </div>
  )
}

/** Signed-in user of an active business. Platform admins without a business go to /platforma. */
export function RequireBusiness({ children }: { children: ReactNode }) {
  const { status, ctx, error } = useAuth()
  const location = useLocation()
  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (status === 'error')
    return <Blocked title="Të dhënat nuk u ngarkuan" text={error ?? 'Provo përsëri pas pak.'} />
  if (!ctx?.profile) {
    if (ctx?.is_platform_admin) return <Navigate to="/platforma" replace />
    if (ctx?.accountant) return <Blocked title="Kjo është llogari kontabilisti" text="Hyr me këtë email në programin Kasa Kontabilist." />
    return <Blocked title="Llogaria nuk ka biznes" text="Kjo llogari nuk është e lidhur me asnjë biznes. Kontakto administratorin." />
  }
  if (!ctx.business?.active) {
    // SEF (0029): the owner of a business that waits (or is suspended) sees the status and the next steps
    if (ctx.profile.role === 'admin' && ctx.business?.status && ctx.business.status !== 'active') return <Navigate to="/llogaria" replace />
    if (ctx.business?.status === 'pending' || ctx.business?.status === 'needs_info' || ctx.business?.status === 'approved')
      return <Blocked title="Biznesi nuk është aktivizuar ende" text="Pronari i biznesit e sheh statusin e aktivizimit te llogaria e tij." />
    return <Blocked title="Biznesi është çaktivizuar" text="Qasja në këtë biznes është ndalur. Kontakto administratorin e platformës." />
  }
  if (!ctx.profile.active)
    return <Blocked title="Llogaria është çaktivizuar" text="Kontakto pronarin ose menaxherin e biznesit." />
  return <>{children}</>
}

/** Admin panel only (admin/manager). Workers are sent to their own panel. */
export function RequireManager({ children }: { children: ReactNode }) {
  const { ctx } = useAuth()
  if (!isManagerRole(ctx?.profile?.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Screens of the people who work in the business (till, own work, printer). Not for the accountant. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { ctx } = useAuth()
  if (ctx?.profile?.role === 'accountant') return <Navigate to="/" replace />
  return <>{children}</>
}

/** Screens that exist only for one business type (e.g. /terminet for salons). */
export function RequireType({ type, children }: { type: BusinessType; children: ReactNode }) {
  const { ctx } = useAuth()
  if (ctx?.business?.type !== type || ctx?.profile?.role === 'accountant') return <Navigate to="/" replace />
  return <>{children}</>
}

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { status, ctx } = useAuth()
  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: '/platforma' }} />
  if (!ctx?.is_platform_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

/** /llogaria: the signed-in owner of a business, active or not (SEF registration, payment, license, Install SEF). */
export function RequireOwner({ children }: { children: ReactNode }) {
  const { status, ctx, error } = useAuth()
  const location = useLocation()
  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (status === 'error') return <Blocked title="Të dhënat nuk u ngarkuan" text={error ?? 'Provo përsëri pas pak.'} />
  if (!ctx?.profile || ctx.profile.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
