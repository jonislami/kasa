// The two ATK payroll forms, filled into copies of the original ATK templates (public/atk, unchanged copies):
//   - "Lista e pagave dhe kontributeve"  – lista_pagave.xls (BIFF8), Sheet1 A–K, data from row 3
//   - "Formulari WR" (tatimi i mbajtur në burim) – formulari_wr.xlsx, Sheet1 A–O, data from row 3
// Rows 1–2 (titles, codes, notes), column widths, row heights, fonts, colours, borders, cell formats, the
// PO/JO list (L2:L3), the country list (U4:U224), the empty Sheet2/Sheet3 stay exactly as in ATK's files.
// Pure: no browser or database imports (scripts/atk-forms-preview.ts uses it in Node).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { readCfb, writeCfb } from './cfb'

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

// ---------------------------------------------------------------------------
// Titles, word for word as in the templates (line breaks included)
// ---------------------------------------------------------------------------
export interface FormHead {
  title: string
  /** Red note under the title (WR M and N). */
  note?: string
  code: string
}

export const PAY_HEAD: FormHead[] = [
  { title: 'Emri', code: 'a' },
  { title: 'Mbiemri', code: 'b' },
  { title: 'Numri \nIndividual i punëtorit', code: 'c' },
  { title: 'Bruto paga \npër muaj', code: 'd' },
  { title: 'Kontributi pensional i të punësuarit', code: 'e=(d*5%)' },
  { title: 'Kontributi pensional i punëdhënësit', code: 'f=(d*5%)' },
  { title: 'Kontributi suplementar i të punësuarit', code: 'g' },
  { title: 'Kontributi suplementar i punëdhënësit', code: 'h' },
  { title: 'Punë \nPrimare', code: 'i' },
  { title: 'Përfshihen Kontributet', code: 'j' },
  { title: 'Aplikohet \nTatimi në Paga', code: 'k' },
]

export const WR_HEAD: FormHead[] = [
  { title: 'Nr. Rend', code: '1' },
  { title: 'NUI/ \nNumri Fiskal/ Numri personal', code: '2' },
  { title: 'Emri i biznesit/ \nEmri dhe Mbiemri i personit', code: '3' },
  { title: 'Interesi bruto i paguar', code: '4' },
  { title: 'Të drejtat pronësore të paguara', code: '5' },
  { title: 'Fitoret bruto në lotari të paguara', code: '6' },
  { title: 'Tatimi Mbajtur në Burim(TMB)', code: '7=(4+5+6)*10% ose % sipas METD' },
  { title: 'Qiraja bruto e paguar \n(pa TVSH)', code: '8' },
  { title: 'Pagesa bruto për personin jo-rezident (zbavitës)', code: '9' },
  { title: 'Pagesa bruto për personin jo-rezident për shërbime', code: '10' },
  { title: 'TMB për personat jo-rezident ', code: '11=(9+10)*5% ose % sipas METD' },
  { title: 'Pagesat bruto për personat fizik jo-afarist (kategori të veçanta)', code: '12' },
  { title: 'Hapësira e objektit të marr me qira në metra katror (m2) ', note: '[plotësohet nese kutia 8>0]', code: '13' },
  { title: 'Vlera bruto e qirasë mujore (pa TVSH)\n', note: '[plotësohet nëse kutia 8>0]', code: '14' },
  { title: 'Shteti me të cilin keni transaksione', code: '15' },
]

