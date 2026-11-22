import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { SafeAreaStrip } from '@/app/layout/AppLayout'
import { Logo } from '@/components/Logo'
import { REGISTRATION_TYPES } from '@/lib/business'

const typeTexts: Record<string, string> = {
  market: 'Market, veshje e këpucë: barkod, madhësi e ngjyra, hyrje malli nga furnitorët, stok minimal dhe porosi.',
  restaurant: 'Kafiterie e restorante: tavolinat, porositë në kuzhinë e bar, ndarja e llogarisë.',
  pharmacy: 'Seria dhe afati i çdo bari, paralajmërime për skadimet, barnat me recetë.',
  boutique: 'Madhësi dhe ngjyra për çdo artikull, etiketa me barkod, ndërrime.',
  salon: 'Shërbimet me njësinë e tyre, pagesa në arkë dhe komisioni i punëtorit.',
}

const features = [
  { title: 'Fiskalizim në ATK', text: 'Arka regjistrohet një herë; çdo kupon nënshkruhet në pajisje dhe dërgohet me numrin fiskal.' },
  { title: 'Raporte financiare', text: 'Shitjet, fitimi dhe TVSH-ja sipas normës (E, D, C, A), sipas ditës, arkës dhe punëtorit.' },
  { title: 'Punon pa internet', text: 'Arka vazhdon të shesë; kuponët ruhen të enkriptuar dhe dërgohen sapo kthehet lidhja.' },
  { title: 'Punëtorë me PIN', text: 'Secili hyn me PIN-in e vet dhe sheh vetëm punën e vet. Anulimet kërkojnë miratimin e menaxherit.' },
  { title: 'Kompjuter dhe telefon', text: 'E njëjta llogari në Windows, Android, iPhone dhe në shfletues.' },
  { title: 'Printer termik', text: 'Printerë 58, 80 dhe 100 mm me Bluetooth ose USB, direkt nga arka.' },
]

const steps = [
  { title: 'Regjistro biznesin', text: 'Plotëso të dhënat një herë dhe zgjidh llojin e biznesit.' },
  { title: 'Merr çelësin e arkës', text: 'Pas aprovimit, shkarko programin dhe aktivizoje me çelësin.' },
  { title: 'Shto produktet dhe shit', text: 'Importo produktet nga Excel, lidh printerin dhe nis kuponin e parë.' },
]

export function PublicHeader() {
  return (
    <>
      <SafeAreaStrip />
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 pt-safe backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-5">
          <Link to="/" aria-label="KontoSef.app">
            <Logo size={30} />
          </Link>
          <nav className="flex items-center gap-1 text-[14px] font-medium text-[#344054]">
            <a href="/#per-ke" className="hidden rounded-ctl px-3 py-2 hover:bg-[#F5F6F8] md:inline">Për kë është</a>
            <a href="/#perfshihet" className="hidden rounded-ctl px-3 py-2 hover:bg-[#F5F6F8] md:inline">Çfarë përfshihet</a>
            <Link to="/shkarko" className="hidden rounded-ctl px-3 py-2 hover:bg-[#F5F6F8] sm:inline">Shkarko</Link>
            <Link to="/regjistrohu" className="ml-2 hidden h-9 items-center rounded-ctl border border-field px-3.5 font-semibold text-ink hover:bg-[#F9FAFB] sm:flex">
              Regjistrohu
            </Link>
            <Link to="/login" className="ml-2 flex h-9 items-center rounded-ctl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
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
    <footer className="border-t border-line bg-white">
      <div className="mx-auto max-w-[1160px] px-5 py-10">
        <div className="grid gap-8 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Logo size={26} />
            <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-muted">
              Arka, stoku, raportet dhe fiskalizimi për bizneset në Kosovë.
            </p>
          </div>
          <div className="text-[14px]">
            <div className="font-semibold text-ink">Produkti</div>
            <ul className="mt-3 flex flex-col gap-2 text-muted">
              <li><a href="/#perfshihet" className="hover:text-ink">Çfarë përfshihet</a></li>
              <li><Link to="/shkarko" className="hover:text-ink">Shkarko</Link></li>
              <li><Link to="/login" className="hover:text-ink">Hyr</Link></li>
            </ul>
          </div>
          <div className="text-[14px]">
            <div className="font-semibold text-ink">Kontakti</div>
            <ul className="mt-3 flex flex-col gap-2 text-muted">
              <li>Prishtinë, Kosovë</li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-2 border-t border-line pt-6 text-[13px] text-muted sm:flex-row">
          <span>© {new Date().getFullYear()} KontoSef.app</span>
          <span>Kushtet e përdorimit · Privatësia</span>
        </div>
      </div>
    </footer>
  )
}

