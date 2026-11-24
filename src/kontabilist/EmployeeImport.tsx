import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import type { Client } from './api'
import { CONTRACT_LABELS, saveEmployee, type Contract, type Employee } from './payroll'

// Excel / CSV import of a list of employees into a client (the same columns as the "Excel" export of the list).
const COLUMNS = ['Emri', 'Mbiemri', 'Nr. personal', 'Datëlindja', 'Gjinia', 'Adresa', 'Qyteti', 'Telefoni', 'Email', 'Pozita', 'Kontrata', 'Fillimi', 'Përfundimi', 'Orë/javë', 'Paga bruto', 'Banka', 'IBAN']

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/ë/g, 'e')
    .replace(/ç/g, 'c')
    .replace(/[_\s]+/g, ' ')

const ALIASES: Record<string, string[]> = {
  first: ['emri', 'first name', 'name'],
  last: ['mbiemri', 'last name', 'surname'],
  full: ['emri dhe mbiemri', 'emri mbiemri', 'punonjesi', 'punetori', 'emri i plote'],
  pno: ['nr. personal', 'nr personal', 'numri personal', 'nr. leternjoftimit', 'leternjoftimi', 'id', 'nr. id'],
  birth: ['datelindja', 'data e lindjes', 'lindja'],
  gender: ['gjinia', 'gender'],
  address: ['adresa', 'address'],
  city: ['qyteti', 'vendi', 'komuna'],
  phone: ['telefoni', 'tel', 'tel.', 'phone', 'nr. telefonit'],
  email: ['email', 'e-mail', 'emaili'],
  position: ['pozita', 'pozita e punes', 'vendi i punes', 'detyra'],
  contract: ['kontrata', 'lloji i kontrates'],
  start: ['fillimi', 'data e fillimit', 'data e punesimit', 'punesuar me'],
  end: ['perfundimi', 'data e perfundimit', 'deri me'],
  hours: ['ore/jave', 'ore ne jave', 'oret', 'orari javor'],
  salary: ['paga bruto', 'paga', 'bruto', 'paga mujore'],
  bank: ['banka', 'bank'],
  iban: ['iban', 'xhirollogaria', 'llogaria bankare', 'nr. llogarise'],
}

function toDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim().replace(/\s|€/g, '')
  if (!s) return null
  const t = s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

function toContract(v: unknown): Contract {
  const s = norm(v)
  if (!s) return 'indefinite'
  const hit = (Object.entries(CONTRACT_LABELS) as [Contract, string][]).find(([k, l]) => norm(l) === s || k === s)
  if (hit) return hit[0]
  if (s.includes('pjessh')) return 'part_time'
  if (s.includes('sherbim')) return 'service'
  if (s.includes('pacaktuar')) return 'indefinite'
  if (s.includes('caktuar')) return 'fixed'
  return 'indefinite'
}

const text = (v: unknown) => String(v ?? '').trim()

type Row = Partial<Employee> & { first_name: string; last_name: string; start_date: string }

