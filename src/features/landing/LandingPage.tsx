import { Link } from 'react-router-dom'
import {
  BarChart3,
  Bluetooth,
  KeyRound,
  Laptop,
  ShieldCheck,
  WifiOff,
  Monitor,
  Smartphone,
  Tablet,
  Globe,
} from 'lucide-react'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { LogoMark } from '@/components/Logo'
import { BUSINESS_TYPE_LIST } from '@/lib/business'

const typeTexts: Record<string, string> = {
  market: 'Shitje me barkod, hyrje malli nga furnitorët, stok minimal dhe porosi.',
  restaurant: 'Tavolinat, porositë në kuzhinë e bar, ndarja e llogarisë.',
  pharmacy: 'Seria dhe afati i çdo bari, paralajmërime për skadimet, barnat me recetë.',
  boutique: 'Madhësi dhe ngjyra për çdo artikull, etiketa me barkod, ndërrime.',
  salon: 'Terminet sipas punëtorit, pagesa në arkë dhe komisioni.',
}

const features = [
  { icon: Laptop, title: 'Kompjuter dhe telefon', text: 'E njëjta llogari në Windows, Android, iPhone dhe në shfletues.' },
  { icon: WifiOff, title: 'Punon pa internet', text: 'Arka vazhdon të shesë; faturat dërgohen sapo kthehet lidhja.' },
  { icon: Bluetooth, title: 'Printer me Bluetooth', text: 'Printerë termikë 58 dhe 80mm, me një prekje nga cilësimet.', blue: true },
  { icon: KeyRound, title: 'Arkëtarë me PIN', text: 'Çdo arkëtar hyn me PIN-in e vet dhe sheh vetëm arkën.' },
  { icon: BarChart3, title: 'Raporte', text: 'Shitjet, fitimi, TVSH sipas normës dhe sipas arkëtarit.' },
  { icon: ShieldCheck, title: 'Fiskalizim në ATK', text: 'Arka regjistrohet një herë; çdo faturë dërgohet me numrin fiskal.' },
]

const steps = [
  { title: 'Na kontakto', text: 'Na trego llojin e biznesit dhe sa arka ke. Ne e hapim llogarinë për ty.' },
  { title: 'Merr të dhënat e hyrjes', text: 'Të dërgojmë email-in dhe fjalëkalimin në WhatsApp. Shkarko aplikacionin dhe hyr.' },
  { title: 'Shto produktet dhe shit', text: 'Importo produktet nga Excel, lidh printerin dhe nis faturën e parë.' },
]

export function PublicHeader() {
  return (
    <>
      <SafeAreaStrip />
      <header className="bg-brand-900 pt-safe text-white">
        <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark size={36} />
            <span className="text-xl font-bold">Kasa</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-white/85">
            <a href="/#per-ke" className="hidden hover:text-white md:inline">Për kë është</a>
            <a href="/#perfshihet" className="hidden hover:text-white md:inline">Çfarë përfshihet</a>
            <a href="/#si-fillohet" className="hidden hover:text-white md:inline">Si fillohet</a>
            <Link to="/shkarko" className="hidden hover:text-white sm:inline">Shkarko</Link>
            <Link to="/regjistrohu" className="hidden h-10 items-center rounded-ctl border border-white/25 px-4 font-semibold text-white hover:bg-brand-800 sm:flex">
              Regjistrohu
            </Link>
            <Link to="/login" className="flex h-10 items-center rounded-ctl bg-white px-5 font-semibold text-ink hover:bg-bg">
              Hyr
            </Link>
          </nav>
        </div>
      </header>
    </>
  )
}

export function PublicFooter() {
  return (
    <footer className="bg-brand-900 text-white">
      <div className="mx-auto max-w-[1200px] px-5 py-12">
        <div className="grid gap-8 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark size={32} />
              <span className="text-lg font-bold">Kasa</span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-white/70">
              Arka për bizneset e vogla në Kosovë – market, kafiteri, barnatore, butik dhe sallon.
            </p>
          </div>
          <div className="text-sm">
            <div className="font-semibold">Produkti</div>
            <ul className="mt-3 flex flex-col gap-3 text-white/70">
              <li><a href="/#perfshihet" className="hover:text-white">Çfarë përfshihet</a></li>
              <li><Link to="/shkarko" className="hover:text-white">Shkarko</Link></li>
              <li><Link to="/login" className="hover:text-white">Hyr</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <div className="font-semibold">Kontakti</div>
            <ul className="mt-3 flex flex-col gap-2 text-white/70">
              <li>Prishtinë, Kosovë</li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-2 border-t border-white/10 pt-6 text-xs text-white/60 sm:flex-row">
          <span>© {new Date().getFullYear()} Kasa</span>
          <span>Kushtet e përdorimit · Privatësia</span>
        </div>
      </div>
    </footer>
  )
}

