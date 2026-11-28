// Excel reports of KontoSef Kontabilist: one visual identity for every report that has no official ATK format.
// Pure (no browser or database imports): scripts/report-xlsx-preview.ts builds sample files in Node.
//
// Layout of every sheet: company (and the office's logo, top right) · NUI and address · report title · period and
// date of generation · column headers (dark band, frozen, filter) · rows (light banding, groups, subtotals, totals,
// final result) · footer "company · page n / m · title" · A4, fit to width, margins for printing.
//
// The ATK files (books, WM/CM, WR) and the office's own forms are NOT made here: they keep their official templates.
import { strToU8, zipSync } from 'fflate'

export type Kind = 'text' | 'code' | 'money' | 'qty' | 'int' | 'date' | 'percent'
export type RowStyle = 'data' | 'group' | 'subtotal' | 'total' | 'grand' | 'note'
export type Val = string | number | null | undefined

export interface Col {
  header: string
  kind?: Kind
  /** Characters; computed from the content when missing. */
  width?: number
}

export interface Row {
  cells: Val[]
  style?: RowStyle
  /** Indent of the first text cell (sub-categories). */
  indent?: number
}

export interface ReportSheet {
  name: string
  /** Title of this sheet (default: the report title, plus the sheet name when there are several sheets). */
  title?: string
  columns: Col[]
  rows: Row[]
  landscape?: boolean
  /** Filter on the header (default: lists of more than 3 rows). */
  filter?: boolean
  /** Light banding of the data rows (default true). */
  band?: boolean
}

export interface Logo {
  bytes: Uint8Array
  ext: 'png' | 'jpeg'
  width: number
  height: number
}

export interface ReportMeta {
  /** The company the report is about. */
  company: string
  /** NUI · VAT no. · address. */
  companyLine?: string
  title: string
  period?: string
  /** "dd.mm.yyyy hh:mm". */
  generatedAt: string
  /** The accounting office that prepared it. */
  preparedBy?: string
  logo?: Logo | null
}

// ---------------------------------------------------------------------------
// Palette (one accent: the navy of the program; greys for structure)
// ---------------------------------------------------------------------------
const NAVY = 'FF1F3A5F'
const INK = 'FF1F2937'
const MUTED = 'FF6B7280'
const LINE = 'FFE5E7EB'
const BAND = 'FFF7F9FC'
const GROUP = 'FFEEF2F7'
const TOTAL = 'FFE2E8F0'

const HEAD_ROWS = 5 // company, line, title, period, spacer → column headers on row 6
const HEADER_ROW = HEAD_ROWS + 1

// ---------------------------------------------------------------------------
// Styles: a registry of fonts / fills / borders / xfs, written into styles.xml
// ---------------------------------------------------------------------------
interface XfSpec {
  font: number
  fill?: number
  border?: number
  numFmt?: number
  h?: 'left' | 'right' | 'center'
  v?: 'center' | 'top' | 'bottom'
  wrap?: boolean
  indent?: number
}

