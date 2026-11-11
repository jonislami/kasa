import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { Blocked, FullScreenLoader, SetupMissing } from '@/app/AuthGuard'
import { Shell } from '@/app/layout/AppLayout'
import type { NavItem } from '@/app/nav'
import { LogoMark } from '@/components/Logo'
import { supabaseConfigured } from '@/lib/supabase'
import { fetchMe, type AccMe } from './api'
import { LoginPage } from './LoginPage'
import { MfaGate } from './MfaGate'
import { mfaStatus } from './office'

const ClientsPage = lazy(() => import('./ClientsPage').then((m) => ({ default: m.ClientsPage })))
const ClientPage = lazy(() => import('./ClientPage').then((m) => ({ default: m.ClientPage })))
const WorkPage = lazy(() => import('./WorkPage').then((m) => ({ default: m.WorkPage })))
const PortalPage = lazy(() => import('./portal/PortalPage').then((m) => ({ default: m.PortalPage })))
const OfficePage = lazy(() => import('./OfficePage').then((m) => ({ default: m.OfficePage })))

/** Signed-in, active accountant account; anything else gets a clear message. */
function RequireAccountant({ children }: { children: (me: AccMe) => ReactNode }) {
  const { status, session, error } = useAuth()
  const location = useLocation()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['acc-me', session?.user.id], queryFn: fetchMe, enabled: Boolean(session), staleTime: 5 * 60_000 })
  // Two-factor login: asked whenever the account has it, required when the office says so.
  const mfa = useQuery({ queryKey: ['mfa', session?.user.id], queryFn: mfaStatus, enabled: Boolean(session), staleTime: 60_000, retry: false })
  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (status === 'error') return <Blocked title="Të dhënat nuk u ngarkuan" text={error ?? 'Provo përsëri pas pak.'} />
  if (status === 'loading' || me.isLoading || mfa.isLoading) return <FullScreenLoader />
  const mfaDone = () => {
    void qc.invalidateQueries({ queryKey: ['mfa'] })
    void qc.invalidateQueries({ queryKey: ['acc-me'] })
  }
  if (mfa.data?.factorId && mfa.data.next === 'aal2' && mfa.data.current !== 'aal2') return <MfaGate mode="verify" factorId={mfa.data.factorId} onDone={mfaDone} />
  if (me.data?.mfa_required) return <MfaGate mode={mfa.data?.factorId ? 'verify' : 'enroll'} factorId={mfa.data?.factorId ?? null} onDone={mfaDone} />
  if (me.error) return <Blocked title="Programi nuk është aktivizuar ende" text={(me.error as Error).message} />
  const m = me.data!
  // A client company's account (0024): its own portal instead of the office program.
  if (!m.accountant && (m.portal_clients ?? 0) > 0) return <Navigate to="/portal" replace />
  if (m.has_business) return <Blocked title="Kjo është llogari biznesi" text="Ky program është për kontabilistët. Bizneset hyjnë në aplikacionin Kasa." />
  if (!m.accountant) return <Blocked title="Llogaria nuk është kontabilist" text="Llogarinë e kontabilistit e krijon administratori i Kasa-s." />
  if (!m.accountant.active) return <Blocked title="Llogaria është çaktivizuar" text="Kontakto administratorin e Kasa-s." />
  return <>{children(m)}</>
}

/** Signed in; the portal itself checks which companies the account may open. */
function RequireSession({ children }: { children: ReactNode }) {
  const { status, error } = useAuth()
  const location = useLocation()
  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (status === 'error') return <Blocked title="Të dhënat nuk u ngarkuan" text={error ?? 'Provo përsëri pas pak.'} />
  if (status === 'loading') return <FullScreenLoader />
  return <>{children}</>
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>
}

/** Layout of the program: dark sidebar on desktop, tab bar on phones (same as Kasa). */
export function AccShell({ me, extra = [], children }: { me: AccMe; extra?: NavItem[]; children: ReactNode }) {
  const nav: NavItem[] = [{ to: '/', label: 'Klientët', icon: Building2, end: true }, ...extra]
  return (
    <Shell
      brand={
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold leading-tight">{me.accountant?.office_name || 'Kasa'}</div>
            <div className="text-xs font-semibold text-brand-400">Kontabilist</div>
          </div>
        </div>
      }
      main={nav}
      bottom={[]}
      userName={me.accountant?.full_name || me.accountant?.email || 'Kontabilist'}
      userSub={me.accountant?.email ?? ''}
    >
      {children}
    </Shell>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAccountant>
            {(me) => (
              <Lazy>
                <ClientsPage me={me} />
              </Lazy>
            )}
          </RequireAccountant>
        }
      />
      <Route
        path="/klient/:id/:tab?"
        element={
          <RequireAccountant>
            {(me) => (
              <Lazy>
                <ClientPage me={me} />
              </Lazy>
            )}
          </RequireAccountant>
        }
      />
      <Route
        path="/portal"
        element={
          <RequireSession>
            <Lazy>
              <PortalPage />
            </Lazy>
          </RequireSession>
        }
      />
      <Route
        path="/puna"
        element={
          <RequireAccountant>
            {(me) => (
              <Lazy>
                <WorkPage me={me} />
              </Lazy>
            )}
          </RequireAccountant>
        }
      />
      <Route
        path="/zyra"
        element={
          <RequireAccountant>
            {(me) => (
              <Lazy>
                <OfficePage me={me} />
              </Lazy>
            )}
          </RequireAccountant>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
