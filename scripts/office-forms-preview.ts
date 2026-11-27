// Fills the office forms (public/hr) with test data and checks them:
//   npx tsx --tsconfig tsconfig.app.json scripts/office-forms-preview.ts [out-dir]   (npm run test:kontabilist)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { CONTRACT_BLANKS, CONTRACT_FILES, contractValues, DECISION_BLANKS, DECISION_FILE, decisionValues, fillDocx, fillStatements, ksrfNotes, leftKeys, STATEMENTS_FILE, type FormEmployee, type TbLine } from '../src/kontabilist/officeForms'

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'kontabilist-forms-'))
let fails = 0
const ok = (name: string, cond: boolean, info = '') => {
  if (!cond) fails++
  console.log(`${cond ? '✓' : '✗'} ${name}${info ? ` – ${info}` : ''}`)
}
const tpl = (f: string) => new Uint8Array(readFileSync(`public/hr/${f}`))
const docText = (b: Uint8Array) => strFromU8(unzipSync(b)['word/document.xml']).replace(/<[^>]+>/g, '')

const client = { name: 'SHEMBULL SH.P.K.', nui: '810000001', address: 'Rr. Shembull 1', city: 'Prishtinë', representative: 'Drejtori Shembull' }
const emp: FormEmployee = {
  first_name: 'Punëtor', last_name: 'Shembull', personal_no: '1234567890', address: 'Rr. Test 2', city: 'Ferizaj', profession: 'Ekonomist', position: 'Kontabilist',
  iban: 'XK051212012345678906', duties: 'Regjistrimi i faturave\nPagat', workplace: null, contract: 'fixed', start_date: '2026-01-01', end_date: '2026-12-31',
  probation_months: 3, weekly_hours: 40, work_days: 5, schedule_from: '08:00', schedule_to: '16:00', gross_salary: 600, annual_leave_days: null,
}

for (const form of ['fixed', 'indefinite'] as const) {
  const e = form === 'fixed' ? emp : { ...emp, contract: 'indefinite' as const, end_date: null }
  const out = fillDocx(tpl(CONTRACT_FILES[form]), contractValues(client, e), CONTRACT_BLANKS[form])
  writeFileSync(`${dir}/${CONTRACT_FILES[form]}`, out)
  const t = docText(out)
  ok(`kontrata ${form}: pa shenja të mbetura`, leftKeys(out).length === 0)
  ok(`kontrata ${form}: të dhënat`, ['SHEMBULL SH.P.K.', '810000001', '1234567890', 'XK051212012345678906', '600,00 €', '3,46 €', 'Prishtinë'].every((s) => t.includes(s)))
  if (form === 'fixed') ok('kontrata fixed: periudha', t.includes('12 muaj (01.01.2026 – 31.12.2026)'))
  // an empty form gives back the original blanks
  const empty = docText(fillDocx(tpl(CONTRACT_FILES[form]), {}, CONTRACT_BLANKS[form]))
  writeFileSync(`${dir}/bosh_${CONTRACT_FILES[form]}`, fillDocx(tpl(CONTRACT_FILES[form]), {}, CONTRACT_BLANKS[form]))
  ok(`kontrata ${form}: bosh = vijat e origjinalit`, empty.includes('______ muaj; __________ orë') && empty.includes('Themelore në _______.'))
}

const dec = fillDocx(tpl(DECISION_FILE), decisionValues(client, emp, { from_date: '2026-02-02', to_date: '2026-02-13', days: 10 }, '2026-02-16', 2025), DECISION_BLANKS)
writeFileSync(`${dir}/${DECISION_FILE}`, dec)
const dt = docText(dec)
const head = strFromU8(unzipSync(dec)['word/header1.xml']).replace(/<[^>]+>/g, '')
ok('vendimi: pa shenja të mbetura', leftKeys(dec).length === 0)
ok('vendimi: teksti', dt.includes('Punëmarrësi Punëtor Shembull, caktuar në punët dhe dëtyrat e punës në SHEMBULL SH.P.K. i lejohet') && dt.includes('prej datës 02.02.2026 deri me 13.02.2026') && dt.includes('paraqitet më 16.02.2026') && dt.includes('për vitin 2025'))
ok('vendimi: koka', head.includes('SHEMBULL SH.P.K.') && head.includes('810000001') && head.includes('Rr. Shembull 1, Prishtinë'))

