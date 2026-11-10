import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth, useBusiness } from './AuthProvider'
import { hasModule } from '@/lib/business'
import { Blocked, FullScreenLoader, RequireBusiness, RequireManager, RequirePlatformAdmin, RequireStaff, RequireType } from './AuthGuard'
import { AppLayout } from './layout/AppLayout'
import { workerHome } from './nav'
import { LandingPage } from '@/features/landing/LandingPage'
import { DownloadPage } from '@/features/download/DownloadPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { supabaseConfigured } from '@/lib/supabase'
import { device } from '@/lib/device'

const AccountantsAdminPage = lazy(() => import('@/features/platform/AccountantsPage').then((m) => ({ default: m.AccountantsPage })))
const PlatformPage = lazy(() => import('@/features/platform/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const PosPage = lazy(() => import('@/features/pos/PosPage').then((m) => ({ default: m.PosPage })))
const RefundPage = lazy(() => import('@/features/pos/RefundPage').then((m) => ({ default: m.RefundPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const AuditPage = lazy(() => import('@/features/reports/AuditPage').then((m) => ({ default: m.AuditPage })))
const WorkPage = lazy(() => import('@/features/work/WorkPage').then((m) => ({ default: m.WorkPage })))
const AppointmentsPage = lazy(() => import('@/features/salon/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })))
const TablesPage = lazy(() => import('@/features/restaurant/TablesPage').then((m) => ({ default: m.TablesPage })))
const OrderPage = lazy(() => import('@/features/restaurant/OrderPage').then((m) => ({ default: m.OrderPage })))
const KitchenPage = lazy(() => import('@/features/restaurant/KitchenPage').then((m) => ({ default: m.KitchenPage })))
const MenuItemPage = lazy(() => import('@/features/restaurant/MenuItemPage').then((m) => ({ default: m.MenuItemPage })))
const VariantsPage = lazy(() => import('@/features/products/VariantsPage').then((m) => ({ default: m.VariantsPage })))
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
    // Only "/" itself is the public website (in the browser); inner screens ask for login.
    // The installed apps (Windows, Android, iPhone) open straight on the login screen.
    if (pathname === '/' && device.platform === 'web') return <LandingPage />
    return <Navigate to="/login" replace state={pathname === '/' ? undefined : { from: pathname }} />
  }
  if (status === 'loading') return <FullScreenLoader />
  if (ctx?.is_platform_admin && !ctx.profile) return <Navigate to="/platforma" replace />
  // Accountants work in their own program (Kasa Kontabilist), not in the till app.
  if (ctx?.accountant && ctx.profile?.role !== 'admin' && ctx.profile?.role !== 'manager' && ctx.profile?.role !== 'worker')
    return <Blocked title="Kjo është llogari kontabilisti" text="Hyr me këtë email në programin Kasa Kontabilist. Ky aplikacion është për arkën e bizneseve." />
  return (
    <RequireBusiness>
      <AppLayout />
    </RequireBusiness>
  )
}

/** "/" inside a business: the panel; the accountant lands on the books. */
function Index() {
  const { business, profile } = useBusiness()
  // The worker has no panel: straight to the work (tables, till, appointments).
  if (profile.role === 'worker') return <Navigate to={workerHome(business.type)} replace />
  return <DashboardPage />
}

/** /produktet/:id – boutique: sizes × colours; restaurant: recipe, modifiers, station. */
function ProductDetails() {
  const { business } = useBusiness()
  return hasModule(business.type, 'recipes') ? <MenuItemPage /> : <VariantsPage />
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

      <Route
        path="/platforma/kontabilistet"
        element={
          <RequirePlatformAdmin>
            <Lazy>
              <AccountantsAdminPage />
            </Lazy>
          </RequirePlatformAdmin>
        }
      />

      <Route path="/" element={<Home />}>
        <Route index element={<Index />} />
        <Route
          path="arka"
          element={
            <RequireStaff>
              <Lazy>
                <PosPage />
              </Lazy>
            </RequireStaff>
          }
        />
        <Route
          path="arka/kthim"
          element={
            <RequireStaff>
              <Lazy>
                <RefundPage />
              </Lazy>
            </RequireStaff>
          }
        />
        <Route
          path="puna"
          element={
            <RequireStaff>
              <Lazy>
                <WorkPage />
              </Lazy>
            </RequireStaff>
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
            <RequireStaff>
              <Lazy>
                <SettingsPage />
              </Lazy>
            </RequireStaff>
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
          path="produktet/:id"
          element={
            <RequireManager>
              <Lazy>
                <ProductDetails />
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
              <Lazy>
                <AppointmentsPage />
              </Lazy>
            </RequireType>
          }
        />
        <Route
          path="tavolinat"
          element={
            <RequireType type="restaurant">
              <Lazy>
                <TablesPage />
              </Lazy>
            </RequireType>
          }
        />
        <Route
          path="tavolinat/:tableId"
          element={
            <RequireType type="restaurant">
              <Lazy>
                <OrderPage />
              </Lazy>
            </RequireType>
          }
        />
        <Route
          path="kuzhina"
          element={
            <RequireType type="restaurant">
              <Lazy>
                <KitchenPage />
              </Lazy>
            </RequireType>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
