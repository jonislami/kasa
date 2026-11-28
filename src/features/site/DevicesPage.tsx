import type { ReactNode } from 'react'
import { MonitorFrame, PaperRoll, PhoneFrame, Scaled } from './mockups'
import { DemoReceipt, PhoneReport, PosScreen } from './screens'
import { Eyebrow, H2, Lead, PrimaryLink, Section, SitePage } from './SiteLayout'

/** Drawings of the devices (line art in the colours of the site). */
function PrinterArt() {
  return (
    <svg viewBox="0 0 240 200" className="h-auto w-full" role="img" aria-label="Printer termik me kuponin që del">
      <rect x="40" y="70" width="160" height="100" rx="14" fill="#1B2433" />
      <rect x="40" y="70" width="160" height="26" rx="12" fill="#2A3444" />
      <rect x="62" y="86" width="116" height="6" rx="3" fill="#0F1B2D" />
      <path d="M70 89 H170 V20 L163 26 L156 20 L149 26 L142 20 L135 26 L128 20 L121 26 L114 20 L107 26 L100 20 L93 26 L86 20 L79 26 L70 20 Z" fill="#FFFFFF" stroke="#E5E7EB" />
      {[34, 42, 50, 58, 66, 74].map((y) => (
        <rect key={y} x="82" y={y} width={y === 58 ? 40 : 76} height="3" rx="1.5" fill="#CBD2DC" />
      ))}
      <circle cx="176" cy="146" r="6" fill="#3FBF86" />
      <rect x="56" y="140" width="44" height="12" rx="4" fill="#2A3444" />
    </svg>
  )
}

function ScannerArt() {
  return (
    <svg viewBox="0 0 240 200" className="h-auto w-full" role="img" aria-label="Skaner barkodi që lexon barkodin e një produkti">
      <path d="M60 60 L150 40 Q170 36 172 56 L176 92 Q178 108 162 110 L120 116 L104 176 Q100 188 88 186 L76 184 Q64 182 67 170 L82 112 L66 108 Q50 104 52 88 Z" fill="#1B2433" />
      <rect x="150" y="48" width="18" height="52" rx="6" fill="#8AAEEB" opacity="0.9" />
      <path d="M170 74 L230 60 M170 74 L230 88" stroke="#E5484D" strokeWidth="2" opacity="0.75" />
      <rect x="200" y="56" width="34" height="40" rx="3" fill="#FFFFFF" stroke="#D0D5DD" />
      {[204, 208, 211, 215, 219, 222, 226, 229].map((x, i) => (
        <rect key={x} x={x} y="60" width={i % 3 === 0 ? 2.5 : 1.4} height="30" fill="#0F172A" />
      ))}
    </svg>
  )
}

interface Device {
  title: string
  job: string
  tested: string[]
  note?: string
  art: ReactNode
}

const DEVICES: Device[] = [
  {
    title: 'Printer termik',
    job: 'Printon kuponin fiskal pas çdo pagese, në letër 58 ose 80 mm (edhe 100 mm), me QR-në dhe logon fiskale. Mund të prejë letrën dhe të hapë sirtarin e parave.',
    tested: ['Bluetooth nga programi për Windows', 'USB nga programi për Windows', 'Bluetooth nga aplikacioni Android'],
    note: 'Programi mban mend printerin e fundit dhe lidhet përsëri vetë.',
    art: <PrinterArt />,
  },
  {
    title: 'Skaner barkodi',
    job: 'Lexon barkodin e artikullit dhe e shton në kupon pa prekur tastierën. Punon si tastierë, me kabllo ose pa kabllo; në telefon mund të përdoret edhe kamera.',
    tested: ['Skaner barkodi në arkë (si tastierë)'],
    art: <ScannerArt />,
  },
]

