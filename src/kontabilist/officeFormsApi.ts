// Downloads of the office forms (officeForms.ts fills them): the original file from public/hr, filled, as a download.
import type { Client } from './api'
import { returnDay } from './hr'
import { fetchTrialBalance } from './ledger'
import {
  CONTRACT_BLANKS,
  CONTRACT_FILES,
  contractForm,
  contractValues,
  DECISION_BLANKS,
  DECISION_FILE,
  decisionValues,
  fillDocx,
  fillStatements,
  STATEMENTS_FILE,
  type FormClient,
} from './officeForms'
import type { Employee, Leave } from './payroll'

async function template(name: string): Promise<Uint8Array> {
  const res = await fetch(`${import.meta.env.BASE_URL}hr/${name}`)
  if (!res.ok) throw new Error(`Formulari ${name} nuk u gjet.`)
  return new Uint8Array(await res.arrayBuffer())
}

function save(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[\\/:*?"<>|]+/g, ' ')
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const formClient = (c: Client): FormClient => ({ name: c.name, nui: c.nui, address: c.address, city: c.city, representative: c.representative })

const FIELD_LABELS: Record<string, string> = {
  company_no: 'NUI e kompanisë',
  company_address: 'adresa e kompanisë',
  representative: 'përfaqësuesi i kompanisë',
  personal_no: 'numri personal',
  residence: 'vendbanimi',
  profession: 'profesioni',
  iban: 'IBAN-i',
  duties: 'detyrat',
  probation: 'puna provuese',
  from: 'orari i punës',
  gross_month: 'paga bruto',
  court: 'qyteti i kompanisë (gjykata)',
}

/** The employment contract on the office's own form (fixed term when the contract is fixed or has an end date).
 *  Returns the fields left blank, so the accountant can complete the data or write them by hand. */
export async function downloadContract(client: Client, e: Employee): Promise<{ name: string; missing: string[] }> {
  const form = contractForm(e)
  const values = contractValues(formClient(client), e)
  const bytes = fillDocx(await template(CONTRACT_FILES[form]), values, CONTRACT_BLANKS[form])
  save(bytes, `Kontrata e punës ${form === 'fixed' ? 'me kohë të caktuar' : 'me kohë të pacaktuar'} - ${e.first_name} ${e.last_name}.docx`, DOCX)
  return { name: `${e.first_name} ${e.last_name}`, missing: Object.keys(FIELD_LABELS).filter((k) => !values[k]?.toString().trim()).map((k) => FIELD_LABELS[k]) }
}

/** The annual-leave decision on the office's own form. */
export async function downloadLeaveDecision(client: Client, e: Employee, l: Leave): Promise<void> {
  const back = returnDay(l.to_date, e.work_days ?? 5)
  const bytes = fillDocx(await template(DECISION_FILE), decisionValues(formClient(client), e, l, back), DECISION_BLANKS)
  save(bytes, `Aktvendim për pushim vjetor - ${e.first_name} ${e.last_name} - ${l.from_date}.docx`, DOCX)
}

export interface StatementsResult {
  check: number
  checkPrev: number
  unmapped: string[]
  result: number
}

/** The financial statements (KSRF form) of a year from the trial balances of the year and the year before. */
export async function downloadStatements(client: Client, year: number): Promise<StatementsResult> {
  const [cur, prev, tpl] = await Promise.all([fetchTrialBalance(client.id, `${year}-01-01`, `${year}-12-31`), fetchTrialBalance(client.id, `${year - 1}-01-01`, `${year - 1}-12-31`), template(STATEMENTS_FILE)])
  const out = fillStatements(tpl, {
    company: client.name,
    nui: client.nui,
    address: [client.address, client.city].filter(Boolean).join(', '),
    year,
    current: cur,
    previous: prev,
  })
  save(out.bytes, `Pasqyrat financiare ${year} - ${client.name}.xlsx`, XLSX)
  return { check: out.current.check, checkPrev: out.previous.check, unmapped: [...new Set([...out.current.unmapped, ...out.previous.unmapped])], result: out.current.result }
}
