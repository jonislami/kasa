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

// ---------------------------------------------------------------------------
const body = [
  // ---- cover ----
  new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ text: 'KontoSef.app', bold: true, size: 64, color: GREEN })] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Softueri Elektronik Fiskal (SEF)', size: 36 })] }),
  new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: 'Manuali i përdorimit', bold: true, size: 44 })] }),
  p('Për shfrytëzuesit e programit dhe për kontrollin nga Administrata Tatimore e Kosovës (ATK) – Udhëzimi Administrativ (MF) Nr. 01/2026, pika 12.5: qasja dhe nxjerrja e informatave nga SEF.'),
  gap(),
  table([3000, W - 3000], [
    ['Të dhënat', 'Vlera'],
    ['Softueri', 'KontoSef.app – arka (POS) dhe fiskalizimi në ATK'],
    ['Versioni', '0.3.25'],
    ['Platformat', 'Windows (program .exe), Android (aplikacion), shfletues (vetëm menaxhim)'],
    ['Gjuhët', 'Shqip, Serbisht (latinisht)'],
    ['Data e dokumentit', 'Nëntor 2026'],
  ]),
  new Paragraph({ children: [new PageBreak()] }),

  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Përmbajtja', bold: true, size: 32, font: FONT })] }),
  new TableOfContents('Përmbajtja', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),

  // ---- 1 ----
  h1('1. Hyrje'),
  p('KontoSef.app është softuer elektronik fiskal për bizneset në Kosovë: shitja në arkë, produktet dhe shërbimet, stoku, raportet, printimi i kuponit dhe fiskalizimi i çdo kuponi në Sistemin Informativ të ATK-së (SIATK).'),
  p('Softueri ka dy pjesë:'),
  ...ul([
    '**Programi SEF** – instalohet në pajisjen e arkës (Windows ose Android). Vetëm ky program shet, nënshkruan dhe dërgon kuponët fiskalë në ATK dhe i printon.',
    '**Paneli i menaxhimit (web)** – hapet në shfletues nga pronari ose menaxheri: produktet, çmimet, stoku, punëtorët dhe PIN-et, raportet, regjistri i veprimeve, fiskalizimi i arkave. Nga paneli web nuk mund të shitet.',
  ]),
  h2('1.1 Llojet e bizneseve'),
  p('Çdo biznes ka një lloj që zgjidhet kur regjistrohet. Arka, fiskalizimi dhe raportet janë të njëjta për të gjitha; ndryshojnë vetëm modulet shtesë:'),
  table([3000, W - 3000], [
    ['Veprimtaria e lokalit', 'Modulet shtesë'],
    ['Tregti me pakicë', 'market, veshje & këpucë: barkod, peshë (kg), stok, madhësi × ngjyrë'],
    ['Gastronomi', 'kafiteri, restorant: tavolina, porosi, ekrani i kuzhinës/barit, receta'],
    ['Barnatore', 'seri (lot) dhe afat skadimi'],
    ['Shërbim', 'shërbime pa stok me njësinë e tyre (orë, ditë …), punëtorë me komision'],
  ]),
  h2('1.2 Rolet'),
  table([2600, W - 2600], [
    ['Roli', 'Çka mund të bëjë'],
    ['Pronari (admin)', 'gjithçka të biznesit: produktet, çmimet, stoku, punëtorët, raportet, fiskalizimi, cilësimet; miraton anulimet dhe kthimet me PIN'],
    ['Menaxheri', 'menaxhon produktet, stokun, punëtorët dhe raportet; miraton anulimet dhe kthimet me PIN'],
    ['Punëtori (arkëtar, kamarier…)', 'vetëm shitja në arkë, puna e vet e sotme dhe printeri; nuk ndryshon produkte, çmime as stok'],
    ['Kontabilisti', 'vetëm lexim: shitjet, kthimet, TVSH-ja, libri i shitjes, eksporti; nuk shet'],
  ]),
  note('Kufizimet zbatohen në databazë (rregulla sigurie në server), jo vetëm duke fshehur butonat.'),

  // ---- 2 ----
  h1('2. Instalimi'),
  p('Programi shkarkohet nga faqja e internetit e KontoSef.app, faqja **Shkarko** (/shkarko):'),
  ...ul([
    '**Windows 10/11** – skedari "Kasa-Setup-<versioni>.exe". Hapet dhe ndiqen hapat e instaluesit. Përditësimet shkarkohen dhe instalohen vetë.',
    '**Android 8 ose më i ri** – skedari "Kasa-<versioni>.apk" (ose nga Play Store). Për APK lejohet "instalimi nga ky burim" kur e kërkon telefoni.',
    '**Shfletuesi** – vetëm për menaxhim (pronari, menaxheri, kontabilisti), pa shitje.',
  ]),
  p('Nevojitet lidhje interneti për aktivizim dhe për dërgimin e kuponëve. Kur interneti ndërpritet, shitja vazhdon (shih kapitullin 8).'),

  // ---- 3 ----
  h1('3. Aktivizimi dhe hyrja'),
  h2('3.1 Aktivizimi i programit SEF'),
  ...ol([
    'Hapet programi i instaluar. Shfaqet ekrani "Aktivizo programin".',
    'Shkruhet çelësi i aktivizimit në formën **KASA-XXXX-XXXX-XXXX**, që e jep administratori i KontoSef.app për biznesin.',
    'Programi lidhet me biznesin dhe me arkën. Një çelës vlen vetëm për një pajisje.',
  ]),
  h2('3.2 Hyrja me PIN'),
  p('Pas aktivizimit, çdo punëtor hyn me **PIN-in 4-shifror** të vet. PIN-et i cakton pronari ose menaxheri te paneli web (Punëtorët). Pas 5 PIN-eve të gabuara hyrja bllokohet përkohësisht (15 minuta).'),
  p('Pronari dhe menaxheri hyjnë në panelin web me email dhe fjalëkalim.'),
  note('Çdo shitje, kthim, anulim dhe veprim ruhet me punëtorin që e kreu, me datën dhe orën.'),
  h2('3.3 Paneli i menaxhimit (web)'),
  p('Menuja e panelit ka katër pjesë: **Sot** (Paneli, Tavolinat), **Produktet & Stoku**, **Raportet** (Raportet, Puna e punëtorëve, Regjistri i veprimeve) dhe poshtë **Fiskalizimi (ATK)**, **Llogaria** dhe **Cilësimet**. Në telefon menuja është poshtë.'),
  p('Biznesi i ri sheh në Panel listën **"Hapat e parë"** me ✓ për çdo hap të kryer: shto produktet, krijo punëtorët dhe PIN-et, instalo programin e arkës, regjistro arkën në ATK.'),

  // ---- 4 ----
  h1('4. Ekrani i arkës'),
  p('Në krye të ekranit janë emri i biznesit dhe i punëtorit, shenja e ATK-së, butoni "Sinkronizo" dhe menuja (Puna ime sot, Kuponët e lëshuar, Printeri, Mbyll ditën, Dil). Në kompjuter, në të majtë është shiriti me ekranet, kuletën (keshi që mban punëtori), "Mbyll ditën" dhe "Dil".'),
  p('Mbi listën e produkteve janë butonat e arkës, secili me emrin poshtë ikonës:'),
  table([2200, W - 2200], [
    ['Butoni', 'Çka bën'],
    ['Shto', 'produkt ose shërbim i ri (pronari/menaxheri): Lloji i artikullit (Artikull / Shërbim), emri, çmimi, njësia matëse, kategoria, kategoria ATK'],
    ['Blloku', 'kupon nga blloku i veçantë i kuponëve (pronari/menaxheri) – kapitulli 9'],
    ['Në pritje', 'kuponët e ruajtur për më vonë (F4 e ruan kuponin aktual)'],
    ['Kuponët', 'të gjithë kuponët e lëshuar – kapitulli 6'],
  ]),
  h2('4.1 Shenja e ATK-së'),
  p('Shenja tregon gjithmonë gjendjen e lidhjes së arkës me SIATK. Shtypja e saj hap kartën e fiskalizimit të arkës.'),
  table([2000, W - 2000], [
    ['Shenja', 'Domethënia'],
    ['ATK ✓ (e gjelbër)', 'arka është e regjistruar në ATK dhe të gjithë kuponët janë konfirmuar nga ATK'],
    ['ATK 3 (portokalli)', 'numri i kuponëve të nënshkruar që presin të dërgohen në ATK (p.sh. pa internet)'],
    ['ATK ! (e kuqe)', 'ATK ka refuzuar një kupon – shih Fiskalizimi'],
    ['ATK – (gri)', 'kjo arkë nuk është regjistruar ende në ATK në këtë pajisje'],
  ]),
  h2('4.2 Sinkronizo'),
  p('Butoni "Sinkronizo" merr menjëherë ndryshimet e bëra diku tjetër (produkte, çmime, tavolina të shtuara në web ose në një arkë tjetër) dhe kontrollon orën me serverin.'),

  // ---- 5 ----
  h1('5. Shitja'),
  ...ol([
    'Artikulli shtohet me kërkim (emri ose kodi), me lexuesin e barkodit ose duke e prekur te lista. Për artikujt me peshë shkruhet sasia në kg (deri në 3 decimale).',
    'Sasia ndryshohet me + / − ose duke e shkruar. Zbritja jepet për artikull ose për gjithë kuponin.',
    'Shtypet **PAGUAJ** (F12). Hapet dritarja **Pagesa**: me ✓ zgjidhet si paguan klienti – një ose dy nga **Kesh, Kartelë, Vauçer, Transfer bankar**. Me një mënyrë paguhet e gjithë shuma (për kesh: shuma e marrë ose butonat Saktë · 5 · 10 · 20 · 50 · 100 €, programi tregon kusurin). Me dy mënyra shkruhet shuma e njërës: me kesh – pjesa tjetër paguhet kesh me kusur (p.sh. Vauçer + Kesh); pa kesh – pjesa tjetër shkon te mënyra e parë (p.sh. Kartelë + Vauçer, Vauçer + Transfer).',
    'Shtypet **MBYLL SHITJEN** (ose Enter). Programi e nënshkruan kuponin në pajisje, e dërgon në ATK **para printimit**, pastaj printon kuponin fiskal me kodin QR.',
  ]),
  table([1800, W - 1800], [
    ['Tasti', 'Veprimi (në kompjuter)'],
    ['F2', 'kërkimi i artikullit'],
    ['F4', 'ruaj kuponin në pritje (klienti kthehet më vonë)'],
    ['F12', 'hap dritaren Pagesa'],
    ['Enter', 'në dritaren Pagesa: mbyll shitjen'],
    ['Esc', 'mbyll dritaren e hapur'],
  ]),
  h2('5.1 Normat e TVSH-së'),
  p('Çmimet e shitjes përfshijnë TVSH-në. Kuponi tregon ndarjen sipas normës, me shkronjat zyrtare të ATK-së:'),
  table([1500, 2200, W - 3700], [
    ['Shkronja', 'Norma', 'Shënim'],
    ['E', '18%', 'norma e përgjithshme'],
    ['D', '8%', 'norma e reduktuar'],
    ['C', '0%', 'norma zero'],
    ['A', 'e liruar', 'pa TVSH; biznesi që nuk është i regjistruar për TVSH shet gjithçka me A'],
  ]),
  h2('5.2 Kuponi fiskal'),
  p('Kuponi i printuar përmban të dhënat e biznesit (emri, NUI, njësia, arka), numrin e kuponit, datën dhe orën, artikujt me sasi, çmim dhe shkronjën e TVSH-së, totalin, ndarjen e TVSH-së, mënyrën e pagesës, emrin dhe **numrin identifikues të punëtorit** (p.sh. "Alton Islami (ID 001)"), NUIKF-në, numrin ditor, **kodin QR 20 × 20 mm** me të cilin blerësi e verifikon kuponin në faqen e ATK-së dhe logon RKS/MF. Kuponi që nënshkruhet pa internet shënohet "OFFLINE"; ribotimi shënohet "KOPJE E KUPONIT".'),
  p('Letra e printerit: 58 mm, 80 mm ose 100 mm (Cilësimet → Printeri → "Letra e printerit").'),

  // ---- 6 ----
  h1('6. Kuponët, anulimi dhe kthimi'),
  h2('6.1 Kuponët e lëshuar'),
  p('Butoni **Kuponët** (ose menuja → Kuponët e lëshuar) hap të gjithë kuponët e ruajtur në sistem, edhe të ditëve të kaluara:'),
  ...ul([
    'Periudha: Sot, Dje, Këtë javë, Këtë muaj ose një periudhë e zgjedhur (nga – deri).',
    'Kërkimi sipas numrit të kuponit; pronari/menaxheri filtron edhe sipas punëtorit (punëtori sheh vetëm kuponët e vet).',
    'Totalet e periudhës: shitjet, anulimet dhe kthimet, totali dhe numri i kuponëve.',
    'Kuponi hapet ashtu siç është printuar (artikujt, sasia, çmimi, TVSH-ja, totali), me butonat **Printo kopje**, **PDF**, **e-kupon**, **Kthim** dhe **Anulo**.',
    'Shitjet pa internet që presin të dërgohen dalin lart, me butonin "Provo tani".',
  ]),
  h2('6.2 Anulimi dhe kthimi'),
  p('Shitjet nuk ndryshohen dhe nuk fshihen. Korrigjimi bëhet me kupon të ri që i referohet kuponit origjinal:'),
  ...ol([
    '**Anulimi:** Kuponët → kuponi → **Anulo**. Arsyeja e anulimit **shkruhet detyrimisht** (butonat e shpejtë e mbushin fushën).',
    '**Kthimi:** Kuponët → kuponi → **Kthim**, ose arka → Kthim; zgjidhen artikujt dhe sasitë që kthehen dhe mënyra e kthimit të parave.',
    'Pronari ose menaxheri e miraton me **PIN-in e vet**. Pa arsye dhe pa PIN të saktë veprimi nuk kryhet (kontrolli bëhet në server).',
    'Lëshohet kupon anulimi/kthimi me shuma negative, i lidhur me kuponin origjinal, dërgohet në ATK dhe printohet. Stoku rikthehet.',
  ]),

  // ---- 7 ----
  h1('7. Mbyllja e ditës'),
  p('"Mbyll ditën" tregon kuponët, totalin, keshin, kartelën, kusurin në fillim dhe kuletën. Punëtori shkruan keshin që dorëzon (opsionale); programi tregon mungesën ose tepricën. Pastaj mbyllet ndërrimi dhe punëtori del nga llogaria.'),

  // ---- 8 ----
  h1('8. Puna pa internet'),
  p('Kur nuk ka internet, arka vazhdon të shesë. Kuponi nënshkruhet në pajisje, shënohet "OFFLINE" dhe ruhet i enkriptuar në radhë. Sapo kthehet lidhja, kuponët dërgohen vetë në ATK.'),
  ...ul([
    'Shenja e ATK-së tregon numrin e kuponëve në pritje.',
    'Në krye të ekranit shfaqet shiriti "… kuponë fiskalë pa u dërguar në ATK" me orët që kanë mbetur dhe butonin **Dërgo tani**.',
    'ATK lejon **48 orë** për dërgimin e kuponëve offline. Kur afati kalon, njoftohet ATK-ja.',
  ]),

  // ---- 9 ----
  h1('9. Blloku i veçantë i kuponëve'),
  p('Kur pajisja prishet plotësisht, kuponët shkruhen me dorë nga blloku i veçantë i kuponëve. Kur pajisja rregullohet, ata regjistrohen në program:'),
  ...ol([
    'Pronari ose menaxheri, i hyrë në arkë me PIN, shtyp butonin **Blloku** te arka (ose **BLLOKU TATIMOR** në dritaren Pagesa).',
    'Shkruhet numri serik i kuponit të bllokut dhe data e ora nga kuponi në letër.',
    'Shtohen artikujt dhe pagesa si zakonisht. Kuponi nënshkruhet dhe dërgohet në ATK me kohën e kuponit të letrës.',
  ]),
  note('Kuponët e bllokut regjistrohen brenda 48 orëve + 5 ditëve (UA neni 45). Për më të vjetër njoftohet ATK-ja.'),

  // ---- 10 ----
  h1('10. Printeri'),
  p('Te Cilësimet → Printeri zgjidhet printeri i arkës:'),
  ...ul([
    '**Windows:** printer termik i instaluar në Windows (USB) – printimi direkt ESC/POS, ose Bluetooth.',
    '**Android:** printer Bluetooth i çiftuar në telefon, ose printer në rrjet (adresa IP).',
    '**Restorant:** për kuzhinën dhe barin zgjidhet printeri i secilit stacion (rrjet, printer i Windows-it ose printeri i arkës).',
  ]),
  p('Kur printeri nuk përgjigjet, programi njofton dhe ofron: "Provo përsëri", "Printo me dritaren" ose "Vazhdo pa printuar". Kuponi është i fiskalizuar edhe nëse printimi dështon dhe mund të printohet përsëri te **Kuponët** → kuponi → "Printo kopje".'),

  // ---- 11 ----
  h1('11. Fiskalizimi i arkës në ATK'),
  p('Bëhet një herë për çdo arkë, nga pronari:'),
  ...ol([
    'Në portalin e ATK-së: regjistrohet njësia e biznesit dhe merren numri EDI dhe Branch ID; për çdo arkë merret POS ID.',
    'Paneli web → **Fiskalizimi**, Hapi 1: NUI, numri EDI, Branch ID dhe ambienti (Test / Prod).',
    'Hapi 2: POS ID-ja e çdo arke.',
    'Hapi 3: në arkë, pronari ose menaxheri (i hyrë me PIN) shtyp **"Regjistro arkën në ATK"**. Programi krijon çelësin privat në pajisje, merr kodin e verifikimit nga ATK dhe certifikatën.',
    'Nga ky moment çdo shitje fiskalizohet vetë. Shenja ATK bëhet e gjelbër.',
  ]),
  note('Çelësi privat krijohet në pajisje dhe nuk del kurrë prej saj (Windows: DPAPI; Android: Keystore). Kur ndërrohet pajisja, arka regjistrohet përsëri.'),

  // ---- 12 ----
  h1('12. Qasja dhe nxjerrja e të dhënave për kontrollin e ATK-së'),
  p('Për nevoja të kontrollit nga ATK-ja, të dhënat nxirren si më poshtë. Qasja jepet nga pronari ose menaxheri (hyrja në panelin web me email ose në arkë me PIN).'),
  table([3000, 3200, W - 6200], [
    ['Çka', 'Ku', 'Formati'],
    ['Kuponët e padërguar në ATK', 'Paneli web → Fiskalizimi (ATK) → "Kuponët e padërguar (për ATK)"; edhe në arkë te Cilësimet', 'CSV, PDF'],
    ['Shitjet, kthimet, anulimet, TVSH sipas normës, pagesat, punëtorët', 'Paneli web → Raportet (periudha: sot, dje, 7 ditë, muaj, e zgjedhur) → Eksporto', 'Excel'],
    ['Regjistri i veprimeve (hyrje, shitje, anulime me arsye, kthime, ndryshime çmimesh e cilësimesh)', 'Paneli web → Raportet → Regjistri i veprimeve', 'CSV, PDF'],
    ['Puna për punëtor (kuponët, kthimet, orët)', 'Paneli web → Raportet → Puna e punëtorëve', 'në ekran / printim'],
    ['Kuponët e lëshuar sipas periudhës dhe punëtorit', 'Arka → Kuponët', 'në ekran, ribotim, PDF'],
    ['Libri i shitjes (çdo kupon, kthimet si notë krediti)', 'Programi Kasa Kontabilist → klienti → "Libri i shitjes dhe i blerjes (ATK)"', 'skedari zyrtar i ATK-së (xlsx)'],
    ['Kuponi i veçantë', 'Arka → Kuponët → kuponi → "Printo kopje" / "PDF"', 'ribotim ("KOPJE E KUPONIT"), PDF'],
  ]),
  gap(),
  p('Eksporti i kuponëve të padërguar kërkon shënimin e kërkesës (p.sh. numri i kërkesës së ATK-së) dhe regjistrohet në regjistrin e veprimeve, sipas nenit 26 pika 4 të Kërkesave specifike teknike.'),
  h2('12.1 Siguria e të dhënave'),
  ...ul([
    'Shitjet janë të pandryshueshme: nuk ka ndryshim as fshirje; korrigjimi bëhet vetëm me kupon anulimi/kthimi.',
    'Çdo kupon nënshkruhet me ECDSA P-256 me çelës që nuk eksportohet nga pajisja dhe dërgohet në ATK para printimit.',
    'Kuponët offline ruhen të enkriptuar në pajisje deri në dërgim.',
    'Regjistri i veprimeve vetëm shton; asnjë veprim nuk fshihet.',
    'Të dhënat e çdo biznesi janë të ndara nga bizneset e tjera (rregulla sigurie në databazë).',
    'Ora e arkës krahasohet me serverin; programi paralajmëron kur ora e pajisjes nuk është e saktë.',
  ]),

  // ---- 13 ----
  h1('13. Gjuha dhe qasja'),
  p('Te Cilësimet → **Gjuha / Jezik** zgjidhet Shqip ose Serbisht (latinisht). Ndryshon i gjithë programi i arkës dhe kuponi fiskal; emrat e produkteve dhe të dhënat e biznesit mbeten siç janë shkruar.'),
  p('Te Cilësimet → **Madhësia e tekstit** zgjidhet "Normal" ose "E madhe" (tekst dhe butona më të mëdhenj), veçmas për çdo pajisje. Programi përdoret edhe vetëm me tastierë: Tab kalon nga një fushë/buton te tjetri, Enter e shtyp, Esc mbyll dritaren.'),

  // ---- 14 ----
  h1('14. Përditësimet dhe versioni'),
  p('Versioni i programit shfaqet te Cilësimet dhe dërgohet me çdo kupon fiskal. Në Windows përditësimet instalohen vetë; në Android instalohet APK-ja e re nga faqja Shkarko ose përditësohet nga Play Store. Çdo version që prek fiskalizimin njoftohet te ATK para publikimit.'),

  // ---- 15 ----
  h1('15. Probleme të shpeshta'),
  table([3400, W - 3400], [
    ['Problemi', 'Zgjidhja'],
    ['Shenja ATK është gri', 'Arka nuk është regjistruar në ATK në këtë pajisje – kapitulli 11, Hapi 3.'],
    ['Shenja ATK është portokalli', 'Ka kuponë në pritje. Kontrolloni internetin; shtypni "Dërgo tani". Afati 48 orë.'],
    ['Shenja ATK është e kuqe', 'ATK refuzoi një kupon. Paneli web → Fiskalizimi tregon gabimin; kontaktoni mbështetjen.'],
    ['Printeri nuk printon', 'Kontrolloni letrën, ndezjen dhe lidhjen; "Provo përsëri" ose zgjidhni printerin përsëri te Cilësimet → Printeri.'],
    ['PIN-i u bllokua', 'Prisni 15 minuta ose pronari e ndryshon PIN-in te paneli web.'],
    ['Produkti i ri nuk duket në arkë', 'Shtypni "Sinkronizo".'],
    ['Ora e pajisjes nuk është e saktë', 'Cilësimet e pajisjes → Data dhe ora → "Vendos automatikisht".'],
  ]),
]

const doc = new Document({
  creator: 'KontoSef.app',
  title: 'KontoSef.app – Manuali i përdorimit',
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
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'KontoSef.app – Manuali i përdorimit', size: 18, color: '56645C' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Faqja ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 18, color: '56645C' })] })] }) },
      children: body,
    },
  ],
})

Packer.toBuffer(doc).then((b) => fs.writeFileSync(out, b))
