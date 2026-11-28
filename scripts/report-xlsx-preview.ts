// Builds sample Kontabilist reports in the common Excel layout and checks their structure:
//   npx tsx --tsconfig tsconfig.app.json scripts/report-xlsx-preview.ts [out-dir]
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { buildReport, excelDate, inferKinds, inferRows, simpleSheet, type ReportMeta } from '../src/kontabilist/reportXlsx'

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'kontabilist-reports-'))
let fails = 0
const ok = (name: string, cond: boolean, info = '') => {
  if (!cond) fails++
  console.log(`${cond ? '✓' : '✗'} ${name}${info ? ` – ${info}` : ''}`)
}

// a 2×1 PNG as the office logo
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC', 'base64'))
const meta: ReportMeta = { company: 'SHEMBULL SH.P.K.', companyLine: 'NUI 810000001   ·   Rr. Shembull 1, Prishtinë', title: 'Bilanci provues', period: '01.10.2026 – 31.10.2026', generatedAt: '28.11.2026 10:15', preparedBy: 'Zyra Shembull', logo: { bytes: png, ext: 'png', width: 2, height: 1 } }

const tb = buildReport(meta, [
  {
    name: 'Bilanci provues',
    columns: [{ header: 'Konto', kind: 'code' }, { header: 'Emri i kontos' }, { header: 'Saldo fillestare', kind: 'money' }, { header: 'Debi', kind: 'money' }, { header: 'Kredi', kind: 'money' }, { header: 'Saldo përfundimtare', kind: 'money' }],
    filter: false,
    rows: [
      { cells: [null, 'PASURITË'], style: 'group' },
      { cells: ['1010', 'Arka', 0, 1500, 300, 1200], indent: 1 },
      { cells: ['1020', 'Banka', 100, 9000, 4000, 5100], indent: 1 },
      { cells: [null, 'Gjithsej pasuritë', 100, 10500, 4300, 6300], style: 'subtotal' },
      { cells: [null, 'Gjithsej bilanci provues', 0, 10500, 10500, 0], style: 'grand' },
      { cells: ['Debia = Kredia.'], style: 'note' },
    ],
  },
])
writeFileSync(join(dir, 'bilanci-provues.xlsx'), tb)
const f = unzipSync(tb)
const s1 = strFromU8(f['xl/worksheets/sheet1.xml'])
const wb = strFromU8(f['xl/workbook.xml'])
ok('koka: kompania, titulli, periudha', s1.includes('SHEMBULL SH.P.K.') && s1.includes('Bilanci provues') && s1.includes('Periudha: 01.10.2026 – 31.10.2026') && s1.includes('Gjeneruar më 28.11.2026 10:15'))
ok('titujt e fiksuar (rreshti 6)', /<pane ySplit="6" topLeftCell="A7"[^>]*state="frozen"/.test(s1))
ok('titujt përsëriten në çdo faqe të printuar', wb.includes(`_xlnm.Print_Titles" localSheetId="0">'Bilanci provues'!$6:$6`))
ok('A4, përshtatet në gjerësi', /<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"\/>/.test(s1) && s1.includes('fitToPage="1"'))
ok('fundi i faqes: faqja n / m', s1.includes('Faqja &amp;P / &amp;N'))
ok('logoja', Boolean(f['xl/media/logo.png']) && s1.includes('<drawing r:id="rId1"/>'))
ok('pa vija rrjete', s1.includes('showGridLines="0"'))
ok('formati i shumave', strFromU8(f['xl/styles.xml']).includes('#,##0.00;[Red]\\-#,##0.00;&quot;–&quot;'))
ok('kontot si tekst (1010 jo numër)', /<c r="A8" s="\d+" t="inlineStr"><is><t xml:space="preserve">1010<\/t>/.test(s1))
ok('pa filtër kur kërkohet', !s1.includes('<autoFilter'))

// a list inferred from plain columns + rows
const sh = simpleSheet('Partnerët', ['Data', 'Partneri', 'NUI', 'Totali', 'Sasia', 'Marzha %'], [
  ['01.10.2026', 'A', '810000001', 118, 2, 0.25],
  ['2026-10-02', 'B', '810000002', 59, 1, 0.1],
  ['03.10.2026', 'C', '', 236.5, 4, 0.3],
  ['04.10.2026', 'D', '810000004', 10, 1, 0.2],
  [null, 'Gjithsej', null, 423.5, 8, null],
])
ok('llojet e kolonave', JSON.stringify(sh.columns.map((c) => c.kind)) === JSON.stringify(['date', 'text', 'code', 'money', 'int', 'percent']), sh.columns.map((c) => c.kind).join(','))
ok('rreshti "Gjithsej" si total', sh.rows.at(-1)?.style === 'total')
const list = buildReport({ ...meta, title: 'Partnerët', logo: null }, [sh])
writeFileSync(join(dir, 'partneret.xlsx'), list)
const s2 = strFromU8(unzipSync(list)['xl/worksheets/sheet1.xml'])
ok('filtri te titujt (deri te rreshti i fundit i të dhënave)', s2.includes('<autoFilter ref="A6:F10"/>'))
ok('data si datë Excel', s2.includes(`<v>${excelDate('01.10.2026')}</v>`) && excelDate('2026-10-02') === excelDate('02.10.2026'))
ok('përqindja si numër', /<c r="F7" s="\d+"><v>0.25<\/v>/.test(s2))
ok('rreshta të ndryshëm me ngjyrë', (s2.match(/<c r="B7" s="(\d+)"/)?.[1] ?? 'a') !== (s2.match(/<c r="B8" s="(\d+)"/)?.[1] ?? 'a'))
ok('pa logo pa drawing', !s2.includes('<drawing'))

const many = buildReport({ ...meta, title: 'Pasqyrat financiare' }, [simpleSheet('Bilanci', ['Zëri', 'Shuma'], [['A', 1]]), simpleSheet('Bilanci', ['Zëri', 'Shuma'], [['B', 2]])])
const wb3 = strFromU8(unzipSync(many)['xl/workbook.xml'])
ok('emrat e fletëve unikë', wb3.includes('name="Bilanci"') && wb3.includes('name="Bilanci 2"'))
const rows = inferRows([['FITIMI', null], ['Fitimi i periudhës', 50]], inferKinds(['Zëri', 'Shuma'], [['x', 1]]))
ok('rezultati përfundimtar', rows[1].style === 'grand' && rows[0].style === 'group')
writeFileSync(join(dir, 'pasqyrat.xlsx'), many)

console.log(`\n${fails ? `${fails} gabime` : 'Të gjitha provat e raporteve kaluan'} (${dir})`)
process.exit(fails ? 1 : 0)