/** The country list of the WR template (Sheet1!U4:U224), in its order and spelling. */
export const WR_COUNTRIES: string[] = [
  'Afrika e Jugut', 'Algjeri', 'Algjeria', 'Amerika', 'Andorra', 'Angli', 'Angola', 'Antartike', 'Antigua',
  'Arabia Saudite', 'Argjentina', 'Argjentine', 'Armeni', 'Armenia', 'Australia', 'Australie', 'Austri', 'Austria',
  'Azerbejgjani', 'B e Madhe &Irlanda Veriore', 'Bahamas', 'Bahame', 'Bahrani', 'Bangladesh', 'Barbades', 'Barbuda',
  'Belgjika', 'Belgjike', 'Belize', 'Benin', 'Bolivia', 'Bosnadhe Hercegovina', 'Botsvana', 'Brazil', 'Britani e Madhe',
  'Bullgaria', 'Burkina Faso', 'Burundia', 'Butan', 'Cad', 'Cekosllavaki', 'Danimark', 'Domenika', 'E.e Bashkuara Arabe',
  'Egjypt', 'Ekuador', 'Eritrea', 'Estonia', 'Etiopia', 'Federata e Rusis', 'Fiji', 'Filipinet', 'Finlande', 'France',
  'Gabon', 'Gambia', 'Gane', 'Gjeorgji', 'Gjermania', 'Gjibuti', 'Grenade', 'Grenadines', 'Greqi', 'Guadeloupe',
  'Guatemala', 'Guine Ekuatoriale', 'Guinea Bisau', 'Guinea e Re Papua', 'Guinea Ekuatoriale', 'Guinee Bisao',
  'Guinee Konakry', 'Gujane', 'Haiti', 'Holland', 'Honduras', 'Hong Kong', 'Hungari', 'Ile Vierges Britann', 'Indi',
  'Indonezia', 'Irak', 'Irani', 'Irlande', 'Islanda', 'Islanda Solomone', 'Israel', 'Itali', 'Japoni', 'Jemeni', 'Jordania',
  'Kambuxhia', 'Kameroun', 'Kanada', 'Kape verde', 'Katar', 'Kazakistani', 'Kenia', 'Kili', 'Kina', 'Kirgistani',
  'Kiribati', 'Kolumbia', 'Komoros', 'Kongo', 'Kore', 'Korea', 'Korea Jugut', 'Korea Veriut', 'Kosova', 'Kosta Rika',
  'Kroacia', 'Kuba', 'Kuvajti', 'Latvia', 'Lesoto', 'Libani', 'Liberia', 'Libia', 'Lihtenshtajn', 'Lituania',
  'Luksemburgu', 'Madegascar', 'Malaisi', 'Malavia', 'Mali', 'Mali i Zi', 'Malta', 'Maqedonia', 'Marok',
  'Marshall islanda', 'Mauritania', 'Mauritiusi', 'Meksiko', 'Mikronesia', 'Moldavia', 'Monako', 'Mongolia',
  'Montserrat', 'Mozambiku', 'Muanmar', 'Namibia', 'Napali', 'Nauru', 'Nevis', 'Nigeria', 'Nikaragua', 'Norvegji',
  'Omani', 'Pakistani', 'Palau', 'Panama', 'Paraguaji', 'Peru', 'Poloni', 'Porto Riko', 'Portugali', 'Qekia', 'Qipro',
  'R.D.E Laosit', 'R.Q.E Afrikës', 'Rep e Kores', 'Rep e Moldovis', 'Rep e Tanzanis', 'Republika Domenikane', 'Romania',
  'Ruanda', 'Rusi', 'S Tome dhe Principe', 'S V dhe Grenadinet', 'Saint Kits dhe Nevis', 'Salvador', 'Samoa',
  'San marino', 'Sejqelles', 'Senegal', 'Sent Luqia', 'Serbia', 'Shen Croix', 'Shen Kitis', 'Shen Lucia', 'Shen Marteen',
  'Shen Vincent', 'Shetet e Bashkuara', 'Shqipëria', 'Shri Lanka', 'Sierra Leone', 'Singapor', 'Siria', 'Sllovakia',
  'Sllovenia', 'Somalia', 'Spanje', 'Sudan', 'Suedi', 'Surinami', 'Svaziland', 'Tailande', 'Taxhikistan', 'Togo',
  'Tonga', 'Trinidad dhe Tobago', 'Trinidat', 'Tunizi', 'Turkmenistani', 'Turqi', 'Tuvalu', 'Uganda', 'Ukraine',
  'Uruguaji', 'Uzbekistani', 'Vanuati', 'Venezuela', 'Vietnam', 'Vietnami', 'Xhamahiria Lib.Arabe', 'Xhamaike', 'Zaire',
  'Zambia', 'Zelend e re', 'Zimbabve', 'Zvicer',
]

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export type YesNo = 'PO' | 'JO'

