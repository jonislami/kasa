// Tests of the ATK checks and calculations of Kontabilist (no database):
//   npx tsx --tsconfig tsconfig.app.json scripts/compliance-selftest.ts
import { buildRows, checkBooks, totals, type BookDoc } from '../src/kontabilist/atkBooks'
import { buildRb500, checkPayroll, extraDeadlines, legalKind, quarterlyForm, rbRequired, regimeIssues, vatVsBooks, wageTaxOf, type PayLineCheck } from '../src/kontabilist/compliance'
import { finalBoxes, personalIncomeTax, quarterTax, salaryPreview, wageTax } from '../src/kontabilist/taxMath'

let fails = 0
let passes = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) passes++
  else {
    fails++
    console.log(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`)
  }
}

// --- Personal income tax (ATK: 0–3,000 0%, 3,000–5,400 8%, >5,400 10%, since 23.08.2024) ---
eq('PIT 3000', personalIncomeTax(3000), 0)
eq('PIT 5400', personalIncomeTax(5400), 192)
eq('PIT 10000', personalIncomeTax(10000), 192 + 460)
eq('PIT negative', personalIncomeTax(-50), 0)
eq('quarter individual real 6000 profit/quarter', quarterTax('individual_real', 8000, 2000), Math.round((personalIncomeTax(24000) / 4) * 100) / 100)
eq('quarter small 3%', quarterTax('individual_small_3', 10000, 9000), 300)
eq('quarter small 9%', quarterTax('individual_small_9', 10000, 9000), 900)
eq('quarter corporate', quarterTax('corporate', 10000, 4000), 600)

// --- Wage tax (monthly 0–250 0%, 250–450 8%, >450 10%; secondary 10%) – client, compliance and DB formula agree ---
for (const base of [0, 100, 250, 250.01, 300, 450, 451, 800, 2500.55]) {
  eq(`wage tax primary ${base}`, wageTaxOf(base, true), wageTax(base, true))
  eq(`wage tax secondary ${base}`, wageTaxOf(base, false), wageTax(base, false))
}
eq('wage tax 450', wageTax(450, true), 16)
eq('wage tax 1000', wageTax(1000, true), 16 + 55)
eq('salary 600 gross', salaryPreview(600, 5, 5, true), { emp: 30, er: 30, tax: 28, net: 542, cost: 630 })

// --- VAT return calculation ---
const fb = finalBoxes({ '12': 1000, '13': 180, '43': 500, '44': 90 }, { '14': 100 }, 20, 0)
eq('VAT [30]', fb['30'], 188)
eq('VAT [67]', fb['67'], 90)
eq('VAT [72] payable', fb['72'], 78)
eq('VAT [69] none', fb['69'], 0)
const fb2 = finalBoxes({ '12': 100, '13': 18, '43': 1000, '44': 180 }, {}, 0, 50)
eq('VAT [69] credit', fb2['69'], 162)
eq('VAT [70] refund capped', fb2['70'], 50)
eq('VAT [71] carry', fb2['71'], 112)

// --- Books and checks ---
const base = { vat_no: '', vat_nd: 0, asset: false, export: false, category: 'goods', vat_flag: 'none', doc_type: 'invoice', net_d: 0, vat_d: 0, amt_c: 0, amt_a: 0 } as const
const docs: BookDoc[] = [
  { ...base, kind: 'sale', date: '2026-10-03', doc_no: 'S-1', partner: 'Kompania A', nui: '810243569', net_e: 1000, vat_e: 180, total: 1180 },
  { ...base, kind: 'purchase', date: '2026-10-07', doc_no: 'B-1', partner: 'Furnitori', nui: '812395037', vat_no: '330000000', net_e: 2000, vat_e: 360, net_d: 100, vat_d: 8, total: 2468 },
  { ...base, kind: 'purchase', date: '2026-11-07', doc_no: 'B-2', partner: 'Furnitori SH.P.K.', nui: '812395037', vat_no: '330000000', net_e: 100, vat_e: 18, total: 118 },
  { ...base, kind: 'purchase', date: '2026-11-08', doc_no: 'B-3', partner: 'Pa numër', nui: '', net_e: 600, vat_e: 108, total: 708 },
  { ...base, kind: 'purchase', date: '2026-11-09', doc_no: 'B-4', partner: 'I vogël', nui: '811000001', net_e: 300, vat_e: 54, total: 354 },
  { ...base, kind: 'purchase', date: '2026-11-10', doc_no: 'I-1', partner: 'Import GmbH', nui: '', vat_flag: 'import', net_e: 5000, vat_e: 900, total: 5900 },
  { ...base, kind: 'purchase', date: '2026-11-11', doc_no: 'K-1', partner: 'Furnitori', nui: '812395037', doc_type: 'credit_note', net_e: -100, vat_e: -18, total: -118 },
]
const oct = docs.filter((d) => d.date < '2026-11-01')
eq('sales book [30]', totals(buildRows('sales_vat', oct)).at(-1), 180)
eq('purchase book [67]', totals(buildRows('purchase_vat', oct)).at(-1), 368)
eq('books clean month: no errors', checkBooks(oct, true, '2026-10-01', '2026-10-31').filter((i) => i.level === 'error').length, 0)
eq('books: missing NUI is an error', checkBooks(docs, true, '2026-10-01', '2026-11-30').some((i) => i.level === 'error' && i.text.includes('B-3')), true)
eq('VAT vs books equal', vatVsBooks({ boxes: { '30': 180, '67': 368 }, status: 'draft' }, 180, 368, 'Tetor 2026'), [])
eq('VAT vs books differ', vatVsBooks({ boxes: { '30': 200, '67': 368 }, status: 'draft' }, 180, 368, 'Tetor 2026').length, 1)

// --- RB: purchases ≥ 500 € per supplier in the year ---
const rb = buildRb500(docs, 2026)
eq('RB rows', rb.rows.map((r) => [r.nui, r.total]), [['812395037', 2468], ['', 708]])
eq('RB missing NUI error', rb.issues.filter((i) => i.level === 'error').length, 1)
eq('RB different names warning', rb.issues.some((i) => i.level === 'warn' && i.text.includes('812395037')), true)
eq('RB other year empty', buildRb500(docs, 2025).rows.length, 0)
eq('RB small regime not required', rbRequired('individual_small_3', false).required, false)
eq('RB corporate required', rbRequired('corporate', true).required, true)

// --- Payroll checks ---
const line = (p: Partial<PayLineCheck>): PayLineCheck => {
  const gross = p.gross ?? 600
  const emp = Math.round(gross * 5) / 100
  const tax = wageTaxOf(gross - emp, p.primary_job ?? true)
  return { name: 'Arta Krasniqi', personal_no: '1234567890', primary_job: true, gross, emp_pct: 5, er_pct: 5, emp_contrib: emp, tax_base: gross - emp, tax, net: Math.round((gross - emp - tax) * 100) / 100, payable: Math.round((gross - emp - tax) * 100) / 100, iban: 'XK051212012345678906', ...p }
}
eq('payroll clean', checkPayroll([line({})]), [])
eq('payroll bad personal no', checkPayroll([line({ personal_no: '12345' })]).filter((i) => i.level === 'error').length, 1)
eq('payroll duplicate personal no', checkPayroll([line({}), line({ name: 'B' })]).filter((i) => i.level === 'error').length, 1)
eq('payroll pension below 5%', checkPayroll([line({ emp_pct: 3 })]).some((i) => i.text.includes('nën 5%')), true)
eq('payroll wrong tax', checkPayroll([line({ tax: 1 })]).some((i) => i.text.includes('shkallët')), true)
eq('payroll advance above net', checkPayroll([line({ payable: -10 })]).some((i) => i.text.includes('avansi')), true)

// --- Legal form, regime, deadlines ---
eq('legal SH.P.K.', legalKind('SH.P.K.'), 'corporate')
eq('legal B.I.', legalKind('B.I.'), 'individual')
eq('legal Biznes individual', legalKind('Biznes individual'), 'individual')
eq('legal empty', legalKind(''), 'unknown')
eq('regime: individual with CIT is an error', regimeIssues({ regime: 'corporate', legal_form: 'B.I.', vat_registered: false, sales_12m: 1000 }).some((i) => i.level === 'error'), true)
eq('regime: small corp above 30k', regimeIssues({ regime: 'individual_small_9', legal_form: 'SH.P.K.', vat_registered: true, sales_12m: 31000 }).some((i) => i.level === 'error' && i.text.includes('30.000')), true)
eq('regime: small individual at 40k fine', regimeIssues({ regime: 'individual_small_3', legal_form: 'B.I.', vat_registered: true, sales_12m: 40000 }).filter((i) => i.level === 'error').length, 0)
eq('regime: VAT threshold', regimeIssues({ regime: 'individual_small_3', legal_form: 'B.I.', vat_registered: false, sales_12m: 30001 }).some((i) => i.text.includes('regjistrohet për TVSH')), true)
eq('quarterly form QS', quarterlyForm('individual_small_9', 'corporate').code, 'QS')
eq('quarterly form QL', quarterlyForm('corporate', 'corporate').code, 'QL')
eq('quarterly form IS', quarterlyForm('individual_small_3', 'individual').code, 'IS')
eq('quarterly form IL', quarterlyForm('individual_real', 'individual').code, 'IL')
const dl = extraDeadlines({ vat_registered: false, regime: 'corporate' }, '2026-12-01', '2027-04-30')
eq('deadlines non-VAT', dl.map((d) => `${d.code} ${d.due}`), ['LB/LSH 2027-01-15', 'RB 2027-03-31', 'PF 2027-03-31', 'LB/LSH 2027-04-15'])
eq('deadlines VAT small: only PF', extraDeadlines({ vat_registered: true, regime: 'individual_small_3' }, '2027-01-01', '2027-04-30').map((d) => d.code), ['PF'])

console.log(`\n${passes} të sakta, ${fails} gabime`)
process.exit(fails ? 1 : 0)