/** Rows of the sheet → employees; rows with no name, a wrong personal number or one already on the list are skipped. */
export function parseEmployees(data: unknown[][], existing: Employee[]): { rows: Row[]; errors: string[]; defaultedStart: number } {
  const isHead = (r: unknown[]) => r.some((c) => [...ALIASES.first, ...ALIASES.full].includes(norm(c)))
  const headerIdx = data.findIndex(isHead)
  if (headerIdx < 0) return { rows: [], errors: ['Nuk u gjet rreshti i titujve (duhet të ketë kolonën "Emri" ose "Emri dhe mbiemri").'], defaultedStart: 0 }
  const head = data[headerIdx].map(norm)
  const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, head.findIndex((h) => ALIASES[k].includes(h))])) as Record<string, number>
  const get = (r: unknown[], key: string) => (idx[key] >= 0 ? r[idx[key]] : undefined)

  const known = new Set(existing.map((e) => e.personal_no).filter(Boolean) as string[])
  const knownNames = new Set(existing.map((e) => norm(`${e.first_name} ${e.last_name}`)))
  const today = kosovoDateISO()
  const rows: Row[] = []
  const errors: string[] = []
  let defaultedStart = 0
  data.slice(headerIdx + 1).forEach((r, i) => {
    if (r.every((c) => text(c) === '')) return
    const line = headerIdx + i + 2
    let first = text(get(r, 'first'))
    let last = text(get(r, 'last'))
    if ((!first || !last) && idx.full >= 0) {
      const parts = text(get(r, 'full')).split(/\s+/).filter(Boolean)
      if (parts.length >= 2) {
        last = parts.pop()!
        first = parts.join(' ')
      }
    }
    if (!first || !last) return errors.push(`Rreshti ${line}: mungon emri ose mbiemri`)
    const pno = text(get(r, 'pno')).replace(/\D/g, '') || null
    if (pno && pno.length !== 10) return errors.push(`Rreshti ${line} (${first} ${last}): numri personal duhet të ketë 10 shifra`)
    if (pno ? known.has(pno) : knownNames.has(norm(`${first} ${last}`))) return errors.push(`Rreshti ${line} (${first} ${last}): është tashmë në listë`)
    const salary = toNum(get(r, 'salary'))
    const hours = toNum(get(r, 'hours'))
    if (Number.isNaN(salary) || Number.isNaN(hours)) return errors.push(`Rreshti ${line} (${first} ${last}): paga ose orët nuk janë numër`)
    let start = toDate(get(r, 'start'))
    if (!start) {
      start = today
      defaultedStart++
    }
    const end = toDate(get(r, 'end'))
    if (end && end < start) return errors.push(`Rreshti ${line} (${first} ${last}): data e përfundimit është para fillimit`)
    const g = norm(get(r, 'gender'))
    if (pno) known.add(pno)
    else knownNames.add(norm(`${first} ${last}`))
    rows.push({
      first_name: first,
      last_name: last,
      personal_no: pno,
      birth_date: toDate(get(r, 'birth')),
      gender: g.startsWith('f') ? 'F' : g.startsWith('m') ? 'M' : null,
      address: text(get(r, 'address')) || null,
      city: text(get(r, 'city')) || null,
      phone: text(get(r, 'phone')) || null,
      email: text(get(r, 'email')) || null,
      position: text(get(r, 'position')) || null,
      contract: toContract(get(r, 'contract')),
      start_date: start,
      end_date: end,
      weekly_hours: hours ?? 40,
      work_days: 5,
      gross_salary: salary ?? 0,
      bank_name: text(get(r, 'bank')) || null,
      iban: text(get(r, 'iban')).replace(/\s/g, '') || null,
      primary_job: true,
      emp_pension_pct: 5,
      er_pension_pct: 5,
    })
  })
  return { rows, errors, defaultedStart }
}

