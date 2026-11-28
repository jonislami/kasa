import { MonitorFrame, PaperRoll, PhoneFrame, Scaled, ZoomCallout } from './mockups'
import { DemoReceipt, PaymentBox, PhoneReport, PosScreen, ReportCloseup, ScanCloseup, ScreenNote } from './screens'
import { Eyebrow, H2, Lead, PrimaryLink, Section, SecondaryLink, SitePage, Step } from './SiteLayout'

/** /si-funksionon – one complete sale: the item enters the bill, the payment, the printed receipt; then the owner's day. */
export function ArkaPage() {
  return (
    <SitePage>
      <Section tone="gray" className="pb-12 md:pb-16">
        <Eyebrow>Arka dhe shitjet</Eyebrow>
        <h1 className="mt-2 max-w-3xl text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[46px]">Një shitje e plotë, nga skaneri te kuponi</h1>
        <Lead className="mt-4 max-w-2xl">
          Ky është programi i arkës, me një shitje shembull në “Market Shembull”: pesë artikuj, pagesë me kesh dhe kuponi fiskal i printuar në letër 80 mm.
        </Lead>
      </Section>

      {/* 1. the item enters the bill */}
      <Section>
        <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-24">
            <Step n={1} title="Artikulli hyn në faturë">
              Arkëtari skanon barkodin, ose shkruan emrin dhe shtyp Enter. Artikulli hyn në kupon me çmimin dhe normën e TVSH-së që ka te produktet. Djathi me peshë hyn me
              sasinë në kg; sasia ndryshohet me − dhe +.
            </Step>
            <ZoomCallout label="Zmadhuar: kërkimi dhe rreshti i kuponit" className="mt-6 lg:max-w-[420px]">
              <ScanCloseup />
            </ZoomCallout>
          </div>
          <div>
            <MonitorFrame>
              <Scaled width={1280} height={800}>
                <PosScreen step="scan" />
              </Scaled>
            </MonitorFrame>
            <ScreenNote>Arka e programit SEF në Windows · të dhëna shembull</ScreenNote>
          </div>
        </div>
      </Section>

      {/* 2. payment */}
      <Section tone="gray">
        <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-24">
            <Step n={2} title="Regjistrohet pagesa">
              <b>Paguaj</b> (ose F2) hap pagesën: kesh, kartelë ose të dyja bashkë. Për keshin shkruhet sa dha klienti dhe programi tregon kusurin. Me Enter, kuponi nënshkruhet,
              dërgohet në ATK dhe printohet.
            </Step>
            <ZoomCallout label="Zmadhuar: mënyra e pagesës dhe kusuri" className="mt-6 lg:max-w-[420px]">
              <PaymentBox big />
            </ZoomCallout>
          </div>
          <div>
            <MonitorFrame>
              <Scaled width={1280} height={800}>
                <PosScreen step="pay" />
              </Scaled>
            </MonitorFrame>
            <ScreenNote>Pagesa me kesh: €20.00 të dhëna, kusuri del vetë</ScreenNote>
          </div>
        </div>
      </Section>

      {/* 3. the receipt */}
      <Section>
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <Step n={3} title="Printohet kuponi">
              Printeri termik nxjerr kuponin fiskal: tatimpaguesi dhe njësia, artikujt me sasinë dhe çmimin, totali dhe pagesa, TVSH-ja sipas normës (E 18%, D 8%), numri i kuponit,
              NUIKF-ja dhe kodi QR që klienti e verifikon te ATK.
            </Step>
            <p className="mt-6 rounded-ctl border border-line bg-[#F7F8FA] px-4 py-3 text-[14px] text-muted">
              Kuponi në të djathtë është ai që vizaton vetë programi, në madhësinë e vërtetë të letrës 80 mm. Ky është kupon shembull, pa vlerë fiskale.
            </p>
          </div>
          <div className="flex justify-center">
            <PaperRoll label="Kuponi 80 mm, madhësi reale">
              <DemoReceipt width={80} />
            </PaperRoll>
          </div>
        </div>
      </Section>

      {/* the owner's day */}
      <Section tone="gray">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_0.8fr]">
          <div>
            <Eyebrow>Në fund të ditës</Eyebrow>
            <H2 className="mt-2">Çfarë sheh pronari në raportin ditor</H2>
            <Lead className="mt-3">
              Nga telefoni, pronari sheh totalin e ditës dhe çdo arkë veç: kush punoi, sa kuponë, sa kesh dhe sa me kartelë. Poshtë, TVSH-ja sipas normës dhe artikujt që po mbarojnë
              në stok.
            </Lead>
            <ZoomCallout label="Zmadhuar: një arkë në raport" className="mt-6 max-w-[440px]">
              <ReportCloseup />
            </ZoomCallout>
          </div>
          <div className="mx-auto w-full max-w-[290px]">
            <PhoneFrame>
              <Scaled width={390} height={844}>
                <PhoneReport />
              </Scaled>
            </PhoneFrame>
            <ScreenNote>Raporti i ditës në telefonin e pronarit</ScreenNote>
          </div>
        </div>
      </Section>

      <Section>
        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <H2>Gati për arkën e parë?</H2>
            <Lead className="mt-2">Regjistro biznesin; pas miratimit merr çelësin e arkës dhe shkarkon programin.</Lead>
          </div>
          <div className="flex flex-wrap gap-3">
            <PrimaryLink to="/regjistrohu">Regjistro biznesin</PrimaryLink>
            <SecondaryLink to="/pajisjet">Pajisjet që duhen</SecondaryLink>
          </div>
        </div>
      </Section>
    </SitePage>
  )
}
