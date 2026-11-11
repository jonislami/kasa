import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarMinus, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Landmark, Plus, Printer, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, formatDay, monthName, monthStart } from '@/features/accounting/api'
import type { Client } from './api'
import {
  CONTRACT_LABELS,
  deleteLeave,
  fetchEmployees,
  fetchPayroll,
  fetchPayrollYear,
  LEAVE_LABELS,
  preparePayroll,
  salaryPreview,
  saveEmployee,
  saveLeave,
  setPayrollStatus,
  updatePayrollLine,
  type Contract,
  type Employee,
  type LeaveKind,
  type PayrollLine,
  type PayrollRun,
} from './payroll'
import { downloadSheets } from './xls'

const n2 = (v: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()
const STATUS: Record<PayrollRun['status'], { label: string; tone: 'amber' | 'info' | 'success' }> = {
  draft: { label: 'Draft', tone: 'amber' },
  confirmed: { label: 'E konfirmuar', tone: 'info' },
  filed: { label: 'E deklaruar (WPK)', tone: 'success' },
}

/** Pagat: payroll of the month, employees, leaves, year overview. */
export function PayrollTab({ client }: { client: Client }) {
  const [view, setView] = useState<'list' | 'employees' | 'year'>('list')
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex gap-2">
        {(
          [
            ['list', 'Lista e pagave'],
            ['employees', 'Punëtorët dhe pushimet'],
            ['year', 'Viti'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={cn('h-10 rounded-full border px-4 text-sm font-semibold', view === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
            {l}
          </button>
        ))}
      </div>
      {view === 'list' && <PayrollMonthView client={client} />}
      {view === 'employees' && <EmployeesView client={client} />}
      {view === 'year' && <YearView client={client} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Payroll of one month
// ---------------------------------------------------------------------------
function PayrollMonthView({ client }: { client: Client }) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1))
  const run = useQuery({ queryKey: ['client', client.id, 'payroll', month], queryFn: () => fetchPayroll(client.id, month) })
  const r = run.data
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id] })
  const prepare = useMutation({ mutationFn: (days?: number) => preparePayroll(client.id, month, days), onSuccess: refresh })
  const line = useMutation({ mutationFn: ({ id, p }: { id: string; p: Partial<PayrollLine> }) => updatePayrollLine(id, p), onSuccess: refresh })
  const status = useMutation({ mutationFn: (p: Parameters<typeof setPayrollStatus>[1]) => setPayrollStatus(r!.id, p), onSuccess: refresh })
  const [fileOpen, setFileOpen] = useState(false)
  const [printing, setPrinting] = useState<PayrollLine[] | null>(null)
  useEffect(() => {
    if (!printing) return
    const t = setTimeout(() => {
      window.print()
      setPrinting(null)
    }, 80)
    return () => clearTimeout(t)
  }, [printing])

  const lines = r?.lines ?? []
  const draft = r?.status === 'draft'
  const t = lines.reduce(
    (a, l) => ({ gross: a.gross + l.gross, emp: a.emp + l.emp_contrib, er: a.er + l.er_contrib, tax: a.tax + l.tax, net: a.net + l.net, pay: a.pay + l.payable, adv: a.adv + l.advance }),
    { gross: 0, emp: 0, er: 0, tax: 0, net: 0, pay: 0, adv: 0 },
  )
  const label = monthName(month)

  const wpk = () =>
    downloadSheets(`wpk-${slug(client.name)}-${month.slice(0, 7)}.xlsx`, [
      {
        name: 'WPK',
        columns: ['Nr.', 'Numri personal', 'Emri dhe mbiemri', 'Punëdhënësi', 'Paga bruto', 'Kontributi i punëtorit', 'Kontributi i punëdhënësit', 'Kontributet gjithsej', 'Baza e tatueshme', 'Tatimi i mbajtur', 'Paga neto'],
        rows: [
          ...lines.map((l, i) => [i + 1, l.personal_no ?? '', l.name, l.primary_job ? 'Parësor' : 'Dytësor', l.gross, l.emp_contrib, l.er_contrib, l.emp_contrib + l.er_contrib, l.tax_base, l.tax, l.net]),
          ['', '', 'Gjithsej', '', t.gross, t.emp, t.er, t.emp + t.er, t.gross - t.emp, t.tax, t.net],
        ],
      },
    ])
  const bank = () =>
    downloadSheets(`urdhri-pageses-pagat-${slug(client.name)}-${month.slice(0, 7)}.xlsx`, [
      {
        name: 'Urdhri i pagesës',
        columns: ['Nr.', 'Emri dhe mbiemri', 'IBAN', 'Shuma (€)', 'Përshkrimi'],
        rows: [...lines.filter((l) => l.payable > 0).map((l, i) => [i + 1, l.name, l.iban ?? '', l.payable, `Paga ${label}`]), ['', 'Gjithsej', '', t.pay, '']],
      },
    ])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
          <button type="button" aria-label="Muaji i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] px-2 text-center font-semibold">{label}</span>
          <button type="button" aria-label="Muaji tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg disabled:text-[#B8C2BC]" disabled={month >= monthStart()} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {r && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            <Button variant="secondary" onClick={() => void wpk()} disabled={!lines.length}>
              <FileSpreadsheet className="h-4 w-4" /> WPK për ATK
            </Button>
            <Button variant="secondary" onClick={() => void bank()} disabled={!lines.length}>
              <Landmark className="h-4 w-4" /> Urdhri për bankën
            </Button>
            <Button variant="secondary" onClick={() => setPrinting(lines)} disabled={!lines.length}>
              <Printer className="h-4 w-4" /> Fletëpagesat
            </Button>
            {draft && (
              <Button variant="secondary" loading={prepare.isPending} onClick={() => prepare.mutate(undefined)}>
                <RefreshCw className="h-4 w-4" /> Rifresko
              </Button>
            )}
            {r.status === 'draft' && (
              <Button loading={status.isPending} onClick={() => status.mutate({ status: 'confirmed' })} disabled={!lines.length}>
                <CheckCircle2 className="h-4 w-4" /> Konfirmo
              </Button>
            )}
            {r.status === 'confirmed' && (
              <>
                <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ status: 'draft' })}>
                  Hape
                </Button>
                <Button onClick={() => setFileOpen(true)}>Shëno WPK të dorëzuar</Button>
              </>
            )}
            {r.status === 'filed' && (
              <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ status: 'confirmed' })}>
                Anulo dorëzimin
              </Button>
            )}
          </div>
        )}
      </div>
      {(prepare.error || line.error || status.error) && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{((prepare.error ?? line.error ?? status.error) as Error).message}</p>}

      {run.isLoading ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : !r ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={`Lista e pagave për ${label}`}
            text="Krijohet nga punëtorët aktivë të muajit; pushimet pa pagesë merren vetë. Pastaj shton bonuset dhe avanset dhe e konfirmon."
            action={
              <Button loading={prepare.isPending} onClick={() => prepare.mutate(undefined)}>
                Krijo listën e pagave
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['Paga bruto', t.gross],
              ['Kontributet (5%+5%)', t.emp + t.er],
              ['Tatimi në paga', t.tax],
              ['Paga neto', t.net],
              ['Kosto e punëdhënësit', t.gross + t.er],
            ].map(([l, v]) => (
              <Card key={l as string} className="p-4">
                <div className="text-sm text-muted">{l}</div>
                <div className="mt-1 text-[20px] font-bold tabular-nums">{formatEUR(v as number)}</div>
              </Card>
            ))}
          </div>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm text-muted">
              <span>
                {lines.length} punëtorë · ditë pune në muaj:{' '}
                {draft ? (
                  <input
                    inputMode="numeric"
                    defaultValue={r.working_days}
                    onBlur={(e) => Number(e.target.value) !== r.working_days && prepare.mutate(Number(e.target.value) || r.working_days)}
                    className="h-8 w-14 rounded-lg border border-field px-2 text-center"
                  />
                ) : (
                  r.working_days
                )}
              </span>
              <span>Afati i deklarimit WPK: {formatDay(`${addMonths(month, 1).slice(0, 8)}15`)}</span>
            </div>
            <Table>
              <thead className="bg-[#F6F9F7]">
                <tr>
                  <Th className="pl-5">Punëtori</Th>
                  <Th className="text-right">Paga bazë</Th>
                  <Th className="text-right">Ditë pa pagesë</Th>
                  <Th className="text-right">Bonus</Th>
                  <Th className="text-right">Bruto</Th>
                  <Th className="hidden text-right lg:table-cell">Kontr. 5%</Th>
                  <Th className="hidden text-right lg:table-cell">Tatimi</Th>
                  <Th className="text-right">Neto</Th>
                  <Th className="text-right">Avans</Th>
                  <Th className="pr-5 text-right">Për pagesë</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="pl-5">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted">
                        {[l.position, l.personal_no, !l.primary_job && 'punëdhënës dytësor (10%)'].filter(Boolean).join(' · ')}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{n2(l.base_salary)}</Td>
                    <Td className="text-right">{draft ? <NumCell value={l.unpaid_days} onSave={(v) => line.mutate({ id: l.id, p: { unpaid_days: v } })} /> : l.unpaid_days || ''}</Td>
                    <Td className="text-right">{draft ? <NumCell value={l.bonus} onSave={(v) => line.mutate({ id: l.id, p: { bonus: v } })} /> : n2(l.bonus)}</Td>
                    <Td className="text-right font-medium tabular-nums">{n2(l.gross)}</Td>
                    <Td className="hidden text-right tabular-nums lg:table-cell">{n2(l.emp_contrib)}</Td>
                    <Td className="hidden text-right tabular-nums lg:table-cell">{n2(l.tax)}</Td>
                    <Td className="text-right tabular-nums">{n2(l.net)}</Td>
                    <Td className="text-right">{draft ? <NumCell value={l.advance} onSave={(v) => line.mutate({ id: l.id, p: { advance: v } })} /> : n2(l.advance)}</Td>
                    <Td className="pr-5 text-right font-semibold tabular-nums">{n2(l.payable)}</Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td className="border-b-0 pl-5">Gjithsej</Td>
                  <Td className="border-b-0" />
                  <Td className="border-b-0" />
                  <Td className="border-b-0" />
                  <Td className="border-b-0 text-right tabular-nums">{n2(t.gross)}</Td>
                  <Td className="hidden border-b-0 text-right tabular-nums lg:table-cell">{n2(t.emp)}</Td>
                  <Td className="hidden border-b-0 text-right tabular-nums lg:table-cell">{n2(t.tax)}</Td>
                  <Td className="border-b-0 text-right tabular-nums">{n2(t.net)}</Td>
                  <Td className="border-b-0 text-right tabular-nums">{n2(t.adv)}</Td>
                  <Td className="border-b-0 pr-5 text-right tabular-nums">{n2(t.pay)}</Td>
                </tr>
              </tbody>
            </Table>
            {!draft && <p className="border-t border-line px-5 py-3 text-xs text-muted">E konfirmuar: kontohet vetë (6200 / 6210 – 3400 / 3500 / 3700). Pagesat e pagave nga banka ("Dalje → Pagat") e mbyllin 3400.</p>}
          </Card>
        </>
      )}

      <FileWpkDialog open={fileOpen} loading={status.isPending} onClose={() => setFileOpen(false)} onSave={(p) => status.mutate({ status: 'filed', ...p }, { onSuccess: () => setFileOpen(false) })} />
      {printing && r && createPortal(<Payslips client={client} lines={printing} month={month} />, document.body)}
    </>
  )
}

