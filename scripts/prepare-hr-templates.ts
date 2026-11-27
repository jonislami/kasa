// Prepares the office's original Word / Excel forms as templates in public/hr/ (run again when a form changes):
//   npx tsx --tsconfig tsconfig.app.json scripts/prepare-hr-templates.ts "<folder with the originals>"
//
// Nothing of the layout is touched: only the empty places of each form get a {{key}} in a run that keeps the
// formatting of the original run (src/kontabilist/officeForms.ts replaces it, or puts the original blank back).
// Sample data the originals carry (another company's name, NUI, address, employees, figures) is removed, and so are
// the author names in docProps/core.xml.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const dir = process.argv[2]
if (!dir) throw new Error('Jep dosjen me formularët origjinalë')
const out = 'public/hr'
mkdirSync(out, { recursive: true })

type Files = Record<string, Uint8Array>
const read = (name: string): Files => unzipSync(new Uint8Array(readFileSync(join(dir, name))))
const text = (f: Files, part: string) => strFromU8(f[part])
const put = (f: Files, part: string, xml: string) => (f[part] = strToU8(xml))
const write = (f: Files, name: string) => {
  writeFileSync(join(out, name), zipSync(f, { level: 9 }))
  console.log('✓', join(out, name))
}

/** Clears the author fields (keeps the elements). */
function anonymize(f: Files) {
  put(
    f,
    'docProps/core.xml',
    text(f, 'docProps/core.xml')
      .replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator></dc:creator>')
      .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy></cp:lastModifiedBy>'),
  )
}

function must(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`Nuk u gjet: ${what}`)
}

