import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { DemoKontabilistTable } from './kontabilistDemo'
import { LaptopFrame, MonitorFrame, PaperRoll, PhoneFrame, Scaled } from './mockups'
import { DemoReceipt, KitchenScreen, PharmacyScreen, PhoneReport, PosScreen, ServiceScreen } from './screens'
import { BUSINESS_PAGES, Eyebrow, H2, Lead, PrimaryLink, Section, SecondaryLink, SitePage } from './SiteLayout'

/** Kryefaqja of KontoSef.app. */
export function HomePage() {
  return (
    <SitePage>
      {/* first view: the title on the left, the counter with the till and the receipt on the right */}
      <section className="border-b border-line bg-[#F5F7FA]">
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 pb-14 pt-10 md:pt-16 lg:grid-cols-[0.9fr_1.1fr] lg:pb-20">
          <div>
            <h1 className="text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink md:text-[52px]">Programi i arkës për bizneset në Kosovë</h1>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-muted md:text-[19px]">
              Skano artikullin, prano pagesën dhe printo kuponin. Në fund të ditës, shiko nga telefoni sa ka shitur secila arkë.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryLink to="/regjistrohu">Regjistro biznesin</PrimaryLink>
              <SecondaryLink to="/si-funksionon">Shiko si funksionon</SecondaryLink>
            </div>
            <p className="mt-6 text-[14px] text-muted">
              Ke llogari?{' '}
              <Link to="/login" className="font-semibold text-brand-600 hover:underline">
                Hyr
              </Link>
            </p>
          </div>
          <div className="relative pb-10 pr-[18%] sm:pr-[20%]">
            <MonitorFrame>
              <Scaled width={1280} height={800}>
                <PosScreen step="scan" />
              </Scaled>
            </MonitorFrame>
            <div className="absolute bottom-0 right-0 [zoom:0.42] sm:[zoom:0.55] xl:[zoom:0.62]">
              <PaperRoll>
                <DemoReceipt width={80} />
              </PaperRoll>
            </div>
          </div>
        </div>
      </section>

      {/* two paths */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col">
            <Eyebrow>Për biznesin</Eyebrow>
            <H2 className="mt-2">Arka në banak, raporti në xhep</H2>
            <Lead className="mt-3">
              Punëtori shet me PIN-in e vet. Pronari sheh shitjet e çdo arke, kesh dhe kartelë, TVSH-në sipas normës dhe stokun që po mbaron – nga telefoni.
            </Lead>
            <div className="mt-8 flex items-end gap-6">
              <div className="w-[46%] max-w-[230px]">
                <PhoneFrame>
                  <Scaled width={390} height={844}>
                    <PhoneReport />
                  </Scaled>
                </PhoneFrame>
              </div>
              <ul className="mb-4 flex-1 space-y-3 text-[15px] text-[#344054]">
                <li className="border-l-2 border-brand-600 pl-3">Kuponi fiskal dërgohet në ATK para se të printohet</li>
                <li className="border-l-2 border-line pl-3">Arka vazhdon të shesë edhe pa internet</li>
                <li className="border-l-2 border-line pl-3">Windows, Android dhe printer termik 58 / 80 mm</li>
              </ul>
            </div>
            <Link to="/si-funksionon" className="mt-8 inline-flex items-center gap-1.5 text-[15px] font-semibold text-brand-600 hover:underline">
              Ndiq një shitje nga skanimi te raporti <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex flex-col">
            <Eyebrow>Për zyrat e kontabilitetit</Eyebrow>
            <H2 className="mt-2">Të gjithë klientët në një program</H2>
            <Lead className="mt-3">
              KontoSef Kontabilist mban faturat, bankën, pagat dhe librat e ATK-së të çdo klienti. Kur klienti shet me arkën KontoSef, kuponët dalin vetë në librin e shitjes.
            </Lead>
            <div className="mt-8">
              <LaptopFrame>
                <Scaled width={1100} height={560}>
                  <DemoKontabilistTable />
                </Scaled>
              </LaptopFrame>
            </div>
            <Link to="/kontabilisti" className="mt-8 inline-flex items-center gap-1.5 text-[15px] font-semibold text-brand-600 hover:underline">
              Shiko një muaj pune të kontabilistit <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </Section>

      {/* by business type */}
      <Section tone="gray">
        <Eyebrow>Për biznesin tënd</Eyebrow>
        <H2 className="mt-2 max-w-2xl">Një arkë, e përshtatur me punën që bën</H2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {[
            { page: BUSINESS_PAGES[0], text: 'Barkod, peshë në kg, stoku minimal dhe hyrjet e mallit nga furnitorët.', screen: <PosScreen step="scan" />, w: 1280, h: 800 },
            { page: BUSINESS_PAGES[1], text: 'Porosia nga tavolina shkon vetë në kuzhinë dhe në bar.', screen: <KitchenScreen />, w: 1000, h: 600 },
            { page: BUSINESS_PAGES[2], text: 'Seria dhe afati i çdo bari; shitet e para ajo që skadon më herët.', screen: <PharmacyScreen />, w: 1000, h: 640 },
            { page: BUSINESS_PAGES[3], text: 'Puna e kryer faturohet me punëtorin; komisioni llogaritet vetë.', screen: <ServiceScreen />, w: 1000, h: 640 },
          ].map(({ page, text, screen, w, h }) => (
            <Link key={page.to} to={page.to} className="group flex flex-col overflow-hidden rounded-card border border-line bg-white hover:border-field">
              <div className="border-b border-line bg-[#F7F8FA] p-4">
                <div className="overflow-hidden rounded-[6px] border border-line">
                  <Scaled width={w} height={h}>
                    {screen}
                  </Scaled>
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[18px] font-semibold text-ink">{page.label}</span>
                  <ArrowRight className="h-4 w-4 text-brand-600 transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-1 text-[15px] text-muted">{text}</p>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* start */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <Eyebrow>Si të fillosh</Eyebrow>
            <H2 className="mt-2">Nga regjistrimi te kuponi i parë</H2>
            <ol className="mt-6 space-y-4 text-[16px] text-[#344054]">
              <li>
                <b className="text-ink">1. Regjistro biznesin</b> – të dhënat dhe lloji i biznesit, një herë.
              </li>
              <li>
                <b className="text-ink">2. Prit miratimin</b> – pas aprovimit hapet shkarkimi i programit.
              </li>
              <li>
                <b className="text-ink">3. Merr çelësin e arkës</b> – një çelës për çdo arkë.
              </li>
              <li>
                <b className="text-ink">4. Aktivizo arkën</b> – instalo programin, fut çelësin dhe hyr me PIN.
              </li>
            </ol>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryLink to="/regjistrohu">Regjistro biznesin</PrimaryLink>
              <SecondaryLink to="/fillo">Hapat në detaje</SecondaryLink>
            </div>
          </div>
          <div className="rounded-card border border-line bg-[#F7F8FA] p-6">
            <div className="text-[14px] font-semibold text-ink">Pajisjet që përdor</div>
            <p className="mt-1 text-[14px] text-muted">Printerë termikë 58 dhe 80 mm me Bluetooth ose USB, skaner barkodi, kompjuter me Windows ose telefon Android.</p>
            <Link to="/pajisjet" className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-semibold text-brand-600 hover:underline">
              Pajisjet dhe printerët <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </Section>
    </SitePage>
  )
}