function NumCell({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(value ? String(value) : '')
  useEffect(() => setV(value ? String(value) : ''), [value])
  return (
    <input
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const x = Number(v.replace(',', '.')) || 0
        if (x !== value) onSave(x)
      }}
      className="h-9 w-20 rounded-lg border border-field px-2 text-right"
    />
  )
}

function FileWpkDialog({ open, loading, onClose, onSave }: { open: boolean; loading: boolean; onClose: () => void; onSave: (p: { filed_at: string; reference?: string; paid_at?: string }) => void }) {
  const [f, setF] = useState({ filed_at: kosovoDateISO(), reference: '', paid_at: '' })
  useEffect(() => {
    if (open) setF({ filed_at: kosovoDateISO(), reference: '', paid_at: '' })
  }, [open])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Deklarata e pagave (WPK) u dorëzua"
      width="md:max-w-[460px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={loading} onClick={() => onSave({ filed_at: f.filed_at, reference: f.reference || undefined, paid_at: f.paid_at || undefined })}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Data e dorëzimit" type="date" value={f.filed_at} onChange={(e) => setF({ ...f, filed_at: e.target.value })} />
        <Input label="Nr. i konfirmimit (EDI)" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        <Input label="Tatimi dhe kontributet paguar më" type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} />
      </div>
    </Dialog>
  )
}

