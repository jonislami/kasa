// Generates the ATK document (DOCX). Run: npx -p docx node scripts/manuali/<file>.cjs docs/manuali/<name>.docx – then open in Word to update the table of contents and save as PDF.
const fs = require('fs')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber, BorderStyle, TableOfContents, PageBreak,
} = require('docx')

const out = process.argv[2]
const FONT = 'Arial'
const GREEN = '0E6B4E'
const W = 9638 // A4 width minus 2 cm margins (11906 - 2*1134)

const p = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 120, line: 288 }, ...opts, children: runs(text) })
// **bold** inside text
function runs(text) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((s) => (s.startsWith('**') ? new TextRun({ text: s.slice(2, -2), bold: true }) : new TextRun(s)))
}
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] })
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] })
const ul = (items) => items.map((t) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60, line: 276 }, children: runs(t) }))
let olN = 0
const ol = (items) => {
  const ref = 'num' + olN++
  numberingConfigs.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 340 } } } }] })
  return items.map((t) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 60, line: 276 }, children: runs(t) }))
}
const note = (t) =>
  new Paragraph({
    spacing: { before: 120, after: 160, line: 276 },
    shading: { type: ShadingType.CLEAR, fill: 'E3F1EA', color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 8 } },
    indent: { left: 170, right: 170 },
    children: runs(t),
  })

const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5CE' }
const borders = { top: border, bottom: border, left: border, right: border }
function table(widths, rows) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map(
      (r, i) =>
        new TableRow({
          tableHeader: i === 0,
          cantSplit: true,
          children: r.map(
            (c, j) =>
              new TableCell({
                borders,
                width: { size: widths[j], type: WidthType.DXA },
                shading: i === 0 ? { type: ShadingType.CLEAR, fill: '10241B', color: 'auto' } : undefined,
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ spacing: { after: 0, line: 264 }, children: i === 0 ? [new TextRun({ text: c, bold: true, color: 'FFFFFF' })] : runs(c) })],
              }),
          ),
        }),
    ),
  })
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] })

const numberingConfigs = [
  { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 340 } } } }] },
]

