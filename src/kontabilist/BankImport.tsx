import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { Button, Dialog, Select } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { importBankLines } from './api'

type Raw = unknown[][]
type Field = 'date' | 'description' | 'counterparty' | 'reference' | 'amount' | 'credit' | 'debit'
const FIELD_LABEL: Record<Field, string> = {
  date: 'Data',
  description: 'Përshkrimi',
  counterparty: 'Pala tjetër',
  reference: 'Referenca',
  amount: 'Shuma (+/−)',
  credit: 'Hyrje (kredi)',
  debit: 'Dalje (debi)',
}
const GUESS: Record<Field, RegExp> = {
  date: /^(data|date|datum|data e valut|data e transaksionit|booking|value date)/i,
  description: /(pershkrim|përshkrim|description|detaj|qellim|qëllim|purpose|narrative|pershkrimi|details)/i,
  counterparty: /(pala|emri|counterparty|beneficiar|paguesi|payer|partner|name)/i,
  reference: /(referenc|ref\.?$|reference|nr\.? transak)/i,
  amount: /^(shuma|amount|vlera|iznos)$/i,
  credit: /(kredi|credit|hyrje|in$|depozit)/i,
  debit: /(debi|debit|dalje|out$|terheqje|tërheqje)/i,
}

const norm = (v: unknown) => String(v ?? '').trim()

/** "1.234,56" / "1,234.56" / "-12.5" / 12.5 → number */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = norm(v).replace(/[^\d,.\-−()]/g, '').replace('−', '-')
  if (!s) return null
  const neg = s.startsWith('(') && s.endsWith(')')
  s = s.replace(/[()]/g, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const x = Number(s)
  return Number.isFinite(x) ? (neg ? -Math.abs(x) : x) : null
}

/** dd.mm.yyyy, dd/mm/yyyy, yyyy-mm-dd, Excel dates → yyyy-mm-dd */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = norm(v)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

