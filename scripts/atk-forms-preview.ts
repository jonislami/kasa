// Fills the two original ATK payroll forms (public/atk) with sample rows:
//   npx tsx --tsconfig tsconfig.app.json scripts/atk-forms-preview.ts <out-dir> [rows]
import { readFileSync, writeFileSync } from 'node:fs'
import { buildPayRows, buildWrRows, checkPayRows, checkWrRows, emptyWrRow, fillPayTemplate, fillWrTemplate } from '../src/kontabilist/atkForms'

const dir = process.argv[2] ?? '.'
const many = Number(process.argv[3] ?? 3)
const names = ['Vullnet Syla', 'Arbëresha Krasniqi', 'Çlirim Gashi', 'Dafina Berisha', 'Ëndrit Hoxha']
const lines = Array.from({ length: many }, (_, i) => ({
  employee_id: `e${i}`,
  name: names[i % names.length] + (i >= names.length ? ` ${i}` : ''),
  personal_no: String(1012667546 + i),
  primary_job: i % 4 !== 3,
  gross: 500 + i * 37.5,
  emp_pct: i === 2 ? 7 : 5,
  emp_contrib: Math.round((500 + i * 37.5) * (i === 2 ? 7 : 5)) / 100,
  er_contrib: Math.round((500 + i * 37.5) * 5) / 100,
}))
const pay = buildPayRows(lines, [{ id: 'e0', first_name: 'Vullnet', last_name: 'Syla' }])
writeFileSync(`${dir}/lista_pagave.xls`, fillPayTemplate(new Uint8Array(readFileSync('public/atk/lista_pagave.xls')), pay))

const wr = [
  ...buildWrRows([
    { partner_name: 'Filan Fisteku', partner_nui: '1012667546', net_e: 200, net_d: 0, amt_c: 0, amt_a: 0 },
    { partner_name: 'Qiradhënësi SH.P.K.', partner_nui: '811111111', net_e: 0, net_d: 0, amt_c: 0, amt_a: 350 },
  ]).map((r, i) => ({ ...r, area_m2: i ? 80 : 20 })),
  { ...emptyWrRow(), id_no: '', name: 'Google Ireland', nonres_services: 120, country: 'Irlande' },
  ...Array.from({ length: Math.max(0, many - 3) }, (_, i) => ({ ...emptyWrRow(), id_no: String(812000000 + i), name: `Biznesi ${i + 1}`, interest: 10 * (i + 1) })),
]
writeFileSync(`${dir}/formulari_wr.xlsx`, fillWrTemplate(new Uint8Array(readFileSync('public/atk/formulari_wr.xlsx')), wr))
console.log(pay.length, 'punëtorë,', wr.length, 'rreshta WR')
console.log([...checkPayRows(pay), ...checkWrRows(wr)].join('\n'))
