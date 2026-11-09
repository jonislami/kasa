import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { Blocked, FullScreenLoader, SetupMissing } from '@/app/AuthGuard'
import { Shell } from '@/app/layout/AppLayout'
import type { NavItem } from '@/app/nav'
import { LogoMark } from '@/components/Logo'
import { supabaseConfigured } from '@/lib/supabase'
import { fetchMe, type AccMe } from './api'
import { LoginPage } from './LoginPage'

const ClientsPage = lazy(() => import('./ClientsPage').then((m) => ({ default: m.ClientsPage })))
const ClientPage = lazy(() => import('./ClientPage').then((m) => ({ default: m.ClientPage })))

/** Signed-in, active accountant account; anything else gets a clear message. */
function RequireAccountant({ children }: { children: (me: AccMe) => ReactNode }) {
  const { status, session, error } = useAuth()
  const location = useLocation()
  const me = useQuery({ queryKey: ['acc-me', session?.user.id], queryFn: fetchMe, enabled: Boolean(session), staleTime: 5 * 60_000 })
  if (!supabaseConfigured) return <SetupMissing />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (status === 'error') return <Blocked title="Të dhënat nuk u ngarkuan" text={error ?? 'Provo përsëri pas pak.'} />
  if (status === 'loading' || me.isLoading) return <FullScreenLoader />
  if (me.error) return <Blocked title="Programi nuk është aktivizuar ende" text={(me.error as Error).message} />
  const m = me.data!
  if (m.has_business) return <Blocked title="Kjo është llogari biznesi" text="Ky program është për kontabilistët. Bizneset hyjnë në aplikacionin Kasa." />
  if (!m.accountant) return <Blocked title="Llogaria nuk është kontabilist" text="Llogarinë e kontabilistit e krijon administratori i Kasa-s." />
  if (!m.accountant.active) return <Blocked title="Llogaria është çaktivizuar" text="Kontakto administratorin e Kasa-s." />
  return <>{children(m)}</>
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