/** A real screen of the program in a quiet window frame (demo data, no real business). */
function Screen({ src, alt, title, className, width, height }: { src: string; alt: string; title: string; className?: string; width: number; height: number }) {
  return (
    <figure className={`overflow-hidden rounded-card border border-line bg-white shadow-pop ${className ?? ''}`}>
      <div className="flex h-8 items-center gap-1.5 border-b border-line bg-[#F9FAFB] px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#E4E7EC]" />
        <span className="ml-3 truncate text-[11px] font-medium text-muted">{title}</span>
      </div>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className="block h-auto w-full" />
    </figure>
  )
}

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="max-w-2xl">
      <div className="text-[13px] font-semibold text-brand-600">{eyebrow}</div>
      <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink md:text-[32px]">{title}</h2>
      {text && <p className="mt-3 text-[15px] leading-relaxed text-muted">{text}</p>}
    </div>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-white">
      <PublicHeader />

      {/* Hero */}
      <section className="border-b border-line bg-[linear-gradient(180deg,#FFFFFF_0%,#F3F5F8_100%)]">
        <div className="mx-auto max-w-[1160px] px-5 pt-12 md:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-[13px] font-semibold text-brand-600">Për marketet, kafiteritë dhe bizneset në Kosovë</div>
            <h1 className="mt-4 text-[36px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink md:text-[54px]">
              Shitja, stoku dhe fiskalizimi, në rregull çdo ditë.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">
              KontoSef.app është arka dhe pasqyra financiare për market, kafiteri, barnatore, butik dhe sallon. Punon në kompjuter
              dhe telefon, edhe kur bie interneti.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/regjistrohu" className="flex h-12 items-center gap-2 rounded-ctl bg-brand-600 px-5 text-[15px] font-semibold text-white shadow-card hover:bg-brand-700">
                Regjistro biznesin <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/shkarko" className="flex h-12 items-center rounded-ctl border border-field bg-white px-5 text-[15px] font-semibold text-ink shadow-card hover:bg-[#F9FAFB]">
                Shkarko aplikacionin
              </Link>
            </div>
          </div>
          <Screen
            src="/screens/arka.jpg"
            alt="Arka e KontoSef.app në një market: produktet me stok, fatura me TVSH sipas normës dhe pagesa"
            title="KontoSef.app · Arka e marketit"
            width={1600}
            height={1000}
            className="mx-auto mt-12 max-w-[1060px] translate-y-px rounded-b-none border-b-0 md:mt-16"
          />
        </div>
      </section>

      {/* Markets */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-[1160px] items-center gap-12 px-5 py-16 md:grid-cols-[1fr_auto] md:py-24">
          <div>
            <SectionTitle
              eyebrow="Për marketet"
              title="Barkodi, peshorja dhe stoku – në të njëjtën arkë"
              text="Skano produktin ose kërko me emër, shit me copë ose me kg, dhe stoku ulet vetë. Kuponi del me TVSH të ndarë sipas normës, i nënshkruar dhe i dërguar në ATK."
            />
            <ul className="mt-8 grid gap-4 text-[15px] sm:grid-cols-2">
              {[
                ['Shitje me barkod', 'Skaner USB ose kamera e telefonit; produkti hyn në faturë menjëherë.'],
                ['Copë, kg, pako, litër', 'Djathi, frutat dhe perimet shiten me peshë, deri në gram.'],
                ['Stok i ulët', 'Paralajmërim kur produkti bie nën minimum, dhe lista se çfarë duhet porositur.'],
                ['Hyrjet e mallit', 'Fatura e furnitorit regjistrohet një herë – stoku dhe çmimi i blerjes përditësohen.'],
              ].map(([t, d]) => (
                <li key={t} className="border-l-2 border-brand-600 pl-4">
                  <div className="font-semibold text-ink">{t}</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted">{d}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-end justify-center gap-5">
            <figure className="w-[190px] overflow-hidden rounded-[28px] border-[6px] border-brand-900 bg-white shadow-pop sm:w-[220px]">
              <img src="/screens/arka-telefon.jpg" alt="Arka e marketit në telefon: qumësht, bukë, ujë, djathë me peshë" width={640} height={1385} loading="lazy" decoding="async" className="block h-auto w-full" />
            </figure>
            <figure className="hidden w-[210px] overflow-hidden rounded-card border border-line bg-white shadow-pop sm:block">
              <img src="/screens/kuponi.jpg" alt="Kuponi i printuar 80 mm me TVSH E 18% dhe D 8%" width={520} height={1090} loading="lazy" decoding="async" className="block h-auto w-full" />
            </figure>
          </div>
        </div>
      </section>

      {/* Cafés and restaurants */}
      <section className="border-y border-line bg-[#F7F8FA]">
        <div className="mx-auto max-w-[1160px] px-5 py-16 md:py-24">
          <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
            <SectionTitle
              eyebrow="Për kafiteritë dhe restorantet"
              title="Tavolinat, porositë dhe kuzhina, me një shikim"
              text="Kamarieri sheh menjëherë cilat tavolina janë të lira, të zëna ose të vetat. Porosia shkon në bar ose kuzhinë, llogaria ndahet dhe paguhet në tavolinë."
            />
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-[#344054] md:justify-end">
              {[['bg-[#12B76A]', 'E lirë'], ['bg-brand-600', 'Imja'], ['bg-[#D92D20]', 'E zënë']].map(([c, l]) => (
                <li key={l} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${c}`} /> {l}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-10 grid items-end gap-6 lg:grid-cols-[1fr_auto]">
            <Screen src="/screens/tavolinat.jpg" alt="Tavolinat e kafiterisë: të lira, të zëna dhe të kamarierit, me totalin e secilës" title="KontoSef.app · Tavolinat" width={1600} height={1000} />
            <figure className="mx-auto hidden w-[220px] overflow-hidden rounded-[28px] border-[6px] border-brand-900 bg-white shadow-pop lg:block">
              <img src="/screens/tavolinat-telefon.jpg" alt="Tavolinat në telefonin e kamarierit" width={640} height={1385} loading="lazy" decoding="async" className="block h-auto w-full" />
            </figure>
          </div>
        </div>
      </section>

      {/* Owner's panel */}
      <section className="bg-white">
        <div className="mx-auto max-w-[1160px] px-5 py-16 md:py-24">
          <SectionTitle
            eyebrow="Për pronarin"
            title="Shitjet, fitimi dhe TVSH-ja e ditës – nga kudo"
            text="Paneli tregon shitjet sot dhe krahasimin me dje, fitimin bruto, keshin dhe kartelën, TVSH-në sipas normës dhe çfarë duhet porositur. Raportet dhe puna e çdo punëtori janë një klik larg."
          />
          <Screen src="/screens/paneli.jpg" alt="Paneli i pronarit: shitjet sot, kuponët, fitimi, stoku i ulët, grafiku i javës dhe TVSH sipas normës" title="KontoSef.app · Paneli" width={1600} height={1000} className="mt-10" />
        </div>
      </section>

      <main className="mx-auto max-w-[1160px] px-5">
        {/* Types */}
        <section id="per-ke" className="scroll-mt-20 py-16 md:py-24">
          <SectionTitle
            eyebrow="Për kë është"
            title="Një platformë, e përshtatur për llojin e biznesit"
            text="Kur hapet biznesi zgjidhet lloji, dhe KontoSef.app shfaq vetëm ekranet që të duhen."
          />
          <div className="mt-10 grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
            {REGISTRATION_TYPES.map((t) => (
              <div key={t.code} className="border-b border-line py-6 pr-6 lg:border-b-0">
                <div className="text-[15px] font-semibold text-ink">{t.label}</div>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{typeTexts[t.code]}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="perfshihet" className="scroll-mt-20 pb-16 md:pb-24">
          <SectionTitle eyebrow="Çfarë përfshihet" title="Gjithçka që i duhet arkës dhe kontabilitetit, pa programe shtesë" />
          <div className="mt-10 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ title, text }) => (
              <div key={title} className="bg-white p-6">
                <div className="text-[15px] font-semibold text-ink">{title}</div>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Steps */}
        <section id="si-fillohet" className="scroll-mt-20 pb-16 md:pb-24">
          <SectionTitle eyebrow="Si fillohet" title="Gati për shitje brenda ditës" />
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="border-t-2 border-ink pt-5">
                <div className="num text-[13px] font-semibold text-muted">0{i + 1}</div>
                <div className="mt-2 text-[15px] font-semibold text-ink">{s.title}</div>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Download */}
        <section className="pb-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-card bg-brand-900 px-7 py-9 text-white md:flex-row md:items-center md:px-10">
            <div>
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] md:text-[26px]">Instaloje në pajisjen që përdor</h2>
              <p className="mt-2 text-[15px] text-white/65">Windows, Android, iPhone/iPad, ose direkt në shfletues.</p>
            </div>
            <Link to="/shkarko" className="flex h-11 shrink-0 items-center gap-2 rounded-ctl bg-white px-5 text-[14px] font-semibold text-ink hover:bg-[#F2F4F7]">
              Shkarko <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