// trial balance of two years (balanced: Σ closing = 0)
const L = (code: string, type: TbLine['type'], opening: number, debit: number, credit: number): TbLine => ({ code, type, opening, debit, credit, closing: opening + debit - credit })
const prev: TbLine[] = [L('1010', 'asset', 0, 2000, 1500), L('1020', 'asset', 0, 9000, 4000), L('1200', 'asset', 0, 3000, 1000), L('2200', 'asset', 0, 4000, 0), L('2290', 'asset', 0, 0, 800), L('3100', 'liability', 0, 500, 2500), L('4000', 'equity', 0, 0, 1000), L('5000', 'income', 0, 0, 12000), L('6000', 'expense', 0, 5000, 0), L('6100', 'expense', 0, 1200, 0), L('6600', 'expense', 0, 800, 0), L('6200', 'expense', 0, 3600, 0), L('6210', 'expense', 0, 0, 0)]
const sumClose = (t: TbLine[]) => Math.round(t.reduce((s, x) => s + x.closing, 0) * 100) / 100
// the bookkeeping of the previous year above is not balanced by itself; balance it through the bank
prev[1] = L('1020', 'asset', 0, 9000, 4000 + sumClose(prev))
ok('provë: bilanci provues i vitit të kaluar barazohet', sumClose(prev) === 0)
const cur: TbLine[] = prev.map((t) => L(t.code, t.type, t.closing, 0, 0))
cur.push(L('5100', 'income', 0, 0, 8000), L('6330', 'expense', 0, 900, 0), L('6700', 'expense', 0, 100, 0), L('1600', 'asset', 0, 300, 0), L('3600', 'liability', 0, 0, 450), L('3200', 'liability', 0, 0, 2000))
const bank = cur.find((t) => t.code === '1020')!
Object.assign(bank, L('1020', 'asset', bank.opening, 8000 + 2000, 900 + 100 + 300 - 450 + 450))
bank.closing = bank.opening + bank.debit - bank.credit
const fix = sumClose(cur)
Object.assign(bank, L('1020', 'asset', bank.opening, bank.debit, bank.credit + fix))
ok('provë: bilanci provues i vitit barazohet', sumClose(cur) === 0)

const nc = ksrfNotes(cur)
const np = ksrfNotes(prev)
ok('pasqyrat: bilanci i gjendjes barazohet (viti)', Math.abs(nc.check) < 0.01, `diferenca ${nc.check}`)
ok('pasqyrat: bilanci i gjendjes barazohet (viti i kaluar)', Math.abs(np.check) < 0.01, `diferenca ${np.check}`)
ok('pasqyrat: rezultati i vitit = të hyrat − shpenzimet', nc.result === 8000 - 1000, String(nc.result))
ok('pasqyrat: KMSH = konto 6000 e vitit', nc.notes[172] === 0 && np.notes[172] === 5000)
ok('pasqyrat: të hyrat 3.6', nc.notes[160] === 8000 && np.notes[157] === 12000)
ok('pasqyrat: pa konto të palidhura', nc.unmapped.length === 0, nc.unmapped.join(','))

const st = fillStatements(tpl(STATEMENTS_FILE), { company: client.name, nui: client.nui, address: 'Rr. Shembull 1, Prishtinë', year: 2026, current: cur, previous: prev })
writeFileSync(`${dir}/${STATEMENTS_FILE}`, st.bytes)
const files = unzipSync(st.bytes)
const ss = strFromU8(files['xl/sharedStrings.xml'])
ok('pasqyrat: kompania dhe vitet', ss.includes('Emri i kompanisë: SHEMBULL SH.P.K.') && ss.includes('Gjendja më 1 janar 2025') && ss.includes('Gjendja më 31 dhjetor 2026') && !ss.includes('{{'))
ok('pasqyrat: pa Scuti', !Object.values(files).some((b) => /Scuti|811483388/.test(strFromU8(b))))

console.log(`\n${fails ? `${fails} gabime` : 'Të gjitha provat kaluan'}`)
process.exit(fails ? 1 : 0)
