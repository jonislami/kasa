// The ATK sales and purchase books, built exactly on the four official templates
// ("Libri i shitjes me TVSH", "Libri i blerjes me TVSH", "Libri i shitjes jo TVSH", "Libri i blerjes jo TVSH"):
// same columns, same header rows and merged cells, same box numbers of the VAT return and the same formulas
// (K1 = (bases) × 18%, K2 = (bases) × 8%, totals = sum of the columns).
// Pure (no database / browser imports): fetching and downloading are in atkBooksApi.ts, filling the ATK file in atkXlsx.ts.

export type BookKind = 'sales_vat' | 'purchase_vat' | 'sales_novat' | 'purchase_novat'
export const BOOK_LABELS: Record<BookKind, string> = {
  sales_vat: 'Libri i shitjes me TVSH',
  purchase_vat: 'Libri i blerjes me TVSH',
  sales_novat: 'Libri i shitjes jo TVSH',
  purchase_novat: 'Libri i blerjes jo TVSH',
}

export type VatFlag = 'none' | 'service_abroad' | 'reverse_charge' | 'exempt_credit' | 'import' | 'farmer'

/** One document of the period (acc_vat_book_range, 0032). */
export interface BookDoc {
  id?: string
  kind: 'sale' | 'purchase'
  date: string
  doc_no: string | null
  partner: string
  nui: string
  vat_no: string
  doc_type: 'invoice' | 'credit_note' | 'debit_note'
  vat_flag: VatFlag
  category: string | null
  asset: boolean
  export: boolean
  net_e: number
  vat_e: number
  net_d: number
  vat_d: number
  amt_c: number
  amt_a: number
  vat_nd: number
  total: number
}

// ---------------------------------------------------------------------------
// Template structure
// ---------------------------------------------------------------------------
export interface HeadCell {
  text: string
  col: number // 0-based
  colSpan?: number
  rowSpan?: number
}

export interface BookTemplate {
  kind: BookKind
  widths: number[]
  /** Header rows exactly as in the template (row 1..3). */
  head: HeadCell[][]
  /** Columns that hold amounts (0-based), the rest are text. */
  amountFrom: number
  /** Short names of the amount columns for the on-screen preview. */
  codes: string[]
}

const W_SALES_VAT = [5.29, 11.43, 9.14, 31.71, 11.29, 11.57, 12.71, 12.71, 14.43, 12.71, 16.57, 12.71, 12.71, 12.71, 12.71, 12.71, 12.71, 12.71, 11.29, 12.71, 12.71, 12.71, 12.71, 11.71]
const W_PURCHASE_VAT = [4.33, 10, 17.66, 27.66, 13.55, 11.44, 13, 13, 13, 13, 11.11, 9, 13.66, 11.66, 8.11, 7.11, 8.66, 9, 12.55, 10, 9, 13.33, 9, 9, 9, 9, 9, 11.66, 14.11]
const W_SALES_NOVAT = [4.26, 10, 17.68, 27.68, 13.58, 11.42, 11.42, 11.42, 14.42]
const W_PURCHASE_NOVAT = [4.29, 10, 17.71, 27.71, 13.57, 11.43, 11.43, 11.43, 11.43, 11.43, 11.14, 14.43]

const BOX_ROW = 'Numri i kutisë në Deklaratën e TVSH-së'