function HeroReceipt() {
  const rows = [
    ['Qumësht i freskët 1L × 2', '€1.90'],
    ['Bukë e bardhë 500g', '€0.50'],
    ['Kafe e bluar 200g', '€2.90'],
  ]
  return (
    <div className="w-full max-w-[500px] rounded-[18px] bg-white p-5 text-ink shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Fatura #01284</span>
        <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-600">Arka 1</span>
      </div>
      <div className="mt-3 divide-y divide-line text-sm">
        {rows.map(([n, p]) => (
          <div key={n} className="flex justify-between py-2.5">
            <span>{n}</span>
            <span className="font-semibold tabular-nums">{p}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-end justify-between border-t border-line pt-4">
        <span className="text-sm text-muted">Totali</span>
        <span className="text-[30px] font-bold tabular-nums">€5.30</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="flex h-12 items-center justify-center rounded-ctl border border-field text-sm font-semibold">Kartelë</div>
        <div className="flex h-12 items-center justify-center rounded-ctl bg-brand-600 text-sm font-semibold text-white">Paguaj kesh</div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-bt-600">
        <Bluetooth className="h-3.5 w-3.5" /> POS-80 Printer · i lidhur
      </div>
    </div>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />

      {/* Hero */}
      <section className="bg-brand-900 text-white">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 pb-16 pt-8 md:grid-cols-2 md:pb-24 md:pt-14">
          <div>
            <span className="inline-block rounded-full border border-brand-400/40 px-3 py-1 text-xs font-medium text-brand-400">
              Për bizneset në Kosovë
            </span>
            <h1 className="mt-5 text-[38px] font-bold leading-[1.05] tracking-tight md:text-[56px]">
              Arka që i njeh shitjet, stokun dhe faturat e tua.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/70">
              Kasa është arka për market, kafiteri, barnatore, butik dhe sallon. Punon në kompjuter dhe telefon, edhe kur bie
              interneti, dhe printon faturën me Bluetooth.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/regjistrohu" className="flex h-[52px] items-center rounded-ctl bg-brand-400 px-6 font-semibold text-brand-900 hover:brightness-105">
                Regjistro biznesin
              </Link>
              <Link to="/shkarko" className="flex h-[52px] items-center rounded-ctl border border-white/20 px-6 font-semibold hover:bg-brand-800">
                Shkarko aplikacionin
              </Link>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <HeroReceipt />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1200px] px-5">
        {/* Types */}
        <section id="per-ke" className="scroll-mt-6 py-16 md:py-20">
          <div className="text-xs font-bold uppercase tracking-widest text-brand-600">Për kë është</div>
          <h2 className="mt-2 max-w-xl text-[30px] font-bold leading-tight tracking-tight md:text-[36px]">
            Një arkë, e përshtatur për llojin e biznesit tënd
          </h2>
          <p className="mt-3 text-muted">Kur hapet biznesi zgjedh llojin, dhe Kasa i shfaq vetëm ekranet që të duhen.</p>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {BUSINESS_TYPE_LIST.map((t) => {
              const Icon = t.icon
              return (
                <div key={t.code} className="rounded-card border border-line bg-white p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="mt-5 font-semibold">{t.label}</div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{typeTexts[t.code]}</p>
                </div>
              )
            })}
          </div>
        </section>

        {/* Features */}
        <section id="perfshihet" className="scroll-mt-6 pb-16 md:pb-20">
          <div className="text-xs font-bold uppercase tracking-widest text-brand-600">Çfarë përfshihet</div>
          <h2 className="mt-2 max-w-xl text-[30px] font-bold leading-tight tracking-tight md:text-[36px]">
            Gjithçka që i duhet arkës, pa programe shtesë
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text, blue }) => (
              <div key={title} className="flex gap-4 rounded-card border border-line bg-white p-6">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${blue ? 'bg-[#E6EDFD] text-bt-600' : 'bg-brand-100 text-brand-600'}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-semibold">{title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Steps */}
        <section id="si-fillohet" className="scroll-mt-6 pb-16 md:pb-20">
          <div className="text-xs font-bold uppercase tracking-widest text-brand-600">Si fillohet</div>
          <h2 className="mt-2 text-[30px] font-bold leading-tight tracking-tight md:text-[36px]">Gati për shitje brenda ditës</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="rounded-card border border-line bg-white p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-900 text-sm font-semibold text-white">{i + 1}</div>
                <div className="mt-4 font-semibold">{s.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Download */}
        <section className="pb-20">
          <div className="grid items-center gap-8 rounded-[20px] border border-line bg-white p-7 md:grid-cols-2 md:p-10">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-brand-600">Shkarko</div>
              <h2 className="mt-2 text-[26px] font-bold tracking-tight md:text-[30px]">Instaloje në pajisjen që përdor</h2>
              <p className="mt-3 text-muted">Windows, Android, iPhone/iPad, ose hape direkt në shfletues.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Monitor, t: 'Windows', s: '.exe' },
                { icon: Smartphone, t: 'Android', s: 'Google Play · APK' },
                { icon: Tablet, t: 'iPhone / iPad', s: 'App Store' },
                { icon: Globe, t: 'Në shfletues', s: 'Chrome, Edge, Safari' },
              ].map(({ icon: Icon, t, s }) => (
                <Link key={t} to="/shkarko" className="flex items-center gap-3 rounded-ctl border border-field px-4 py-3 hover:bg-bg">
                  <Icon className="h-5 w-5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{t}</div>
                    <div className="truncate text-xs text-muted">{s}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