class Styles {
  fonts = [
    `<font><sz val="10"/><color rgb="${INK}"/><name val="Calibri"/><family val="2"/></font>`, // 0 body
    `<font><b/><sz val="10"/><color rgb="${INK}"/><name val="Calibri"/><family val="2"/></font>`, // 1 bold
    `<font><b/><sz val="14"/><color rgb="${NAVY}"/><name val="Calibri"/><family val="2"/></font>`, // 2 company
    `<font><sz val="9"/><color rgb="${MUTED}"/><name val="Calibri"/><family val="2"/></font>`, // 3 muted
    `<font><b/><sz val="12"/><color rgb="${INK}"/><name val="Calibri"/><family val="2"/></font>`, // 4 title
    `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>`, // 5 header
    `<font><b/><sz val="11"/><color rgb="${NAVY}"/><name val="Calibri"/><family val="2"/></font>`, // 6 grand
    `<font><i/><sz val="9"/><color rgb="${MUTED}"/><name val="Calibri"/><family val="2"/></font>`, // 7 note
  ]
  fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    `<fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor indexed="64"/></patternFill></fill>`, // 2 header
    `<fill><patternFill patternType="solid"><fgColor rgb="${BAND}"/><bgColor indexed="64"/></patternFill></fill>`, // 3 band
    `<fill><patternFill patternType="solid"><fgColor rgb="${GROUP}"/><bgColor indexed="64"/></patternFill></fill>`, // 4 group
    `<fill><patternFill patternType="solid"><fgColor rgb="${TOTAL}"/><bgColor indexed="64"/></patternFill></fill>`, // 5 total
  ]
  borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${LINE}"/></bottom><diagonal/></border>`, // 1 data line
    `<border><left/><right/><top style="thin"><color rgb="FF9CA3AF"/></top><bottom style="thin"><color rgb="${LINE}"/></bottom><diagonal/></border>`, // 2 subtotal
    `<border><left/><right/><top style="thin"><color rgb="${NAVY}"/></top><bottom style="thin"><color rgb="${NAVY}"/></bottom><diagonal/></border>`, // 3 total
    `<border><left/><right/><top style="medium"><color rgb="${NAVY}"/></top><bottom style="double"><color rgb="${NAVY}"/></bottom><diagonal/></border>`, // 4 grand
    `<border><left/><right/><top/><bottom style="medium"><color rgb="${NAVY}"/></bottom><diagonal/></border>`, // 5 under the title block
  ]
  numFmts: Record<number, string> = {
    164: '#,##0.00;[Red]\\-#,##0.00;"–"',
    165: 'dd.mm.yyyy',
    166: '0.00%',
    167: '#,##0.####',
  }
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  private keys = new Map<string, number>()

  xf(s: XfSpec): number {
    const key = JSON.stringify(s)
    const hit = this.keys.get(key)
    if (hit != null) return hit
    const align = s.h || s.v || s.wrap || s.indent ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v}"` : ''}${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>` : ''
    const xml = `<xf numFmtId="${s.numFmt ?? 0}" fontId="${s.font}" fillId="${s.fill ?? 0}" borderId="${s.border ?? 0}" xfId="0"${s.numFmt ? ' applyNumberFormat="1"' : ''} applyFont="1"${s.fill ? ' applyFill="1"' : ''}${s.border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`
    this.xfs.push(xml)
    this.keys.set(key, this.xfs.length - 1)
    return this.xfs.length - 1
  }

  xml(): string {
    const nf = Object.entries(this.numFmts).map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`)
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<numFmts count="${nf.length}">${nf.join('')}</numFmts>` +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    )
  }
}

const NUMFMT: Record<Kind, number> = { text: 0, code: 49, money: 164, qty: 167, int: 3, date: 165, percent: 166 }
const isNum = (k: Kind) => k === 'money' || k === 'qty' || k === 'int' || k === 'percent'