/** CSV (comma or semicolon) → rows, with quoted fields. */
export function parseCsv(s: string): string[][] {
  const sep = (s.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > (s.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      out.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    out.push(row)
  }
  return out
}

export function EmployeeImportDialog({ client, existing, open, onClose }: { client: Client; existing: Employee[]; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [parsed, setParsed] = useState<(ReturnType<typeof parseEmployees> & { file: string }) | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; failed: string[] } | null>(null)

  const run = useMutation({
    mutationFn: async () => {
      let added = 0
      const failed: string[] = []
      for (const r of parsed!.rows) {
        try {
          await saveEmployee(client.id, r)
          added++
        } catch (e) {
          failed.push(`${r.first_name} ${r.last_name}: ${(e as Error).message}`)
        }
      }
      return { added, failed }
    },
    onSuccess: (r) => {
      setResult(r)
      setParsed(null)
      void qc.invalidateQueries({ queryKey: ['client', client.id] })
    },
  })

  const close = () => {
    setParsed(null)
    setReadError(null)
    setResult(null)
    run.reset()
    onClose()
  }

  const pick = async (file: File) => {
    setReadError(null)
    setResult(null)
    try {
      let data: unknown[][]
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') data = parseCsv((await file.text()).replace(/^﻿/, ''))
      else {
        const { readSheet } = await import('read-excel-file/browser')
        data = (await readSheet(file)) as unknown[][]
      }
      setParsed({ ...parseEmployees(data, existing), file: file.name })
    } catch (e) {
      setReadError('Skedari nuk u lexua: ' + (e as Error).message)
    }
  }

  const template = async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const example = ['Arta', 'Krasniqi', '1234567890', '15.03.1990', 'F', 'Rruga Shembull 1', 'Prishtinë', '044000000', '', 'Shitëse', 'Me kohë të pacaktuar', '01.01.2026', '', 40, 500, 'Banka', 'XK050000000000000000']
    await writeXlsxFile(
      [COLUMNS.map((c) => ({ value: c, fontWeight: 'bold' as const })), example.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: v, type: String }))] as never,
      { columns: COLUMNS.map((c) => ({ width: Math.max(12, c.length + 4) })) },
    ).toFile('shablloni-punonjesit.xlsx')
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Importo listën e punonjësve"
      subtitle="Excel (.xlsx) ose CSV. Kolonat: Emri, Mbiemri (ose Emri dhe mbiemri), Nr. personal, Datëlindja, Gjinia, Adresa, Qyteti, Telefoni, Email, Pozita, Kontrata, Fillimi, Përfundimi, Orë/javë, Paga bruto, Banka, IBAN."
      width="md:max-w-[620px]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {run.error && <span className="mr-auto text-sm text-warn-700">{(run.error as Error).message}</span>}
          <Button variant="secondary" onClick={() => void template()}>
            Shkarko shabllonin
          </Button>
          {result ? (
            <Button onClick={close}>Mbyll</Button>
          ) : (
            <Button disabled={!parsed || parsed.rows.length === 0} loading={run.isPending} onClick={() => run.mutate()}>
              Importo {parsed?.rows.length ? `(${parsed.rows.length})` : ''}
            </Button>
          )}
        </div>
      }
    >
      <label className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-field bg-[#F9FAFB] px-4 text-center hover:border-brand-600">
        <FileSpreadsheet className="h-7 w-7 text-brand-600" />
        <span className="font-semibold">{parsed ? parsed.file : 'Zgjidh skedarin (.xlsx ose .csv)'}</span>
        <span className="text-sm text-muted">Rreshti i parë me tituj; çdo rresht tjetër një punonjës.</span>
        <input
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pick(f)
            e.target.value = ''
          }}
        />
      </label>
      {readError && <p className="mt-3 text-sm text-warn-700">{readError}</p>}
      {parsed && (
        <div className="mt-4 text-sm">
          <p>
            <strong>{parsed.rows.length}</strong> punonjës gati për t'u shtuar.
            {parsed.defaultedStart > 0 && ` ${parsed.defaultedStart} pa datë fillimi – merret data e sotme (ndryshoje te punonjësi).`}
          </p>
          {parsed.rows.length > 0 && (
            <div className="mt-2 max-h-[180px] overflow-y-auto rounded-ctl border border-line">
              {parsed.rows.map((r, i) => (
                <div key={i} className="flex justify-between gap-3 border-b border-line px-3 py-1.5 last:border-0">
                  <span>
                    {r.first_name} {r.last_name}
                    {r.position && <span className="text-muted"> · {r.position}</span>}
                  </span>
                  <span className="tabular-nums text-muted">{r.personal_no ?? ''}</span>
                </div>
              ))}
            </div>
          )}
          {parsed.errors.length > 0 && (
            <div className="mt-3 max-h-[160px] overflow-y-auto rounded-ctl bg-amber-100 px-4 py-3 text-amber-700">
              <div className="font-semibold">{parsed.errors.length} rreshta nuk merren:</div>
              {parsed.errors.slice(0, 50).map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="mt-4 text-sm">
          <p className="rounded-ctl bg-brand-100 px-4 py-2.5 text-brand-600">
            U shtuan <strong>{result.added}</strong> punonjës.
          </p>
          {result.failed.length > 0 && (
            <div className="mt-3 max-h-[160px] overflow-y-auto rounded-ctl bg-warn-100 px-4 py-3 text-warn-700">
              <div className="font-semibold">{result.failed.length} nuk u shtuan:</div>
              {result.failed.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