function parseCsv(text: string): Raw {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

/** Import a bank statement (CSV or Excel from any bank in Kosovo): pick the columns, preview, import. */
export function BankImportDialog({ accountId, accountName, open, onClose, onDone }: { accountId: string; accountName: string; open: boolean; onClose: () => void; onDone: (r: { added: number; skipped: number }) => void }) {
  const [file, setFile] = useState<{ name: string; rows: Raw } | null>(null)
  const [headerRow, setHeaderRow] = useState(0)
  const [map, setMap] = useState<Partial<Record<Field, number>>>({})
  const [readError, setReadError] = useState<string | null>(null)

  const pick = async (f: File) => {
    setReadError(null)
    try {
      let rows: Raw
      if (/\.(xlsx|xls)$/i.test(f.name)) {
        const { readSheet } = await import('read-excel-file/browser')
        rows = (await readSheet(f)) as Raw
      } else {
        rows = parseCsv(await f.text())
      }
      // header = first row with a date-like column name
      const h = Math.max(0, rows.findIndex((r) => r.some((c) => GUESS.date.test(norm(c)))))
      const head = (rows[h] ?? []).map(norm)
      const guess: Partial<Record<Field, number>> = {}
      for (const f2 of Object.keys(GUESS) as Field[]) {
        const i = head.findIndex((c, j) => GUESS[f2].test(c) && !Object.values(guess).includes(j))
        if (i >= 0) guess[f2] = i
      }
      if (guess.amount !== undefined) {
        delete guess.credit
        delete guess.debit
      }
      setFile({ name: f.name, rows })
      setHeaderRow(h)
      setMap(guess)
    } catch (e) {
      setReadError('Skedari nuk u lexua: ' + (e as Error).message)
    }
  }

  const head = file ? (file.rows[headerRow] ?? []).map(norm) : []
  const parsed = useMemo(() => {
    if (!file) return { rows: [], bad: 0 }
    const out: { date: string; amount: number; description?: string; counterparty?: string; reference?: string }[] = []
    let bad = 0
    for (const r of file.rows.slice(headerRow + 1)) {
      const date = map.date !== undefined ? parseDate(r[map.date]) : null
      let amount: number | null = null
      if (map.amount !== undefined) amount = parseAmount(r[map.amount])
      else {
        const cr = map.credit !== undefined ? parseAmount(r[map.credit]) ?? 0 : 0
        const db = map.debit !== undefined ? parseAmount(r[map.debit]) ?? 0 : 0
        amount = Math.round((Math.abs(cr) - Math.abs(db)) * 100) / 100
      }
      if (!date || !amount) {
        if (r.some((c) => norm(c))) bad++
        continue
      }
      out.push({
        date,
        amount,
        description: map.description !== undefined ? norm(r[map.description]) : undefined,
        counterparty: map.counterparty !== undefined ? norm(r[map.counterparty]) : undefined,
        reference: map.reference !== undefined ? norm(r[map.reference]) : undefined,
      })
    }
    return { rows: out, bad }
  }, [file, headerRow, map])

  const run = useMutation({ mutationFn: () => importBankLines(accountId, parsed.rows), onSuccess: (r) => onDone(r) })
  const close = () => {
    setFile(null)
    setMap({})
    run.reset()
    onClose()
  }
  const sumIn = parsed.rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0)
  const sumOut = parsed.rows.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0)

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Importo ekstraktin – ${accountName}`}
      subtitle="CSV ose Excel nga e-banking-u. Rreshtat që janë importuar më parë nuk shtohen dy herë."
      width="md:max-w-[880px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted">
            {file && `${parsed.rows.length} lëvizje · hyrje ${formatEUR(sumIn)} · dalje ${formatEUR(sumOut)}${parsed.bad ? ` · ${parsed.bad} rreshta pa datë/shumë` : ''}`}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={close}>
              Anulo
            </Button>
            <Button disabled={!parsed.rows.length} loading={run.isPending} onClick={() => run.mutate()}>
              Importo {parsed.rows.length || ''}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-card border-2 border-dashed border-field p-4 hover:border-brand-600">
          <FileUp className="h-6 w-6 text-muted" />
          <span className="flex-1">{file ? file.name : 'Zgjidh skedarin e ekstraktit (.csv, .xlsx)'}</span>
          <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
        </label>
        {readError && <p className="text-sm text-warn-700">{readError}</p>}

        {file && (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Select
                label="Rreshti i titujve"
                value={String(headerRow)}
                onChange={(e) => setHeaderRow(Number(e.target.value))}
                options={file.rows.slice(0, 15).map((r, i) => ({ value: String(i), label: `${i + 1}: ${r.map(norm).filter(Boolean).slice(0, 3).join(' | ')}`.slice(0, 60) }))}
              />
              {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
                <Select
                  key={f}
                  label={FIELD_LABEL[f]}
                  value={map[f] === undefined ? '' : String(map[f])}
                  onChange={(e) => setMap({ ...map, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}
                  options={[{ value: '', label: '—' }, ...head.map((h, i) => ({ value: String(i), label: h || `Kolona ${i + 1}` }))]}
                />
              ))}
            </div>
            <p className="text-xs text-muted">Zgjidh ose "Shuma" me shenjë (+ hyrje, − dalje), ose "Hyrje" dhe "Dalje" në kolona të veçanta.</p>
            <div className="max-h-[320px] overflow-auto rounded-card border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#F8FAF8] text-left text-muted">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th>Përshkrimi</th>
                    <th>Pala</th>
                    <th className="px-3 text-right">Shuma</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="whitespace-nowrap px-3 py-1.5">{formatDay(r.date)}</td>
                      <td className="max-w-[360px] truncate">{r.description}</td>
                      <td className="max-w-[160px] truncate">{r.counterparty}</td>
                      <td className={`px-3 text-right tabular-nums ${r.amount < 0 ? 'text-warn-700' : 'text-brand-600'}`}>{formatEUR(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {run.error && <p className="text-sm text-warn-700">{(run.error as Error).message}</p>}
      </div>
    </Dialog>
  )
}
