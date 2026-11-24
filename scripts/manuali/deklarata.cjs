// Generates the declaration of conformity of the SEF (DOCX) for the ATK application; the applicant fills the blanks and signs.
// Run: NODE_PATH=<docx> node scripts/manuali/deklarata.cjs docs/manuali/KontoSef-Deklarata-e-pajtueshmerise.docx
const fs = require('fs')
const { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx')

const out = process.argv[2]
const VERSION = require('../../package.json').version
const FONT = 'Arial'
const W = 9638

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 140, line: 300 }, alignment: AlignmentType.JUSTIFIED, ...opts, children: runs(text) })
function runs(text) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((s) => (s.startsWith('**') ? new TextRun({ text: s.slice(2, -2), bold: true }) : new TextRun(s)))
}
const ol = (items) => items.map((t) => new Paragraph({ numbering: { reference: 'num', level: 0 }, spacing: { after: 80, line: 288 }, alignment: AlignmentType.JUSTIFIED, children: runs(t) }))
const line = '______________________________'
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const field = (label, value) =>
  new TableRow({
    children: [
      new TableCell({ width: { size: 3200, type: WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none }, children: [new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: label, bold: true })] })] }),
      new TableCell({ width: { size: W - 3200, type: WidthType.DXA }, borders: { top: none, bottom: none, left: none, right: none }, children: [new Paragraph({ spacing: { after: 80 }, children: [new TextRun(value)] })] }),
    ],
  })

const body = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'Republika e Kosovës – Republika Kosova – Republic of Kosovo', size: 20 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: 'Administrata Tatimore e Kosovës', size: 20 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: 'DEKLARATË E PAJTUESHMËRISË SË SOFTUERIT ELEKTRONIK FISKAL (SEF)', bold: true, size: 28 })] }),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [3200, W - 3200],
    rows: [
      field('Aplikuesi (zhvilluesi):', line + line),
      field('NUI / NF / ID:', line),
      field('Adresa:', line + line),
      field('Personi kontaktues:', line),
      field('Emri i SEF:', 'KontoSef.app'),
      field('Versioni i SEF:', VERSION),
      field('Platformat:', 'Windows 10/11 (program i instaluar) dhe Android (aplikacion); paneli i menaxhimit në shfletues (kontosef.app)'),
    ],
  }),
  new Paragraph({ spacing: { after: 240 }, children: [] }),
  p('Unë, i nënshkruari, në cilësinë e aplikuesit për certifikimin dhe mirëmbajtjen e Softuerit Elektronik Fiskal të mësipërm, me përgjegjësi të plotë **deklaroj** se softueri **KontoSef.app**, versioni **' + VERSION + '**, është zhvilluar dhe funksionon në pajtueshmëri me:'),
  ...ol([
    'Ligjin Nr. 08/L-257 për Administrimin e Procedurave Tatimore;',
    'Udhëzimin Administrativ (MF) Nr. 01/2026, datë 27.04.2026, për shfrytëzimin e pajisjeve elektronike fiskale, sistemeve fiskale dhe softuerëve elektronikë fiskalë;',
    'Kërkesat specifike teknike dhe funksionale për pajisjet elektronike fiskale, sistemet fiskale dhe softuerët elektronikë fiskalë, përfshirë ndryshim-plotësimin e vitit 2026;',
    'Kushtet dhe Procedurat për Aplikimin, Certifikimin dhe Mirëmbajtjen e Softuerëve Elektronikë Fiskalë (SEF), të miratuara nga Drejtori i Përgjithshëm i ATK-së më 03.07.2026 (sipas nenit 35, paragrafi 5 i Udhëzimit Administrativ (MF) Nr. 01/2026), përfshirë kërkesat e nenit 5 për dokumentacionin dhe të nenit 6 për testimin teknik;',
    'specifikat teknike të shërbimit të fiskalizimit të ATK-së (models.proto, /ca/verify, /ca/signcsr, /pos/coupon).',
  ]),
  p('Në veçanti deklaroj se softueri:'),
  ...ol([
    'fiskalizon çdo kupon në kohë reale në Sistemin Informativ të ATK-së **para printimit**, dhe nuk lëshon asnjë kupon nga arka që nuk është e regjistruar në ATK;',
    'e nënshkruan çdo kupon me çelës privat ECDSA P-256 të krijuar në pajisjen e arkës, i cili nuk eksportohet, dhe me certifikatë të lëshuar nga ATK;',
    'printon në çdo kupon të dhënat e kërkuara, përfshirë numrin identifikues të SEF-it, NUIKF-në, operatorin me numrin e tij identifikues dhe kodin QR për verifikim nga qytetari;',
    'nuk lejon ndryshimin apo fshirjen e kuponëve të lëshuar; korrigjimi bëhet vetëm me kupon anulimi ose kthimi që i referohet kuponit origjinal, me arsye dhe miratim;',
    'në mungesë të lidhjes i nënshkruan kuponët në pajisje, i ruan të enkriptuar dhe i dërgon në ATK brenda 48 orëve;',
    'mban regjistër të pandryshueshëm të veprimeve dhe mundëson qasjen dhe nxjerrjen e të dhënave për kontrollin e ATK-së (CSV, PDF, Excel);',
    'punon në gjuhën shqipe dhe serbe.',
  ]),
  p('Marr përsipër që çdo ndryshim të softuerit që prek krijimin, ruajtjen apo dërgimin e të dhënave fiskale ta njoftoj paraprakisht në ATK, të mirëmbaj softuerin dhe të ofroj mbështetje për përdoruesit gjatë gjithë kohës së certifikimit.'),
  p('Jam i vetëdijshëm për përgjegjësinë ligjore në rast të deklarimit të të dhënave të pasakta.'),
  new Paragraph({ spacing: { after: 600 }, children: [] }),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W / 2, W / 2],
    rows: [
      new TableRow({
        children: [
          new TableCell({ borders: { top: none, bottom: none, left: none, right: none }, children: [new Paragraph({ children: [new TextRun('Data: ' + line)] })] }),
          new TableCell({ borders: { top: none, bottom: none, left: none, right: none }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('Emri, mbiemri dhe nënshkrimi')] }), new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 400 }, children: [new TextRun(line)] })] }),
        ],
      }),
    ],
  }),
]

const doc = new Document({
  creator: 'KontoSef.app',
  title: 'Deklarata e pajtueshmërisë – KontoSef.app',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 340 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: body }],
})
Packer.toBuffer(doc).then((b) => fs.writeFileSync(out, b))
