import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Download, Globe, Monitor } from 'lucide-react'
import { Button } from '@/components/ui'
import { SqDateFormat } from '@/lib/sqDate'
import { PublicFooter, PublicHeader } from './LandingPage'

/**
 * /kontabilisti – the page of the accountant's program "KontoSef Kontabilist": what it does, the Windows installer
 * (the newest GitHub release tagged kontabilist-v…, built with `npm run dist:win:kontabilist`) and the web version.
 */
const REPO = 'jonislami/kasa'
export const KONTABILIST_WEB = ((import.meta.env.VITE_KONTABILIST_URL as string | undefined)?.trim() || 'https://kontabilisti.kontosef.app').replace(/\/$/, '')

interface Asset {
  name: string
  size: number
  browser_download_url: string
}
interface Release {
  tag_name: string
  published_at: string
  draft: boolean
  assets: Asset[]
}

/** The newest release with the Kontabilist installer (its releases never take "latest", which is the till's). */
export async function kontabilistRelease(): Promise<{ release: Release; exe: Asset } | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`GitHub ${r.status}`)
  for (const rel of (await r.json()) as Release[]) {
    if (rel.draft) continue
    const exe = rel.assets.find((a) => /^Kasa-Kontabilist-Setup-.*\.exe$/i.test(a.name))
    if (exe) return { release: rel, exe }
  }
  return null
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`
const dateFmt = new SqDateFormat({ day: 'numeric', month: 'long', year: 'numeric' })

const groups: { title: string; items: string[] }[] = [
  {
    title: 'Dokumentet dhe librat',
    items: [
      'Faturat e shitjes dhe të blerjes me rreshta, proformat, notat kreditore dhe debitore',
      'Skanimi i faturave me AI dhe kontrolli i dyfishimeve',
      'Arka dhe banka, importi i ekstraktit dhe rakordimi me faturat',
      'Plani kontabël, ditari, libri kryesor, bilanci provues, mjetet themelore dhe mbyllja e muajit',
    ],
  },
  {
    title: 'Administrata Tatimore e Kosovës',
    items: [
      'Deklarata e TVSH-së me kutitë e formularit, nga dokumentet e muajit',
      'Libri i shitjes dhe i blerjes në skedarët zyrtarë të ATK-së për EDI',
      'Lista e pagave (CM WM), Formulari WR dhe raporti i blerjeve mbi 500 €',
      'Kontrolli para dorëzimit: gabimet dhe mungesat para se të shkojnë në EDI',
      'Afatet e çdo klienti në një kalendar të përbashkët',
    ],
  },
  {
    title: 'Pagat dhe personeli',
    items: [
      'Pagat me kontributet 5% + 5% dhe tatimin sipas shkallëve në fuqi',
      'Kontratat e punës dhe aktvendimet për pushim në formularët e zyrës',
      'Vijueshmëria, pushimet dhe historiku i çdo punonjësi',
    ],
  },
  {
    title: 'Raportet',
    items: [
      'Pasqyrat financiare, edhe në formatin e SKRF-së',
      'Borxhet e klientëve dhe ndaj furnitorëve sipas vjetërsisë',
      'Çdo raport në Excel me kokën e kompanisë, gati për klientin ose auditorin',
    ],
  },
]

const office = [
  { title: 'Qindra klientë nga një vend', text: 'Kalimi nga një kompani te tjetra pa humbur faqen, kërkimi i çdo fature apo partneri me Ctrl+K.' },
  { title: 'Ekipi me role', text: 'Administrator, kontabilist dhe asistent; secili sheh vetëm klientët që i janë caktuar. Hyrje me dy faktorë.' },
  { title: 'Lidhja me arkën KontoSef', text: 'Kur klienti përdor arkën KontoSef, kuponët fiskalë dalin vetë në librin e shitjes.' },
  { title: 'Portali i klientit', text: 'Klienti ngarkon faturat dhe sheh raportet; kërkesat për dokumente dhe mesazhet në një vend.' },
]

export function KontabilistPage() {
  const rel = useQuery({ queryKey: ['kontabilist-release'], queryFn: kontabilistRelease, staleTime: 60_000, retry: 1 })
  const exe = rel.data?.exe
  const version = rel.data?.release.tag_name.replace(/^kontabilist-v/, '')

  return (
    <div className="min-h-dvh bg-white">
      <PublicHeader />

      {/* intro */}
      <section className="border-b border-line bg-[#F7F8FA]">
        <div className="mx-auto grid max-w-[1160px] gap-10 px-5 py-14 md:grid-cols-[1.3fr_1fr] md:py-20">
          <div>
            <div className="text-[13px] font-semibold text-brand-600">KontoSef Kontabilist</div>
            <h1 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink md:text-[44px]">Programi për zyrat e kontabilitetit</h1>
            <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-muted">
              Librat, TVSH-ja, pagat, deklaratat në ATK dhe pasqyrat financiare të të gjithë klientëve, nga një llogari – për zyrat që mbajnë shumë biznese
              dhe për kompanitë që e mbajnë kontabilitetin vetë.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#shkarko">
                <Button size="lg">
                  <Download className="h-5 w-5" /> Shkarko për Windows
                </Button>
              </a>
              <a href={KONTABILIST_WEB}>
                <Button size="lg" variant="secondary">
                  <Globe className="h-5 w-5" /> Hape në shfletues
                </Button>
              </a>
            </div>
          </div>
          <div className="self-center rounded-card border border-line bg-white p-6 shadow-card">
            <div className="text-[13px] font-semibold text-ink">Çdo muaj, për çdo klient</div>
            <ol className="mt-4 flex flex-col gap-3 text-[14px] text-[#344054]">
              {['Regjistro ose skano faturat', 'Rakordo bankën dhe arkën', 'Kontrollo gabimet para dorëzimit', 'Shkarko librat dhe deklaratat për EDI', 'Llogarit pagat dhe nxirr raportet'].map((s, i) => (
                <li key={s} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[12px] font-semibold text-brand-700">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* what is in it */}
      <section className="mx-auto max-w-[1160px] px-5 py-14 md:py-20">
        <div className="max-w-2xl">
          <div className="text-[13px] font-semibold text-brand-600">Çfarë përfshihet</div>
          <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink md:text-[32px]">E gjithë puna e kontabilistit, sipas kërkesave të ATK-së</h2>
        </div>
        <div className="mt-10 grid gap-x-10 gap-y-9 md:grid-cols-2">
          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="border-b border-line pb-2 text-[15px] font-semibold text-ink">{g.title}</h3>
              <ul className="mt-3 flex flex-col gap-2 text-[14px] leading-relaxed text-muted">
                {g.items.map((it) => (
                  <li key={it} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-brand-600" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* the office */}
      <section className="border-y border-line bg-[#F7F8FA]">
        <div className="mx-auto max-w-[1160px] px-5 py-14 md:py-16">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink md:text-[26px]">Për zyrën dhe ekipin</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {office.map((o) => (
              <div key={o.title} className="rounded-card border border-line bg-white p-5">
                <div className="text-[15px] font-semibold text-ink">{o.title}</div>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{o.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* download */}
      <section id="shkarko" className="mx-auto max-w-[1160px] scroll-mt-20 px-5 py-14 md:py-20">
        <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-ink md:text-[32px]">Shkarko KontoSef Kontabilist</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          E njëjta llogari dhe të njëjtat të dhëna në Windows dhe në shfletues. Llogarinë e kontabilistit e krijon administratori i KontoSef.app.
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="flex flex-col rounded-card border border-line bg-white p-6 shadow-card">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-ctl bg-brand-100 text-brand-600">
                <Monitor className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[17px] font-semibold text-ink">Windows</div>
                <div className="text-[13px] text-muted">
                  {[version && `v${version}`, exe && mb(exe.size), rel.data && dateFmt.format(new Date(rel.data.release.published_at)), 'Windows 10 / 11'].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
            <p className="mt-4 flex-1 text-[14px] leading-relaxed text-muted">
              Program me ikonë në desktop, në dritaren e vet. Në instalimin e parë Windows mund të paralajmërojë: zgjidh “Më shumë info” → “Ekzekuto gjithsesi”.
            </p>
            <div className="mt-5">
              {exe ? (
                <a href={exe.browser_download_url}>
                  <Button block size="lg">
                    <Download className="h-5 w-5" /> Shkarko për Windows (.exe)
                  </Button>
                </a>
              ) : (
                <Button block size="lg" disabled>
                  {rel.isLoading ? 'Duke ngarkuar…' : 'Së shpejti'}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col rounded-card border border-line bg-white p-6 shadow-card">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-ctl bg-brand-100 text-brand-600">
                <Globe className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[17px] font-semibold text-ink">Në shfletues</div>
                <div className="text-[13px] text-muted">Chrome, Edge, Firefox, Safari · pa instalim</div>
              </div>
            </div>
            <p className="mt-4 flex-1 text-[14px] leading-relaxed text-muted">
              Gjithmonë versioni i fundit. Në Chrome ose Edge mund ta instalosh edhe si aplikacion nga menyja e shfletuesit.
            </p>
            <div className="mt-5">
              <a href={KONTABILIST_WEB}>
                <Button block size="lg" variant="secondary">
                  Hape KontoSef Kontabilist <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
            </div>
          </div>
        </div>
        <p className="mt-6 text-[14px] text-muted">
          Për arkën dhe bizneset: <Link to="/" className="font-semibold text-brand-600 hover:underline">KontoSef.app</Link>
        </p>
      </section>

      <PublicFooter />
    </div>
  )
}