/** A4 payslips, one per page. */
function Payslips({ client, lines, month }: { client: Client; lines: PayrollLine[]; month: string }) {
  return (
    <div className="print-root print-a4 hidden bg-white text-[12px] text-black">
      {lines.map((l, i) => (
        <div key={l.id} style={{ breakAfter: i < lines.length - 1 ? 'page' : 'auto' }} className="pb-6">
          <div className="flex justify-between border-b-2 border-black pb-2">
            <div>
              <div className="text-[15px] font-bold">{client.name}</div>
              <div>{[client.address, client.city].filter(Boolean).join(', ')}</div>
              {client.nui && <div>NUI {client.nui}</div>}
            </div>
            <div className="text-right">
              <div className="text-[18px] font-bold">FLETËPAGESA</div>
              <div>{monthName(month)}</div>
            </div>
          </div>
          <table className="mt-3 w-full">
            <tbody>
              <tr>
                <td className="py-0.5 text-black/60">Punëtori</td>
                <td className="font-semibold">{l.name}</td>
                <td className="text-black/60">Nr. personal</td>
                <td>{l.personal_no ?? '—'}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-black/60">Pozita</td>
                <td>{l.position ?? '—'}</td>
                <td className="text-black/60">Punëdhënësi</td>
                <td>{l.primary_job ? 'Parësor' : 'Dytësor'}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-black/60">IBAN</td>
                <td colSpan={3}>{l.iban ?? '—'}</td>
              </tr>
            </tbody>
          </table>
          <table className="mt-4 w-full border-collapse">
            <tbody>
              {(
                [
                  ['Paga bazë', l.base_salary],
                  ...(l.unpaid_days ? [[`Zbritje për ${l.unpaid_days} ditë pa pagesë`, l.gross - l.bonus - l.base_salary]] : []),
                  ...(l.bonus ? [['Bonus / shtesa', l.bonus]] : []),
                  ['PAGA BRUTO', l.gross],
                  [`Kontributi pensional i punëtorit (${l.emp_pct}%)`, -l.emp_contrib],
                  ['Baza e tatueshme', l.tax_base],
                  ['Tatimi në të ardhura personale', -l.tax],
                  ['PAGA NETO', l.net],
                  ...(l.advance ? [['Avans i paguar më parë', -l.advance]] : []),
                  ['PËR PAGESË', l.payable],
                ] as [string, number][]
              ).map(([k, v]) => (
                <tr key={k} className={cn('border-b border-black/20', k === k.toUpperCase() && 'font-bold')}>
                  <td className="py-1">{k}</td>
                  <td className="text-right">{n2(v)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-black/70">
            Kontributi pensional i punëdhënësit ({l.er_pct}%): {n2(l.er_contrib)} € · Kostoja e punëdhënësit: {n2(l.gross + l.er_contrib)} €
          </p>
          <div className="mt-12 grid grid-cols-2 gap-16 text-center">
            <div className="border-t border-black pt-1">Punëdhënësi</div>
            <div className="border-t border-black pt-1">Punëtori</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Employees and leaves
// ---------------------------------------------------------------------------
function EmployeesView({ client }: { client: Client }) {
  const qc = useQueryClient()
  const year = Number(kosovoDateISO().slice(0, 4))
  const emps = useQuery({ queryKey: ['client', client.id, 'employees', year], queryFn: () => fetchEmployees(client.id, year) })
  const [edit, setEdit] = useState<Partial<Employee> | null>(null)
  const [leaveFor, setLeaveFor] = useState<Employee | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id] })
  const delLeave = useMutation({ mutationFn: deleteLeave, onSuccess: refresh })
  const list = emps.data ?? []
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[17px] font-semibold">Punëtorët</h2>
          <p className="text-sm text-muted">{list.filter((e) => e.active).length} aktivë · pushimet e vitit {year}</p>
        </div>
        <Button onClick={() => setEdit({ start_date: kosovoDateISO(), contract: 'indefinite', primary_job: true, emp_pension_pct: 5, er_pension_pct: 5, gross_salary: 0, active: true })}>
          <UserPlus className="h-4 w-4" /> Punëtor i ri
        </Button>
      </div>
      {!emps.data ? (
        <p className={emps.error ? 'px-5 py-6 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{emps.error ? (emps.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : list.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="Asnjë punëtor" text="Shto punëtorët me pagën bruto; lista e pagave llogaritet vetë çdo muaj." />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((e) => {
            const p = salaryPreview(e.gross_salary, e.emp_pension_pct, e.er_pension_pct, e.primary_job)
            return (
              <li key={e.id} className={cn('px-5 py-3.5', !e.active && 'opacity-50')}>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(e)}>
                    <div className="font-semibold text-brand-600 hover:underline">
                      {e.first_name} {e.last_name}
                    </div>
                    <div className="text-xs text-muted">
                      {[e.position, CONTRACT_LABELS[e.contract], `nga ${formatDay(e.start_date)}`, e.end_date && `deri ${formatDay(e.end_date)}`, !e.primary_job && 'punëdhënës dytësor'].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                  <div className="text-right text-sm">
                    <div className="font-semibold tabular-nums">Bruto {formatEUR(e.gross_salary)}</div>
                    <div className="text-muted tabular-nums">neto {formatEUR(p.net)}</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setLeaveFor(e)}>
                    <CalendarMinus className="h-4 w-4" /> Mungesë
                  </Button>
                </div>
                {e.leaves.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {e.leaves.map((l) => (
                      <span key={l.id} className="flex items-center gap-1 rounded-full bg-[#F1F5F2] py-1 pl-3 pr-1 text-xs">
                        {LEAVE_LABELS[l.kind]} · {formatDay(l.from_date)}–{formatDay(l.to_date)} · {l.days} ditë
                        <button type="button" aria-label="Fshi" onClick={() => delLeave.mutate(l.id)} className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-warn-700">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <EmployeeDialog clientId={client.id} value={edit} onClose={() => setEdit(null)} onSaved={refresh} />
      <LeaveDialog employee={leaveFor} onClose={() => setLeaveFor(null)} onSaved={refresh} />
    </Card>
  )
}

function EmployeeDialog({ clientId, value, onClose, onSaved }: { clientId: string; value: Partial<Employee> | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Employee>>({})
  useEffect(() => {
    if (value) setF(value)
  }, [value])
  const save = useMutation({
    mutationFn: () => saveEmployee(clientId, f),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const p = salaryPreview(f.gross_salary ?? 0, f.emp_pension_pct ?? 5, f.er_pension_pct ?? 5, f.primary_job !== false)
  const set = (k: keyof Employee) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={f.id ? `${f.first_name ?? ''} ${f.last_name ?? ''}` : 'Punëtor i ri'}
      width="md:max-w-[680px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Emri" value={f.first_name ?? ''} onChange={set('first_name')} />
        <Input label="Mbiemri" value={f.last_name ?? ''} onChange={set('last_name')} />
        <Input label="Numri personal" inputMode="numeric" maxLength={10} value={f.personal_no ?? ''} onChange={(e) => setF({ ...f, personal_no: e.target.value.replace(/\D/g, '') })} />
        <Input label="Pozita" value={f.position ?? ''} onChange={set('position')} />
        <Input label="Data e punësimit" type="date" value={f.start_date ?? ''} onChange={set('start_date')} />
        <Input label="Data e largimit" type="date" value={f.end_date ?? ''} onChange={(e) => setF({ ...f, end_date: e.target.value || null })} />
        <Select label="Kontrata" value={f.contract ?? 'indefinite'} onChange={(e) => setF({ ...f, contract: e.target.value as Contract })} options={(Object.keys(CONTRACT_LABELS) as Contract[]).map((c) => ({ value: c, label: CONTRACT_LABELS[c] }))} />
        <Select label="Punëdhënësi" value={f.primary_job === false ? 'secondary' : 'primary'} onChange={(e) => setF({ ...f, primary_job: e.target.value === 'primary' })} options={[{ value: 'primary', label: 'Parësor (0 / 8 / 10%)' }, { value: 'secondary', label: 'Dytësor (10%)' }]} />
        <Input label="Paga bruto mujore (€)" inputMode="decimal" value={f.gross_salary ? String(f.gross_salary) : ''} onChange={(e) => setF({ ...f, gross_salary: Number(e.target.value.replace(',', '.')) || 0 })} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Trusti punëtori %" inputMode="decimal" value={String(f.emp_pension_pct ?? 5)} onChange={(e) => setF({ ...f, emp_pension_pct: Number(e.target.value.replace(',', '.')) || 0 })} />
          <Input label="Trusti punëdhënësi %" inputMode="decimal" value={String(f.er_pension_pct ?? 5)} onChange={(e) => setF({ ...f, er_pension_pct: Number(e.target.value.replace(',', '.')) || 0 })} />
        </div>
        <Input label="IBAN (për pagën)" value={f.iban ?? ''} onChange={(e) => setF({ ...f, iban: e.target.value.toUpperCase() })} />
        <Input label="Email" type="email" value={f.email ?? ''} onChange={set('email')} />
        <div className="sm:col-span-2">
          <Input label="Shënim" value={f.note ?? ''} onChange={set('note')} />
        </div>
        {f.id && (
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktiv
          </label>
        )}
        {(f.gross_salary ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-2 rounded-card bg-[#F4F6F3] p-3 text-sm sm:col-span-2 sm:grid-cols-5">
            <div>
              <div className="text-muted">Kontr. punëtori</div>
              <div className="font-semibold tabular-nums">{formatEUR(p.emp)}</div>
            </div>
            <div>
              <div className="text-muted">Tatimi</div>
              <div className="font-semibold tabular-nums">{formatEUR(p.tax)}</div>
            </div>
            <div>
              <div className="text-muted">Neto</div>
              <div className="font-semibold tabular-nums text-brand-600">{formatEUR(p.net)}</div>
            </div>
            <div>
              <div className="text-muted">Kontr. punëdhënësi</div>
              <div className="font-semibold tabular-nums">{formatEUR(p.er)}</div>
            </div>
            <div>
              <div className="text-muted">Kosto gjithsej</div>
              <div className="font-semibold tabular-nums">{formatEUR(p.cost)}</div>
            </div>
          </div>
        )}
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

function LeaveDialog({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: 'annual' as LeaveKind, from_date: kosovoDateISO(), to_date: kosovoDateISO(), days: '1', note: '' })
  useEffect(() => {
    if (employee) setF({ kind: 'annual', from_date: kosovoDateISO(), to_date: kosovoDateISO(), days: '1', note: '' })
  }, [employee])
  const workdays = (a: string, b: string) => {
    let c = 0
    for (let d = new Date(a + 'T12:00:00'); d <= new Date(b + 'T12:00:00'); d.setDate(d.getDate() + 1)) if (d.getDay() % 6 !== 0) c++
    return c
  }
  const save = useMutation({
    mutationFn: () => saveLeave({ employee_id: employee!.id, kind: f.kind, from_date: f.from_date, to_date: f.to_date, days: Number(f.days.replace(',', '.')) || 0, note: f.note || null }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(employee)}
      onClose={onClose}
      title={`Mungesë – ${employee?.first_name ?? ''} ${employee?.last_name ?? ''}`}
      subtitle="Pushimi pa pagesë e zbret pagën bruto të muajit (ditët / ditët e punës)."
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            <Plus className="h-4 w-4" /> Shto
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Select label="Lloji" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LeaveKind })} options={(Object.keys(LEAVE_LABELS) as LeaveKind[]).map((k) => ({ value: k, label: LEAVE_LABELS[k] }))} />
        </div>
        <Input label="Nga" type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, days: String(workdays(e.target.value, f.to_date < e.target.value ? e.target.value : f.to_date)), to_date: f.to_date < e.target.value ? e.target.value : f.to_date })} />
        <Input label="Deri" type="date" value={f.to_date} min={f.from_date} onChange={(e) => setF({ ...f, to_date: e.target.value, days: String(workdays(f.from_date, e.target.value)) })} />
        <Input label="Ditë pune" inputMode="decimal" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
        <Input label="Shënim" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Year overview
// ---------------------------------------------------------------------------
function YearView({ client }: { client: Client }) {
  const [year, setYear] = useState(() => Number(kosovoDateISO().slice(0, 4)))
  const data = useQuery({ queryKey: ['client', client.id, 'payroll-year', year], queryFn: () => fetchPayrollYear(client.id, year) })
  const rows = data.data ?? []
  const t = rows.reduce((a, r) => ({ g: a.g + r.gross, tax: a.tax + r.tax, c: a.c + r.contrib, n: a.n + r.net }), { g: 0, tax: 0, c: 0, n: 0 })
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="text-[17px] font-semibold">Pagat sipas muajve</h2>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[0, 1, 2].map((i) => ({ value: String(Number(kosovoDateISO().slice(0, 4)) - i), label: String(Number(kosovoDateISO().slice(0, 4)) - i) }))} />
          <Button
            variant="secondary"
            disabled={!rows.length}
            onClick={() =>
              void downloadSheets(`pagat-${slug(client.name)}-${year}.xlsx`, [
                { name: `Pagat ${year}`, columns: ['Muaji', 'Punëtorë', 'Bruto', 'Kontributet', 'Tatimi', 'Neto', 'Statusi'], rows: [...rows.map((r) => [monthName(r.month), r.employees, r.gross, r.contrib, r.tax, r.net, STATUS[r.status].label]), ['Gjithsej', '', t.g, t.c, t.tax, t.n, '']] },
              ])
            }
          >
            Excel
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={`Asnjë listë pagash në ${year}`} />
      ) : (
        <Table>
          <thead className="bg-[#F6F9F7]">
            <tr>
              <Th className="pl-5">Muaji</Th>
              <Th className="text-right">Punëtorë</Th>
              <Th className="text-right">Bruto</Th>
              <Th className="text-right">Kontributet</Th>
              <Th className="text-right">Tatimi</Th>
              <Th className="text-right">Neto</Th>
              <Th className="pr-5">Statusi</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <Td className="pl-5">{monthName(r.month)}</Td>
                <Td className="text-right">{r.employees}</Td>
                <Td className="text-right tabular-nums">{n2(r.gross)}</Td>
                <Td className="text-right tabular-nums">{n2(r.contrib)}</Td>
                <Td className="text-right tabular-nums">{n2(r.tax)}</Td>
                <Td className="text-right tabular-nums">{n2(r.net)}</Td>
                <Td className="pr-5">
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td className="border-b-0 pl-5">Gjithsej</Td>
              <Td className="border-b-0" />
              <Td className="border-b-0 text-right tabular-nums">{n2(t.g)}</Td>
              <Td className="border-b-0 text-right tabular-nums">{n2(t.c)}</Td>
              <Td className="border-b-0 text-right tabular-nums">{n2(t.tax)}</Td>
              <Td className="border-b-0 text-right tabular-nums">{n2(t.n)}</Td>
              <Td className="border-b-0" />
            </tr>
          </tbody>
        </Table>
      )}
    </Card>
  )
}
