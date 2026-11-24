// Generates the user manual for ATK (DOCX) with screenshots from docs/manuali/foto/{web,sef}.
// Run: NODE_PATH=<docx> node scripts/manuali/manuali.cjs docs/manuali/KontoSef-Manuali-i-perdorimit.docx
// then open in Word to update the table of contents and save as PDF.
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType,
  LevelFormat, Header, Footer, PageNumber, BorderStyle, TableOfContents, PageBreak, ImageRun,
} = require('docx')

const out = process.argv[2]
const FOTO = path.join(__dirname, '..', '..', 'docs', 'manuali', 'foto')
const VERSION = require(path.join(__dirname, '..', '..', 'package.json')).version
const FONT = 'Arial'
const GREEN = '0E6B4E'
const W = 9638 // A4 width minus 2 cm margins

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120, line: 288 }, ...opts, children: runs(text) })
function runs(text) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((s) => (s.startsWith('**') ? new TextRun({ text: s.slice(2, -2), bold: true }) : new TextRun(s)))
}
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(t)] })
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

/** Width and height of a JPEG (SOF marker). */
function jpgSize(buf) {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const m = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  return { w: 800, h: 500 }
}
let fig = 0
/** A screenshot with its caption ("Figura n – …"); `maxW` in pixels on the page (600 ≈ full width). */
function img(folder, name, caption, maxW = 600) {
  const file = path.join(FOTO, folder, name + '.jpg')
  if (!fs.existsSync(file)) return [note(`[Foto mungon: ${folder}/${name}]`)]
  const data = fs.readFileSync(file)
  const s = jpgSize(data)
  const w = Math.min(maxW, s.w)
  const h = Math.round((s.h * w) / s.w)
  fig++
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true, children: [new ImageRun({ type: 'jpg', data, transformation: { width: w, height: h } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `Figura ${fig} – ${caption}`, italics: true, size: 18, color: '56645C' })] }),
  ]
}

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

