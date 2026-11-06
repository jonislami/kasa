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
import { supabaseConfigured } from '@/lib/supabase'

const PlatformPage = lazy(() => import('@/features/platform/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const PosPage = lazy(() => import('@/features/pos/PosPage').then((m) => ({ default: m.PosPage })))
const RefundPage = lazy(() => import('@/features/pos/RefundPage').then((m) => ({ default: m.RefundPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const AuditPage = lazy(() => import('@/features/reports/AuditPage').then((m) => ({ default: m.AuditPage })))
const WorkPage = lazy(() => import('@/features/work/WorkPage').then((m) => ({ default: m.WorkPage })))
const StockPage = lazy(() => import('@/features/stock/StockPage').then((m) => ({ default: m.StockPage })))
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
        <Route
          path="arka"
          element={
            <Lazy>
              <PosPage />
            </Lazy>
          }
        />
        <Route
          path="arka/kthim"
          element={
            <Lazy>
              <RefundPage />
            </Lazy>
          }
        />
        <Route
          path="puna"
          element={
            <Lazy>
              <WorkPage />
            </Lazy>
          }
        />
        <Route
          path="regjistri"
          element={
            <RequireManager>
              <Lazy>
                <AuditPage />
              </Lazy>
            </RequireManager>
          }
        />
        <Route
          path="cilesimet"
          element={
            <Lazy>
              <SettingsPage />
            </Lazy>
          }
        />
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
              <Lazy>
                <StockPage />
              </Lazy>
            </RequireManager>
          }
        />
        <Route
          path="raportet"
          element={
            <RequireManager>
              <Lazy>
                <ReportsPage />
              </Lazy>
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
