import { Link } from 'react-router-dom'
import { Globe, Monitor, Smartphone, Tablet } from 'lucide-react'
import { PublicHeader, PublicFooter } from '@/features/landing/LandingPage'
import { Badge, Button } from '@/components/ui'

/** /shkarko – full version (Windows .exe, Play Store, App Store) comes in phase 7b. */
export function DownloadPage() {
  const items = [
    { icon: Monitor, title: 'Windows', sub: 'Instalues .exe', soon: true },
    { icon: Smartphone, title: 'Android', sub: 'Google Play · APK', soon: true },
    { icon: Tablet, title: 'iPhone / iPad', sub: 'App Store', soon: true },
    { icon: Globe, title: 'Në shfletues', sub: 'Chrome, Edge, Safari', soon: false },
  ]
  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <main className="mx-auto max-w-[1000px] px-5 py-12 md:py-16">
        <h1 className="text-[32px] font-bold tracking-tight md:text-[44px]">Instaloje në pajisjen që përdor</h1>
        <p className="mt-3 text-muted">E njëjta llogari punon në të gjitha pajisjet.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {items.map(({ icon: Icon, title, sub, soon }) => (
            <div key={title} className="flex items-center gap-4 rounded-card border border-line bg-white p-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                <Icon className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">{title}</div>
                <div className="text-sm text-muted">{sub}</div>
              </div>
              {soon ? (
                <Badge>Së shpejti</Badge>
              ) : (
                <Link to="/login">
                  <Button size="sm">Hap</Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