// ---------------------------------------------------------------------------
const body = [
  // ---- cover ----
  new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ text: 'KontoSef.app', bold: true, size: 64, color: GREEN })] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Softueri Elektronik Fiskal (SEF)', size: 36 })] }),
  new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: 'Manuali i përdoruesit dhe udhëzimet bazë për përdorim', bold: true, size: 40 })] }),
  p('Për shfrytëzuesit e programit dhe për Administratën Tatimore të Kosovës (ATK), sipas Udhëzimit Administrativ (MF) Nr. 01/2026 dhe Kërkesave specifike teknike dhe funksionale për SEF.'),
  gap(),
  table([3000, W - 3000], [
    ['Të dhënat', 'Vlera'],
    ['Softueri', 'KontoSef.app – arka (POS), menaxhimi i biznesit dhe fiskalizimi në ATK'],
    ['Versioni', VERSION],
    ['Platformat', 'Windows 10/11 (program .exe) dhe Android (aplikacion) – shitja; shfletues – vetëm menaxhimi'],
    ['Gjuhët', 'Shqip dhe Serbisht (latinisht)'],
    ['Adresa', 'https://kontosef.app'],
    ['Data e dokumentit', 'Nëntor 2026'],
  ]),
  gap(),
  note('Fotot e ekraneve janë marrë nga një biznes demo ("Market Demo SH.P.K.", NUI 999999991) me të dhëna shembull. Foto e kuponit të printuar (Figura te kapitulli 9) është kupon i vërtetë nga mjedisi test i ATK-së ("TEST – PA VLERË FISKALE").'),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Përmbajtja', bold: true, size: 32, font: FONT })] }),
  new TableOfContents('Përmbajtja', { hyperlink: true, headingStyleRange: '1-2' }),

  // ---- 1 ----
  h1('1. Hyrje'),
  p('KontoSef.app është softuer elektronik fiskal për bizneset në Kosovë: shitja në arkë, produktet dhe shërbimet, stoku, raportet, printimi i kuponit dhe fiskalizimi i çdo kuponi në Sistemin Informativ të ATK-së (SIATK).'),
  p('Softueri ka dy pjesë që punojnë me të njëjtat të dhëna:'),
  ...ul([
    '**Programi SEF (arka)** – instalohet në pajisjen e arkës (Windows ose Android). Vetëm ky program shet: e nënshkruan kuponin me çelësin e arkës, e dërgon në ATK para printimit dhe e printon.',
    '**Paneli i menaxhimit (web)** – hapet në shfletues nga pronari ose menaxheri (kontosef.app): produktet, çmimet, stoku, punëtorët dhe PIN-et, njësitë dhe arkat, raportet, fiskalizimi i arkave, cilësimet. Nga paneli web nuk mund të shitet.',
  ]),
  note('Rregulla kryesore: **pa fiskalizim nuk ka kupon.** Arka që nuk është e regjistruar në ATK në atë pajisje nuk lëshon asnjë kupon – as "jo-fiskal". Kjo kontrollohet edhe në server.'),
  h2('1.1 Llojet e bizneseve'),
  table([3000, W - 3000], [
    ['Veprimtaria e lokalit', 'Modulet shtesë'],
    ['Tregti me pakicë', 'market, veshje & këpucë: barkod, peshë (kg), stok, madhësi × ngjyrë'],
    ['Gastronomi', 'kafiteri, restorant: tavolina, porosi, ekrani i kuzhinës/barit, receta'],
    ['Barnatore', 'seri (lot) dhe afat skadimi'],
    ['Shërbim', 'shërbime pa stok me njësinë e tyre (orë, ditë …), punëtorë me komision'],
  ]),
  h2('1.2 Rolet dhe qasja'),
  table([2800, W - 2800], [
    ['Roli', 'Çka mund të bëjë'],
    ['Administratori i KontoSef', 'aprovon bizneset, aktivizon dhe heq arkat, krijon çelësat e aktivizimit, miraton njësitë e reja dhe kalimin në TVSH'],
    ['Pronari', 'gjithçka të biznesit në web: produktet, çmimet, stoku, punëtorët dhe PIN-et, qasja në arka, raportet, fiskalizimi, cilësimet; në arkë miraton anulimet dhe kthimet me PIN'],
    ['Menaxheri', 'si pronari, pa llogarinë e abonimit'],
    ['Punëtori (arkëtar, kamarier…)', 'vetëm shitja në arkat ku ka qasje, puna e vet e sotme dhe printeri; nuk ndryshon produkte, çmime as stok'],
    ['Kontabilisti', 'vetëm lexim: shitjet, kthimet, TVSH-ja, librat e shitjes/blerjes, eksporti'],
  ]),
  note('Kufizimet zbatohen në databazë (rregulla sigurie në server), jo vetëm duke fshehur butonat.'),

  // ---- 2 ----
  h1('2. Regjistrimi i biznesit dhe aktivizimi'),
  h2('2.1 Regjistrimi'),
  p('Biznesi regjistrohet në **kontosef.app → Regjistrohu**: emri, NUI, adresa, veprimtaria e lokalit, njësitë (dyqani, lokali) me adresën, forma juridike, kategoria tatimore, statusi i TVSH-së, certifikata e ARBK-së dhe fjalëkalimi. Pas dërgimit, llogaria pret aprovimin e administratorit të KontoSef.'),
  ...img('web', '02-llogaria-ne-shqyrtim', 'Llogaria pas regjistrimit – në shqyrtim'),
  h2('2.2 Llogaria dhe aktivizimi'),
  p('Pas aprovimit, te **Llogaria dhe abonimi** pronari sheh statusin, licencën, njësitë e biznesit, TVSH-në, arkat dhe shkarkimin e programit.'),
  ...img('web', '03-llogaria-aktive', 'Llogaria aktive: njësitë dhe TVSH-ja'),
  ...ul([
    '**Shto njësi** – kur hapet një pikë tjetër shitjeje. Njësia e re pret miratimin e administratorit; pas miratimit krijohet një arkë në të.',
    '**Kërko kalimin në TVSH** – biznesi që regjistrohet në TVSH ngarkon dokumentin; statusi bëhet "Me TVSH" vetëm pasi administratori ta verifikojë.',
    '**Kërko arkë shtesë** – zgjidhet njësia; administratori e aktivizon. Biznesi paguan për çdo arkë të lidhur me ATK-në; numri i punëtorëve nuk ndikon.',
  ]),
  ...img('web', '04-arkat-shkarko', 'Arkat dhe shkarkimi i programit për Windows dhe Android'),
  h2('2.3 Instalimi'),
  ...ul([
    '**Windows 10/11** – "Kasa-Setup-<versioni>.exe" nga faqja **Shkarko**. Përditësimet instalohen vetë.',
    '**Android 7 ose më i ri** – "Kasa-<versioni>.apk" (ose Play Store).',
    '**Shfletuesi** – vetëm për menaxhim, pa shitje.',
  ]),
  h2('2.4 Aktivizimi i arkës me çelës'),
  p('Çelësin e aktivizimit **KASA-XXXX-XXXX-XXXX** e krijon vetëm administratori i KontoSef për një arkë të caktuar dhe i dërgohet pronarit automatikisht në email (shqip dhe serbisht). Një çelës vlen për një pajisje. Në hapjen e parë programi kërkon çelësin:'),
  ...img('sef', '01-aktivizimi', 'Aktivizimi i programit SEF me çelës', 520),
  note('Pajisja e aktivizuar i takon një arke të vetme dhe shet vetëm si ajo arkë (çelësi i ATK-së, POS ID, njësia). Arka nuk ndërrohet nga programi.'),

  // ---- 3 ----
  h1('3. Hyrja'),
  h2('3.1 Hyrja në panelin web'),
  p('Pronari dhe menaxheri hyjnë me email dhe fjalëkalim. "Harrove fjalëkalimin?" dërgon në email një link njëpërdorimësh për fjalëkalimin e ri. Punëtorët nuk hyjnë në web.'),
  ...img('web', '01-hyrja', 'Hyrja në panelin web'),
  h2('3.2 Hyrja në arkë me PIN'),
  p('Në arkë shfaqen vetëm punëtorët që kanë qasje në atë arkë, si dhe pronari e menaxherët. Punëtori zgjedh emrin dhe shkruan **PIN-in 4-shifror**. Pas 5 PIN-eve të gabuara hyrja bllokohet 15 minuta. Kur ndërrohet punëtori, kolegu hyn me PIN-in e vet dhe kuponët e rinj regjistrohen në emrin e tij.'),
  ...img('sef', '02-pin-lista', 'Zgjedhja e punëtorit në arkë', 520),
  ...img('sef', '03-pin-kodi', 'Shkrimi i PIN-it', 520),
  note('Serveri kontrollon edhe vetë që punëtori ka qasje në arkën e pajisjes; pa qasje hyrja refuzohet.'),

  // ---- 4 ----
  h1('4. Paneli i menaxhimit (web)'),
  p('Menuja ka katër pjesë: **Sot** (Paneli), **Produktet & Stoku**, **Raportet** (Raportet, Puna e punëtorëve, Regjistri i veprimeve) dhe poshtë **Fiskalizimi (ATK)**, **Llogaria** dhe **Cilësimet**. Biznesi i ri sheh listën **"Hapat e parë"**.'),
  ...img('web', '05-paneli', 'Paneli: hapat e parë, shitjet e ditës dhe stoku i ulët'),

  // ---- 5 ----
  h1('5. Produktet dhe shërbimet'),
  p('Te **Produktet** shihen të gjithë artikujt me barkod, kategori, çmim blerjeje dhe shitjeje, marzhë, normë TVSH-je dhe stok. Stoku i ulët shënohet me ngjyrë.'),
  ...img('web', '06-produktet', 'Lista e produkteve'),
  h2('5.1 Produkt i ri'),
  p('**Produkt i ri**: lloji (Artikull / Shërbim), emri, barkodi (ose "Gjenero"), kategoria, njësia matëse sipas listës së ATK-së, çmimi i blerjes dhe i shitjes (me TVSH), norma e TVSH-së, kategoria ATK, stoku minimal dhe fillestar, "Shfaq në arkë" dhe – kur biznesi ka disa njësi – "Shitet në".'),
  ...img('web', '07-produkt-i-ri', 'Forma e produktit të ri'),
  h2('5.2 Importi nga Excel'),
  p('Produktet shtohen ose përditësohen të gjitha njëherë nga Excel. Shkarkohet shablloni, mbushet dhe ngarkohet.'),
  ...img('web', '08-importo-excel', 'Importi nga Excel'),
  h2('5.3 Ndryshimi nga arka'),
  p('Pronari ose menaxheri, i hyrë në arkë me PIN, ka butonat **Shto** dhe **Ndrysho**: shton, ndryshon ose fshin një produkt pa dalë nga arka. Produkti që është shitur nuk fshihet: hiqet nga arka dhe ruhet si joaktiv (historiku mbetet).'),
  ...img('sef', '13-ndrysho-produktet', 'Ndrysho ose fshi produktet nga arka'),

  // ---- 6 ----
  h1('6. Stoku'),
  p('Te **Stoku & Hyrjet**: hyrja e mallit nga furnitori (me barkod ose kërkim, sasia dhe kosto), historiku i hyrjeve, lëvizjet e stokut, inventarizimi dhe furnitorët. Çdo ndryshim i stokut kalon përmes serverit dhe regjistrohet si lëvizje.'),
  ...img('web', '09-hyrje-malli', 'Hyrja e mallit nga furnitori'),
  ...img('web', '10-inventarizimi', 'Inventarizimi dhe produktet nën minimum'),

  // ---- 7 ----
  h1('7. Ekrani i arkës'),
  p('Në krye janë emri i punëtorit, shenja e ATK-së dhe ora e kontrolluar me serverin. Në të majtë: Arka, Më shumë (menuja), Sinkronizo, kuleta, "Mbyll ditën" dhe "Dil". Mbi produktet: kërkimi (F2), Kamera (lexim barkodi), **Në pritje** dhe **Kuponët**; për pronarin edhe **Shto**, **Ndrysho** dhe **Blloku**.'),
  ...img('sef', '05-arka-kupon', 'Arka me artikuj në kupon dhe ndarjen e TVSH-së'),
  h2('7.1 Shenja e ATK-së'),
  table([2000, W - 2000], [
    ['Shenja', 'Domethënia'],
    ['ATK ✓ (e gjelbër)', 'arka është e regjistruar në ATK dhe të gjithë kuponët janë konfirmuar'],
    ['ATK 3 (portokalli)', 'numri i kuponëve të nënshkruar që presin të dërgohen (p.sh. pa internet)'],
    ['ATK ! (e kuqe)', 'ATK ka refuzuar një kupon'],
    ['ATK – (gri)', 'kjo arkë nuk është regjistruar ende në ATK në këtë pajisje – nuk lëshohet kupon'],
  ]),
  ...img('sef', '04-arka-pa-fiskalizim', 'Arka pa regjistrim në ATK: "Paguaj" është i bllokuar dhe tregohet arsyeja'),
  h2('7.2 Menuja e punëtorit'),
  p('Menuja ka: Arka, Puna ime sot, Kuponët e lëshuar, Printeri, Mbyll ditën dhe Dil. Pronari ose menaxheri me PIN ka edhe **Raporti i auditit**.'),
  ...img('sef', '06-menuja', 'Menuja e punëtorit', 520),

  // ---- 8 ----
  h1('8. Shitja'),
  ...ol([
    'Artikulli shtohet me kërkim (emri ose kodi), me lexuesin e barkodit ose duke e prekur te lista. Lexuesi i barkodit e shton vetë artikullin.',
    'Sasia ndryshohet me + / − ose duke e shkruar (kg deri në 3 decimale). Zbritja jepet për artikull ose për gjithë kuponin.',
    'Shtypet **PAGUAJ** (F12). Dritarja Pagesa ka tri skeda: **Kesh** (shuma e marrë ose butonat Saktë · 5 · 10 · 20 · 50 · 100 €, programi tregon kusurin), **Kartelë** (kartelë, vauçer ose transfer bankar) dhe **Të kombinuara** (dy nga Kesh, Kartelë, Vauçer, Transfer bankar).',
    'Shtypet **MBYLL SHITJEN** (Enter). Kuponi nënshkruhet në pajisje, dërgohet në ATK **para printimit** dhe printohet me kodin QR.',
  ]),
  table([1800, W - 1800], [
    ['Tasti', 'Veprimi'],
    ['F2', 'kërkimi i artikullit'],
    ['F4', 'ruaj kuponin në pritje'],
    ['F12', 'hap dritaren Pagesa'],
    ['Enter', 'në Pagesa: mbyll shitjen'],
    ['Esc', 'mbyll dritaren e hapur'],
  ]),
  h2('8.1 Normat e TVSH-së'),
  p('Çmimet e shitjes përfshijnë TVSH-në. TVSH llogaritet një herë për normë mbi shumën bruto të asaj norme.'),
  table([1500, 2200, W - 3700], [
    ['Shkronja', 'Norma', 'Shënim'],
    ['E', '18%', 'norma e përgjithshme'],
    ['D', '8%', 'norma e reduktuar'],
    ['C', '0%', 'norma zero'],
    ['A', 'e liruar', 'biznesi jashtë TVSH-së shet gjithçka me A'],
  ]),
  ...img('web', '17-tvsh', 'Normat e TVSH-së sipas ATK-së'),

  // ---- 9 ----
  h1('9. Kuponi fiskal'),
  p('Kuponi i printuar përmban: tatimpaguesin, emrin dhe numrin e njësisë, adresën, NF-NUI dhe numrin e TVSH-së, emrin dhe **ID-në e punëtorit**, artikujt me sasi, çmim dhe shkronjën e TVSH-së, totalin, mënyrën e pagesës, ndarjen e TVSH-së, numrin e kuponit, datën dhe orën, numrin identifikues të SEF-it, **NUIKF**-në, numrin ditor, **kodin QR** (së paku 20 × 20 mm, më i madh në letër më të gjerë) dhe logon RKS/MF. Në mjedisin test shënohet "TEST – PA VLERË FISKALE"; pa internet "OFFLINE"; ribotimi "KOPJE E KUPONIT".'),
  ...img('sef', '16-kuponi-printuar', 'Kuponë fiskalë të printuar nga mjedisi test i ATK-së', 420),
  p('Letra: 58 mm, 80 mm ose 100 mm. Me pëlqimin e blerësit kuponi dërgohet edhe si **e-kupon** në email (shqip dhe serbisht, me kodin QR).'),

  // ---- 10 ----
  h1('10. Kuponët, anulimi dhe kthimi'),
  h2('10.1 Kuponët e lëshuar'),
  p('**Kuponët** hap kuponët e ruajtur sipas periudhës (Sot, Dje, Këtë javë, Këtë muaj, periudhë e zgjedhur), me kërkim sipas numrit, filtër sipas punëtorit (pronari/menaxheri) dhe totalet e periudhës. Kuponi hapet ashtu siç është printuar, me butonat Printo kopje, PDF, e-kupon, Kthim dhe Anulo.'),
  ...img('sef', '08-kuponet', 'Kuponët e lëshuar'),
  h2('10.2 Anulimi dhe kthimi'),
  ...ol([
    '**Anulimi:** Kuponët → kuponi → **Anulo**. Arsyeja shkruhet detyrimisht.',
    '**Kthimi:** Kuponët → kuponi → **Kthim** (ose arka → Kthim): artikujt, sasitë dhe mënyra e kthimit të parave.',
    'Pronari ose menaxheri e miraton me **PIN-in e vet** (kontrolli në server).',
    'Lëshohet kupon anulimi/kthimi me shuma negative, i lidhur me kuponin origjinal, dërgohet në ATK dhe printohet. Stoku rikthehet.',
  ]),
  note('Shitjet nuk ndryshohen dhe nuk fshihen; korrigjimi bëhet vetëm me kupon anulimi ose kthimi.'),

  // ---- 11 ----
  h1('11. Puna e punëtorit dhe mbyllja e ditës'),
  p('**Puna ime sot**: fillimi i ndërrimit, faturat, totali (kesh/kartelë), kthimet dhe orët e punës së punëtorit.'),
  ...img('sef', '07-puna-ime', 'Puna ime sot'),
  p('**Mbyll ditën**: faturat, totali, keshi, kartela dhe kuleta. Punëtori shkruan keshin që dorëzon; programi tregon mungesën ose tepricën, mbyll ndërrimin dhe del nga llogaria.'),
  ...img('sef', '11-mbyll-diten', 'Mbyllja e ditës'),

  // ---- 12 ----
  h1('12. Puna pa internet'),
  p('Kur nuk ka internet, arka e fiskalizuar në atë pajisje vazhdon të shesë: kuponi nënshkruhet në pajisje me çelësin e ATK-së, merr numrin fiskal dhe QR-në, printohet "OFFLINE" dhe ruhet i enkriptuar në radhë. Sapo kthehet lidhja, kuponët dërgohen vetë në ATK.'),
  ...ul([
    'Shenja e ATK-së tregon numrin e kuponëve në pritje; shiriti në krye tregon orët e mbetura dhe butonin **Dërgo tani**.',
    'ATK lejon **48 orë** për dërgimin e kuponëve offline.',
    'Hyrja me PIN punon edhe pa internet për punëtorët që kanë hyrë më parë në atë pajisje.',
  ]),

  // ---- 13 ----
  h1('13. Blloku i veçantë i kuponëve'),
  p('Kur pajisja prishet plotësisht, kuponët shkruhen me dorë nga blloku i veçantë. Kur rregullohet, pronari ose menaxheri shtyp **Blloku**, shkruan numrin serik dhe datën e orën nga kuponi në letër, shton artikujt dhe pagesën. Kuponi nënshkruhet dhe dërgohet në ATK me kohën e kuponit të letrës.'),
  ...img('sef', '14-blloku', 'Kupon nga blloku i veçantë'),
  note('Kuponët e bllokut regjistrohen brenda 48 orëve + 5 ditëve (UA neni 45).'),

  // ---- 14 ----
  h1('14. Printeri dhe fiskalizimi i arkës në pajisje'),
  p('Te **Printeri** (në arkë) zgjidhet printeri (Bluetooth, USB, në rrjet ose i Windows-it), gjuha e arkës dhe e kuponit, madhësia e tekstit dhe "Printo automatikisht kuponin". Karta **"Fiskalizimi i kësaj arke"** tregon çka mungon dhe ka butonin për regjistrimin e pajisjes në ATK.'),
  ...img('sef', '09-printeri-fiskalizimi', 'Printeri dhe fiskalizimi i kësaj arke'),
  p('Kur printeri nuk përgjigjet, programi ofron "Provo përsëri", "Printo me dritaren" ose "Vazhdo pa printuar". Kuponi mbetet i fiskalizuar dhe mund të printohet përsëri si kopje.'),

  // ---- 15 ----
  h1('15. Fiskalizimi në ATK'),
  ...ol([
    'Në portalin e ATK-së (EDI) regjistrohet njësia dhe merret **Branch ID**; për çdo arkë merret **POS ID**.',
    'Paneli web → **Fiskalizimi (ATK)**, Hapi 1: NUI, numri i fiskalizimit (EDI) dhe mjedisi (Test / Prod). Te "Njësitë" çdo njësi merr Branch ID-në e vet.',
    'Hapi 2: POS ID-ja e çdo arke.',
    'Hapi 3: në arkë, pronari ose menaxheri me PIN shtyp **"Regjistro këtë pajisje"**. Krijohet çelësi privat ECDSA P-256 në pajisje (nuk eksportohet), merret kodi i verifikimit dhe certifikata nga ATK.',
    'Nga ky moment çdo shitje fiskalizohet; shenja ATK bëhet e gjelbër.',
  ]),
  ...img('web', '20-fiskalizimi-hapi1', 'Fiskalizimi – Hapi 1: njësia fiskale'),
  ...img('web', '21-fiskalizimi-arkat', 'Fiskalizimi – njësitë (Branch ID) dhe arkat (POS ID)'),

  // ---- 16 ----
  h1('16. Raportet'),
  p('**Raportet**: shitjet, faturat, fitimi bruto, TVSH-ja e mbledhur, shitjet ditore dhe më të shiturat, sipas periudhës. Kur biznesi ka disa njësi/arka, zgjidhet **Njësia** ose **Arka** – raporti i arkës tregon totalin dhe sa ka shitur secili punëtor në të. **Libri i shitjes** shkarkohet në Excel në modelin zyrtar të ATK-së (me ose pa TVSH).'),
  ...img('web', '22-raportet', 'Raportet dhe Libri i shitjes në Excel'),
  h2('16.1 Puna e punëtorëve'),
  p('Për çdo punëtor: faturat, totali, kthimet/anulimet, komisioni, orët e punës dhe krahasimi i punëtorëve.'),
  ...img('web', '23-puna', 'Puna e punëtorëve'),
  h2('16.2 Regjistri i veprimeve dhe raporti i auditit'),
  p('Çdo veprim (hyrje, shitje, anulim me arsye, kthim, ndryshim çmimi, produkti, cilësimesh, qasjeje) ruhet me kohën dhe përdoruesin. Rreshtat lidhen me SHA-256: "Kontrollo integritetin" zbulon çdo ndryshim. Në web regjistri shihet; **raporti i auditit (CSV/PDF) shkarkohet vetëm nga programi SEF**, nga pronari ose menaxheri me PIN.'),
  ...img('web', '24-regjistri', 'Regjistri i veprimeve në web'),
  ...img('sef', '15-raporti-auditit', 'Raporti i auditit në programin SEF (CSV / PDF)'),

  // ---- 17 ----
  h1('17. Cilësimet'),
  h2('17.1 Të dhënat e biznesit'),
  p('Emri, NUI, numri fiskal, telefoni, adresa – dalin në kupon. Numri i TVSH-së ndryshohet vetëm me kërkesë te Llogaria.'),
  ...img('web', '11-cilesimet-biznesi', 'Të dhënat e biznesit'),
  h2('17.2 Printeri dhe fatura'),
  ...img('web', '12-printeri-fatura', 'Printeri dhe fatura'),
  h2('17.3 Përdoruesit dhe PIN-et'),
  p('Shtohen punëtorët (arkëtar ose menaxher) me PIN 4-shifror; secili merr një ID (001, 002 …) që shkruhet në kupon. Pronari vendos edhe PIN-in e vet për miratimet në arkë.'),
  ...img('web', '13-punetor-i-ri', 'Punëtor i ri me PIN'),
  ...img('web', '14-perdoruesit-pin', 'Përdoruesit dhe PIN-et'),
  h2('17.4 Arkat, pajisjet dhe qasja e punëtorëve'),
  p('Për çdo arkë shihen pajisjet dhe POS ID-ja; butoni **Punëtorët** jep ose heq qasjen e secilit punëtor në atë arkë. Arkat i aktivizon ose i heq vetëm administratori i KontoSef.'),
  ...img('web', '15-arkat-pajisjet', 'Arkat dhe pajisjet'),
  ...img('web', '16-qasja-arkes', 'Qasja e punëtorëve në arkë', 520),
  h2('17.5 Kontabilisti dhe kopja rezervë'),
  ...img('web', '18-kontabilisti', 'Qasja e kontabilistit (vetëm lexim)'),
  ...img('web', '19-backup', 'Kopja rezervë në Excel'),
  h2('17.6 Gjuha dhe madhësia e tekstit'),
  p('Programi i arkës dhe kuponi punojnë në **shqip** dhe **serbisht (latinisht)**; zgjedhja bëhet te Printeri → Gjuha / Jezik. Madhësia e tekstit "E madhe" ndihmon në ekrane të vogla.'),
  ...img('sef', '10-arka-serbisht', 'Arka në gjuhën serbe'),

  // ---- 18 ----
  h1('18. Qasja dhe nxjerrja e të dhënave për kontrollin e ATK-së'),
  table([3000, 3200, W - 6200], [
    ['Çka', 'Ku', 'Formati'],
    ['Kuponët e padërguar në ATK', 'Web → Fiskalizimi (ATK) → "Kuponët e padërguar (për ATK)"', 'CSV, PDF'],
    ['Shitjet, TVSH sipas normës, pagesat, punëtorët', 'Web → Raportet → Eksporto', 'Excel'],
    ['Libri i shitjes', 'Web → Raportet → Libri i shitjes → Shkarko në Excel', 'modeli zyrtar i ATK-së (xlsx)'],
    ['Raporti i auditit', 'Programi SEF → Menuja → Raporti i auditit (pronari/menaxheri)', 'CSV, PDF'],
    ['Puna për punëtor', 'Web → Puna e punëtorëve', 'në ekran'],
    ['Kuponi i veçantë', 'Arka → Kuponët → kuponi → Printo kopje / PDF', 'ribotim, PDF'],
  ]),
  gap(),
  h2('18.1 Siguria e të dhënave'),
  ...ul([
    'Pa fiskalizim nuk ka kupon; serveri refuzon shitjen nga arka e paregjistruar.',
    'Çdo kupon nënshkruhet me ECDSA P-256 me çelës që nuk eksportohet nga pajisja dhe dërgohet në ATK para printimit.',
    'Shitjet janë të pandryshueshme; korrigjimi vetëm me kupon anulimi/kthimi.',
    'Kuponët offline ruhen të enkriptuar në pajisje deri në dërgim (afati 48 orë).',
    'Regjistri i veprimeve vetëm shton dhe është i lidhur me SHA-256.',
    'Të dhënat e çdo biznesi janë të ndara (rregulla sigurie në databazë); qasja e punëtorit kontrollohet për çdo arkë.',
    'Ora e arkës kontrollohet me serverin.',
    'Të dhënat ruhen në server (Supabase, BE) me kopje rezervë.',
  ]),

  // ---- 19 ----
  h1('19. Përditësimet dhe probleme të shpeshta'),
  p('Versioni shfaqet te Cilësimet dhe dërgohet me çdo kupon. Në Windows përditësimet instalohen vetë; në Android instalohet versioni i ri sipër të vjetrit. Çdo version që prek fiskalizimin njoftohet te ATK para publikimit.'),
  table([3400, W - 3400], [
    ['Problemi', 'Zgjidhja'],
    ['"Paguaj" është i bllokuar', 'Arka nuk është e regjistruar në ATK në këtë pajisje – kapitulli 15.'],
    ['Shenja ATK portokalli', 'Kuponë në pritje: kontrolloni internetin, "Dërgo tani". Afati 48 orë.'],
    ['Shenja ATK e kuqe', 'ATK refuzoi një kupon: Fiskalizimi në web tregon gabimin.'],
    ['Punëtori nuk del te PIN-i', 'Nuk ka qasje në këtë arkë: Cilësimet → Arkat → Punëtorët.'],
    ['Printeri nuk printon', 'Kontrolloni letrën, kapakun dhe lidhjen; "Provo përsëri".'],
    ['PIN-i u bllokua', 'Prisni 15 minuta ose pronari vendos PIN të ri.'],
    ['Produkti i ri nuk duket', 'Shtypni "Sinkronizo".'],
  ]),
]

const doc = new Document({
  creator: 'KontoSef.app',
  title: 'KontoSef.app – Manuali i përdoruesit',
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: GREEN }, paragraph: { spacing: { before: 120, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '14201A' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: numberingConfigs },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `KontoSef.app ${VERSION} – Manuali i përdoruesit`, size: 18, color: '56645C' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Faqja ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 18, color: '56645C' })] })] }) },
      children: body,
    },
  ],
})

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(out, b)
  console.log('figures', fig)
})
