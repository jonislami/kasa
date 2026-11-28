import type { ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { MonitorFrame, PhoneFrame, Scaled, ZoomCallout } from './mockups'
import { ExpiryCloseup, KitchenScreen, PharmacyScreen, PhoneOrder, PosScreen, ScanCloseup, ScreenNote, ServiceCloseup, ServiceScreen } from './screens'
import { BUSINESS_PAGES, Eyebrow, H2, Lead, PrimaryLink, Section, SecondaryLink, SitePage, Step } from './SiteLayout'

interface Story {
  eyebrow: string
  title: string
  lead: string
  steps: { title: string; text: ReactNode }[]
  visual: ReactNode
  zoom: { label: string; node: ReactNode }
  facts: string[]
}

const STORIES: Record<string, Story> = {
  tregti: {
    eyebrow: 'Tregti me pakicë',
    title: 'Market, dyqan ushqimor, butik',
    lead: 'Arkëtari skanon, programi mban stokun. Pronari sheh çfarë po mbaron dhe çfarë hyri nga furnitorët.',
    steps: [
      { title: 'Skano ose kërko', text: 'Barkodi nga skaneri ose kamera; artikujt me peshë me sasinë në kg, deri në 4 decimale.' },
      { title: 'Stoku zbret vetë', text: 'Çdo kupon zbret stokun; kthimi dhe anulimi e kthejnë. Kur sasia bie nën minimumin, artikulli del te paralajmërimet.' },
      { title: 'Hyrja e mallit', text: 'Fatura e furnitorit regjistrohet si hyrje malli; stoku dhe çmimi i blerjes përditësohen.' },
    ],
    visual: (
      <MonitorFrame>
        <Scaled width={1280} height={800}>
          <PosScreen step="scan" />
        </Scaled>
      </MonitorFrame>
    ),
    zoom: { label: 'Zmadhuar: artikulli i skanuar në kupon', node: <ScanCloseup /> },
    facts: ['Variante madhësi × ngjyrë dhe etiketa për butikët', 'Importi i produkteve nga Excel', 'Inventarizimi me sasinë e numëruar'],
  },
  gastronomi: {
    eyebrow: 'Gastronomi',
    title: 'Nga tavolina deri në kuzhinë',
    lead: 'Kamarieri merr porosinë në telefon. Pijet shkojnë në bar, ushqimi në kuzhinë, dhe llogaria e tavolinës mbetet e hapur deri në pagesë.',
    steps: [
      { title: 'Porosia në tavolinë', text: 'Kamarieri hap tavolinën 7 dhe shton dy makiato, një picë, një sallatë dhe dy ujë.' },
      { title: 'Kuzhina e sheh menjëherë', text: 'Në ekranin e kuzhinës del porosia e re; kuzhinieri e shënon “në përgatitje” dhe pastaj “gati”.' },
      { title: 'Llogaria dhe kuponi', text: 'Kur klienti paguan, tavolina mbyllet me një kupon fiskal; llogaria mund të ndahet.' },
    ],
    visual: (
      <div className="grid items-end gap-6 sm:grid-cols-[0.42fr_1fr]">
        <PhoneFrame>
          <Scaled width={390} height={844}>
            <PhoneOrder />
          </Scaled>
        </PhoneFrame>
        <MonitorFrame stand={false}>
          <Scaled width={1000} height={600}>
            <KitchenScreen />
          </Scaled>
        </MonitorFrame>
      </div>
    ),
    zoom: {
      label: 'Zmadhuar: porosia e re në kuzhinë',
      node: (
        <div className="font-sans text-[#0F172A]">
          <div className="flex items-baseline justify-between">
            <span className="text-[17px] font-semibold">Tavolina 7</span>
            <span className="text-[13px] text-[#5F6B7A]">2 min</span>
          </div>
          <ul className="mt-2 text-[16px]">
            <li>1× Picë Margarita</li>
            <li>1× Sallatë shope</li>
          </ul>
          <div className="mt-3 rounded-[8px] bg-[#1F4FA8] py-2 text-center text-[14px] font-semibold text-white">Fillo përgatitjen</div>
        </div>
      ),
    },
    facts: ['Tavolinat: të lira, të zëna dhe të secilit kamarier', 'Recetat zbresin përbërësit nga stoku', 'Çdo kamarier me PIN-in e vet'],
  },
  barnatore: {
    eyebrow: 'Barnatore',
    title: 'Afati i çdo bari, në çdo shitje',
    lead: 'Çdo hyrje malli ruan serinë dhe afatin. Në arkë shitet e para seria që skadon më herët, dhe pronari sheh çfarë skadon së shpejti.',
    steps: [
      { title: 'Hyrja me seri dhe afat', text: 'Te hyrja e mallit, për çdo bar shkruhen seria (lot) dhe data e skadimit.' },
      { title: 'Kontrolli i afatit', text: 'Te barnat duket çdo seri me sasinë dhe afatin; ajo që skadon brenda 90 ditëve shënohet me të verdhë.' },
      { title: 'Shitja sipas afatit', text: 'Arka zbret nga seria me afatin më të afërt; seritë e skaduara dalin veçmas te stoku.' },
    ],
    visual: (
      <MonitorFrame>
        <Scaled width={1000} height={640}>
          <PharmacyScreen />
        </Scaled>
      </MonitorFrame>
    ),
    zoom: { label: 'Zmadhuar: seria që skadon e para', node: <ExpiryCloseup /> },
    facts: ['Raporti i afateve: brenda 30 dhe 90 ditëve', 'Kthimi i barit i kthehet serisë nga erdhi', 'Normat e TVSH-së E, D, C dhe A sipas barit'],
  },
  sherbime: {
    eyebrow: 'Shërbime',
    title: 'Puna e kryer, e faturuar me punëtorin',
    lead: 'Sallon, servis, studio: shërbimi nuk ka stok, por ka punëtorin që e kreu. Fatura e ruan, dhe komisioni llogaritet vetë.',
    steps: [
      { title: 'Termini', text: 'Klienti ka termin te punëtori; termini kalon nga “në pritje” te “në punë” dhe “kryer”.' },
      { title: 'Fatura e punës', text: 'Shërbimet e kryera hyjnë në faturë me punëtorin e secilit; shtohen edhe produktet e shitura.' },
      { title: 'Komisioni', text: 'Raporti i komisionit tregon vlerën e punës së çdo punëtori dhe komisionin e tij për muajin.' },
    ],
    visual: (
      <MonitorFrame>
        <Scaled width={1000} height={640}>
          <ServiceScreen />
        </Scaled>
      </MonitorFrame>
    ),
    zoom: { label: 'Zmadhuar: shërbimi me punëtorin', node: <ServiceCloseup /> },
    facts: ['Shërbimet me njësinë e tyre (orë, seancë)', 'Çdo punëtor sheh punën e vet të ditës', 'Kuponi fiskal si në çdo arkë'],
  },
}

/** /biznese/:lloji – one page per kind of business, with its own example. */
export function BusinessPage() {
  const { kind = '' } = useParams()
  const s = STORIES[kind]
  if (!s) return <Navigate to="/biznese/tregti" replace />
  return (
    <SitePage>
      <Section tone="gray" className="pb-12 md:pb-16">
        <div className="flex flex-wrap gap-2">
          {BUSINESS_PAGES.map((p) => (
            <Link key={p.to} to={p.to} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${p.to.endsWith(kind) ? 'bg-brand-900 text-white' : 'bg-white text-[#344054] ring-1 ring-line hover:ring-field'}`}>
              {p.label}
            </Link>
          ))}
        </div>
        <div className="mt-8">
          <Eyebrow>{s.eyebrow}</Eyebrow>
          <h1 className="mt-2 max-w-3xl text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[46px]">{s.title}</h1>
          <Lead className="mt-4 max-w-2xl">{s.lead}</Lead>
        </div>
      </Section>
      <Section>
        <div className="grid items-start gap-12 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="flex flex-col gap-7">
            {s.steps.map((st, i) => (
              <Step key={st.title} n={i + 1} title={st.title}>
                {st.text}
              </Step>
            ))}
            <ZoomCallout label={s.zoom.label} className="lg:max-w-[420px]">
              {s.zoom.node}
            </ZoomCallout>
          </div>
          <div>
            {s.visual}
            <ScreenNote>Pamje nga programi · të dhëna shembull</ScreenNote>
          </div>
        </div>
      </Section>
      <Section tone="gray">
        <H2>Edhe këto janë pjesë e arkës</H2>
        <ul className="mt-6 grid gap-x-10 gap-y-3 text-[16px] text-[#344054] md:grid-cols-3">
          {s.facts.map((f) => (
            <li key={f} className="border-l-2 border-brand-600 pl-3">
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap gap-3">
          <PrimaryLink to="/regjistrohu">Regjistro biznesin</PrimaryLink>
          <SecondaryLink to="/si-funksionon">Si funksionon arka</SecondaryLink>
        </div>
      </Section>
    </SitePage>
  )
}
