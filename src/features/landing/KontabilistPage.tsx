import { useQuery } from '@tanstack/react-query'
import { SqDateFormat } from '@/lib/sqDate'
import { LaptopFrame, PaperRoll, Scaled, ZoomCallout } from '@/features/site/mockups'
import { DemoReceipt, ScreenNote } from '@/features/site/screens'
import { BankDemo, ClientPickerDemo, DemoKontabilistTable, SalesBookDemo } from '@/features/site/kontabilistDemo'
import { Eyebrow, H2, Lead, Section, SitePage, Step } from '@/features/site/SiteLayout'

/**
 * /kontabilisti – the page of the accountant's program "KontoSef Kontabilist": one month of a client worked through
 * with demo data, how a till coupon reaches the sales book, the Windows installer (the newest GitHub release with a
 * Kasa-Kontabilist-Setup-*.exe, built with `npm run dist:win:kontabilist`) and the web version.
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

const ALSO = [
  ['Tatimet', 'Deklarata e TVSH-së, lista e pagave dhe Formulari WR, kontrolli para dorëzimit, afatet e çdo klienti.'],
  ['Pagat dhe personeli', 'Kontributet 5% + 5%, tatimi sipas shkallëve, kontratat e punës dhe vendimet për pushim.'],
  ['Kontabiliteti', 'Plani kontabël, ditari, libri kryesor, bilanci provues, mjetet themelore, pasqyrat financiare.'],
  ['Zyra', 'Shumë klientë, ekipi me role, hyrje me dy faktorë dhe portali ku klienti ngarkon faturat.'],
]

export function KontabilistPage() {
  const rel = useQuery({ queryKey: ['kontabilist-release'], queryFn: kontabilistRelease, staleTime: 60_000, retry: 1 })
  const exe = rel.data?.exe
  const version = rel.data?.release.tag_name.replace(/^kontabilist-v/, '')

  return (
    <SitePage>
      {/* intro */}
      <Section tone="gray" className="pb-12 md:pb-16">
        <div className="grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <Eyebrow>KontoSef Kontabilist</Eyebrow>
            <h1 className="mt-2 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[46px]">Programi për zyrat e kontabilitetit</h1>
            <Lead className="mt-4 max-w-xl">Faturat, banka, librat e ATK-së, TVSH-ja dhe pagat e të gjithë klientëve, nga një llogari. Në Windows dhe në shfletues.</Lead>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#shkarko" className="inline-flex h-12 items-center rounded-ctl bg-brand-600 px-6 text-[15px] font-semibold text-white hover:bg-brand-700">
                Shkarko për Windows
              </a>
              <a href={KONTABILIST_WEB} className="inline-flex h-12 items-center rounded-ctl border border-field bg-white px-6 text-[15px] font-semibold text-ink hover:bg-[#F7F8FA]">
                Hape në shfletues
              </a>
            </div>
          </div>
          <div>
            <LaptopFrame>
              <Scaled width={1100} height={560}>
                <DemoKontabilistTable />
              </Scaled>
            </LaptopFrame>
            <ScreenNote>Faturat e shitjes të një klienti · të dhëna shembull</ScreenNote>
          </div>
        </div>
      </Section>

      {/* a month of one client */}
      <Section>
        <div className="max-w-2xl">
          <Eyebrow>Një muaj i një klienti</Eyebrow>
          <H2 className="mt-2">Nga faturat deri te libri i shitjes</H2>
          <Lead className="mt-3">Shembull me klientin “SHEMBULL SH.P.K.” për nëntorin 2026. Të gjitha pamjet janë nga programi, me të dhëna shembull.</Lead>
        </div>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
          <Step n={1} title="Zgjidh klientin">
            Me Ctrl+K shkruan emrin ose NUI-në. Kompania tjetër hapet në të njëjtën faqe ku ishe, pa e humbur punën.
          </Step>
          <ZoomCallout label="Zmadhuar: kërkimi i kompanisë">
            <ClientPickerDemo />
          </ZoomCallout>
        </div>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
          <Step n={2} title="Kontrollo faturat">
            Faturat e muajit me partnerin, NUI-në, bazën, TVSH-në dhe statusin e pagesës. Faturat e skanuara me AI kontrollohen për dyfishime para se të hyjnë.
          </Step>
          <div>
            <LaptopFrame>
              <Scaled width={1100} height={560}>
                <DemoKontabilistTable />
              </Scaled>
            </LaptopFrame>
          </div>
        </div>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
          <Step n={3} title="Rakordo bankën">
            Importon ekstraktin e bankës. Programi i lidh pagesat me faturat sipas shumës dhe numrit; ti e konfirmon lidhjen ose e regjistron rreshtin si shpenzim.
          </Step>
          <div className="overflow-x-auto">
            <div className="min-w-[620px]">
              <BankDemo />
            </div>
          </div>
        </div>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] [&>*]:min-w-0">
          <Step n={4} title="Shkarko librin e shitjes">
            Libri del në skedarin origjinal të ATK-së, i mbushur me kolonat e formularit, gati për ngarkim në EDI. Njësoj edhe libri i blerjes.
          </Step>
          <div>
            <SalesBookDemo />
            <ScreenNote>Kolonat kryesore të librit të shitjes · të dhëna shembull</ScreenNote>
          </div>
        </div>
      </Section>

      {/* from the till to the book */}
      <Section tone="gray">
        <div className="max-w-2xl">
          <Eyebrow>Arka KontoSef → kontabilisti</Eyebrow>
          <H2 className="mt-2">Kuponi i arkës hyn vetë në librin e shitjes</H2>
          <Lead className="mt-3">
            Kur klienti shet me arkën KontoSef dhe të ka shtuar si kontabilist, kuponët fiskalë nuk rishkruhen. Kuponi i mëposhtëm është shitja shembull e “Market Shembull”; në libër
            del si shitje te qytetari (kodi 1), me bazën dhe TVSH-në ndarë sipas normës.
          </Lead>
        </div>
        <div className="mt-10 grid items-center gap-10 lg:grid-cols-[auto_1fr] [&>*]:min-w-0">
          <div className="flex justify-center [zoom:0.8]">
            <PaperRoll label="Kuponi i arkës">
              <DemoReceipt width={80} />
            </PaperRoll>
          </div>
          <div>
            <SalesBookDemo highlightKasa />
            <ScreenNote>Rreshti i theksuar është kuponi i arkës</ScreenNote>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted">
              Kontabilisti i sheh vetëm shitjet, kthimet, stokun dhe raportet e biznesit. Nuk sheh punëtorët, PIN-et, arkat apo cilësimet, dhe pronari ia heq qasjen kur të dojë.
            </p>
          </div>
        </div>
      </Section>

      {/* everything else */}
      <Section>
        <H2>Edhe këto janë në program</H2>
        <dl className="mt-8 grid gap-x-10 gap-y-6 md:grid-cols-2">
          {ALSO.map(([t, d]) => (
            <div key={t} className="border-l-2 border-brand-600 pl-4">
              <dt className="text-[16px] font-semibold">{t}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* download */}
      <Section tone="gray" id="shkarko" className="scroll-mt-20">
        <H2>Shkarko KontoSef Kontabilist</H2>
        <Lead className="mt-3 max-w-2xl">E njëjta llogari dhe të njëjtat të dhëna në Windows dhe në shfletues. Llogarinë e kontabilistit e krijon administratori i KontoSef.app.</Lead>
        <div className="mt-8 grid gap-10 md:grid-cols-2">
          <div>
            <h3 className="text-[20px] font-semibold tracking-[-0.02em]">Windows</h3>
            <div className="mt-1 text-[14px] text-muted">
              {[version && `v${version}`, exe && mb(exe.size), rel.data && dateFmt.format(new Date(rel.data.release.published_at)), 'Windows 10 / 11'].filter(Boolean).join(' · ')}
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              Program në dritaren e vet, me ikonë në desktop. Në instalimin e parë Windows mund të paralajmërojë: zgjidh “Më shumë info” → “Ekzekuto gjithsesi”.
            </p>
            <div className="mt-5">
              {exe ? (
                <a href={exe.browser_download_url} className="inline-flex h-12 items-center rounded-ctl bg-brand-600 px-6 text-[15px] font-semibold text-white hover:bg-brand-700">
                  Shkarko për Windows (.exe)
                </a>
              ) : (
                <span className="inline-flex h-12 items-center rounded-ctl bg-[#E4E7EC] px-6 text-[15px] font-semibold text-muted">{rel.isLoading ? 'Duke ngarkuar…' : 'Së shpejti'}</span>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-[20px] font-semibold tracking-[-0.02em]">Në shfletues</h3>
            <div className="mt-1 text-[14px] text-muted">Chrome, Edge, Firefox, Safari · pa instalim</div>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">Gjithmonë versioni i fundit. Në Chrome ose Edge mund ta instalosh edhe si aplikacion nga menyja e shfletuesit.</p>
            <div className="mt-5">
              <a href={KONTABILIST_WEB} className="inline-flex h-12 items-center rounded-ctl border border-field bg-white px-6 text-[15px] font-semibold text-ink hover:bg-[#F7F8FA]">
                Hape KontoSef Kontabilist
              </a>
            </div>
          </div>
        </div>
      </Section>
    </SitePage>
  )
}