/** /pajisjet – the printer, the scanner, the POS computer and the phone; the two receipt widths at the same scale. */
export function DevicesPage() {
  return (
    <SitePage>
      <Section tone="gray" className="pb-12 md:pb-16">
        <Eyebrow>Pajisjet dhe printerët</Eyebrow>
        <h1 className="mt-2 max-w-3xl text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[46px]">Çfarë duhet në banak</h1>
        <Lead className="mt-4 max-w-2xl">Një kompjuter me Windows ose një telefon Android, një printer termik dhe, për marketet, një skaner barkodi. Ja çfarë bën secila pajisje dhe çfarë kemi provuar.</Lead>
      </Section>

      <Section>
        <div className="grid gap-12 md:grid-cols-2">
          {DEVICES.map((d) => (
            <div key={d.title} className="flex flex-col">
              <div className="rounded-card bg-[#F5F7FA] p-8">
                <div className="mx-auto max-w-[280px]">{d.art}</div>
              </div>
              <h2 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">{d.title}</h2>
              <p className="mt-2 text-[16px] leading-relaxed text-muted">{d.job}</p>
              <div className="mt-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-ink">Lidhjet e provuara</div>
              <ul className="mt-2 space-y-1.5 text-[15px] text-[#344054]">
                {d.tested.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#3FBF86]" /> {t}
                  </li>
                ))}
              </ul>
              {d.note && <p className="mt-3 text-[14px] text-muted">{d.note}</p>}
            </div>
          ))}
        </div>
      </Section>

      {/* receipts side by side at the same scale */}
      <Section tone="gray">
        <div className="max-w-2xl">
          <Eyebrow>58 mm dhe 80 mm</Eyebrow>
          <H2 className="mt-2">I njëjti kupon, në dy gjerësi letre</H2>
          <Lead className="mt-3">Të dy kuponët janë vizatuar nga programi në madhësinë e vërtetë të letrës, në të njëjtën shkallë. Në 58 mm teksti është më i vogël dhe rreshtat e gjatë kalojnë në dy rreshta.</Lead>
        </div>
        <div className="mt-10 flex flex-wrap items-start justify-center gap-10 overflow-x-auto pb-2">
          <PaperRoll label="58 mm · 32 shenja në rresht">
            <DemoReceipt width={58} />
          </PaperRoll>
          <PaperRoll label="80 mm · 48 shenja në rresht">
            <DemoReceipt width={80} />
          </PaperRoll>
        </div>
        <p className="mt-6 text-center text-[13px] text-muted">Kupon shembull i “Market Shembull”, pa vlerë fiskale.</p>
      </Section>

      {/* computer and phone */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <MonitorFrame>
              <Scaled width={1280} height={800}>
                <PosScreen step="scan" />
              </Scaled>
            </MonitorFrame>
            <h2 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">Kompjuter POS me Windows</h2>
            <p className="mt-2 text-[16px] leading-relaxed text-muted">
              Programi SEF për Windows 10 / 11 – me ekran me prekje ose me mi dhe tastierë. Shet, printon dhe e mban çelësin e arkës në kompjuter. Punon edhe pa internet; kuponët
              dërgohen sapo kthehet lidhja.
            </p>
            <div className="mt-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-ink">Lidhjet e provuara</div>
            <p className="mt-2 text-[15px] text-[#344054]">Printeri me Bluetooth dhe me USB; skaneri i barkodit.</p>
          </div>
          <div>
            <div className="mx-auto max-w-[260px]">
              <PhoneFrame>
                <Scaled width={390} height={844}>
                  <PhoneReport />
                </Scaled>
              </PhoneFrame>
            </div>
            <h2 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">Telefon me aplikacionin</h2>
            <p className="mt-2 text-[16px] leading-relaxed text-muted">Në Android, telefoni bëhet arkë me printer Bluetooth. Pronari e përdor për raportin e ditës dhe për shitjet e çdo arke.</p>
            <div className="mt-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-ink">Lidhjet e provuara</div>
            <p className="mt-2 text-[15px] text-[#344054]">Printeri me Bluetooth nga aplikacioni Android.</p>
          </div>
        </div>
      </Section>

      <Section tone="gray">
        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <Lead>Programi për Windows dhe aplikacioni Android shkarkohen pas miratimit të biznesit.</Lead>
          <PrimaryLink to="/fillo">Si të fillosh</PrimaryLink>
        </div>
      </Section>
    </SitePage>
  )
}
