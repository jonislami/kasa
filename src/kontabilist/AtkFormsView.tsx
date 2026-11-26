import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { addMonths, monthName, monthStart } from '@/features/accounting/api'
import { fetchDocs, type Client } from './api'
import {
  buildPayRows,
  buildWrRows,
  checkPayRows,
  checkWrRows,
  emptyWrRow,
  fillPayTemplate,
  fillWrTemplate,
  payContrib,
  PAY_HEAD,
  WR_COUNTRIES,
  WR_HEAD,
  wrTmb,
  wrTmbNonres,
  type FormHead,
  type PayFormRow,
  type WrRow,
  type YesNo,
} from './atkForms'
import { fetchEmployees, fetchPayroll } from './payroll'

const n2 = (v: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()
// column widths of the templates (Excel characters → px: 7 px per character + 5)
const px = (chars: number) => Math.round(chars * 7 + 5)
const PAY_WIDTHS = [2247, 2588, 2958, 2958, 3584, 3612, 4295, 3697, 2218, 3043, 3925].map((w) => px(w / 256))
const WR_WIDTHS = [9.109375, ...Array<number>(13).fill(14.6640625), 21.77734375].map(px)
const letter = (i: number) => String.fromCharCode(65 + i)
const monthEnd = (m: string) => {
  const d = new Date(`${m.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return d.toISOString().slice(0, 10)
}

async function download(file: string, filename: string, fill: (t: Uint8Array) => Uint8Array, mime: string) {
  const res = await fetch(`${import.meta.env.BASE_URL}atk/${file}`)
  if (!res.ok) throw new Error('Shablloni i ATK-së nuk u gjet.')
  const url = URL.createObjectURL(new Blob([fill(new Uint8Array(await res.arrayBuffer())) as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function MonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return (
    <div className="flex items-center self-start overflow-hidden rounded-ctl border border-line bg-white">
      <button type="button" aria-label="Muaji i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[140px] px-2 text-center font-semibold">{monthName(month)}</span>
      <button type="button" aria-label="Muaji tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg disabled:text-[#B5BCC7]" disabled={month >= monthStart()} onClick={() => setMonth(addMonths(month, 1))}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

/** Pagat → "Lista e pagave për ATK": ATK's payroll template of a month. */
export function AtkFormsView({ client }: { client: Client }) {
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1))
  return (
    <>
      <MonthNav month={month} setMonth={setMonth} />
      <PayForm client={client} month={month} />
    </>
  )
}

/** Its own page ("Formulari WR", Administrata tatimore): ATK's WR template of a month. */
export function WrTab({ client }: { client: Client }) {
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1))
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <MonthNav month={month} setMonth={setMonth} />
      <WrForm client={client} month={month} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The sheet look: column letters, row numbers, rows 1–2 as in the template
// ---------------------------------------------------------------------------
function Sheet({ head, widths, children }: { head: FormHead[]; widths: number[]; children: React.ReactNode }) {
  const cellB = 'border border-[#BFC7C2] px-1.5'
  return (
    <div className="w-full overflow-x-auto">
      <table className="border-collapse text-[12px] text-ink" style={{ fontFamily: 'Calibri, Arial, sans-serif' }}>
        <colgroup>
          <col style={{ width: 34 }} />
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-[#F3F4F3] text-center text-[11px] text-muted">
            <th className={cellB} />
            {head.map((_, i) => (
              <th key={i} className={cn(cellB, 'font-normal')}>
                {letter(i)}
              </th>
            ))}
          </tr>
          <tr>
            <th className={cn(cellB, 'bg-[#F3F4F3] text-[11px] font-normal text-muted')}>1</th>
            {head.map((h, i) => (
              <th key={i} className={cn(cellB, 'h-[72px] whitespace-pre-line py-1 text-center align-middle font-bold leading-tight')}>
                {h.title}
                {h.note && <span className="block text-[10px] font-normal text-[#FF0000]">{h.note}</span>}
              </th>
            ))}
          </tr>
          <tr>
            <th className={cn(cellB, 'bg-[#F3F4F3] text-[11px] font-normal text-muted')}>2</th>
            {head.map((h, i) => (
              <th key={i} className={cn(cellB, 'py-1 text-center font-bold')}>
                {h.code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

const cellC = 'border border-[#BFC7C2] px-1.5 py-1 whitespace-nowrap'
const rowNo = (n: number) => <td className={cn(cellC, 'bg-[#F3F4F3] text-center text-[11px] text-muted')}>{n}</td>

function Issues({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mx-5 mb-4 flex items-start gap-2 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <ul>
        {items.slice(0, 8).map((t) => (
          <li key={t}>{t}</li>
        ))}
        {items.length > 8 && <li>… edhe {items.length - 8}</li>}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lista e pagave dhe kontributeve (.xls)
// ---------------------------------------------------------------------------
function PayForm({ client, month }: { client: Client; month: string }) {
  const run = useQuery({ queryKey: ['client', client.id, 'payroll', month], queryFn: () => fetchPayroll(client.id, month) })
  const emps = useQuery({ queryKey: ['client', client.id, 'employees'], queryFn: () => fetchEmployees(client.id) })
  const base = useMemo(() => buildPayRows(run.data?.lines ?? [], emps.data ?? []), [run.data, emps.data])
  // PO / JO chosen on screen (i, j, k), by row
  const [choice, setChoice] = useState<Record<number, Partial<Pick<PayFormRow, 'primary' | 'contributions' | 'tax'>>>>({})
  useEffect(() => setChoice({}), [month, client.id])
  const rows = base.map((r, i) => ({ ...r, ...choice[i] }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const issues = checkPayRows(rows)

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await download('lista_pagave.xls', `lista-e-pagave-${slug(client.name)}-${month.slice(0, 7)}.xls`, (t) => fillPayTemplate(t, rows), 'application/vnd.ms-excel')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const yn = (i: number, key: 'primary' | 'contributions' | 'tax', v: YesNo) => (
    <select value={v} onChange={(e) => setChoice({ ...choice, [i]: { ...choice[i], [key]: e.target.value as YesNo } })} className="w-full bg-transparent text-center outline-none">
      <option value="PO">PO</option>
      <option value="JO">JO</option>
    </select>
  )

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Lista e pagave dhe kontributeve</h2>
          <p className="text-sm text-muted">Shablloni i ATK-së (.xls), {monthName(month)}. Të dhënat vijnë nga lista e pagave e muajit; PO/JO mund t'i ndryshosh këtu.</p>
        </div>
        <Button onClick={() => void save()} loading={busy} disabled={!rows.length}>
          <Download className="h-4 w-4" /> Shkarko .xls
        </Button>
      </div>
      {error && <p className="mx-5 mb-4 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
      {run.isLoading || emps.isLoading ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : !run.data ? (
        <p className="px-5 pb-5 text-sm text-muted">Për {monthName(month)} nuk ka listë pagash. Krijoje te "Lista e pagave", pastaj kthehu këtu.</p>
      ) : (
        <>
          <Issues items={issues} />
          <div className="px-5 pb-5">
            <Sheet head={PAY_HEAD} widths={PAY_WIDTHS}>
              {rows.map((r, i) => {
                const e = payContrib(r.gross)
                return (
                  <tr key={i}>
                    {rowNo(i + 3)}
                    <td className={cellC}>{r.first_name}</td>
                    <td className={cellC}>{r.last_name}</td>
                    <td className={cn(cellC, 'tabular-nums')}>{r.personal_no}</td>
                    <td className={cn(cellC, 'text-right tabular-nums')}>{n2(r.gross)}</td>
                    <td className={cn(cellC, 'text-right tabular-nums')}>{n2(e)}</td>
                    <td className={cn(cellC, 'text-right tabular-nums')}>{n2(e)}</td>
                    <td className={cn(cellC, 'text-right tabular-nums')}>{n2(r.extra_emp)}</td>
                    <td className={cn(cellC, 'text-right tabular-nums')}>{n2(r.extra_er)}</td>
                    <td className={cn(cellC, 'p-0')}>{yn(i, 'primary', r.primary)}</td>
                    <td className={cn(cellC, 'p-0')}>{yn(i, 'contributions', r.contributions)}</td>
                    <td className={cn(cellC, 'p-0')}>{yn(i, 'tax', r.tax)}</td>
                  </tr>
                )
              })}
            </Sheet>
            <p className="mt-2 text-xs text-muted">Në skedar: e = D×5% dhe f = E (formulat e shabllonit), PO/JO me listën e zgjedhjes së shabllonit (L2:L3).</p>
          </div>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Formulari WR (.xlsx)
// ---------------------------------------------------------------------------
type NumKey = 'interest' | 'royalties' | 'lottery' | 'rent' | 'nonres_exempt' | 'nonres_services' | 'special'

function WrForm({ client, month }: { client: Client; month: string }) {
  const key = `kontabilist.wr.${client.id}.${month.slice(0, 7)}`
  const rent = useQuery({
    queryKey: ['client', client.id, 'wr-rent', month],
    queryFn: async () => (await fetchDocs(client.id, 'purchase', month, monthEnd(month))).filter((d) => d.category === 'rent'),
  })
  const [rows, setRows] = useState<WrRow[] | null>(null)
  useEffect(() => {
    const saved = localStorage.getItem(key)
    setRows(saved ? (JSON.parse(saved) as WrRow[]) : null)
  }, [key])
  // nothing kept for the month yet: the rent invoices of the month
  const shown = rows ?? buildWrRows(rent.data ?? [])
  const update = (next: WrRow[]) => {
    setRows(next)
    localStorage.setItem(key, JSON.stringify(next))
  }
  const set = (i: number, p: Partial<WrRow>) => update(shown.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const reset = () => {
    localStorage.removeItem(key)
    setRows(null)
  }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const issues = checkWrRows(shown)

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await download('formulari_wr.xlsx', `formulari-wr-${slug(client.name)}-${month.slice(0, 7)}.xlsx`, (t) => fillWrTemplate(t, shown), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inp = 'h-7 w-full bg-transparent px-1 outline-none focus:bg-brand-100'
  const text = (i: number, k: 'id_no' | 'name', v: string) => <input value={v} onChange={(e) => set(i, { [k]: e.target.value })} className={inp} />
  const num = (v: number | null, onSet: (x: number | null) => void, placeholder?: string) => <NumInput value={v} placeholder={placeholder} onSave={onSet} className={cn(inp, 'text-right tabular-nums')} />
  const amount = (i: number, k: NumKey) => num(shown[i][k] || null, (x) => set(i, { [k]: x ?? 0 }))

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Formulari WR – tatimi i mbajtur në burim</h2>
          <p className="text-sm text-muted">Shablloni i ATK-së (.xlsx), {monthName(month)}. Qiraja merret nga faturat e blerjes "Qiraja"; plotëso m² dhe pagesat e tjera.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => update([...shown, emptyWrRow()])}>
            <Plus className="h-4 w-4" /> Rresht
          </Button>
          {rows && (
            <Button variant="secondary" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Nga faturat
            </Button>
          )}
          <Button onClick={() => void save()} loading={busy} disabled={!shown.length}>
            <Download className="h-4 w-4" /> Shkarko .xlsx
          </Button>
        </div>
      </div>
      {error && <p className="mx-5 mb-4 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
      <Issues items={issues} />
      <div className="px-5 pb-5">
        {rent.isLoading && !rows ? (
          <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
        ) : (
          <Sheet head={WR_HEAD} widths={WR_WIDTHS}>
            {shown.map((r, i) => (
              <tr key={i} className="group">
                {rowNo(i + 3)}
                <td className={cn(cellC, 'text-center tabular-nums')}>
                  <span className="group-hover:hidden">{i + 1}</span>
                  <button type="button" aria-label="Fshi rreshtin" className="hidden text-warn-700 group-hover:inline" onClick={() => update(shown.filter((_, k) => k !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
                <td className={cn(cellC, 'p-0')}>{text(i, 'id_no', r.id_no)}</td>
                <td className={cn(cellC, 'p-0')}>{text(i, 'name', r.name)}</td>
                <td className={cn(cellC, 'p-0')}>{amount(i, 'interest')}</td>
                <td className={cn(cellC, 'p-0')}>{amount(i, 'royalties')}</td>
                <td className={cn(cellC, 'p-0')}>{amount(i, 'lottery')}</td>
                <td className={cn(cellC, 'p-0')}>{num(r.tmb, (x) => set(i, { tmb: x }), wrTmb(r) ? n2(wrTmb(r)) : '')}</td>
                <td className={cn(cellC, 'p-0')}>{amount(i, 'rent')}</td>
                <td className={cn(cellC, 'p-0')}>{amount(i, 'nonres_exempt')}</td>
                <td className={cn(cellC, 'p-0')}>{amount(i, 'nonres_services')}</td>
                <td className={cn(cellC, 'p-0')}>{num(r.tmb_nonres, (x) => set(i, { tmb_nonres: x }), wrTmbNonres(r) ? n2(wrTmbNonres(r)) : '')}</td>
                <td className={cn(cellC, 'p-0')}>{amount(i, 'special')}</td>
                <td className={cn(cellC, 'p-0', r.rent > 0 && !r.area_m2 && 'bg-amber-100')}>{num(r.area_m2, (x) => set(i, { area_m2: x }))}</td>
                <td className={cn(cellC, 'p-0', r.rent > 0 && !r.monthly_rent && 'bg-amber-100')}>{num(r.monthly_rent, (x) => set(i, { monthly_rent: x }))}</td>
                <td className={cn(cellC, 'p-0')}>
                  <select value={r.country} onChange={(e) => set(i, { country: e.target.value })} className="h-7 w-full bg-transparent outline-none">
                    {!WR_COUNTRIES.includes(r.country) && <option value={r.country}>{r.country || '—'}</option>}
                    {WR_COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                {rowNo(3)}
                <td colSpan={15} className={cn(cellC, 'py-3 text-center text-muted')}>
                  Asnjë faturë qiraje këtë muaj. Shto rresht për interesin, të drejtat pronësore, lotarinë, jo-rezidentët ose kategoritë e veçanta.
                </td>
              </tr>
            )}
          </Sheet>
        )}
        <p className="mt-2 text-xs text-muted">
          Kutia 7 = (4+5+6)×10% dhe 11 = (9+10)×5% llogariten vetë; shkruaj shumën kur zbatohet norma sipas METD. Ndryshimet ruhen në këtë kompjuter për muajin. Në skedar, shteti
          zgjidhet nga lista origjinale (U4:U224).
        </p>
      </div>
    </Card>
  )
}

function NumInput({ value, onSave, className, placeholder }: { value: number | null; onSave: (v: number | null) => void; className: string; placeholder?: string }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => setV(value == null ? '' : String(value)), [value])
  return (
    <input
      inputMode="decimal"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim().replace(',', '.')
        const x = t === '' ? null : Number(t)
        if (x != null && !Number.isFinite(x)) return setV(value == null ? '' : String(value))
        if (x !== value) onSave(x == null ? null : Math.round(x * 100) / 100)
      }}
      className={className}
    />
  )
}
