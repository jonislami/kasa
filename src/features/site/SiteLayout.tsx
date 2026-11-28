import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Menu, X } from 'lucide-react'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/cn'

/**
 * The public site of KontoSef.app: one header with the two paths (the business at the till, the accounting office),
 * "Hyr" always visible, and a footer. The pages show the program itself – its own components with demo data in
 * device frames – not stock photos.
 */
export const BUSINESS_PAGES = [
  { to: '/biznese/tregti', label: 'Tregti me pakicë', sub: 'Market, dyqan, butik' },
  { to: '/biznese/gastronomi', label: 'Gastronomi', sub: 'Kafiteri, restorant, piceri' },
  { to: '/biznese/barnatore', label: 'Barnatore', sub: 'Seria dhe afati i barnave' },
  { to: '/biznese/sherbime', label: 'Shërbime', sub: 'Sallon, servis, studio' },
]

function BusinessMenu({ onPick }: { onPick?: () => void }) {
  return (
    <div className="grid gap-1 p-2 sm:w-[320px]">
      {BUSINESS_PAGES.map((p) => (
        <Link key={p.to} to={p.to} onClick={onPick} className="rounded-ctl px-3 py-2.5 hover:bg-[#F3F5F8]">
          <span className="block text-[14px] font-semibold text-ink">{p.label}</span>
          <span className="block text-[13px] text-muted">{p.sub}</span>
        </Link>
      ))}
    </div>
  )
}