export const TEMPLATES: Record<BookKind, BookTemplate> = {
  sales_vat: {
    kind: 'sales_vat',
    widths: W_SALES_VAT,
    amountFrom: 6,
    codes: ['[9]', '[10a]', '[10b]', '[10c]', '[10]', '[11]', '[12]', '[16]', '[20]', '[24]', '[28]', '[K1]', '[14]', '[18]', '[22]', '[26]', '[K2]', '[30]'],
    head: [
      [
        { text: 'Nr.', col: 0, rowSpan: 2 },
        { text: 'Fatura', col: 1, colSpan: 2 },
        { text: 'Blerësi', col: 3, colSpan: 3 },
        { text: 'Shitjet e liruara nga TVSH', col: 6, colSpan: 6 },
        { text: 'Shitjet e tatueshme me normën 18%', col: 12, colSpan: 6 },
        { text: 'Shitjet e tatueshme me normën 8%', col: 18, colSpan: 5 },
        { text: 'Totali i TVSH-së së llogaritur me   18% dhe 8%', col: 23, rowSpan: 2 },
      ],
      [
        'Data', 'Numri i faturës', 'Emri i blerësit', 'Numri Fiskal i blerësit', 'Numri i TVSH-së së blerësit',
        'Shitjet e liruara pa të drejtë kreditimi', 'Shitjet e shërbimeve jashtë vendit', 'Shitjet brenda vendit me ngarkesë të kundërt  të TVSH-së',
        'Shitjet tjera të liruara me të drejtë kreditimi', 'Totali i shitjeve të liruara me të drejtë kreditimi', 'Eksportet',
        'Shitjet e tatueshme ', 'Nota debitore e lëshuar, nota kreditore e pranuar ', 'Fatura e borxhit të keq e pranuar', 'Rregullimet për të rritur TVSH-në ',
        'Blerjet që i nënshtrohen ngarkesës së kundërt', 'Totali i TVSH-së së llogaritur me normën 18%',
        'Shitjet e tatueshme', 'Nota debitore e lëshuar, nota kreditore e pranuar ', 'Fatura e borxhit të keq e pranuar', 'Rregullimet për të rritur TVSH-në ',
        'Totali i TVSH-së së llogaritur me normën 8%',
      ].map((text, i) => ({ text, col: i + 1 })),
      [
        { text: BOX_ROW, col: 0, colSpan: 6 },
        ...['[9]', '[10a]', '[10b]', '[10c]', '[10] = [10a]+[10b]+[10c]', '[11]', '[12]', '[16]', '[20]', '[24]', '[28]', '[K1]', '[14]', '[18]', '[22]', '[26]', '[K2]', '[30]'].map((text, i) => ({ text, col: 6 + i })),
      ],
    ],
  },
  purchase_vat: {
    kind: 'purchase_vat',
    widths: W_PURCHASE_VAT,
    amountFrom: 6,
    codes: ['[31]', '[32]', '[33]', '[34]', '[35]', '[39]', '[43]', '[47]', '[53]', '[57]', '[61]', '[65]', '[K1]', '[37]', '[41]', '[45]', '[49]', '[51]', '[55]', '[59]', '[63]', '[K2]', '[67]'],
    head: [
      [
        { text: 'Nr.', col: 0, rowSpan: 2 },
        { text: 'Fatura', col: 1, colSpan: 2 },
        { text: 'Shitësi', col: 3, colSpan: 3 },
        { text: 'Blerjet dhe Importet e liruara dhe me TVSH jo të zbritshme', col: 6, colSpan: 4 },
        { text: 'Blerjet dhe Importet e tatushme me 18%, si dhe rregullimet e zbritjeve', col: 10, colSpan: 9 },
        { text: 'Blerjet dhe Importet e tatushme me 8%, si dhe rregullimet e zbritjeve', col: 19, colSpan: 9 },
        { text: 'Totali i TVSH-së së zbritshme me 18% dhe 8%', col: 28, rowSpan: 2 },
      ],
      [
        'Data', 'Numri i faturës', 'Emri i shitësit', 'Numri Fiskal i shitësit', 'Numri i TVSH-së së shitësit',
        'Blerjet dhe importet pa TVSH', 'Blerjet dhe importet investive pa TVSH', 'Blerjet dhe importet me TVSH jo të zbritshme', 'Blerjet dhe importet investive me TVSH jo të zbritshme',
        'Importet', 'Importet investive  ', 'Blerjet vendore', 'Blerjet investive vendore  ', 'Nota debitore e pranuar, nota kreditore e lëshuar ', 'Fatura e borxhit të keq e lëshuar ',
        'Rregullimet për të ulur TVSH-në për pagesë', 'E drejta e kreditimit të TVSH-së në lidhje me Ngarkesën e Kundërt', 'Totali i TVSH-së së  zbritshme me 18%',
        'Importet ', 'Importet investive ', 'Blerjet vendore', 'Blerjet investive vendore', 'Blerjet nga fermerët (aplikimi i normës së sheshtë)',
        'Nota debitore e pranuar, nota kreditore e lëshuar ', 'Fatura e borxhit të keq e lëshuar', 'Rregullimet për të ulur TVSH-në për pagesë', 'Totali i TVSH-së së  zbritshme me 8%',
      ].map((text, i) => ({ text, col: i + 1 })),
      [
        { text: BOX_ROW, col: 0, colSpan: 6 },
        ...['[31]', '[32]', '[33]', '[34]', '[35]', '[39]', '[43]', '[47]', '[53]', '[57]', '[61]', '[65]', '[K1]', '[37]', '[41]', '[45]', '[49]', '[51]', '[55]', '[59]', '[63]', '[K2]', '[67] '].map((text, i) => ({ text, col: 6 + i })),
      ],
    ],
  },
  sales_novat: {
    kind: 'sales_novat',
    widths: W_SALES_NOVAT,
    amountFrom: 5,
    codes: ['a', 'b', 'c', 'd=a+b+c'],
    head: [
      [
        { text: 'Nr.', col: 0, rowSpan: 3 },
        { text: 'Fatura', col: 1, colSpan: 2 },
        { text: 'Blerësi', col: 3, colSpan: 2 },
        { text: 'Shitje e mallrave / shërbimeve brenda vendit', col: 5, rowSpan: 2 },
        { text: 'Shitje e shërbimeve jashtë vendit', col: 6, rowSpan: 2 },
        { text: 'Eksporte', col: 7, rowSpan: 2 },
        { text: 'Shitjet totale', col: 8, rowSpan: 2 },
      ],
      [
        { text: 'Data', col: 1, rowSpan: 2 },
        { text: 'Numri i faturës', col: 2, rowSpan: 2 },
        { text: 'Emri i blerësit', col: 3, rowSpan: 2 },
        { text: 'Numri Unik Identifikues / Numri Fiskal                      i blerësit', col: 4, rowSpan: 2 },
      ],
      [
        { text: 'a', col: 5 },
        { text: 'b', col: 6 },
        { text: 'c', col: 7 },
        { text: 'd=a+b+c', col: 8 },
      ],
    ],
  },
  purchase_novat: {
    kind: 'purchase_novat',
    widths: W_PURCHASE_NOVAT,
    amountFrom: 5,
    codes: ['a', 'b', 'c', 'd', 'e', 'f', 'g=a+b+c+d+e+f'],
    head: [
      [
        { text: 'Nr.', col: 0, rowSpan: 3 },
        { text: 'Fatura', col: 1, colSpan: 2 },
        { text: 'Shitësi', col: 3, colSpan: 2 },
        { text: 'Blerje vendore', col: 5, colSpan: 3 },
        { text: 'Importe', col: 8, colSpan: 3 },
        { text: 'Blerjet totale', col: 11, rowSpan: 2 },
      ],
      [
        { text: 'Data', col: 1, rowSpan: 2 },
        { text: 'Numri i faturës', col: 2, rowSpan: 2 },
        { text: 'Emri i shitësit', col: 3, rowSpan: 2 },
        { text: 'Numri Unik Identifikues / Numri Fiskal / Numri Personal                 i shitësit', col: 4, rowSpan: 2 },
        { text: 'Blerje e mallrave / shërbimeve', col: 5 },
        { text: 'Blerje për shpenzime', col: 6 },
        { text: 'Blerje investive', col: 7 },
        { text: 'Importe të mallrave', col: 8 },
        { text: 'Importe investive', col: 9 },
        { text: 'Blerje të shërbimeve jashtë vendit', col: 10 },
      ],
      [
        { text: 'a', col: 5 },
        { text: 'b', col: 6 },
        { text: 'c', col: 7 },
        { text: 'd', col: 8 },
        { text: 'e', col: 9 },
        { text: 'f', col: 10 },
        { text: 'g=a+b+c+d+e+f', col: 11 },
      ],
    ],
  },
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export interface BookRow {
  doc: BookDoc
  /** Text columns after "Nr.": date, invoice number, name, NUI/NF and (VAT books) VAT number. */
  text: string[]
  /** Amount columns in template order. */
  amounts: number[]
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
export const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const abs = (v: number) => r2(Math.abs(v))
const sum = (...v: number[]) => r2(v.reduce((a, b) => a + b, 0))

/** NUI / NF column: the number, or the ATK code (3 export, 2 service abroad, 6 reverse charge). */
export function nuiCell(d: BookDoc): string {
  if (d.kind === 'sale' && d.export) return '3'
  if (d.kind === 'sale' && d.vat_flag === 'service_abroad') return '2'
  if (d.kind === 'purchase' && d.vat_flag === 'reverse_charge') return '6'
  return (d.nui ?? '').replace(/\s/g, '')
}

/** Which documents go into which book. Credit/debit notes go to the side the ATK template names. */
export function belongs(book: BookKind, d: BookDoc): boolean {
  const note = d.doc_type !== 'invoice'
  switch (book) {
    case 'sales_vat':
      // sales + debit notes issued; credit notes received ([16]/[18]); purchases under reverse charge ([28])
      return (d.kind === 'sale' && d.doc_type !== 'credit_note') || (d.kind === 'purchase' && d.doc_type === 'credit_note') || (d.kind === 'purchase' && d.doc_type === 'invoice' && d.vat_flag === 'reverse_charge')
    case 'purchase_vat':
      // purchases + debit notes received; credit notes issued ([53]/[55])
      return (d.kind === 'purchase' && d.doc_type !== 'credit_note') || (d.kind === 'sale' && d.doc_type === 'credit_note')
    case 'sales_novat':
      return d.kind === 'sale' && (!note || d.doc_type === 'credit_note' || d.doc_type === 'debit_note')
    case 'purchase_novat':
      return d.kind === 'purchase'
  }
}

function salesVat(d: BookDoc): number[] {
  const z = Array(18).fill(0) as number[]
  if (d.kind === 'purchase') {
    if (d.doc_type === 'credit_note') {
      z[7] = abs(d.net_e) // [16]
      z[13] = abs(d.net_d) // [18]
    } else {
      z[10] = abs(d.net_e + d.net_d + d.amt_c + d.amt_a) // [28] reverse charge
    }
  } else if (d.doc_type === 'debit_note') {
    z[7] = abs(d.net_e)
    z[13] = abs(d.net_d)
  } else if (d.export) {
    z[5] = abs(d.net_e + d.net_d + d.amt_c + d.amt_a) // [11]
  } else {
    z[0] = abs(d.amt_a) // [9]
    if (d.vat_flag === 'service_abroad') z[1] = abs(d.amt_c)
    else if (d.vat_flag === 'reverse_charge') z[2] = abs(d.amt_c)
    else z[3] = abs(d.amt_c)
    z[6] = abs(d.net_e) // [12]
    z[12] = abs(d.net_d) // [14]
  }
  z[4] = sum(z[1], z[2], z[3]) // [10] = [10a]+[10b]+[10c]
  z[11] = r2((z[6] + z[7] + z[8] + z[9] + z[10]) * 0.18) // [K1]
  z[16] = r2((z[12] + z[13] + z[14] + z[15]) * 0.08) // [K2]
  z[17] = sum(z[11], z[16]) // [30]
  return z
}

function purchaseVat(d: BookDoc): number[] {
  const z = Array(23).fill(0) as number[]
  if (d.kind === 'sale' || d.doc_type === 'debit_note') {
    z[8] = abs(d.net_e) // [53]
    z[18] = abs(d.net_d) // [55]
  } else {
    const nd = d.vat_nd !== 0
    const rc = d.vat_flag === 'reverse_charge'
    const imp = d.vat_flag === 'import'
    const farmer = d.vat_flag === 'farmer'
    const a = d.asset
    if (rc) {
      z[11] = abs(d.net_e + d.net_d + d.amt_c + d.amt_a) // [65]
    } else {
      const free = d.amt_c + d.amt_a
      if (a) z[1] = abs(free) // [32]
      else z[0] = abs(free) // [31]
      if (nd) {
        if (a) z[3] = abs(d.net_e + d.net_d) // [34]
        else z[2] = abs(d.net_e + d.net_d) // [33]
      } else if (imp) {
        if (a) {
          z[5] = abs(d.net_e) // [39]
          z[14] = abs(d.net_d) // [41]
        } else {
          z[4] = abs(d.net_e) // [35]
          z[13] = abs(d.net_d) // [37]
        }
      } else if (farmer) {
        z[17] = abs(d.net_d) // [51]
        if (a) z[7] = abs(d.net_e)
        else z[6] = abs(d.net_e)
      } else if (a) {
        z[7] = abs(d.net_e) // [47]
        z[16] = abs(d.net_d) // [49]
      } else {
        z[6] = abs(d.net_e) // [43]
        z[15] = abs(d.net_d) // [45]
      }
    }
  }
  z[12] = r2((z[4] + z[5] + z[6] + z[7] + z[8] + z[9] + z[10] + z[11]) * 0.18) // [K1]
  z[21] = r2((z[13] + z[14] + z[15] + z[16] + z[17] + z[18] + z[19] + z[20]) * 0.08) // [K2]
  z[22] = sum(z[12], z[21]) // [67]
  return z
}

function salesNoVat(d: BookDoc): number[] {
  const sign = d.doc_type === 'credit_note' ? -1 : 1
  const t = r2(Math.abs(d.total) * sign)
  const a = !d.export && d.vat_flag !== 'service_abroad' ? t : 0
  const b = !d.export && d.vat_flag === 'service_abroad' ? t : 0
  const c = d.export ? t : 0
  return [a, b, c, sum(a, b, c)]
}

function purchaseNoVat(d: BookDoc): number[] {
  const sign = d.doc_type === 'credit_note' ? -1 : 1
  const t = r2(Math.abs(d.total) * sign)
  const z = [0, 0, 0, 0, 0, 0]
  if (d.vat_flag === 'reverse_charge' || d.vat_flag === 'service_abroad') z[5] = t // f
  else if (d.vat_flag === 'import') z[d.asset ? 4 : 3] = t // e / d
  else if (d.asset) z[2] = t // c
  else if (d.category === 'goods' || d.category === null) z[0] = t // a
  else z[1] = t // b
  return [...z, sum(...z)]
}

export function buildRows(book: BookKind, docs: BookDoc[]): BookRow[] {
  const vat = book === 'sales_vat' || book === 'purchase_vat'
  return docs
    .filter((d) => belongs(book, d))
    .map((d) => ({
      doc: d,
      text: [ddmmyyyy(d.date), d.doc_no ?? '', d.partner, nuiCell(d), ...(vat ? [d.vat_no ?? ''] : [])],
      amounts: book === 'sales_vat' ? salesVat(d) : book === 'purchase_vat' ? purchaseVat(d) : book === 'sales_novat' ? salesNoVat(d) : purchaseNoVat(d),
    }))
}

export const totals = (rows: BookRow[]) => rows.reduce((t, r) => t.map((v, i) => r2(v + (r.amounts[i] ?? 0))), rows[0]?.amounts.map(() => 0) ?? [])

// ---------------------------------------------------------------------------
// Checks before generating
// ---------------------------------------------------------------------------
export interface BookIssue {
  level: 'error' | 'warn'
  doc?: BookDoc
  text: string
}

export function checkBooks(docs: BookDoc[], vatRegistered: boolean, from: string, to: string): BookIssue[] {
  const out: BookIssue[] = []
  const seen = new Map<string, BookDoc>()
  for (const d of docs) {
    const who = `${d.kind === 'sale' ? 'Shitja' : 'Blerja'} ${d.doc_no?.trim() || '(pa numër)'} e ${ddmmyyyy(d.date)}`
    const nui = nuiCell(d)
    if (!d.doc_no?.trim()) out.push({ level: 'error', doc: d, text: `${who}: mungon numri i faturës.` })
    if (!d.partner.trim()) out.push({ level: 'error', doc: d, text: `${who}: mungon emri i ${d.kind === 'sale' ? 'blerësit' : 'shitësit'}.` })
    if (!nui) out.push({ level: d.kind === 'purchase' ? 'error' : 'warn', doc: d, text: `${who}: mungon NUI / numri fiskal${d.kind === 'sale' ? ' i blerësit (ose kodi sipas udhëzimit të ATK-së)' : ' i shitësit'}.` })
    else if (!/^\d$/.test(nui) && !/^\d{9}$/.test(nui) && !(d.kind === 'purchase' && /^\d{10}$/.test(nui)))
      out.push({ level: 'error', doc: d, text: `${who}: NUI / numri fiskal "${nui}" duhet të ketë 9 shifra${d.kind === 'purchase' ? ' (ose 10 për numrin personal)' : ''}.` })
    const parts = r2(d.net_e + d.vat_e + d.net_d + d.vat_d + d.amt_c + d.amt_a + d.vat_nd)
    if (Math.abs(Math.abs(parts) - Math.abs(d.total)) > 0.05) out.push({ level: 'error', doc: d, text: `${who}: shuma e normave (${parts.toFixed(2)}) nuk përputhet me totalin (${d.total.toFixed(2)}).` })
    if (d.net_e && Math.abs(Math.abs(d.vat_e) + Math.abs(d.vat_nd && d.net_e ? d.vat_nd : 0) - Math.abs(d.net_e) * 0.18) > 0.05 + Math.abs(d.net_e) * 0.002)
      out.push({ level: 'warn', doc: d, text: `${who}: TVSH 18% e dokumentit (${Math.abs(d.vat_e).toFixed(2)}) ndryshon nga 18% e bazës – libri llogarit ${(Math.abs(d.net_e) * 0.18).toFixed(2)}.` })
    if (d.net_d && Math.abs(Math.abs(d.vat_d) - Math.abs(d.net_d) * 0.08) > 0.05 + Math.abs(d.net_d) * 0.002 && !d.vat_nd)
      out.push({ level: 'warn', doc: d, text: `${who}: TVSH 8% e dokumentit ndryshon nga 8% e bazës.` })
    if (!d.total) out.push({ level: 'warn', doc: d, text: `${who}: dokument me vlerë zero.` })
    if (d.date < from || d.date > to) out.push({ level: 'error', doc: d, text: `${who}: data është jashtë periudhës.` })
    if (vatRegistered && d.kind === 'purchase' && (d.vat_e || d.vat_d) && !d.vat_no?.trim() && !d.vat_nd)
      out.push({ level: 'warn', doc: d, text: `${who}: TVSH e zbritshme pa numrin e TVSH-së së shitësit.` })
    if (!vatRegistered && d.kind === 'sale' && (d.vat_e || d.vat_d)) out.push({ level: 'warn', doc: d, text: `${who}: biznesi nuk është në TVSH, por shitja ka TVSH.` })
    if (d.doc_no?.trim()) {
      const key = `${d.kind}|${d.doc_type}|${nui}|${d.partner.trim().toLowerCase()}|${d.doc_no.trim().toLowerCase()}`
      const prev = seen.get(key)
      if (prev) out.push({ level: 'error', doc: d, text: `${who}: e regjistruar dy herë (si ajo e ${ddmmyyyy(prev.date)}).` })
      else seen.set(key, d)
    }
  }
  return out
}
