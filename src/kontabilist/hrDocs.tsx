import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { kosovoDateISO } from '@/lib/clock'
import type { Client } from './api'
import { entitlement, fullName, returnDay, type Entitlement } from './hr'
import { CONTRACT_LABELS, LEAVE_LABELS, type Employee, type Leave } from './payroll'

const dmy = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '__________')
const blank = (v?: string | number | null, len = 18) => (v == null || v === '' ? '_'.repeat(len) : String(v))
const eur = (v: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const days = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','))

/** Prints its children on A4 (browser print → "Ruaj si PDF") and calls onDone. */
export function PrintPortal({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(() => {
      window.print()
      onDone()
    }, 120)
    return () => clearTimeout(id)
  }, [onDone])
  return createPortal(<div className="print-root print-a4 hidden bg-white font-[Inter] text-[12px] leading-relaxed text-black">{children}</div>, document.body)
}

function CompanyHead({ client }: { client: Client }) {
  return (
    <div className="mb-6 border-b border-black pb-2 text-[11px]">
      <div className="text-[14px] font-bold">{client.name}</div>
      <div>
        {[client.nui && `NUI ${client.nui}`, client.address, client.city].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

function Sign({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-12 grid grid-cols-2 gap-16 text-[12px]">
      <div>
        <div className="mb-10">{left}</div>
        <div className="border-t border-black pt-1">Nënshkrimi</div>
      </div>
      <div>
        <div className="mb-10">{right}</div>
        <div className="border-t border-black pt-1">Nënshkrimi</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Employment contract – the Ministry model "Model i kontratës së punës" (Law on Labour No. 03/L-212)
// ---------------------------------------------------------------------------
export function EmploymentContract({ client, e }: { client: Client; e: Employee }) {
  const fixed = e.contract === 'fixed' || Boolean(e.end_date)
  const partTime = e.contract === 'part_time' || (e.weekly_hours ?? 40) < 40
  const perDay = Math.round(((e.weekly_hours ?? 40) / (e.work_days ?? 5)) * 10) / 10
  const duties = (e.duties ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean)
  const H = ({ n, children }: { n: number; children: ReactNode }) => (
    <p className="mt-4 font-bold">
      {n}. {children}
    </p>
  )
  return (
    <div className="text-justify">
      <p className="text-center text-[15px] font-bold">MODEL I KONTRATËS SË PUNËS PËR</p>
      <p className="mb-4 text-center text-[15px] font-bold">KOHË TË {fixed ? 'CAKTUAR' : 'PACAKTUAR'}</p>
      {e.contract_no && <p className="mb-2 text-right">Nr. {e.contract_no}</p>}
      <p>
        Në bazë të nenit 10 paragrafi 2, nën-paragrafit {fixed ? '2.2' : '2.1'}, dhe nenit 11 të Ligjit të Punës Nr. 03/L-212 i shpallur në Gazetën Zyrtare të Republikës së Kosovës, më dt. 01.12.2010, Punëdhënësi dhe i Punësuari, si subjekte të marrëdhënies juridike të punës, lidhin:
      </p>
      <p className="mt-3 font-bold">
        Kontratë Pune në mes të “{client.name}” me seli në {blank(client.city, 12)} numër unik identifikues të biznesit {blank(client.nui, 12)} dhe adresë {blank(client.address, 14)} të cilin e përfaqëson {blank(client.representative, 16)}, (“punëdhënësi”)
      </p>
      <p className="mt-2">dhe të</p>
      <p className="mt-2">
        {fullName(e)} me numër personal {blank(e.personal_no, 12)}, adresa: {blank([e.address, e.city].filter(Boolean).join(', '), 20)} (“e punësuara / i punësuari”)
      </p>
      <p className="mt-2">Palët pajtohen që të qeverisen nga kushtet e kontratës si në vijim:</p>

      <H n={1}>Punësimi</H>
      <p>
        Entiteti / Kompania {client.name} themelon marrëdhënie pune me kohë të {fixed ? 'caktuar' : 'pacaktuar'} me punëtorën/in {fullName(e)} në pozitën e {blank(e.position, 14)} nën cilësinë e orarit të {partTime ? 'pjesshëm' : 'plotë'} brenda neneve të kësaj kontrate. E punësuara / i punësuari do të zhvillojë detyrat, përgjegjësitë dhe obligimet si në vijim:
      </p>
      <ul className="ml-6 list-disc">
        {(duties.length ? duties : ['_________________________', '_________________________', '_________________________']).map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      <p>E punësuara / I punësuari mund të ushtrojë përgjegjësi dhe detyra tjera të cilat mund të shfaqen dhe të cilat mund të caktohen nga punëdhënësi.</p>

      <H n={2}>Performanca dhe orari i punës</H>
      <p>
        E punësuara / I punësuari duhet të performojë detyrat dhe përgjegjësitë e caktuara në një qasje profesionale, në mirëbesim dhe konform aftësive, shkathtësive, talentit dhe përvojës. Orari {partTime ? 'i punës' : 'i plotë'} gjatë ditës, është: {days(perDay)} orë pune gjatë periudhës nga ora {blank(e.schedule_from, 5)} deri {blank(e.schedule_to, 5)}, ndërsa: {days(e.weekly_hours ?? 40)} orë pune në javë.
      </p>

      <H n={3}>Kohëzgjatja e marrëdhënies së punës</H>
      <p>
        {fixed
          ? `Marrëdhënia e punës së të punësuarës / të punësuarit brenda kësaj kontrate fillon me datën ${dmy(e.start_date)} dhe përfundon me datën ${dmy(e.end_date)} me mundësi vazhdimi (nëse aplikohet).`
          : `Marrëdhënia e punës së të punësuarës / të punësuarit brenda kësaj kontrate fillon me datën ${dmy(e.start_date)} dhe lidhet për kohë të pacaktuar.`}
      </p>

      <H n={4}>Afati i punësimit provues</H>
      <p>Periudha e punësimit provues për të punësuarën / të punësuarin brenda kësaj kontrate zgjat {blank(e.probation_months, 4)} muaj (1-6 muaj).</p>
      <p>Gjatë periudhës provuese të punës, punëdhënësi dhe e punësuara / i punësuari, mund ta ndërpresin marrëdhënien e punës, me njoftim paraprak prej shtatë (7) ditësh.</p>

      <H n={5}>Kompensimi i rrogës</H>
      <p>
        <b>(a) Rroga bazë:</b> Për shërbimet e ofruara bazuar në këtë kontratë e punësuara / i punësuari do të paguhet nga punëdhënësi me shumën bruto {eur(e.gross_salary)} €, së paku një herë në muaj e cila nuk mund të jetë më e ulët se paga minimale. Një përqindje e caktuar e rrogës do të mbahet në burim, në pajtim me ligjet tatimore në Kosovë.
      </p>
      <p>
        Rroga neto do të transferohet në xhirollogarinë bankare të të punësuarës / punësuarit si në vijim {blank([e.bank_name, e.iban].filter(Boolean).join(' – '), 22)}.
      </p>
      <p>
        <b>(b) Orët shtesë të punës (nëse aplikohet):</b> E punësuara / i punësuari ka të drejtë në pagë shtesë në përqindje të pagës bazë:
      </p>
      <ul className="ml-6 list-disc">
        <li>20% në orë për kujdestari;</li>
        <li>30% në orë për punë gjatë natës;</li>
        <li>30% në orë për punë jashtë orarit;</li>
        <li>50% në orë për punë gjatë ditëve të festave, dhe</li>
        <li>50% në orë për punë gjatë fundjavës.</li>
      </ul>

      <H n={6}>Vendndodhja e vendit të punës</H>
      <p>E punësuara / i punësuari do të ushtrojë pozitën e saj/tij bashkë me përgjegjësitë e cekura në kontratë në adresën {blank(e.workplace ?? client.address, 20)}.</p>

      <H n={7}>Përfitimet e të punësuarit</H>
      <p>E punësuara / i punësuari ka të drejtë në kompensim të pagës pa u angazhuar në punë, në rastet si në vijim:</p>
      <ul className="ml-6 list-disc">
        <li>gjatë ditëve të festave në të cilat nuk punohet;</li>
        <li>gjatë kohës së shfrytëzimit të pushimit vjetor;</li>
        <li>gjatë aftësimit dhe përsosjes profesionale për të cilën është dërguar dhe</li>
        <li>gjatë ushtrimit të funksioneve publike për të cilat nuk paguhet.</li>
      </ul>
      <p>
        <b>(a) Pushimet:</b> E punësuara / i punësuari ka të drejtë në pushim, dhe atë:
      </p>
      <ul className="ml-6 list-disc">
        <li>pushim gjatë ditës së punës në kohëzgjatje prej së paku 30 minutash, në përputhje organizimin e orarit të punës së punëdhënësit;</li>
        <li>pushim ditor në kohëzgjatje prej së paku dymbëdhjetë (12) orë pandërprerë, midis dy (2) ditëve të njëpasnjëshme të punës;</li>
        <li>pushim javor në kohëzgjatje prej njëzetekatër (24) orë pandërprerë;</li>
        <li>pushim vjetor në kohëzgjatje së paku 4 javë;</li>
        <li>i punësuari i cili përkundër masave mbrojtëse nuk mund të mbrohet nga ndikimet e jashtme, ka të drejtë në pushim shtesë vjetor në kohëzgjatje prej tridhjetë ditësh (30) pune për vitin kalendarik;</li>
        <li>nëna me fëmijë deri në tri (3) vjeç, prindi vetushqyes dhe personat me aftësi të kufizuara kanë të drejtë në pushim vjetor shtesë edhe për dy (2) ditë të tjera.</li>
      </ul>
      <p>
        <b>(b) Pushimi mjekësor:</b> E punësuara / i punësuari ka të drejtë në kompensim të pushimit mjekësor të pagës bazë, prej:
      </p>
      <ul className="ml-6 list-disc">
        <li>100% në rast të shfrytëzimit të pushimit mjekësor të rregullt, mbi bazën deri në 20 ditë pune brenda një (1) viti;</li>
        <li>
          70% në rast të shfrytëzimit të pushimin mjekësor si pasojë e lëndimit në punë ose sëmundjes profesionale, e cila ndërlidhet me kryerjen e punëve dhe të shërbimeve për punëdhënësin, në kohëzgjatje prej dhjetë (10) deri në nëntëdhjetë (90) ditë pune.
        </li>
      </ul>

      <H n={8}>Mbrojtja dhe Siguria në punë</H>
      <p>
        Punëdhënësi obligohet që për punonjësen / punonjësin të sigurojë dhe të zbatojë mjetet dhe masat e mbrojtjes në punë, sipas legjislacionit në fuqi. I/E punësuari/a obligohet t’u përmbahet masave përkatëse për mbrojtje dhe siguri në punë.
      </p>

      <H n={9}>Dispozitat tjera:</H>
      <p>
        <b>Ligji në fuqi:</b> Kushtet e kësaj kontrate do të qeverisen në përputhshmëri me ligjet e Republikës së Kosovës, konkretisht Ligji i Punës Nr.03/L-212.
      </p>
      <p>
        <b>Zbatueshmeria e ligjit dhe akteve tjera:</b> Dispozitat e Ligjit të Punës, të Kontratës Kolektive në fuqi dhe Aktin të Brendshëm të Punëdhënësit (“Akti i Brendshëm”) janë në mënyrë të drejtpërdrejtë të zbatueshme për të drejtat dhe obligimet që nuk janë të përcaktuara me këtë Kontratë. Dispozitat e Kontratës Kolektive aplikohen vetëm në rastet kur Punëdhënësi është palë në atë Kontratë Kolektive ose kur e njejta është nxjerr si akt ligjor/nën-ligjor nga organet kompetente publike.
      </p>
      <p>
        <b>Procedurat disiplinore:</b> Të gjitha procedurat disiplinore rregullohen me Aktin e Brendshëm të punëdhënësit. E punësuara / i punësuari ka lexuar dhe kuptuar Aktin e Brendshëm dhe zotohet për të vepruar në përputhje me këtë Kontratë, Aktin e Brendshëm dhe Ligjin e Punës.
      </p>
      <p>
        <b>Ndërprerja e kontratës:</b>
      </p>
      <p>Punëdhënësi mund t’ia ndërpresë kontratën e punës të punësuarës / të punësuarit me një periudhë paralajmërimi, atëherë kur:</p>
      <ul className="ml-6 list-disc">
        <li>ndërprerja e tillë arsyetohet për arsye ekonomike, teknike ose organizative;</li>
        <li>i punësuari nuk është më i aftë të kryejë detyrat e punës;</li>
        <li>në rastet e rënda të sjelljes së keqe të të punësuarit;</li>
        <li>për shkak të mospërmbushjes së pakënaqshme të detyrave të punës, dhe</li>
        <li>për rastet e tjera të cilat janë përcaktuar me Ligjin e Punës.</li>
      </ul>
      <p>Procedurat e ndërprerjes së Kontratës së Punës sipas paragrafit 1 të këtij neni do të zhvillohen në përputhje me dispozitat e Ligjit të Punës dhe Rregullores së punës të Punëdhënësit.</p>
      <p>
        Kjo Kontratë e Punës mund të ndërpritet me marrëveshje ndërmjet punëdhënësit dhe të punësuarës / të punësuarit. Marrëveshja bëhet në formë të shkruar. Në rast të ndërprerjes së Kontratës së Punës me marrëveshje, punëdhënësi është i obliguar t’i paguajë të punësuarës / të punësuarit pagën, për ditët e punës deri në ndërprerje.
      </p>
      <p>
        E punësuara / i punësuari ka të drejtën e ndërprerjes së Kontratës së Punës në mënyrë të njëanshme. E punësuara / i punësuari duhet ta informojë punëdhënësin paraprakisht në formë të shkruar në afatin prej pesëmbëdhjetë (15) ditësh.
      </p>
      <p>
        Punëdhënësi mund t’ia ndërpresë kontratën e punës të punësuarës / të punësuarit në periudhën e kërkuar të paralajmërimit 30 ditor në rastet e rënda të sjelljes së keqe të punësuarës / të punësuarit dhe për shkak të përmbushjes së pakënaqshme të detyrave të punës. Procedurat e ndërprerjes së Kontratës së Punës sipas kësaj baze do të zhvillohen në përputhje me dispozitat e Ligjit të Punës dhe Rregullores së punës të Punëdhënësit.
      </p>
      <p>
        <b>Ndryshimet e kontratës:</b> Ndryshimet e përshkrimeve dhe neneve të kontratës duhet të bëhen vetëm në formë të shkruar nga palët dhe duke qenë në linjë me ligjet në fuqi të Republikës së Kosovës
      </p>
      <p>
        <b>Konfidencialiteti:</b> Të punësuarës / të punësuarit i ndalohet zbulimi i çfarëdo informacioni konfidencial që ai ka marrë gjatë punësimit ose në lidhje me aktivitetet e tij për PUNËDHËNËSIN te ndonjë palë e tretë. E punësuara / i punësuari nuk duhet të kopjojë asnjë dokument të shkruar, pajisje të dhënash ose ndonjë formë tjetër të dokumentacionit, të cilat i janë besuar atij gjatë punësimit të tij ose në ndonjë mënyrë tjetër, të riprodhojë ose të i bëjë ato të qasshme për ndonjë palë të tretë, nëse nuk kërkohet nga interesat operative të Punëdhënësit. E punësuara / i punësuari, me kërkesë ose pa kërkesë pas ndërprerjes së punësimit dhe pa mbajtur asnjë kopje, kthen të gjitha dokumentet, pajisjet e të dhënave dhe informatat e tjera të shkruara dhe çdo kopje të këtij dokumentacioni te Punëdhënësi. Me nënshkrim të kësaj kontrate, e punësuara / i punësuari në mënyrë të pakthyeshme heq dorë nga çdo e drejtë e mbajtjes së dokumenteve dhe sendeve që i janë dhënë atij. Këto detyrime vlejnë edhe përtej ndërprerjes së këtij punësimi.
      </p>
      <p>
        <b>Të dhënat personale:</b> Punëdhënësi mund të përpunojë informata e dhëna nga e punësuara / i punësuari ("Të Dhëna Personale") siç përcaktohet në Ligjin për Mbrojtjen e të Dhënave Personale të aplikueshëm në Kosovo, për qëllimet statutore dhe qëllimet e menaxhimit të marrëdhënies së punës.
      </p>
      <p>
        <b>Zgjidhja e kontesteve:</b> Rregullat dhe procedurat për zgjidhjen e mosmarrëveshjeve nga puna përmes ndërmjetësimit përcaktohen me dispozitat e ligjit për ndërmjetësim si dhe me dispozitat tjera ligjore të aplikueshme. Në rast të pamundësisë së zgjidhjes së kontestit përmes ndërmjetësimit pas kalimit të periudhës 30 ditore të përpjekjeve për zgjidhje me ndërmjetësim, palët kanë të drejtë të inicojnë procedurën gjyqësore.
      </p>
      <p>
        <b>Hyrja në fuqi e kontratës:</b> Kontrata nënshkruhet nga palët kontraktuese në dy kopje origjinale: një (1) kopje për Punëdhënësin dhe një (1) kopje për të Punësuarën/in.
      </p>
      <p className="mt-3">Kontrata u nënshkrua më datën {dmy(kosovoDateISO())}.</p>
      <Sign left={`Emri, Titulli dhe Nënshkrimi i përfaqësuesit të kompanisë: ${client.representative ?? ''}`} right={`Emri Nënshkrimi i Punëmarrëses/sit: ${fullName(e)}`} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Decision on a leave
// ---------------------------------------------------------------------------
const PAY_TEXT: Partial<Record<Leave['kind'], string>> = {
  annual: 'Gjatë kohës së pushimit vjetor punëtori/ja ka të drejtë në kompensim të pagës.',
  sick: 'Gjatë pushimit mjekësor të rregullt punëtori/ja ka të drejtë në kompensim 100% të pagës bazë, deri në 20 ditë pune brenda një viti.',
  sick_work: 'Gjatë pushimit mjekësor si pasojë e lëndimit në punë ose sëmundjes profesionale punëtori/ja ka të drejtë në kompensim 70% të pagës bazë.',
  unpaid: 'Gjatë pushimit pa pagesë punëtorit/es nuk i paguhet paga.',
  special: 'Gjatë këtij pushimi punëtori/ja ka të drejtë në kompensim të pagës.',
}

export function LeaveDecision({ client, e, leave, ent }: { client: Client; e: Employee; leave: Leave; ent?: Entitlement }) {
  const year = Number(leave.from_date.slice(0, 4))
  const annual = leave.kind === 'annual'
  const back = returnDay(leave.to_date, e.work_days ?? 5)
  const kindText = LEAVE_LABELS[leave.kind].toLowerCase()
  const remaining = ent ? ent.remaining : null
  return (
    <div className="text-justify">
      <CompanyHead client={client} />
      <div className="mb-6 flex justify-between">
        <div>Nr. {blank(leave.decision_no, 10)}</div>
        <div>Data: {dmy(leave.decision_date ?? kosovoDateISO())}</div>
      </div>
      <p>
        Në bazë të Ligjit të Punës Nr. 03/L-212, kontratës së punës dhe {annual ? 'kërkesës së punëtorit/es' : 'dokumentacionit të paraqitur'}, {client.name}
        {client.representative ? `, përmes përfaqësuesit ${client.representative},` : ''} merr këtë:
      </p>
      <p className="mt-6 text-center text-[16px] font-semibold tracking-[-0.015em]">VENDIM</p>
      <p className="mb-6 text-center font-bold">për {annual ? 'shfrytëzimin e pushimit vjetor' : kindText}</p>
      <ol className="ml-5 list-decimal space-y-2">
        <li>
          Punëtorit/es {fullName(e)}, me numër personal {blank(e.personal_no, 10)}, në pozitën {blank(e.position, 12)}, i lejohet {annual ? `shfrytëzimi i pushimit vjetor për vitin ${year}` : kindText} në kohëzgjatje prej {days(leave.days)} ditë pune, nga data {dmy(leave.from_date)} deri më {dmy(leave.to_date)}.
        </li>
        <li>Punëtori/ja është i/e obliguar të paraqitet në punë më datë {dmy(back)}.</li>
        {PAY_TEXT[leave.kind] && <li>{PAY_TEXT[leave.kind]}</li>}
        {annual && remaining != null && (
          <li>
            Pas këtij pushimi, punëtorit/es i mbeten {days(Math.max(0, remaining))} ditë pushim vjetor për vitin {year}.
          </li>
        )}
        <li>Vendimi hyn në fuqi ditën e nënshkrimit.</li>
      </ol>
      <p className="mt-6 text-center font-bold">Arsyetim</p>
      <p className="mt-2">
        {annual
          ? `Punëtori/ja ${fullName(e)} ka kërkuar shfrytëzimin e pushimit vjetor për periudhën nga ${dmy(leave.from_date)} deri më ${dmy(leave.to_date)}. Sipas Ligjit të Punës dhe kontratës së punës, për vitin ${year} punëtori/ja ka të drejtë në ${ent ? days(ent.available) : '____'} ditë pushim vjetor${ent && ent.used - leave.days > 0 ? `, nga të cilat ka shfrytëzuar më parë ${days(ent.used - leave.days)} ditë` : ''}. Duke qenë se kërkesa është në përputhje me ligjin dhe me organizimin e punës, u vendos si në dispozitiv të këtij vendimi.`
          : `Bazuar në dokumentacionin e paraqitur dhe në dispozitat e Ligjit të Punës, u vendos si në dispozitiv të këtij vendimi.`}
      </p>
      {leave.note && <p className="mt-2">Shënim: {leave.note}</p>}
      <p className="mt-6 font-bold">Këshilla juridike:</p>
      <p>Kundër këtij vendimi punëtori/ja mund të paraqesë kërkesë te punëdhënësi brenda afatit të paraparë me Ligjin e Punës.</p>
      <p className="mt-4 text-[11px]">Vendimi i dorëzohet: punëtorit/es, dosjes personale, kontabilitetit.</p>
      <Sign left={`Për punëdhënësin: ${client.representative ?? ''}`} right={`Pranoi: ${fullName(e)}`} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leave report
// ---------------------------------------------------------------------------
export function LeaveReport({ client, e, year }: { client: Client; e: Employee; year: number }) {
  const ent = entitlement(e, year, e.leaves)
  const yearLeaves = e.leaves.filter((l) => l.from_date.slice(0, 4) === String(year)).sort((a, b) => a.from_date.localeCompare(b.from_date))
  const td = 'border border-black px-2 py-1'
  return (
    <div>
      <CompanyHead client={client} />
      <p className="text-center text-[16px] font-semibold tracking-[-0.015em]">RAPORTI I PUSHIMEVE PËR VITIN {year}</p>
      <table className="mt-5 w-full border-collapse text-[12px]">
        <tbody>
          <tr>
            <td className={td}>Punëtori/ja</td>
            <td className={td}>
              <b>{fullName(e)}</b>
              {e.personal_no ? ` · nr. personal ${e.personal_no}` : ''}
            </td>
          </tr>
          <tr>
            <td className={td}>Pozita</td>
            <td className={td}>{e.position ?? '—'}</td>
          </tr>
          <tr>
            <td className={td}>Kontrata</td>
            <td className={td}>
              {CONTRACT_LABELS[e.contract]} · nga {dmy(e.start_date)}
              {e.end_date ? ` deri ${dmy(e.end_date)}` : ''} · {e.work_days ?? 5} ditë në javë
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-5 font-bold">Pushimi vjetor</p>
      <table className="mt-2 w-full border-collapse text-[12px]">
        <tbody>
          <tr>
            <td className={td}>Pushimi vjetor sipas kontratës / ligjit</td>
            <td className={`${td} text-right`}>{days(ent.base)}</td>
          </tr>
          {ent.seniority > 0 && (
            <tr>
              <td className={td}>Ditë shtesë për përvojë pune (1 ditë për çdo 5 vjet)</td>
              <td className={`${td} text-right`}>{days(ent.seniority)}</td>
            </tr>
          )}
          {ent.extra > 0 && (
            <tr>
              <td className={td}>Ditë shtesë (nëna me fëmijë deri 3 vjeç, prind vetushqyes, aftësi e kufizuar…)</td>
              <td className={`${td} text-right`}>{days(ent.extra)}</td>
            </tr>
          )}
          {ent.months < 12 && (
            <tr>
              <td className={td}>Muaj pune në vitin {year}</td>
              <td className={`${td} text-right`}>{ent.months}</td>
            </tr>
          )}
          <tr>
            <td className={td}>Ditë të fituara për vitin {year}</td>
            <td className={`${td} text-right font-bold`}>{days(ent.earned)}</td>
          </tr>
          {ent.carried > 0 && (
            <tr>
              <td className={td}>Ditë të bartura nga viti i kaluar</td>
              <td className={`${td} text-right`}>{days(ent.carried)}</td>
            </tr>
          )}
          <tr>
            <td className={td}>Ditë të shfrytëzuara</td>
            <td className={`${td} text-right`}>{days(ent.used)}</td>
          </tr>
          <tr>
            <td className={td}>
              <b>Ditë të mbetura</b>
            </td>
            <td className={`${td} text-right font-bold`}>{days(ent.remaining)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-5 font-bold">Pushimet e shfrytëzuara</p>
      <table className="mt-2 w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={td}>Lloji</th>
            <th className={td}>Nga</th>
            <th className={td}>Deri</th>
            <th className={td}>Ditë</th>
            <th className={td}>Vendimi</th>
          </tr>
        </thead>
        <tbody>
          {yearLeaves.length === 0 && (
            <tr>
              <td className={td} colSpan={5}>
                Asnjë pushim në vitin {year}.
              </td>
            </tr>
          )}
          {yearLeaves.map((l) => (
            <tr key={l.id}>
              <td className={td}>{LEAVE_LABELS[l.kind]}</td>
              <td className={td}>{dmy(l.from_date)}</td>
              <td className={td}>{dmy(l.to_date)}</td>
              <td className={`${td} text-right`}>{days(l.days)}</td>
              <td className={td}>{l.decision_no ? `${l.decision_no}${l.decision_date ? `, ${dmy(l.decision_date)}` : ''}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[11px]">Raporti u përgatit më {dmy(kosovoDateISO())}.</p>
      <Sign left={`Për punëdhënësin: ${client.representative ?? ''}`} right={`Punëtori/ja: ${fullName(e)}`} />
    </div>
  )
}

/** All employees on one page. */
export function LeaveReportAll({ client, list, year }: { client: Client; list: Employee[]; year: number }) {
  const td = 'border border-black px-2 py-1'
  return (
    <div>
      <CompanyHead client={client} />
      <p className="mb-4 text-center text-[16px] font-semibold tracking-[-0.015em]">RAPORTI I PUSHIMEVE VJETORE – {year}</p>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className={td}>Nr.</th>
            <th className={td}>Punëtori/ja</th>
            <th className={td}>Pozita</th>
            <th className={td}>Të fituara</th>
            <th className={td}>Të bartura</th>
            <th className={td}>Të shfrytëzuara</th>
            <th className={td}>Të mbetura</th>
            <th className={td}>Mjekësor</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e, i) => {
            const ent = entitlement(e, year, e.leaves)
            return (
              <tr key={e.id}>
                <td className={td}>{i + 1}</td>
                <td className={td}>{fullName(e)}</td>
                <td className={td}>{e.position ?? ''}</td>
                <td className={`${td} text-right`}>{days(ent.earned)}</td>
                <td className={`${td} text-right`}>{days(ent.carried)}</td>
                <td className={`${td} text-right`}>{days(ent.used)}</td>
                <td className={`${td} text-right font-bold`}>{days(ent.remaining)}</td>
                <td className={`${td} text-right`}>{days((ent.other.sick ?? 0) + (ent.other.sick_work ?? 0))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-4 text-[11px]">Raporti u përgatit më {dmy(kosovoDateISO())}.</p>
      <Sign left={`Për punëdhënësin: ${client.representative ?? ''}`} right="Kontabilisti" />
    </div>
  )
}