export interface PayFormRow {
  first_name: string
  last_name: string
  personal_no: string
  gross: number
  /** g, h: contributions above the 5% + 5% of the form (an employee who pays more). */
  extra_emp: number
  extra_er: number
  primary: YesNo
  contributions: YesNo
  tax: YesNo
}

/** e and f exactly as the template's formulas (E3 = D3*5%, F3 = E3). */
export const payContrib = (gross: number) => r2(gross * 0.05)

export interface PayLineIn {
  employee_id: string
  name: string
  personal_no: string | null
  primary_job: boolean
  gross: number
  emp_pct: number
  emp_contrib: number
  er_contrib: number
}

export function buildPayRows(lines: PayLineIn[], employees: { id: string; first_name: string; last_name: string }[]): PayFormRow[] {
  const byId = new Map(employees.map((e) => [e.id, e]))
  return lines.map((l) => {
    const e = byId.get(l.employee_id)
    const [first, ...rest] = l.name.trim().split(/\s+/)
    const base = payContrib(l.gross)
    const noContrib = l.emp_pct === 0 && l.emp_contrib === 0
    return {
      first_name: e?.first_name ?? first ?? '',
      last_name: e?.last_name ?? rest.join(' '),
      personal_no: (l.personal_no ?? '').trim(),
      gross: r2(l.gross),
      extra_emp: noContrib ? 0 : Math.max(0, r2(l.emp_contrib - base)),
      extra_er: noContrib ? 0 : Math.max(0, r2(l.er_contrib - base)),
      primary: l.primary_job ? 'PO' : 'JO',
      contributions: noContrib ? 'JO' : 'PO',
      tax: 'PO',
    }
  })
}

export interface WrRow {
  /** NUI / fiscal number / personal number. */
  id_no: string
  name: string
  interest: number
  royalties: number
  lottery: number
  /** 7 = (4+5+6)*10% unless the accountant enters the treaty rate amount. */
  tmb: number | null
  rent: number
  nonres_exempt: number
  nonres_services: number
  /** 11 = (9+10)*5% unless entered. */
  tmb_nonres: number | null
  special: number
  area_m2: number | null
  monthly_rent: number | null
  country: string
}

export const emptyWrRow = (): WrRow => ({
  id_no: '',
  name: '',
  interest: 0,
  royalties: 0,
  lottery: 0,
  tmb: null,
  rent: 0,
  nonres_exempt: 0,
  nonres_services: 0,
  tmb_nonres: null,
  special: 0,
  area_m2: null,
  monthly_rent: null,
  country: 'Kosova',
})

export const wrTmb = (r: WrRow) => r.tmb ?? r2((r.interest + r.royalties + r.lottery) * 0.1)
export const wrTmbNonres = (r: WrRow) => r.tmb_nonres ?? r2((r.nonres_exempt + r.nonres_services) * 0.05)

export interface RentDocIn {
  partner_name: string | null
  partner_nui: string | null
  net_e: number
  net_d: number
  amt_c: number
  amt_a: number
}

/** One row per landlord from the rent invoices of the month: 8 and 14 = rent without VAT. */
export function buildWrRows(rentDocs: RentDocIn[]): WrRow[] {
  const map = new Map<string, WrRow>()
  for (const d of rentDocs) {
    const id = (d.partner_nui ?? '').trim()
    const name = (d.partner_name ?? '').trim()
    const key = id || name.toLowerCase()
    const net = r2(d.net_e + d.net_d + d.amt_c + d.amt_a)
    const row = map.get(key) ?? { ...emptyWrRow(), id_no: id, name, monthly_rent: 0 }
    row.rent = r2(row.rent + net)
    row.monthly_rent = r2((row.monthly_rent ?? 0) + net)
    map.set(key, row)
  }
  return [...map.values()]
}