/** Replaces the first `<w:t…>old</w:t>` at or after `from`; returns the new xml and the index after it. */
function swapRun(xml: string, old: string, neu: string, from = 0): [string, number] {
  const esc = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<w:t(?: xml:space="preserve")?>${esc}</w:t>`, 'g')
  re.lastIndex = from
  const m = re.exec(xml)
  must(m, `"${old}"`)
  const rep = `<w:t xml:space="preserve">${neu}</w:t>`
  return [xml.slice(0, m.index) + rep + xml.slice(m.index + m[0].length), m.index + rep.length]
}

/** "Label" + ":" (one run, or the label run followed by a ":" run; `tail` = the last run of a split label) → ": {{key}}". */
function afterLabel(xml: string, label: string, key: string, tail?: string): string {
  if (xml.includes(`>${label}:</w:t>`)) return swapRun(xml, `${label}:`, `${label}: {{${key}}}`)[0]
  if (tail && xml.includes(`>${tail}:</w:t>`)) return swapRun(xml, `${tail}:`, `${tail}: {{${key}}}`)[0]
  const at = xml.indexOf(`>${label}</w:t>`)
  must(at >= 0, label)
  return swapRun(xml, ':', `: {{${key}}}`, at)[0]
}

// ---------------------------------------------------------------------------
// Employment contracts
// ---------------------------------------------------------------------------
function contract(src: string, dst: string, fixed: boolean) {
  const f = read(src)
  let x = text(f, 'word/document.xml')
  x = afterLabel(x, 'Emri i Kompanisë', 'company')
  x = afterLabel(x, 'Nr. i regjistrimit të biznesit', 'company_no')
  x = afterLabel(x, 'Adresa', 'company_address')
  x = afterLabel(x, 'Përfaqësuesi', 'representative')
  x = afterLabel(x, 'Emri dhe mbiemri', 'name')
  x = afterLabel(x, 'Nr. personal i identifikimit', 'personal_no')
  x = afterLabel(x, 'Vendbanimi', 'residence')
  x = afterLabel(x, 'Profesioni', 'profession')
  x = afterLabel(x, 'Nr. i xhirollogarisë bankare', 'iban')
  x = afterLabel(x, 'Detyrat dhe përgjegjësitë', 'duties', 'përgjegjësitë')
  if (fixed) {
    x = swapRun(x, 'Për një periudhë të caktuar ____ ', 'Për një periudhë të caktuar {{period}} ')[0]
    x = afterLabel(x, 'Data e fillimit të punës', 'start')
  } else {
    x = afterLabel(x, 'Data e fillimit të punës', 'start')
  }
  x = afterLabel(x, 'Puna provuese', 'probation')
  x = swapRun(x, '___orë', '{{hours}}orë')[0]
  if (fixed) {
    const at = x.indexOf('> Orari i punës</w:t>')
    let i: number
    ;[x, i] = swapRun(x, '___', '{{from}}', at)
    x = swapRun(x, '____', '{{to}}', i)[0]
  } else {
    x = swapRun(x, '__- __', '{{from}}- {{to}}')[0]
  }
  x = afterLabel(x, 'Orët shtesë', 'overtime')
  x = afterLabel(x, 'Pushimi gjatë orarit të punës', 'break')
  // this cell centres its label with 13 leading spaces and a negative indent: with a value the spaces go
  // ({{workplace_pad}}), so label and value stay inside the cell
  x = afterLabel(x, '             Vendi i punës', 'workplace')
  x = swapRun(x, '             Vendi i punës', '{{workplace_pad}}Vendi i punës')[0]
  {
    // …and the paragraph gets indent 0 and left alignment ({{raw_workplace_ppr}}; empty form = original pPr)
    const at = x.indexOf('{{workplace_pad}}Vendi i punës')
    const p0 = x.lastIndexOf('<w:p ', at)
    const orig = '<w:ind w:left="-2718"/><w:jc w:val="center"/>'
    const k = x.indexOf(orig, p0)
    must(k > p0 && k < at, 'paragrafi i vendit të punës')
    x = x.slice(0, k) + '{{raw_workplace_ppr}}' + x.slice(k + orig.length)
  }
  x = swapRun(x, '______ muaj; __________ orë', '{{gross_month}} muaj; {{gross_hour}} orë')[0]
  x = swapRun(x, 'Pushimi vjetor:_____ ditë', 'Pushimi vjetor:{{leave_days}} ditë')[0]
  const court = 'Nëse përkundër përkushtimit dhe vullnetit të mirë të dy palëve nuk arrihet marrëveshje, atëherë palët kontraktuese e pranojnë kompetencën e Gjykatës Themelore në _______.'
  x = swapRun(x, court, court.replace('_______', '{{court}}'))[0]
  put(f, 'word/document.xml', x)
  anonymize(f)
  write(f, dst)
}

// ---------------------------------------------------------------------------
// Annual leave decision: the first decision of the original, then the original end of the document
// ---------------------------------------------------------------------------
function leaveDecision(src: string, dst: string) {
  const f = read(src)
  const x = text(f, 'word/document.xml')
  const marks = [...x.matchAll(/Në bazë të nenit 32/g)].map((m) => m.index!)
  must(marks.length >= 2, 'aktvendimi i dytë')
  const pStarts = [...x.matchAll(/<w:p[ >]/g)].map((m) => m.index!)
  const second = Math.max(...pStarts.filter((s) => s < marks[1]))
  const sect = x.lastIndexOf('<w:sectPr')
  const lastTbl = x.lastIndexOf('</w:tbl>', sect) + '</w:tbl>'.length
  // Word needs a paragraph after the last table; the original's empty paragraphs there would open an empty second
  // page (the decision fills page 1 exactly, as in the original), so it is one hidden paragraph 0.7 pt high
  const tail = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="14" w:lineRule="exact"/><w:rPr><w:vanish/><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>'
  let d = x.slice(0, second) + tail + x.slice(sect)
  void lastTbl

  // the decision's places, in the order they come
  let i = d.indexOf('>Punëmarrësi </w:t>')
  must(i >= 0, 'Punëmarrësi')
  ;[d, i] = swapRun(d, 'Xhemshit Xhafa', '{{name}}', i)
  ;[d, i] = swapRun(d, 'ScutiMarketing L.L.C', '{{company}}', i)
  ;[d, i] = swapRun(d, ' 2025 ', ' {{year}} ', i)
  ;[d, i] = swapRun(d, '10 ', '{{days}} ', i)
  ;[d, i] = swapRun(d, '02', '{{from}}', i)
  ;[d, i] = swapRun(d, '.02.2026 deri me ', ' deri me ', i)
  ;[d, i] = swapRun(d, '13', '{{to}}', i)
  ;[d, i] = swapRun(d, '.02.2026 ', ' ', i)
  ;[d, i] = swapRun(d, '1', '{{back}}', i)
  ;[d, i] = swapRun(d, '6', '', i)
  ;[d, i] = swapRun(d, '.02.2026 ', ' ', i)
  ;[d, i] = swapRun(d, '10', '{{days}}', i)
  ;[d, i] = swapRun(d, 'Xhemshit', '{{name}}', i)
  ;[d, i] = swapRun(d, ' ', '', i)
  ;[d, i] = swapRun(d, 'Xhafa', '', i)
  must(!/Xhemshit|Xhafa|Scuti|Ardiana/.test(d), 'mbetje të të dhënave shembull')
  put(f, 'word/document.xml', d)

  let h = text(f, 'word/header1.xml')
  let j = 0
  ;[h, j] = swapRun(h, 'ScutiMarketing L.L.C', '{{company_head}}')
  ;[h, j] = swapRun(h, '811483388', '{{nui}}', j)
  ;[h, j] = swapRun(h, '  Rr ', '  {{address}}', j)
  ;[h, j] = swapRun(h, 'Dëshmoret', '', j)
  ;[h, j] = swapRun(h, ' e ', '', j)
  ;[h] = swapRun(h, 'Kombit', '', j)
  put(f, 'word/header1.xml', h)
  anonymize(f)
  write(f, dst)
}

// ---------------------------------------------------------------------------
// Financial statements (KSRF): company header and the sample figures out, formulas recalculated on opening
// ---------------------------------------------------------------------------
function statements(src: string, dst: string) {
  const f = read(src)
  let ss = text(f, 'xl/sharedStrings.xml')
  for (const [a, b] of [
    ['Emri i kompanisë: Scuti Marketing', 'Emri i kompanisë: {{company}}'],
    ['Numri Unik Identifikues: 811483388', 'Numri Unik Identifikues: {{nui}}'],
    ['Adresa: Deshmoret e Kombit / Ferizaj', 'Adresa: {{address}}'],
  ]) {
    must(ss.includes(a), a)
    ss = ss.replace(a, b)
  }
  put(f, 'xl/sharedStrings.xml', ss)
  // sample prior-year figures typed in B-Gj (E14 receivables, E16 other current assets, E22 PPE, E37 income tax)
  let s1 = text(f, 'xl/worksheets/sheet1.xml')
  for (const ref of ['E14', 'E16', 'E22', 'E37']) {
    const re = new RegExp(`<c r="${ref}"([^>]*?)>(?:<f>[^<]*</f>)?<v>[^<]*</v></c>`)
    must(re.test(s1), ref)
    s1 = s1.replace(re, `<c r="${ref}"$1/>`)
  }
  put(f, 'xl/worksheets/sheet1.xml', s1)
  // the sample company's own note on C50 ("parapagi i qiras janar shkurt") goes, with its drawing; B262 (a general
  // example for the notes) stays
  const cm = text(f, 'xl/comments1.xml')
  const noteRe = /<comment ref="C50"[\s\S]*?<\/comment>/
  must(noteRe.test(cm), 'komenti C50')
  put(f, 'xl/comments1.xml', cm.replace(noteRe, ''))
  const vml = text(f, 'xl/drawings/vmlDrawing1.vml')
  const shapes = [...vml.matchAll(/<v:shape [\s\S]*?<\/v:shape>/g)]
  const c50 = shapes.find((m) => /<x:Row>49<\/x:Row>\s*<x:Column>2<\/x:Column>/.test(m[0]))
  must(c50, 'forma e komentit C50')
  put(f, 'xl/drawings/vmlDrawing1.vml', vml.replace(c50[0], ''))
  // every cached formula result belongs to the sample company: drop them and let Excel recalculate on opening
  for (const p of Object.keys(f).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))) {
    put(f, p, text(f, p).replace(/(<f>[^<]*<\/f>)<v>[^<]*<\/v>/g, '$1').replace(/(<f [^>]*\/>)<v>[^<]*<\/v>/g, '$1'))
  }
  delete f['xl/calcChain.xml']
  put(f, '[Content_Types].xml', text(f, '[Content_Types].xml').replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''))
  put(f, 'xl/_rels/workbook.xml.rels', text(f, 'xl/_rels/workbook.xml.rels').replace(/<Relationship [^>]*Target="calcChain\.xml"\/>/, ''))
  put(f, 'xl/workbook.xml', text(f, 'xl/workbook.xml').replace('<calcPr calcId="125725"/>', '<calcPr calcId="125725" fullCalcOnLoad="1"/>'))
  anonymize(f)
  write(f, dst)
}

contract('KOntrat pune per koh te caktuar.docx', 'kontrata_kohe_te_caktuar.docx', true)
contract('KOntrat pune per koh te pa caktuar.docx', 'kontrata_kohe_te_pacaktuar.docx', false)
leaveDecision('vendimi per pushim e.docx', 'vendimi_pushimi_vjetor.docx')
statements('format e bilancave sipas standarteve kosovare te raportimit financiar.xlsx', 'pasqyrat_financiare_ksrf.xlsx')
