import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { FullScreenLoader, RequireBusiness, RequireManager, RequirePlatformAdmin, RequireType } from './AuthGuard'
import { AppLayout } from './layout/AppLayout'
import { LandingPage } from '@/features/landing/LandingPage'
import { DownloadPage } from '@/features/download/DownloadPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PlatformPage } from '@/features/platform/PlatformPage'
import { ComingSoon } from '@/features/ComingSoon'
import { useBusiness } from './AuthProvider'
import { businessType, isManagerRole } from '@/lib/business'
import { supabaseConfigured } from '@/lib/supabase'

/** "/" – visitors see the website, signed-in users their panel. */
function Home() {
  const { status, ctx } = useAuth()
  if (!supabaseConfigured || status === 'anonymous') return <LandingPage />
  if (status === 'loading') return <FullScreenLoader />
  if (ctx?.is_platform_admin && !ctx.profile) return <Navigate to="/platforma" replace />
  return (
    <RequireBusiness>
      <AppLayout />
    </RequireBusiness>
  )
}

function CatalogSoon() {
  const { business } = useBusiness()
  return <ComingSoon title={businessType(business.type).terms.catalog} phase="Faza 2 – Katalogu" />
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
            <PlatformPage />
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
              <CatalogSoon />
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