// Body of "Përshkrimi i zgjidhjes, i integrimit me ATK dhe teknologjitë" – helpers come from the head of manual.cjs.
const TITLE = 'KontoSef.app – Përshkrimi i zgjidhjes dhe i integrimit me ATK'
const body = [
  new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ text: 'KontoSef.app', bold: true, size: 64, color: GREEN })] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Softueri Elektronik Fiskal (SEF)', size: 36 })] }),
  new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: 'Përshkrimi i zgjidhjes, i integrimit me ATK dhe teknologjitë', bold: true, size: 40 })] }),
  p('Dokument për aplikimin për certifikim të SEF-it te Komisioni i ATK-së (Kushtet dhe procedurat për aplikimin, certifikimin dhe mirëmbajtjen e SEF; Udhëzimi Administrativ (MF) Nr. 01/2026).'),
  gap(),
  table([3000, W - 3000], [
    ['Të dhënat', 'Vlera'],
    ['Softueri', 'KontoSef.app'],
    ['Versioni', '0.3.25'],
    ['Lloji', 'Softuer Elektronik Fiskal (SEF) – arkë (POS) me fiskalizim në kohë reale'],
    ['Platformat', 'Windows 10/11 (program i instaluar), Android 8+ (aplikacion)'],
    ['Integrimi', 'Shërbimi i fiskalizimit i ATK-së (fiskalizimi.atk-ks.org), sipas specifikave github.com/fiskalizimi'],
    ['Data', 'Nëntor 2026'],
  ]),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Përmbajtja', bold: true, size: 32, font: FONT })] }),
  new TableOfContents('Përmbajtja', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),

  // ---- 1 ----
  h1('1. Përshkrimi i zgjidhjes'),
  p('KontoSef.app është platformë për bizneset në Kosovë që përfshin arkën (shitjen), produktet dhe shërbimet, stokun, raportet, printimin e kuponit në printer termik dhe fiskalizimin e çdo kuponi në Sistemin Informativ të ATK-së. Një kod i vetëm punon si program për Windows dhe aplikacion për Android; i njëjti kod shërben edhe panelin e menaxhimit në shfletues.'),
  p('Platforma është shumë-biznesore (multi-tenant): një aplikacion dhe një databazë për shumë biznese, me të dhëna të ndara rreptësisht për çdo biznes. Mbështet katër veprimtari: tregti me pakicë (market, veshje & këpucë), gastronomi (kafiteri, restorant), barnatore dhe shërbime.'),
  h2('1.1 Pjesët e sistemit'),
  table([2800, W - 2800], [
    ['Pjesa', 'Roli'],
    ['Programi SEF (arka)', 'instalohet në pajisje (Windows/Android); shet, krijon dhe nënshkruan kuponin fiskal me çelësin privat të pajisjes, e dërgon në ATK, e printon; punon edhe pa internet'],
    ['Paneli i menaxhimit (web)', 'pronari/menaxheri: produktet, çmimet, stoku, punëtorët dhe PIN-et, raportet, regjistri i veprimeve, konfigurimi i fiskalizimit (NUI, numri EDI, Branch ID, POS ID). Nuk shet.'],
    ['Serveri (backend)', 'databaza PostgreSQL me rregulla sigurie për rresht (RLS) dhe funksione të sigurta (RPC); funksioni "fiscal-relay" që i përcjell kërkesat te ATK-ja dhe i regjistron'],
    ['Programi i kontabilistit', 'vetëm lexim i shitjeve, TVSH-së dhe librit të shitjes për bizneset që i japin qasje'],
  ]),
  h2('1.2 Arkitektura'),
  ...ol([
    '**Pajisja e arkës** (Windows / Android): ndërfaqja, shporta, krijimi i kuponit (protobuf), nënshkrimi ECDSA me çelësin jo të eksportueshëm, radha e enkriptuar e kuponëve offline, printimi ESC/POS.',
    '**Serveri KontoSef** (Supabase: PostgreSQL + Edge Functions): ruan shitjet (të pandryshueshme), kuponët fiskalë dhe përgjigjet e ATK-së; kontrollon që kuponi i përket arkës dhe pajisjes së regjistruar.',
    '**Shërbimi i ATK-së**: merr kuponin e nënshkruar dhe kthen numrin e transaksionit.',
  ]),
  p('Lidhja pajisje → server bëhet me HTTPS (TLS) dhe sesion të autentikuar; lidhja server → ATK me HTTPS te adresat zyrtare të ATK-së. Serveri është i nevojshëm sepse shërbimi i ATK-së nuk pranon thirrje direkt nga shfletuesi (CORS); çelësi privat nuk kalon kurrë në server.'),

  // ---- 2 ----
  h1('2. Integrimi me ATK'),
  h2('2.1 Adresat e shërbimit'),
  table([2200, W - 2200], [
    ['Ambienti', 'Adresa'],
    ['Test', 'https://fiskalizimi-test.atk-ks.org'],
    ['Prodhim', 'https://fiskalizimi.atk-ks.org'],
  ]),
  gap(),
  p('Ambienti zgjidhet për çdo biznes (Fiskalizimi → Hapi 1). Kodi unik i SEF-it (Application ID) për çdo ambient ruhet në konfigurimin e platformës dhe dërgohet me çdo kërkesë dhe çdo kupon.'),
  h2('2.2 Regjistrimi i arkës (certifikata)'),
  ...ol([
    'Pronari vendos në panel NUI-në, numrin e fiskalizimit (EDI), numrin e njësisë (Branch ID) dhe POS ID-në e çdo arke, të marra nga portali i ATK-së.',
    'Në pajisjen e arkës krijohet çelësi ECDSA P-256 (jo i eksportueshëm).',
    '**POST /ca/verify/{NUI}** me fiscalization_no, pos_id, branch_id, application_id → ATK kthen emrin e biznesit dhe kodin e verifikimit.',
    'Pajisja ndërton dhe nënshkruan kërkesën për certifikatë (CSR, PKCS#10) me çelësin e vet.',
    '**POST /ca/signcsr** me CSR-në, kodin e verifikimit dhe identifikuesit → ATK kthen certifikatën e nënshkruar.',
    'Certifikata, çelësi publik dhe identifikuesi i pajisjes ruhen në server; arka shënohet "e regjistruar" dhe lidhet me atë pajisje. Vetëm ajo pajisje mund të dërgojë kuponë për atë arkë.',
  ]),
  h2('2.3 Krijimi dhe dërgimi i kuponit'),
  ...ol([
    'Me pagesën, pajisja krijon **PosCoupon** sipas models.proto të ATK-së: BusinessId (NUI), CouponId, BranchId, Location, OperatorId, PosId, ApplicationId, VerificationNo (NUIKF), Type (1 shitje, 2 anulim, 3 kthim), Time, artikujt (emri, çmimi, njësia, sasia, totali, norma e TVSH-së, kategoria ATK), pagesat, grupet e TVSH-së, totalet, ReferenceNo për anulim/kthim, zbritja.',
    'Çmimet e artikujve dërgohen ×10000, totalet ×100 (cent). Normat: A e liruar, C 0%, D 8%, E 18%. Kategoritë dhe njësitë sipas listave zyrtare të ATK-së.',
    'CouponId = BranchId × 10¹² + PosId × 10⁸ + numri rendor i arkës. NUIKF: 16 karaktere alfanumerike të rastit, unik për kupon.',
    'Mesazhi protobuf → base64 → SHA-256 mbi tekstin base64 → nënshkrim ECDSA P-256 → DER → base64.',
    '**POST /pos/coupon** me { details, signature } – **para printimit**. Përgjigjja 2xx: kuponi shënohet "dërguar" dhe ruhet numri i transaksionit; 4xx: "refuzuar" (shfaqet te arka dhe paneli); pa përgjigje brenda 10 s ose 5xx: "në pritje", dërgohet përsëri.',
    'Për blerësin krijohet **CitizenCoupon**, nënshkruhet njësoj; kodi QR në kupon = base64(CitizenCoupon) + "|" + nënshkrimi.',
  ]),
  h2('2.4 Kontrollet në server'),
  ...ul([
    'Thirrësi duhet të jetë punonjës aktiv i një biznesi aktiv; regjistrimin e arkës e bën vetëm pronari/menaxheri.',
    'Arka duhet të jetë e regjistruar dhe kërkesa të vijë nga pajisja që mban çelësin e saj.',
    'CouponId duhet të përputhet me Branch ID, POS ID dhe numrin rendor; lloji i kuponit me llojin e shitjes.',
    'CouponId dhe NUIKF janë unikë; një kupon i dërguar nuk dërgohet dy herë.',
    'Çdo thirrje te ATK-ja regjistrohet (fiscal_log): ambienti, veprimi, statusi HTTP, mesazhi, përdoruesi, koha.',
  ]),
  h2('2.5 Puna pa internet'),
  ...ul([
    'Kur nuk ka lidhje, kuponi nënshkruhet në pajisje me kohën e serverit, shënohet "OFFLINE", printohet dhe ruhet në radhë të enkriptuar (AES-256-GCM).',
    'Numrat rendorë mbahen në pajisje, kështu që kuponët offline marrin numra të vazhdueshëm.',
    'Kur kthehet lidhja, shitjet sinkronizohen (me çelës idempotence) dhe kuponët dërgohen sipas radhës, më i vjetri i pari.',
    'Arka tregon vazhdimisht numrin e kuponëve në pritje dhe orët e mbetura nga afati 48 orë.',
    'Kuponët e bllokut të veçantë (pajisja e prishur) regjistrohen me kohën e kuponit të letrës dhe numrin serik të bllokut.',
    'Kuponët e padërguar eksportohen në CSV/PDF vetëm me kërkesë të ATK-së ose autoritetit shtetëror; çdo eksport regjistrohet.',
  ]),
  h2('2.6 Ora'),
  p('Koha e kuponit merret nga ora e serverit, jo nga ora e pajisjes. Arka e krahason orën e vet me serverin kur hapet, pas fjetjes së pajisjes dhe me "Sinkronizo"; kur diferenca kalon 1 minutë, paralajmëron përdoruesin.'),

  // ---- 3 ----
  h1('3. Siguria dhe integriteti i të dhënave'),
  table([3000, W - 3000], [
    ['Masa', 'Si zbatohet'],
    ['Çelësi privat i arkës', 'ECDSA P-256 i krijuar në pajisje, jo i eksportueshëm. Android: Android Keystore (në harduer kur pajisja e ka). Windows: i ruajtur vetëm i enkriptuar me Windows DPAPI në procesin kryesor; faqja merr vetëm çelësin publik dhe nënshkrime.'],
    ['Pandryshueshmëria e shitjeve', 'shitjet dhe kuponët nuk ndryshohen e nuk fshihen nga klienti; korrigjimi vetëm me kupon anulimi/kthimi që i referohet origjinalit'],
    ['Miratimi i anulimit/kthimit', 'PIN-i i pronarit/menaxherit kontrollohet në server'],
    ['Ndarja e bizneseve', 'çdo tabelë ka business_id dhe rregulla RLS; ndryshimet e stokut dhe shitjeve vetëm përmes funksioneve të sigurta në server'],
    ['Hyrja', 'punëtorët me PIN 4-shifror (bcrypt, bllokim pas 5 gabimeve); pronari me email + fjalëkalim; programi aktivizohet me çelës unik për një pajisje'],
    ['Regjistri i veprimeve', 'vetëm shtim: hyrjet, shitjet, anulimet, kthimet, ndryshimet e çmimeve dhe cilësimeve, eksportet'],
    ['Ruajtja lokale', 'kuponët dhe shitjet offline të enkriptuara me AES-256-GCM; çelësi i enkriptimit jo i eksportueshëm (Windows: DPAPI)'],
    ['Transmetimi', 'HTTPS/TLS në çdo lidhje'],
    ['Çelësat e serverit', 'çelësi i administrimit përdoret vetëm brenda funksioneve në server, asnjëherë në pajisje'],
    ['Përditësimet', 'Windows: përditësim automatik nga GitHub Releases; Android: APK/Play Store. Versioni dërgohet me çdo kupon; ndryshimet që prekin fiskalizimin njoftohen te ATK para publikimit.'],
  ]),

  // ---- 4 ----
  h1('4. Teknologjitë'),
  h2('4.1 Aplikacioni'),
  table([3200, 1800, W - 5000], [
    ['Teknologjia', 'Versioni', 'Përdorimi'],
    ['TypeScript', '7', 'gjuha e programimit (strict)'],
    ['React', '18', 'ndërfaqja e përdoruesit'],
    ['Vite', '8', 'ndërtimi i aplikacionit'],
    ['Tailwind CSS', '3', 'dizajni'],
    ['React Router', '6', 'navigimi'],
    ['TanStack Query', '5', 'leximi dhe ruajtja e të dhënave, kopja lokale'],
    ['Web Crypto API', '–', 'SHA-256, ECDSA P-256, AES-GCM'],
    ['Protocol Buffers', 'models.proto i ATK-së', 'kodimi i kuponëve (kodues i shkruar në projekt)'],
    ['ESC/POS', '–', 'printimi në printer termik 58/80/100 mm, QR me GS ( k'],
  ]),
  h2('4.2 Platformat e instalimit'),
  table([3200, 1800, W - 5000], [
    ['Teknologjia', 'Versioni', 'Përdorimi'],
    ['Electron', '45', 'programi për Windows (Chromium + Node.js)'],
    ['electron-builder / NSIS', '26', 'instaluesi .exe'],
    ['electron-updater', '6', 'përditësimi automatik nga GitHub Releases'],
    ['Windows DPAPI (safeStorage)', '–', 'mbrojtja e çelësave në Windows'],
    ['Capacitor', '8', 'aplikacioni Android'],
    ['Android Keystore', '–', 'çelësi i ATK-së në Android'],
    ['Bluetooth (SPP/BLE), TCP 9100, Windows spooler (RAW)', '–', 'lidhja me printerin'],
  ]),
  h2('4.3 Serveri dhe infrastruktura'),
  table([3200, 1800, W - 5000], [
    ['Teknologjia', 'Versioni', 'Përdorimi'],
    ['Supabase – PostgreSQL', '17', 'databaza, RLS, funksionet e sigurta (PL/pgSQL); serverët në Bashkimin Evropian (Paris, eu-west-3)'],
    ['Supabase Auth', '–', 'autentikimi (JWT)'],
    ['Supabase Edge Functions (Deno)', '–', 'fiscal-relay (lidhja me ATK), pin-login, menaxhimi i përdoruesve'],
    ['@supabase/supabase-js', '2', 'klienti i serverit'],
    ['Vercel', '–', 'shpërndarja e panelit web (HTTPS)'],
    ['GitHub / GitHub Actions', '–', 'kodi burimor, ndërtimi dhe publikimi i versioneve'],
  ]),

  // ---- 5 ----
  h1('5. Përputhshmëria me kërkesat e ATK-së'),
  table([4200, W - 4200], [
    ['Kërkesa', 'Zbatimi në KontoSef.app'],
    ['Fiskalizim në kohë reale, para printimit', 'kuponi dërgohet te /pos/coupon para printimit (pika 2.3)'],
    ['Nënshkrim me çelës të pajisjes, certifikatë nga ATK', 'ECDSA P-256 jo i eksportueshëm; /ca/verify + /ca/signcsr (pika 2.2)'],
    ['Kodi QR për verifikim nga qytetari', 'CitizenCoupon i nënshkruar në QR, 20 × 20 mm në kupon'],
    ['Operatori dhe numri i tij identifikues në kupon (neni 7, pika 2.5)', 'emri i punëtorit dhe ID-ja e tij (p.sh. ID 001), unike brenda biznesit'],
    ['Anulimi me arsye', 'arsyeja e anulimit shkruhet detyrimisht; PIN i pronarit/menaxherit, i kontrolluar në server'],
    ['Anulimi dhe kthimi me referencë', 'Type 2/3 me ReferenceNo të kuponit origjinal'],
    ['Puna pa lidhje dhe dërgimi brenda 48 orëve', 'radhë e enkriptuar, dërgim automatik, paralajmërim për afatin (pika 2.5)'],
    ['Blloku i veçantë i kuponëve', 'regjistrimi me kohën e kuponit të letrës dhe numrin serik'],
    ['Eksporti i të dhënave të padërguara (CSV, PDF)', 'vetëm me kërkesë, i regjistruar në regjistrin e veprimeve'],
    ['Normat e TVSH-së, kategoritë dhe njësitë zyrtare', 'A/C/D/E; listat zyrtare të ATK-së; biznesi pa TVSH – A'],
    ['Gjuhët shqip dhe serbisht', 'ndërfaqja e arkës dhe kuponi'],
    ['Mbrojtja nga ndryshimet e paautorizuara', 'shitje të pandryshueshme, RLS, regjistër vetëm-shtim, kontrolle në server'],
    ['Versioni dhe kodi i SEF-it në çdo kupon', 'ApplicationId në çdo kupon; versioni i programit i regjistruar'],
    ['Manuali i përdorimit (UA pika 12.5)', 'dokumenti i veçantë "Manuali i përdorimit"'],
  ]),
]

const doc = new Document({
  creator: 'KontoSef.app',
  title: TITLE,
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: GREEN }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '14201A' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: numberingConfigs },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: TITLE, size: 18, color: '56645C' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Faqja ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 18, color: '56645C' })] })] }) },
      children: body,
    },
  ],
})

Packer.toBuffer(doc).then((b) => fs.writeFileSync(out, b))