/** What ATK will reject, per row (1-based numbers). */
export function checkWrRows(rows: WrRow[]): string[] {
  const out: string[] = []
  rows.forEach((r, i) => {
    const n = i + 1
    if (!r.id_no) out.push(`Rreshti ${n}: mungon NUI / numri personal.`)
    if (!r.name) out.push(`Rreshti ${n}: mungon emri.`)
    if (r.rent > 0 && !r.area_m2) out.push(`Rreshti ${n}: kutia 13 (m²) plotësohet kur kutia 8 > 0.`)
    if (r.rent > 0 && !r.monthly_rent) out.push(`Rreshti ${n}: kutia 14 (qiraja mujore) plotësohet kur kutia 8 > 0.`)
    if (!WR_COUNTRIES.includes(r.country)) out.push(`Rreshti ${n}: zgjidh shtetin nga lista.`)
  })
  return out
}

export function checkPayRows(rows: PayFormRow[]): string[] {
  return rows.flatMap((r, i) => (/^\d{10}$/.test(r.personal_no) ? [] : [`${r.first_name} ${r.last_name}`.trim() + ` (rreshti ${i + 1}): numri personal duhet të ketë 10 shifra.`]))
}

// ---------------------------------------------------------------------------
// Formulari WR – .xlsx
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const numOrText = (s: string): string | number => (/^[1-9]\d{0,14}$/.test(s) ? Number(s) : s)

function xcell(ref: string, v: string | number | null | undefined): string {
  if (v == null || v === '' || v === 0) return ''
  if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
}

export function fillWrSheetXml(xml: string, rows: WrRow[]): string {
  const start = xml.indexOf('<sheetData>') + '<sheetData>'.length
  const end = xml.indexOf('</sheetData>')
  const tplRows = [...xml.slice(start, end).matchAll(/<row ([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)].map((m) => ({
    n: Number(/\br="(\d+)"/.exec(m[1])![1]),
    attrs: m[1],
    cells: m[2] ?? '',
  }))
  const byN = new Map(tplRows.map((r) => [r.n, r]))
  // template cells from column P on (the country list in U) stay; the example's A–O values go
  const keep = (cells: string) => [...cells.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].filter((c) => c[1].length > 1 || c[1] > 'O').map((c) => c[0]).join('')
  const last = Math.max(3, rows.length + 2, ...tplRows.map((r) => r.n))
  const ref3 = byN.get(3)?.attrs ?? 'r="3"'
  const out: string[] = []
  for (let n = 1; n <= last; n++) {
    const t = byN.get(n)
    if (n <= 2) {
      if (t) out.push(`<row ${t.attrs}>${t.cells}</row>`)
      continue
    }
    const d = rows[n - 3]
    if (!t && !d) continue
    const attrs = (t?.attrs ?? ref3).replace(/\br="\d+"/, `r="${n}"`).replace(/\bspans="[^"]*"/, 'spans="1:21"')
    const own = d
      ? [
          xcell(`A${n}`, n - 2),
          xcell(`B${n}`, numOrText(d.id_no)),
          xcell(`C${n}`, d.name),
          xcell(`D${n}`, d.interest),
          xcell(`E${n}`, d.royalties),
          xcell(`F${n}`, d.lottery),
          xcell(`G${n}`, wrTmb(d)),
          xcell(`H${n}`, d.rent),
          xcell(`I${n}`, d.nonres_exempt),
          xcell(`J${n}`, d.nonres_services),
          xcell(`K${n}`, wrTmbNonres(d)),
          xcell(`L${n}`, d.special),
          xcell(`M${n}`, d.area_m2),
          xcell(`N${n}`, d.monthly_rent),
          xcell(`O${n}`, d.country),
        ].join('')
      : ''
    out.push(`<row ${attrs}>${own}${t ? keep(t.cells) : ''}</row>`)
  }
  const dataLast = Math.max(3, rows.length + 2)
  return (xml.slice(0, start) + out.join('') + xml.slice(end))
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:U${last}"/>`)
    .replace(/(<dataValidation [^>]*?sqref=")O3(?::O\d+)?(")/, `$1O3:O${dataLast}$2`)
}

/** The filled WR workbook (.xlsx bytes) from the bytes of ATK's template. */
export function fillWrTemplate(template: Uint8Array, rows: WrRow[]): Uint8Array {
  const files = unzipSync(template)
  const sheet = 'xl/worksheets/sheet1.xml'
  files[sheet] = strToU8(fillWrSheetXml(strFromU8(files[sheet]), rows))
  return zipSync(files, { level: 6 })
}

// ---------------------------------------------------------------------------
// Lista e pagave dhe kontributeve – .xls (BIFF8 inside a compound file)
// ---------------------------------------------------------------------------
interface Rec {
  type: number
  data: Uint8Array
}

const T = { BOF: 0x809, EOF: 0x0a, BOUNDSHEET: 0x85, SST: 0xfc, EXTSST: 0xff, CONTINUE: 0x3c, INDEX: 0x20b, DEFCOLWIDTH: 0x55, DIMENSIONS: 0x200, ROW: 0x208, DBCELL: 0xd7 }
const CELL_TYPES = new Set([0x208, 0xd7, 0xfd, 0x203, 0x27e, 0xbd, 0xbe, 0x201, 0x06, 0x207, 0x204, 0x205, 0x221, 0x4bc, 0x236])

function parseRecords(b: Uint8Array): Rec[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Rec[] = []
  for (let o = 0; o + 4 <= b.length; ) {
    const type = dv.getUint16(o, true)
    const len = dv.getUint16(o + 2, true)
    out.push({ type, data: b.slice(o + 4, o + 4 + len) })
    o += 4 + len
  }
  return out
}

class W {
  private parts: number[] = []
  u8(v: number) {
    this.parts.push(v & 0xff)
    return this
  }
  u16(v: number) {
    return this.u8(v).u8(v >> 8)
  }
  u32(v: number) {
    return this.u16(v & 0xffff).u16(v >>> 16)
  }
  f64(v: number) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v, true)
    b.forEach((x) => this.u8(x))
    return this
  }
  bytes(b: Uint8Array) {
    b.forEach((x) => this.u8(x))
    return this
  }
  get length() {
    return this.parts.length
  }
  done() {
    return Uint8Array.from(this.parts)
  }
}