const navLink = ({ isActive }: { isActive: boolean }) => cn('rounded-ctl px-3 py-2 text-[14px] font-medium hover:bg-[#F3F5F8]', isActive ? 'text-brand-700' : 'text-[#344054]')

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [biz, setBiz] = useState(false)
  const location = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setOpen(false)
    setBiz(false)
  }, [location.pathname])
  useEffect(() => {
    if (!biz) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setBiz(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [biz])
  const inBusiness = location.pathname.startsWith('/biznese')

  return (
    <>
      <SafeAreaStrip />
      <header className="sticky top-0 z-40 border-b border-line bg-white pt-safe">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-2 px-5">
          <Link to="/" aria-label="KontoSef.app – kryefaqja" className="mr-4">
            <Logo size={30} />
          </Link>
          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Menyja kryesore">
            <NavLink to="/si-funksionon" className={navLink}>
              Arka dhe shitjet
            </NavLink>
            <div ref={ref} className="relative">
              <button type="button" onClick={() => setBiz(!biz)} aria-expanded={biz} className={cn('flex items-center gap-1 rounded-ctl px-3 py-2 text-[14px] font-medium hover:bg-[#F3F5F8]', inBusiness ? 'text-brand-700' : 'text-[#344054]')}>
                Për biznesin tënd <ChevronDown className={cn('h-4 w-4', biz && 'rotate-180')} />
              </button>
              {biz && (
                <div className="absolute left-0 top-11 rounded-card border border-line bg-white shadow-pop">
                  <BusinessMenu />
                </div>
              )}
            </div>
            <NavLink to="/pajisjet" className={navLink}>
              Pajisjet
            </NavLink>
            <NavLink to="/kontabilisti" className={navLink}>
              Për kontabilistët
            </NavLink>
            <NavLink to="/fillo" className={navLink}>
              Si të fillosh
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/login" className="flex h-10 items-center rounded-ctl border border-field px-4 text-[14px] font-semibold text-ink hover:bg-[#F7F8FA]">
              Hyr
            </Link>
            <Link to="/regjistrohu" className="hidden h-10 items-center rounded-ctl bg-brand-600 px-4 text-[14px] font-semibold text-white hover:bg-brand-700 sm:flex">
              Regjistro biznesin
            </Link>
            <button type="button" onClick={() => setOpen(!open)} aria-label="Menyja" aria-expanded={open} className="flex h-10 w-10 items-center justify-center rounded-ctl border border-field text-ink lg:hidden">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-line bg-white px-5 pb-6 pt-3 lg:hidden" aria-label="Menyja kryesore">
            <Link to="/si-funksionon" className="block border-b border-line py-3 text-[16px] font-semibold text-ink">
              Arka dhe shitjet
            </Link>
            <div className="border-b border-line py-3">
              <div className="text-[13px] font-semibold uppercase tracking-[0.05em] text-muted">Për biznesin tënd</div>
              <div className="-mx-3 mt-1">
                <BusinessMenu />
              </div>
            </div>
            <Link to="/pajisjet" className="block border-b border-line py-3 text-[16px] font-semibold text-ink">
              Pajisjet dhe printerët
            </Link>
            <Link to="/kontabilisti" className="block border-b border-line py-3 text-[16px] font-semibold text-ink">
              Për kontabilistët
            </Link>
            <Link to="/fillo" className="block py-3 text-[16px] font-semibold text-ink">
              Si të fillosh
            </Link>
            <Link to="/regjistrohu" className="mt-3 flex h-12 items-center justify-center rounded-ctl bg-brand-600 text-[15px] font-semibold text-white">
              Regjistro biznesin
            </Link>
          </nav>
        )}
      </header>
    </>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-[#F7F8FA]">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo size={26} />
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-muted">Arka, kuponi fiskal, stoku dhe raportet për bizneset në Kosovë – dhe programi për kontabilistët e tyre.</p>
        </div>
        <FooterCol
          title="Programi"
          links={[
            ['/si-funksionon', 'Arka dhe shitjet'],
            ['/pajisjet', 'Pajisjet dhe printerët'],
            ['/kontabilisti', 'KontoSef Kontabilist'],
            ['/shkarko', 'Shkarko'],
          ]}
        />
        <FooterCol title="Për biznesin tënd" links={BUSINESS_PAGES.map((p) => [p.to, p.label])} />
        <FooterCol
          title="Llogaria"
          links={[
            ['/fillo', 'Si të fillosh'],
            ['/regjistrohu', 'Regjistro biznesin'],
            ['/login', 'Hyr'],
          ]}
        />
      </div>
      <div className="mx-auto max-w-[1200px] border-t border-line px-5 py-5 text-[13px] text-muted">© {new Date().getFullYear()} KontoSef.app · Prishtinë, Kosovë</div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: string[][] }) {
  return (
    <div className="text-[14px]">
      <div className="font-semibold text-ink">{title}</div>
      <ul className="mt-3 flex flex-col gap-2 text-muted">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="hover:text-ink">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SitePage({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  return (
    <div className="min-h-dvh bg-white text-ink">
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Building blocks of the pages
// ---------------------------------------------------------------------------
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand-600">{children}</div>
}

export function H2({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink md:text-[36px]', className)}>{children}</h2>
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[16px] leading-relaxed text-muted md:text-[17px]', className)}>{children}</p>
}

export function Section({ children, tone = 'white', className, id }: { children: ReactNode; tone?: 'white' | 'gray' | 'dark'; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20', tone === 'gray' && 'bg-[#F5F7FA]', tone === 'dark' && 'bg-brand-900 text-white')}>
      <div className={cn('mx-auto max-w-[1200px] px-5 py-16 md:py-24', className)}>{children}</div>
    </section>
  )
}

export function PrimaryLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-12 items-center rounded-ctl bg-brand-600 px-6 text-[15px] font-semibold text-white hover:bg-brand-700">
      {children}
    </Link>
  )
}

export function SecondaryLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-12 items-center rounded-ctl border border-field bg-white px-6 text-[15px] font-semibold text-ink hover:bg-[#F7F8FA]">
      {children}
    </Link>
  )
}

/** A numbered step with its text, next to the screen that shows it. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[14px] font-semibold text-white">{n}</span>
      <div>
        <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        <div className="mt-1.5 text-[15px] leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  )
}