function cellStyle(st: Styles, kind: Kind, row: RowStyle, banded: boolean, indent = 0, first = false): number {
  const num = isNum(kind) || kind === 'date'
  const base: XfSpec = { font: 0, numFmt: NUMFMT[kind], h: num ? 'right' : 'left', v: 'center', border: 1 }
  switch (row) {
    case 'group':
      return st.xf({ ...base, font: 1, fill: 4, border: 1, indent: first ? indent : 0 })
    case 'subtotal':
      return st.xf({ ...base, font: 1, border: 2, indent: first ? indent : 0 })
    case 'total':
      return st.xf({ ...base, font: 1, fill: 5, border: 3, indent: first ? indent : 0 })
    case 'grand':
      return st.xf({ ...base, font: 6, fill: 5, border: 4, indent: first ? indent : 0 })
    case 'note':
      return st.xf({ font: 7, h: 'left', v: 'top', wrap: false })
    default:
      return st.xf({ ...base, fill: banded ? 3 : 0, indent: first ? indent : 0 })
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------
const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** "dd.mm.yyyy" or "yyyy-mm-dd" → Excel serial day; null when not a date. */
export function excelDate(v: Val): number | null {
  if (typeof v !== 'string') return null
  let y: number, m: number, d: number
  const a = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim())
  const b = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(v.trim())
  if (a) [d, m, y] = [Number(a[1]), Number(a[2]), Number(a[3])]
  else if (b) [y, m, d] = [Number(b[1]), Number(b[2]), Number(b[3])]
  else return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

const money = (v: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
function shown(v: Val, kind: Kind): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number') return kind === 'money' ? money(v) : kind === 'percent' ? `${(v * 100).toFixed(2)}%` : String(v)
  return v
}

function cellXml(ref: string, v: Val, kind: Kind, s: number): string {
  if (v == null || v === '') return `<c r="${ref}" s="${s}"/>`
  if (kind === 'date') {
    const n = typeof v === 'number' ? v : excelDate(v)
    if (n != null) return `<c r="${ref}" s="${s}"><v>${n}</v></c>`
  }
  if (typeof v === 'number' && kind !== 'text' && kind !== 'code' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${Math.round(v * 1e6) / 1e6}</v></c>`
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------
function widths(sheet: ReportSheet): number[] {
  return sheet.columns.map((c, i) => {
    if (c.width) return c.width
    const kind = c.kind ?? 'text'
    const data = sheet.rows.slice(0, 1500).reduce((m, r) => Math.max(m, shown(r.cells[i], kind).length + (i === 0 && r.indent ? r.indent * 2 : 0)), 0)
    const word = Math.max(...c.header.split(/\s+/).map((w) => w.length))
    const head = Math.min(c.header.length, Math.max(word, 14)) // headers wrap over two lines
    return Math.min(60, Math.max(kind === 'date' ? 11 : 8, data + 2, head + 2))
  })
}

function sheetXml(st: Styles, meta: ReportMeta, sheet: ReportSheet, title: string, hasLogo: boolean): { xml: string; lastRow: number; cols: number } {
  const n = sheet.columns.length
  const kinds = sheet.columns.map((c) => c.kind ?? 'text')
  const w = widths(sheet)
  const last = colName(n - 1)
  const rows: string[] = []
  const merges: string[] = []

  // title block
  const sCompany = st.xf({ font: 2, v: 'center' })
  const sLine = st.xf({ font: 3, v: 'center' })
  const sTitle = st.xf({ font: 4, v: 'center' })
  const sPeriod = st.xf({ font: 3, v: 'center', border: 5 })
  const sRule = st.xf({ font: 3, border: 5 })
  const head = [
    { t: meta.company, s: sCompany, ht: 22 },
    { t: meta.companyLine ?? '', s: sLine, ht: 14 },
    { t: title, s: sTitle, ht: 20 },
    { t: [meta.period && `Periudha: ${meta.period}`, `Gjeneruar më ${meta.generatedAt}`, meta.preparedBy && `Përgatiti: ${meta.preparedBy}`].filter(Boolean).join('   ·   '), s: sPeriod, ht: 16 },
  ]
  head.forEach((h, i) => {
    const r = i + 1
    const rest = h.s === sPeriod ? Array.from({ length: n - 1 }, (_, k) => `<c r="${colName(k + 1)}${r}" s="${sRule}"/>`).join('') : ''
    rows.push(`<row r="${r}" ht="${h.ht}" customHeight="1"><c r="A${r}" s="${h.s}" t="inlineStr"><is><t xml:space="preserve">${esc(h.t)}</t></is></c>${rest}</row>`)
    // not merged: the text runs over the empty cells to its right, whatever the number of columns
  })
  rows.push(`<row r="${HEAD_ROWS}" ht="6" customHeight="1"/>`)

  // column headers
  const hs = (k: Kind) => st.xf({ font: 5, fill: 2, h: isNum(k) || k === 'date' ? 'right' : 'left', v: 'center', wrap: true, border: 0 })
  rows.push(`<row r="${HEADER_ROW}" ht="30" customHeight="1">${sheet.columns.map((c, i) => `<c r="${colName(i)}${HEADER_ROW}" s="${hs(kinds[i])}" t="inlineStr"><is><t xml:space="preserve">${esc(c.header)}</t></is></c>`).join('')}</row>`)

  // body
  let r = HEADER_ROW
  let band = false
  let lastData = HEADER_ROW
  for (const row of sheet.rows) {
    r += 1
    const style = row.style ?? 'data'
    if (style === 'data') band = !band
    else band = false
    const banded = style === 'data' && band && sheet.band !== false
    const cells = sheet.columns.map((_, i) => {
      const kind = style === 'note' ? 'text' : kinds[i]
      return cellXml(`${colName(i)}${r}`, row.cells[i], kind, cellStyle(st, kind, style, banded, row.indent ?? 0, i === 0))
    })
    if (style === 'note') {
      merges.push(`A${r}:${last}${r}`)
      rows.push(`<row r="${r}">${cells[0]}</row>`)
    } else rows.push(`<row r="${r}"${style === 'grand' ? ' ht="18" customHeight="1"' : ''}>${cells.join('')}</row>`)
    if (style === 'data') lastData = r
  }

  const totalWidth = w.reduce((a, b) => a + b, 0)
  const landscape = sheet.landscape ?? (n > 6 || totalWidth > 100)
  const filter = (sheet.filter ?? sheet.rows.filter((x) => (x.style ?? 'data') === 'data').length > 3) && lastData > HEADER_ROW
  const foot = (s: string) => s.replace(/&/g, '&&')

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${last}${Math.max(r, HEADER_ROW)}"/>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100"><pane ySplit="${HEADER_ROW}" topLeftCell="A${HEADER_ROW + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${HEADER_ROW + 1}" sqref="A${HEADER_ROW + 1}"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x.toFixed(1)}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (filter ? `<autoFilter ref="A${HEADER_ROW}:${last}${lastData}"/>` : '') +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    `<printOptions horizontalCentered="1"/>` +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.7" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
    `<headerFooter><oddFooter>&amp;L&amp;8${esc(foot(meta.company))}&amp;C&amp;8Faqja &amp;P / &amp;N&amp;R&amp;8${esc(foot(title))}</oddFooter></headerFooter>` +
    (hasLogo ? `<drawing r:id="rId1"/>` : '') +
    `</worksheet>`
  return { xml, lastRow: r, cols: n }
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------
const sheetName = (s: string, used: Set<string>) => {
  let base = s.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Fleta'
  let name = base
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`
  used.add(name.toLowerCase())
  return name
}

/** The logo at the top right, 40 px high, over the last two columns. */
function drawingXml(logo: Logo, cols: number): string {
  const h = 40
  const w = Math.round((logo.width / Math.max(1, logo.height)) * h)
  const emu = (px: number) => px * 9525
  const col = Math.max(0, cols - 1)
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${emu(2)}</xdr:rowOff></xdr:from><xdr:ext cx="${emu(w)}" cy="${emu(h)}"/>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
  )
}

export function buildReport(meta: ReportMeta, sheets: ReportSheet[]): Uint8Array {
  const st = new Styles()
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  const names: string[] = []
  const logo = meta.logo ?? null
  const many = sheets.length > 1
  const list = sheets.length ? sheets : [{ name: 'Raporti', columns: [{ header: '' }], rows: [] }]

  list.forEach((sh, i) => {
    const name = sheetName(sh.name, used)
    names.push(name)
    const title = sh.title ?? (many ? `${meta.title} – ${sh.name}` : meta.title)
    const { xml, cols } = sheetXml(st, meta, sh, title, Boolean(logo))
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml)
    if (logo) {
      files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`,
      )
      files[`xl/drawings/drawing${i + 1}.xml`] = strToU8(drawingXml(logo, cols))
      files[`xl/drawings/_rels/drawing${i + 1}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.${logo.ext}"/></Relationships>`,
      )
    }
  })
  if (logo) files[`xl/media/logo.${logo.ext}`] = logo.bytes

  files['xl/styles.xml'] = strToU8(st.xml())
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      `<definedNames>${names.map((n, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(n.replace(/'/g, "''"))}'!$${HEADER_ROW}:$${HEADER_ROW}</definedName>`).join('')}` +
      names
        .map((n, i) => {
          const sh = list[i]
          const last = colName(sh.columns.length - 1)
          const lastData = HEADER_ROW + sh.rows.length
          const filter = (sh.filter ?? sh.rows.filter((x) => (x.style ?? 'data') === 'data').length > 3) && sh.rows.some((x) => (x.style ?? 'data') === 'data')
          if (!filter) return ''
          const lastDataRow = HEADER_ROW + Math.max(...sh.rows.map((x, k) => ((x.style ?? 'data') === 'data' ? k + 1 : 0)))
          void lastData
          return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(n.replace(/'/g, "''"))}'!$A$${HEADER_ROW}:$${last}$${lastDataRow}</definedName>`
        })
        .join('') +
      `</definedNames><calcPr calcId="191029"/></workbook>`,
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  )
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  )
  files['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title)}</dc:title><dc:subject>${esc(meta.company)}</dc:subject><dc:creator>${esc(meta.preparedBy ?? 'KontoSef Kontabilist')}</dc:creator></cp:coreProperties>`,
  )
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      (logo ? `<Default Extension="${logo.ext}" ContentType="image/${logo.ext}"/>` : '') +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      (logo ? names.map((_, i) => `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('') : '') +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  )
  return zipSync(files, { level: 6 })
}

// ---------------------------------------------------------------------------
// From the program's simple tables (columns + rows): kinds of columns and styles of rows
// ---------------------------------------------------------------------------
const COUNT_HEADER = /^(nr\.?|nr\b|numri|sasia|sasi|kuponë|kupona|dokumente|fatura|ditë|dite|orë|ore|punonjës|punëtorë|viti|muaji|rreshti|ID)\b|ditë|orë\/javë|sasia|stoku|gjendja \(sasi/i
const PERCENT_HEADER = /%|përqind|marzh/i
const CODE_HEADER = /konto|kodi|nui|nr\. personal|numri personal|iban|barkod|sku|nr\. tvsh|telefon|nr\. fiskal|numri fiskal/i

export function inferKinds(columns: string[], rows: Val[][]): Kind[] {
  return columns.map((h, i) => {
    const vals = rows.map((r) => r[i]).filter((v) => v != null && v !== '')
    if (CODE_HEADER.test(h)) return 'code'
    if (vals.length && vals.every((v) => typeof v === 'number')) {
      if (PERCENT_HEADER.test(h) && vals.every((v) => Math.abs(v as number) <= 1.5)) return 'percent'
      if (COUNT_HEADER.test(h)) return (vals as number[]).every((v) => Number.isInteger(v)) ? 'int' : 'qty'
      return 'money'
    }
    if (vals.length && vals.every((v) => typeof v === 'string' && excelDate(v) != null)) return 'date'
    return 'text'
  })
}

const TOTAL_TEXT = /^(gjithsej|totali|total\b|shuma|nëntotali)/i
const GRAND_TEXT = /^(fitimi|humbja|rezultati|fitimi \/ humbja|neto|gjendja përfundimtare|saldo përfundimtare|gjithsej detyrimet dhe|pasuritë =)/i

/** Styles of rows from their content: "Gjithsej…" totals, the result lines, headings without amounts. */
export function inferRows(rows: Val[][], kinds: Kind[]): Row[] {
  return rows.map((cells) => {
    const texts = cells.filter((v) => typeof v === 'string' && v.trim()) as string[]
    const label = (texts[0] ?? '').trim()
    const hasNum = cells.some((v, i) => typeof v === 'number' && isNum(kinds[i]))
    if (GRAND_TEXT.test(label) && hasNum) return { cells, style: 'grand' }
    if (TOTAL_TEXT.test(label)) return { cells, style: hasNum ? 'total' : 'group' }
    if (!hasNum && texts.length === 1 && label === label.toUpperCase() && /[A-ZËÇ]/.test(label)) return { cells, style: 'group' }
    if (!hasNum && texts.length === 1 && cells.length > 2 && cells.filter((v) => v != null && v !== '').length === 1 && label.length > 0 && !/^\d/.test(label)) return { cells, style: 'subtotal' }
    return { cells }
  })
}

export function simpleSheet(name: string, columns: string[], rows: Val[][], opts: Partial<ReportSheet> = {}): ReportSheet {
  const kinds = inferKinds(columns, rows)
  return { name, columns: columns.map((header, i) => ({ header, kind: kinds[i] })), rows: inferRows(rows, kinds), ...opts }
}

// ---------------------------------------------------------------------------
// Logo from a data URL (PNG / JPEG) with its size
// ---------------------------------------------------------------------------
export function logoFromDataUrl(url: string | null | undefined): Logo | null {
  if (!url) return null
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(url)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg'
  const size = ext === 'png' ? pngSize(bytes) : jpegSize(bytes)
  return size ? { bytes, ext, ...size } : null
}

function pngSize(b: Uint8Array) {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null
  const dv = new DataView(b.buffer, b.byteOffset)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

function jpegSize(b: Uint8Array) {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    const len = (b[i + 2] << 8) + b[i + 3]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: (b[i + 5] << 8) + b[i + 6], width: (b[i + 7] << 8) + b[i + 8] }
    i += 2 + len
  }
  return null
}