/** A BIFF8 unicode string (XLUnicodeRichExtendedString without rich text): compressed when every char fits Latin-1. */
function sstString(s: string): Uint8Array {
  const wide = [...s].some((ch) => ch.charCodeAt(0) > 0xff)
  const w = new W().u16(s.length).u8(wide ? 1 : 0)
  for (let i = 0; i < s.length; i++) (wide ? w.u16(s.charCodeAt(i)) : w.u8(s.charCodeAt(i)))
  return w.done()
}

/** The entries of an SST (with its CONTINUE records) as raw bytes, one per string. */
function readSst(sst: Rec, conts: Rec[]): { total: number; strings: Uint8Array[] } {
  const chunks = [sst.data, ...conts.map((c) => c.data)]
  const dv0 = new DataView(sst.data.buffer, sst.data.byteOffset)
  const total = dv0.getUint32(0, true)
  const count = dv0.getUint32(4, true)
  let ci = 0
  let p = 8
  const take = (n: number): number[] => {
    const r: number[] = []
    while (r.length < n) {
      if (p >= chunks[ci].length) {
        ci++
        p = 0
      }
      r.push(chunks[ci][p++])
    }
    return r
  }
  const strings: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    if (p >= chunks[ci].length) {
      ci++
      p = 0
    }
    const head = take(3)
    const cch = head[0] | (head[1] << 8)
    let flags = head[2]
    const extra: number[] = []
    let runs = 0
    let ext = 0
    if (flags & 8) {
      const x = take(2)
      extra.push(...x)
      runs = x[0] | (x[1] << 8)
    }
    if (flags & 4) {
      const x = take(4)
      extra.push(...x)
      ext = x[0] | (x[1] << 8) | (x[2] << 16) | (x[3] << 24)
    }
    // the characters may continue in the next CONTINUE record, which starts with its own flags byte
    const chars: number[] = []
    let left = cch
    let wide = flags & 1
    while (left > 0) {
      if (p >= chunks[ci].length) {
        ci++
        p = 0
        wide = chunks[ci][p++] & 1
      }
      const avail = Math.floor((chunks[ci].length - p) / (wide ? 2 : 1))
      const k = Math.min(left, avail)
      for (let j = 0; j < k; j++) {
        chars.push(wide ? chunks[ci][p] | (chunks[ci][p + 1] << 8) : chunks[ci][p])
        p += wide ? 2 : 1
      }
      left -= k
    }
    const tail = take(runs * 4 + ext)
    // stored again as one piece: wide if any char needs it
    const anyWide = chars.some((c) => c > 0xff)
    flags = (flags & ~1) | (anyWide ? 1 : 0)
    const w = new W().u16(cch).u8(flags)
    extra.forEach((x) => w.u8(x))
    chars.forEach((c) => (anyWide ? w.u16(c) : w.u8(c)))
    tail.forEach((x) => w.u8(x))
    strings.push(w.done())
  }
  return { total, strings }
}

