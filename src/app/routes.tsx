import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { FullScreenLoader, RequireBusiness, RequireManager, RequirePlatformAdmin, RequireType } from './AuthGuard'
import { AppLayout } from './layout/AppLayout'
import { LandingPage } from '@/features/landing/LandingPage'
import { DownloadPage } from '@/features/download/DownloadPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ComingSoon } from '@/features/ComingSoon'
import { useBusiness } from './AuthProvider'
import { isManagerRole } from '@/lib/business'
import { supabaseConfigured } from '@/lib/supabase'

const PlatformPage = lazy(() => import('@/features/platform/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const ProductsPage = lazy(() => import('@/features/products/ProductsPage').then((m) => ({ default: m.ProductsPage })))

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullScreenLoader />}>{children}</Suspense>
}

/** "/" – visitors see the website, signed-in users their panel. */
function Home() {
  const { status, ctx } = useAuth()
  const { pathname } = useLocation()
  if (!supabaseConfigured || status === 'anonymous') {
    // Only "/" itself is the public website; inner screens ask for login.
    return pathname === '/' ? <LandingPage /> : <Navigate to="/login" replace state={{ from: pathname }} />
  }
  if (status === 'loading') return <FullScreenLoader />
  if (ctx?.is_platform_admin && !ctx.profile) return <Navigate to="/platforma" replace />
  return (
    <RequireBusiness>
      <AppLayout />
    </RequireBusiness>
  )
}

function WorkSoon() {
  const { profile } = useBusiness()
  return (
    <ComingSoon
      title={isManagerRole(profile.role) ? 'Puna e punëtorëve' : 'Puna ime sot'}
      phase="Faza 5 – Paneli dhe raportet"
    />
  )
}

function SettingsSoon() {
  const { profile } = useBusiness()
  return <ComingSoon title={isManagerRole(profile.role) ? 'Cilësimet' : 'Printeri'} phase="Faza 6 – Cilësimet, printeri, fatura" />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/shkarko" element={<DownloadPage />} />
      <Route
        path="/platforma"
        element={
          <RequirePlatformAdmin>
            <Lazy>
              <PlatformPage />
            </Lazy>
          </RequirePlatformAdmin>
        }
      />

      <Route path="/" element={<Home />}>
        <Route index element={<DashboardPage />} />
        <Route path="arka" element={<ComingSoon title="Arka / Shitja" phase="Faza 3 – Arka" />} />
        <Route path="puna" element={<WorkSoon />} />
        <Route path="cilesimet" element={<SettingsSoon />} />
        <Route
          path="produktet"
          element={
            <RequireManager>
              <Lazy>
                <ProductsPage />
              </Lazy>
            </RequireManager>
          }
        />
        <Route
          path="stoku"
          element={
            <RequireManager>
              <ComingSoon title="Stoku & Hyrjet" phase="Faza 4 – Stoku" />
            </RequireManager>
          }
        />
        <Route
          path="raportet"
          element={
            <RequireManager>
              <ComingSoon title="Raportet" phase="Faza 5 – Paneli dhe raportet" />
            </RequireManager>
          }
        />
        <Route
          path="terminet"
          element={
            <RequireType type="salon">
              <ComingSoon title="Terminet" phase="Faza 8a – Sallon" />
            </RequireType>
          }
        />
        <Route
          path="tavolinat"
          element={
            <RequireType type="restaurant">
              <ComingSoon title="Tavolinat" phase="Faza 8d – Restorant" />
            </RequireType>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