/** SST + CONTINUE records (no string split: a string that does not fit starts a new CONTINUE). */
function writeSst(total: number, strings: Uint8Array[]): { recs: Rec[]; starts: { rec: number; off: number }[] } {
  const MAX = 8224
  const recs: W[] = [new W().u32(total).u32(strings.length)]
  const starts: { rec: number; off: number }[] = []
  for (const s of strings) {
    if (s.length > MAX - 8) throw new Error('Teksti është shumë i gjatë për .xls')
    if (recs[recs.length - 1].length + s.length > MAX) recs.push(new W())
    starts.push({ rec: recs.length - 1, off: recs[recs.length - 1].length })
    recs[recs.length - 1].bytes(s)
  }
  return { recs: recs.map((w, i) => ({ type: i === 0 ? T.SST : T.CONTINUE, data: w.done() })), starts }
}

const cellHead = (row: number, col: number, xf: number) => new W().u16(row).u16(col).u16(xf)
const rec = (type: number, w: W | Uint8Array): Rec => ({ type, data: w instanceof W ? w.done() : w })

/** The filled payroll list (.xls bytes) from the bytes of ATK's template. */
export function fillPayTemplate(template: Uint8Array, rows: PayFormRow[]): Uint8Array {
  const cfb = readCfb(template)
  const book = cfb.streams.find((s) => s.name === 'Workbook')
  if (!book) throw new Error('Shablloni i pagave nuk është .xls (BIFF8)')
  const recs = parseRecords(book.data)

  // --- shared strings: the template's, plus the names and personal numbers
  const iSst = recs.findIndex((r) => r.type === T.SST)
  let iEnd = iSst + 1
  while (recs[iEnd].type === T.CONTINUE) iEnd++
  const sst = readSst(recs[iSst], recs.slice(iSst + 1, iEnd))
  const index = new Map<string, number>()
  const strIdx = (s: string): number => {
    const k = index.get(s)
    if (k != null) return k
    sst.strings.push(sstString(s))
    index.set(s, sst.strings.length - 1)
    return sst.strings.length - 1
  }
  // PO / JO are already in the template (16, 17)
  sst.strings.forEach((b, i) => {
    if (b[2] === 0 && b.length === 3 + (b[0] | (b[1] << 8))) index.set(String.fromCharCode(...b.slice(3)), i)
  })

  // --- Sheet1: the cell block between DIMENSIONS and the first record after the last cell
  const bofs = recs.map((r, i) => (r.type === T.BOF ? i : -1)).filter((i) => i >= 0)
  const s1 = bofs[1]
  const iDim = recs.findIndex((r, i) => i > s1 && r.type === T.DIMENSIONS)
  let iAfter = iDim + 1
  while (CELL_TYPES.has(recs[iAfter].type)) iAfter++
  const old = recs.slice(iDim + 1, iAfter)
  const rowRec = (n: number) => old.find((r) => r.type === T.ROW && (r.data[0] | (r.data[1] << 8)) === n)!
  const cellsOf = (n: number) => old.filter((r) => r.type !== T.ROW && r.type !== T.DBCELL && (r.data[0] | (r.data[1] << 8)) === n)
  const xfAt = (n: number, col: number): number => {
    for (const r of cellsOf(n)) {
      const c = r.data[2] | (r.data[3] << 8)
      if (r.type === 0xbd || r.type === 0xbe) {
        const lastCol = r.data[r.data.length - 2] | (r.data[r.data.length - 1] << 8)
        if (col >= c && col <= lastCol) {
          const step = r.type === 0xbd ? 6 : 2
          const o = 4 + (col - c) * step
          return r.data[o] | (r.data[o + 1] << 8)
        }
      } else if (c === col) return r.data[4] | (r.data[5] << 8)
    }
    return 15
  }
  const xf = Array.from({ length: 12 }, (_, c) => xfAt(2, c))
  const formulaE = cellsOf(2).find((r) => r.type === 0x06 && (r.data[2] | (r.data[3] << 8)) === 4)
  const fFlags = formulaE ? formulaE.data[14] | (formulaE.data[15] << 8) : 0
  const row3 = rowRec(2)

  // rows: 0 and 1 unchanged; data from row index 2; L3 ("JO" of the PO/JO list) stays in row 3
  type Row = { row: Rec; cells: Rec[] }
  const out: Row[] = [0, 1].map((n) => ({ row: rowRec(n), cells: cellsOf(n) }))
  const lCell = cellsOf(2).find((r) => (r.data[2] | (r.data[3] << 8)) === 11)
  const total = Math.max(rows.length, 1)
  for (let i = 0; i < total; i++) {
    const n = i + 2
    const d = rows[i]
    const cells: Rec[] = []
    if (d) {
      const label = (col: number, s: string) => s && cells.push(rec(0xfd, cellHead(n, col, xf[col]).u32(strIdx(s))))
      const num = (col: number, v: number) => cells.push(rec(0x203, cellHead(n, col, xf[col]).f64(v)))
      const formula = (col: number, value: number, rgce: W) => {
        const f = rgce.done()
        cells.push(rec(0x06, cellHead(n, col, xf[col]).f64(value).u16(fFlags).u32(0).u16(f.length).bytes(f)))
      }
      label(0, d.first_name)
      label(1, d.last_name)
      label(2, d.personal_no)
      num(3, d.gross)
      const e = payContrib(d.gross)
      // E = D*5%: ptgRefV D{n} relative, ptgNum 0.05, ptgMul; F = E: ptgRefV E{n}
      formula(4, e, new W().u8(0x44).u16(n).u16(0xc003).u8(0x1f).f64(0.05).u8(0x05))
      formula(5, e, new W().u8(0x44).u16(n).u16(0xc004))
      num(6, d.extra_emp)
      num(7, d.extra_er)
      label(8, d.primary)
      label(9, d.contributions)
      label(10, d.tax)
    }
    if (n === 2 && lCell) cells.push(lCell)
    const lastCol = cells.reduce((m, c) => Math.max(m, (c.data[2] | (c.data[3] << 8)) + 1), 0)
    const row = new Uint8Array(row3.data)
    row[0] = n & 0xff
    row[1] = n >> 8
    if (!cells.length) continue
    // keep the template's column range of the row (0–12), wider only if needed
    const firstCol = row3.data[2] | (row3.data[3] << 8)
    const colMac = Math.max(row3.data[4] | (row3.data[5] << 8), lastCol)
    row[2] = firstCol & 0xff
    row[3] = firstCol >> 8
    row[4] = colMac & 0xff
    row[5] = colMac >> 8
    out.push({ row: { type: T.ROW, data: row }, cells })
  }

  // blocks of 32 rows: ROW records, their cells, DBCELL (offsets filled after serialising)
  const block: Rec[] = []
  const dbcells: { rec: Rec; firstRow: number; cellStarts: number[] }[] = []
  for (let b = 0; b < out.length; b += 32) {
    const part = out.slice(b, b + 32)
    const firstRow = block.length
    part.forEach((r) => block.push(r.row))
    const cellStarts: number[] = []
    part.forEach((r) => {
      cellStarts.push(block.length)
      block.push(...r.cells)
    })
    const db: Rec = { type: T.DBCELL, data: new Uint8Array(4 + part.length * 2) }
    dbcells.push({ rec: db, firstRow, cellStarts })
    block.push(db)
  }
  const dim = new Uint8Array(recs[iDim].data)
  const rwMac = out[out.length - 1] ? (out[out.length - 1].row.data[0] | (out[out.length - 1].row.data[1] << 8)) + 1 : 0
  new DataView(dim.buffer).setUint32(4, rwMac, true)

  // SST "total" = number of LABELSST cells in the workbook
  const isLabel = (r: Rec) => r.type === 0xfd
  const labels = recs.slice(0, iDim + 1).filter(isLabel).length + block.filter(isLabel).length + recs.slice(iAfter).filter(isLabel).length
  const sstOut = writeSst(labels, sst.strings)
  const dsst = Math.max(8, Math.ceil(sst.strings.length / 128))
  const extRec: Rec = { type: T.EXTSST, data: new Uint8Array(2 + 8 * Math.ceil(sst.strings.length / dsst)) }
  const final: Rec[] = [
    ...recs.slice(0, iSst),
    ...sstOut.recs,
    extRec,
    ...recs.slice(recs[iEnd].type === T.EXTSST ? iEnd + 1 : iEnd, iDim),
    { type: T.DIMENSIONS, data: dim },
    ...block,
    ...recs.slice(iAfter),
  ]
  // INDEX of Sheet1 sized for its DBCELLs before the positions are taken
  const idx1 = final.slice(final.indexOf(final.filter((x) => x.type === T.BOF)[1])).find((r) => r.type === T.INDEX)
  if (idx1) idx1.data = new Uint8Array(16 + 4 * dbcells.length)

  const pos = new Map<Rec, number>()
  let o = 0
  for (const r of final) {
    pos.set(r, o)
    o += 4 + r.data.length
  }
  const put16 = (b: Uint8Array, at: number, v: number) => new DataView(b.buffer, b.byteOffset).setUint16(at, v, true)
  const put32 = (b: Uint8Array, at: number, v: number) => new DataView(b.buffer, b.byteOffset).setUint32(at, v, true)

  // DBCELL: offset back to the first ROW of its block; offsets to the first cell of each row (the first one from
  // the 2nd ROW record, or from the end of the only one)
  for (const d of dbcells) {
    put32(d.rec.data, 0, pos.get(d.rec)! - pos.get(block[d.firstRow])!)
    let prev = pos.get(block[d.firstRow + 1])!
    d.cellStarts.forEach((ci, k) => {
      const at = pos.get(block[ci])!
      put16(d.rec.data, 4 + k * 2, at - prev)
      prev = at
    })
  }

  // EXTSST: stream position of every dsst-th string
  const ext = new W().u16(dsst)
  for (let i = 0; i < sst.strings.length; i += dsst) {
    const s = sstOut.starts[i]
    ext.u32(pos.get(sstOut.recs[s.rec])! + 4 + s.off).u16(4 + s.off).u16(0)
  }
  extRec.data = ext.done()

  // BOUNDSHEET: position of each sheet's BOF; INDEX of each sheet: rows, DEFCOLWIDTH and DBCELL positions
  const sheetBofs = final.map((r, i) => (r.type === T.BOF ? i : -1)).filter((i) => i >= 0).slice(1)
  final.filter((r) => r.type === T.BOUNDSHEET).forEach((r, k) => put32(r.data, 0, pos.get(final[sheetBofs[k]])!))
  for (const b of sheetBofs) {
    const sheet = final.slice(b, final.findIndex((r, i) => i > b && r.type === T.EOF))
    const idx = sheet.find((r) => r.type === T.INDEX)
    if (!idx) continue
    const defcol = sheet.find((r) => r.type === T.DEFCOLWIDTH)
    const dimR = sheet.find((r) => r.type === T.DIMENSIONS)!
    const dd = new DataView(dimR.data.buffer, dimR.data.byteOffset)
    const w = new W().u32(0).u32(dd.getUint32(0, true)).u32(dd.getUint32(4, true)).u32(defcol ? pos.get(defcol)! : 0)
    sheet.filter((r) => r.type === T.DBCELL).forEach((d) => w.u32(pos.get(d)!))
    const data = w.done()
    if (data.length !== idx.data.length) throw new Error('INDEX')
    idx.data = data
  }

  const w = new W()
  for (const r of final) w.u16(r.type).u16(r.data.length).bytes(r.data)
  book.data = w.done()
  return writeCfb(cfb)
}
