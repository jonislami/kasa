import { Fragment, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, ChevronLeft, ChevronRight, FileSignature, FileSpreadsheet, FileText, History, Plus, Printer, Trash2, Upload, UserPlus } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, formatDay, monthName, monthStart } from '@/features/accounting/api'
import type { Client } from './api'
import { addDay, ATT, entitlement, fetchAttendance, fetchHistory, fullName, HISTORY_LABELS, holidays, isWorkingDay, nextDecisionNo, saveLeaveFull, setAttendance, workingDays, type AttStatus } from './hr'
import { EmploymentContract, LeaveDecision, LeaveReport, LeaveReportAll, PrintPortal } from './hrDocs'
import { CONTRACT_LABELS, deleteLeave, fetchEmployees, LEAVE_LABELS, saveEmployee, type Contract, type Employee, type Leave, type LeaveKind } from './payroll'
import { downloadSheets } from './xls'
import { EmployeeImportDialog } from './EmployeeImport'

export type HrView = 'employees' | 'attendance' | 'leaves'

const days = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','))

/** Burimet njerëzore: employees with their full file, attendance, leaves and the official documents. */
export function HrTab({ client, view }: { client: Client; view: HrView }) {
  const [year, setYear] = useState(() => Number(kosovoDateISO().slice(0, 4)))
  const employees = useQuery({ queryKey: ['client', client.id, 'employees', year], queryFn: () => fetchEmployees(client.id, year) })
  if (view === 'attendance') return <AttendanceView client={client} />
  if (view === 'leaves') return <LeavesView client={client} year={year} setYear={setYear} list={employees.data ?? []} loading={employees.isLoading} />
  return <EmployeesView client={client} list={employees.data ?? []} loading={employees.isLoading} error={employees.error as Error | null} />
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
function EmployeesView({ client, list, loading, error }: { client: Client; list: Employee[]; loading: boolean; error: Error | null }) {
  const [edit, setEdit] = useState<Partial<Employee> | null>(null)
  const [hist, setHist] = useState<Employee | null>(null)
  const [print, setPrint] = useState<Employee | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [importing, setImporting] = useState(false)
  const shown = list.filter((e) => (showInactive ? true : e.active))
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Punonjësit</h2>
            <p className="text-sm text-muted">Të dhënat personale dhe profesionale, kontrata, orari, paga, historiku dhe kontrata e punës.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Edhe ish-punonjësit
            </label>
            <Button
              variant="secondary"
              disabled={!shown.length}
              onClick={() =>
                void downloadSheets(`punonjesit-${client.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.xlsx`, [
                  {
                    name: 'Punonjësit',
                    columns: ['Emri', 'Mbiemri', 'Nr. personal', 'Datëlindja', 'Adresa', 'Telefoni', 'Pozita', 'Kontrata', 'Fillimi', 'Përfundimi', 'Orë/javë', 'Paga bruto', 'Banka', 'IBAN'],
                    rows: shown.map((e) => [e.first_name, e.last_name, e.personal_no ?? '', e.birth_date ?? '', [e.address, e.city].filter(Boolean).join(', '), e.phone ?? '', e.position ?? '', CONTRACT_LABELS[e.contract], e.start_date, e.end_date ?? '', e.weekly_hours ?? 40, e.gross_salary, e.bank_name ?? '', e.iban ?? '']),
                  },
                ])
              }
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Importo listën
            </Button>
            <Button onClick={() => setEdit({ contract: 'indefinite', primary_job: true, start_date: kosovoDateISO(), gross_salary: 0, emp_pension_pct: 5, er_pension_pct: 5, work_days: 5, weekly_hours: 40, active: true })}>
              <UserPlus className="h-4 w-4" /> Punonjës i ri
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
        ) : error ? (
          <p className="px-5 pb-5 text-sm text-warn-700">{error.message}</p>
        ) : shown.length === 0 ? (
          <EmptyState icon={<UserPlus className="h-6 w-6" />} title="Asnjë punonjës" text="Shto punonjësit me të dhënat e kontratës; pagat, pushimet dhe dokumentet llogariten nga këtu." />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(e)}>
                  <div className="font-semibold text-brand-600 hover:underline">
                    {fullName(e)} {!e.active && <Badge tone="neutral">Joaktiv</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {[e.position, CONTRACT_LABELS[e.contract], `nga ${formatDay(e.start_date)}${e.end_date ? ` deri ${formatDay(e.end_date)}` : ''}`, `${days(e.weekly_hours ?? 40)} orë/javë`, e.phone].filter(Boolean).join(' · ')}
                  </div>
                </button>
                <div className="text-right font-semibold tabular-nums">{formatEUR(e.gross_salary)}</div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" title="Historiku i marrëdhënies së punës" onClick={() => setHist(e)}>
                    <History className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPrint(e)}>
                    <FileSignature className="h-4 w-4" /> <span className="hidden sm:inline">Kontrata</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <EmployeeDialog client={client} value={edit} onClose={() => setEdit(null)} />
      <EmployeeImportDialog client={client} existing={list} open={importing} onClose={() => setImporting(false)} />
      <HistoryDialog employee={hist} onClose={() => setHist(null)} />
      {print && (
        <PrintPortal onDone={() => setPrint(null)}>
          <EmploymentContract client={client} e={print} />
        </PrintPortal>
      )}
    </div>
  )
}

function EmployeeDialog({ client, value, onClose }: { client: Client; value: Partial<Employee> | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<Partial<Employee>>({})
  const [note, setNote] = useState('')
  useEffect(() => {
    if (value) {
      setF(value)
      setNote('')
    }
  }, [value])
  const save = useMutation({
    mutationFn: () => saveEmployee(client.id, { ...f, ...(note.trim() ? ({ history_note: note.trim() } as Partial<Employee>) : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['client', client.id] })
      onClose()
    },
  })
  if (!value) return null
  const s = (k: keyof Employee) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const n = (k: keyof Employee) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })
  const Section = ({ title }: { title: string }) => <div className="mt-2 border-b border-line pb-1 text-sm font-semibold text-muted sm:col-span-2 lg:col-span-3">{title}</div>
  return (
    <Dialog
      open
      onClose={onClose}
      title={f.id ? fullName(f as Employee) : 'Punonjës i ri'}
      width="md:max-w-[980px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {save.error ? <span className="text-sm text-warn-700">{(save.error as Error).message}</span> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Anulo
            </Button>
            <Button loading={save.isPending} disabled={!f.first_name?.trim() || !f.last_name?.trim() || !f.start_date} onClick={() => save.mutate()}>
              Ruaj
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Section title="Të dhënat personale" />
        <Input label="Emri" value={f.first_name ?? ''} onChange={s('first_name')} />
        <Input label="Mbiemri" value={f.last_name ?? ''} onChange={s('last_name')} />
        <Input label="Nr. personal (10 shifra)" inputMode="numeric" maxLength={10} value={f.personal_no ?? ''} onChange={(e) => setF({ ...f, personal_no: e.target.value.replace(/\D/g, '') })} />
        <Input label="Datëlindja" type="date" value={f.birth_date ?? ''} onChange={s('birth_date')} />
        <Select label="Gjinia" value={f.gender ?? ''} onChange={(e) => setF({ ...f, gender: (e.target.value || null) as Employee['gender'] })} options={[{ value: '', label: '—' }, { value: 'F', label: 'Femër' }, { value: 'M', label: 'Mashkull' }]} />
        <Input label="Arsimi" value={f.education ?? ''} onChange={s('education')} />
        <Input label="Adresa (vendbanimi)" value={f.address ?? ''} onChange={s('address')} />
        <Input label="Qyteti" value={f.city ?? ''} onChange={s('city')} />
        <Input label="Profesioni" value={f.profession ?? ''} onChange={s('profession')} />
        <Input label="Telefoni" value={f.phone ?? ''} onChange={s('phone')} />
        <Input label="Email" type="email" value={f.email ?? ''} onChange={s('email')} />

        <Section title="Marrëdhënia e punës" />
        <Input label="Pozita" value={f.position ?? ''} onChange={s('position')} />
        <Select label="Kontrata" value={f.contract ?? 'indefinite'} onChange={(e) => setF({ ...f, contract: e.target.value as Contract })} options={(Object.keys(CONTRACT_LABELS) as Contract[]).map((k) => ({ value: k, label: CONTRACT_LABELS[k] }))} />
        <Input label="Nr. i kontratës" value={f.contract_no ?? ''} onChange={s('contract_no')} />
        <Input label="Data e fillimit" type="date" value={f.start_date ?? ''} onChange={s('start_date')} />
        <Input label="Data e përfundimit" type="date" value={f.end_date ?? ''} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value || null })} />
        <Input label="Puna provuese (muaj, 0–6)" inputMode="numeric" value={f.probation_months ?? ''} onChange={n('probation_months')} />
        <div className="sm:col-span-2 lg:col-span-2">
          <Input label="Vendi i punës (adresa)" value={f.workplace ?? ''} onChange={s('workplace')} placeholder={client.address ?? ''} />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-[15px]">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.primary_job !== false} onChange={(e) => setF({ ...f, primary_job: e.target.checked })} /> Punëdhënës primar
        </label>
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className="mb-1.5 block text-sm font-semibold text-muted">Detyrat dhe përgjegjësitë (një për rresht – hyjnë në kontratë)</span>
          <textarea rows={3} value={f.duties ?? ''} onChange={s('duties')} className="w-full rounded-ctl border border-field px-3 py-2 text-[15px] focus:border-brand-600 focus:outline-none" />
        </label>

        <Section title="Orari i punës" />
        <Select label="Ditë pune në javë" value={String(f.work_days ?? 5)} onChange={(e) => setF({ ...f, work_days: Number(e.target.value) as 5 | 6 })} options={[{ value: '5', label: '5 ditë (e hënë – e premte)' }, { value: '6', label: '6 ditë (e hënë – e shtunë)' }]} />
        <Input label="Orë pune në javë" inputMode="decimal" value={f.weekly_hours ?? ''} onChange={n('weekly_hours')} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Nga ora" type="time" value={f.schedule_from ?? ''} onChange={s('schedule_from')} />
          <Input label="Deri" type="time" value={f.schedule_to ?? ''} onChange={s('schedule_to')} />
        </div>

        <Section title="Paga" />
        <Input label="Paga bruto mujore (€)" inputMode="decimal" value={f.gross_salary ? String(f.gross_salary) : ''} onChange={n('gross_salary')} />
        <Input label="Banka" value={f.bank_name ?? ''} onChange={s('bank_name')} />
        <Input label="IBAN / xhirollogaria" value={f.iban ?? ''} onChange={s('iban')} />

        <Section title="Pushimi vjetor" />
        <Input label="Ditë pushim vjetor (bosh = 20 / 24 sipas ligjit)" inputMode="decimal" value={f.annual_leave_days ?? ''} onChange={n('annual_leave_days')} />
        <Input label="Ditë shtesë (nëna me fëmijë deri 3 vjeç, prind vetushqyes, aftësi e kufizuar: 2)" inputMode="decimal" value={f.extra_leave_days || ''} onChange={n('extra_leave_days')} />
        <Input label="Ditë të bartura nga viti i kaluar" inputMode="decimal" value={f.carried_leave_days || ''} onChange={n('carried_leave_days')} />

        <div className="sm:col-span-2 lg:col-span-3">
          <Input label="Shënim" value={f.note ?? ''} onChange={s('note')} />
        </div>
        {f.id && (
          <>
            <div className="sm:col-span-2">
              <Input label="Shënim për historikun (p.sh. arsyeja e ndryshimit)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-[15px]">
              <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktiv
            </label>
          </>
        )}
      </div>
    </Dialog>
  )
}

function HistoryDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const hist = useQuery({ queryKey: ['employee-history', employee?.id], queryFn: () => fetchHistory(employee!.id), enabled: Boolean(employee) })
  if (!employee) return null
  const fmt = (kind: string, v: string | null) => {
    if (v == null || v === '') return '—'
    if (kind === 'contract') return CONTRACT_LABELS[v as Contract] ?? v
    if (kind === 'salary') return `${v} €`
    if (kind === 'active') return v === 'true' ? 'Aktiv' : 'Joaktiv'
    if (kind === 'start' || kind === 'end') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDay(v) : v
    return v
  }
  return (
    <Dialog open onClose={onClose} title={`Historiku – ${fullName(employee)}`} width="md:max-w-[720px]">
      {hist.data === null ? (
        <p className="text-sm text-warn-700">Kjo kërkon migrimin supabase/migrations/0032_acc_atk_books_hr.sql në Supabase.</p>
      ) : hist.isLoading ? (
        <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
      ) : !hist.data?.length ? (
        <p className="py-6 text-center text-muted">Ende pa ndryshime të regjistruara.</p>
      ) : (
        <ol className="relative ml-2 border-l border-line">
          {hist.data.map((h) => (
            <li key={h.id} className="mb-4 ml-4">
              <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-brand-600" />
              <div className="text-sm text-muted">
                {formatDay(h.change_date)}
                {h.by ? ` · ${h.by}` : ''}
              </div>
              <div className="font-semibold">{HISTORY_LABELS[h.kind] ?? h.kind}</div>
              {h.kind === 'note' ? (
                <div className="text-[15px]">{h.note}</div>
              ) : h.kind === 'start' ? (
                <div className="text-[15px]">{h.new_value}</div>
              ) : (
                <div className="text-[15px]">
                  {fmt(h.kind, h.old_value)} → <b>{fmt(h.kind, h.new_value)}</b>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
function AttendanceView({ client }: { client: Client }) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => monthStart())
  const [brush, setBrush] = useState<AttStatus | null>('present')
  const data = useQuery({ queryKey: ['client', client.id, 'attendance', month], queryFn: () => fetchAttendance(client.id, month) })
  const mark = useMutation({
    mutationFn: (marks: Parameters<typeof setAttendance>[1]) => setAttendance(client.id, marks),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['client', client.id, 'attendance', month] }),
  })
  const year = Number(month.slice(0, 4))
  const hol = holidays(year)
  const last = Number(addDay(addMonths(month, 1), -1).slice(8, 10))
  const dates = Array.from({ length: last }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)
  const rows = data.data ?? []

  /** What a day shows: the mark, else the leave, else holiday / weekly rest. */
  const shownOf = (r: (typeof rows)[number], d: string): { status: AttStatus | null; auto: boolean } => {
    const m = r.days[d]
    if (m) return { status: m.status, auto: false }
    if (d < r.start_date || (r.end_date && d > r.end_date)) return { status: null, auto: true }
    const lv = r.leaves.find((l) => l.from_date <= d && l.to_date >= d)
    if (lv && isWorkingDay(d, r.work_days)) return { status: lv.kind === 'sick' || lv.kind === 'sick_work' ? 'sick' : 'leave', auto: true }
    if (hol.has(d)) return { status: 'holiday', auto: true }
    if (!isWorkingDay(d, r.work_days)) return { status: 'off', auto: true }
    return { status: null, auto: true }
  }

  const fillMonth = () => {
    const marks: Parameters<typeof setAttendance>[1] = []
    for (const r of rows)
      for (const d of dates) {
        const s = shownOf(r, d)
        if (s.auto && s.status === null && d >= r.start_date && (!r.end_date || d <= r.end_date) && d <= kosovoDateISO())
          marks.push({ employee_id: r.employee_id, day: d, status: 'present', hours: Math.round((r.weekly_hours / r.work_days) * 10) / 10 })
      }
    if (marks.length) mark.mutate(marks)
  }

  const summary = (r: (typeof rows)[number]) => {
    const c: Record<string, number> = {}
    let hours = 0
    for (const d of dates) {
      const s = shownOf(r, d).status
      if (s) c[s] = (c[s] ?? 0) + 1
      const h = r.days[d]?.hours
      if (h != null) hours += h
      else if (s === 'present' || s === 'late') hours += r.weekly_hours / r.work_days
    }
    return { ...c, hours: Math.round(hours * 10) / 10 }
  }

  const xlsx = () =>
    downloadSheets(`vijueshmeria-${client.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${month.slice(0, 7)}.xlsx`, [
      {
        name: 'Vijueshmëria',
        columns: ['Punonjësi', ...dates.map((d) => d.slice(8, 10)), 'Prezent', 'Vonesë', 'Mungesë', 'Pushim', 'Mjekësor', 'Orë'],
        rows: rows.map((r) => {
          const s = summary(r) as Record<string, number>
          return [r.name, ...dates.map((d) => (shownOf(r, d).status ? ATT[shownOf(r, d).status!].short : '')), s.present ?? 0, s.late ?? 0, s.absent ?? 0, s.leave ?? 0, s.sick ?? 0, s.hours]
        }),
      },
    ])

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
            <button type="button" aria-label="Muaji i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[140px] px-2 text-center font-semibold">{monthName(month)}</span>
            <button type="button" aria-label="Muaji tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!rows.length} loading={mark.isPending} onClick={fillMonth} title="Shënon 'Prezent' në ditët e punës deri sot që janë ende bosh">
              <CalendarCheck className="h-4 w-4" /> Mbush ditët e punës
            </Button>
            <Button variant="secondary" disabled={!rows.length} onClick={() => void xlsx()}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Kliko ditën për të shënuar:</span>
          {(Object.keys(ATT) as AttStatus[]).map((k) => (
            <button key={k} type="button" onClick={() => setBrush(k)} className={cn('h-9 rounded-full border px-3 font-semibold', brush === k ? 'border-brand-600 ring-2 ring-brand-100' : 'border-line', ATT[k].cls)}>
              {ATT[k].short} · {ATT[k].label}
            </button>
          ))}
          <button type="button" onClick={() => setBrush(null)} className={cn('h-9 rounded-full border px-3 font-semibold text-muted', brush === null ? 'border-brand-600 ring-2 ring-brand-100' : 'border-line')}>
            Fshi shënimin
          </button>
        </div>
        {mark.error && <p className="mt-2 text-sm text-warn-700">{(mark.error as Error).message}</p>}
      </Card>
      <Card className="overflow-hidden">
        {data.isLoading ? (
          <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
        ) : data.error ? (
          <p className="p-5 text-sm text-warn-700">{(data.error as Error).message}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title="Asnjë punonjës këtë muaj" text="Shto punonjësit te Punonjësit." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead className="bg-[#F6F8FB] text-muted">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[160px] bg-[#F6F8FB] px-3 py-2 text-left font-medium">Punonjësi</th>
                  {dates.map((d) => (
                    <th key={d} className={cn('w-8 px-0.5 py-2 text-center font-medium', !isWorkingDay(d, 5) && 'text-[#B5BCC7]')} title={hol.get(d)}>
                      {Number(d.slice(8, 10))}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">P</th>
                  <th className="px-2 py-2 text-right font-medium">M</th>
                  <th className="px-2 py-2 text-right font-medium">PV/S</th>
                  <th className="px-3 py-2 text-right font-medium">Orë</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sm = summary(r) as Record<string, number>
                  return (
                    <tr key={r.employee_id} className="border-t border-line">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-semibold">{r.name}</td>
                      {dates.map((d) => {
                        const s = shownOf(r, d)
                        const outside = d < r.start_date || (r.end_date != null && d > r.end_date)
                        return (
                          <td key={d} className="px-0.5 py-1 text-center">
                            <button
                              type="button"
                              disabled={outside || mark.isPending}
                              onClick={() => mark.mutate([{ employee_id: r.employee_id, day: d, status: brush }])}
                              title={s.status ? `${ATT[s.status].label}${s.auto ? ' (nga kalendari / pushimet)' : ''}` : 'Pa shënim'}
                              className={cn('h-7 w-7 rounded text-[11px] font-semibold', s.status ? ATT[s.status].cls : 'border border-dashed border-line', s.auto && s.status && 'opacity-60', outside && 'invisible')}
                            >
                              {s.status ? ATT[s.status].short : ''}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-2 text-right tabular-nums">{(sm.present ?? 0) + (sm.late ?? 0)}</td>
                      <td className="px-2 text-right tabular-nums text-warn-700">{sm.absent ?? 0}</td>
                      <td className="px-2 text-right tabular-nums">{(sm.leave ?? 0) + (sm.sick ?? 0)}</td>
                      <td className="px-3 text-right tabular-nums">{sm.hours}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">Pushimet e regjistruara dhe festat zyrtare shfaqen vetë (më të zbehta). Bajramet dhe Pashkët ndryshojnë çdo vit – shënoji me "F".</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------
type PrintDoc = { kind: 'decision'; e: Employee; leave: Leave } | { kind: 'report'; e: Employee } | { kind: 'all' }

function LeavesView({ client, year, setYear, list, loading }: { client: Client; year: number; setYear: (y: number) => void; list: Employee[]; loading: boolean }) {
  const qc = useQueryClient()
  const [add, setAdd] = useState<{ employee_id?: string } | null>(null)
  const [print, setPrint] = useState<PrintDoc | null>(null)
  const active = list.filter((e) => e.active || e.leaves.length)
  const del = useMutation({ mutationFn: deleteLeave, onSuccess: () => void qc.invalidateQueries({ queryKey: ['client', client.id] }) })

  const planXlsx = () => {
    // "Tabela e pushimit vjetor": employees down, the days of the year across, "P" on the days of annual leave
    const all: string[] = []
    for (let d = `${year}-01-01`; d <= `${year}-12-31`; d = addDay(d, 1)) all.push(d)
    return downloadSheets(`tabela-e-pushimit-vjetor-${year}-${client.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.xlsx`, [
      {
        name: `Pushimi vjetor ${year}`,
        columns: ['Punëtori', ...all.map((d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`), 'Ditë'],
        rows: active.map((e) => {
          const ann = e.leaves.filter((l) => l.kind === 'annual')
          return [fullName(e), ...all.map((d) => (ann.some((l) => l.from_date <= d && l.to_date >= d) && isWorkingDay(d, e.work_days ?? 5) ? 'P' : '')), ann.reduce((a, l) => a + l.days, 0)]
        }),
      },
    ])
  }

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
            <button type="button" aria-label="Viti i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setYear(year - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[90px] px-2 text-center font-semibold">{year}</span>
            <button type="button" aria-label="Viti tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setYear(year + 1)}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!active.length} onClick={() => setPrint({ kind: 'all' })}>
              <Printer className="h-4 w-4" /> Raporti i pushimeve
            </Button>
            <Button variant="secondary" disabled={!active.length} onClick={() => void planXlsx()} title="Tabela e pushimit vjetor (punëtorët × ditët e vitit)">
              <FileSpreadsheet className="h-4 w-4" /> Tabela e pushimit vjetor
            </Button>
            <Button disabled={!active.length} onClick={() => setAdd({})}>
              <Plus className="h-4 w-4" /> Shto pushim
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
        ) : active.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title="Asnjë punonjës" text="Shto punonjësit te Punonjësit." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[#F6F8FB] text-left text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Punonjësi</th>
                  <th className="px-2 py-2 text-right font-medium">Të fituara</th>
                  <th className="px-2 py-2 text-right font-medium">Të bartura</th>
                  <th className="px-2 py-2 text-right font-medium">Të shfrytëzuara</th>
                  <th className="px-2 py-2 text-right font-medium">Të mbetura</th>
                  <th className="px-2 py-2 text-right font-medium">Mjekësor</th>
                  <th className="px-2 py-2 text-right font-medium">Të tjera</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {active.map((e) => {
                  const ent = entitlement(e, year, e.leaves)
                  const sick = (ent.other.sick ?? 0) + (ent.other.sick_work ?? 0)
                  const other = Object.entries(ent.other).filter(([k]) => k !== 'sick' && k !== 'sick_work').reduce((a, [, v]) => a + (v ?? 0), 0)
                  const yearLeaves = e.leaves.filter((l) => l.from_date.slice(0, 4) === String(year)).sort((a, b) => b.from_date.localeCompare(a.from_date))
                  return (
                    <Fragment key={e.id}>
                      <tr className="border-t border-line">
                        <td className="px-5 py-2.5">
                          <div className="font-semibold">{fullName(e)}</div>
                          <div className="text-xs text-muted">
                            {ent.base} + {ent.seniority} përvojë{ent.extra ? ` + ${days(ent.extra)} shtesë` : ''}
                            {ent.months < 12 ? ` · ${ent.months} muaj pune` : ''}
                          </div>
                        </td>
                        <td className="px-2 text-right tabular-nums">{days(ent.earned)}</td>
                        <td className="px-2 text-right tabular-nums">{days(ent.carried)}</td>
                        <td className="px-2 text-right tabular-nums">{days(ent.used)}</td>
                        <td className={cn('px-2 text-right font-bold tabular-nums', ent.remaining < 0 && 'text-warn-700')}>{days(ent.remaining)}</td>
                        <td className="px-2 text-right tabular-nums">{days(sick)}</td>
                        <td className="px-2 text-right tabular-nums">{days(other)}</td>
                        <td className="px-5 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="secondary" onClick={() => setAdd({ employee_id: e.id })}>
                              <Plus className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="secondary" title="Raporti i pushimeve" onClick={() => setPrint({ kind: 'report', e })}>
                              <FileText className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {yearLeaves.map((l) => (
                        <tr key={l.id} className="bg-[#FAFBFC] text-[13px]">
                          <td className="py-1.5 pl-9 pr-2 text-muted" colSpan={4}>
                            {LEAVE_LABELS[l.kind]} · {formatDay(l.from_date)} – {formatDay(l.to_date)} · {days(l.days)} ditë
                            {l.decision_no ? ` · vendimi ${l.decision_no}` : ''}
                            {l.note ? ` · ${l.note}` : ''}
                          </td>
                          <td colSpan={4} className="px-5 text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setPrint({ kind: 'decision', e, leave: l })}>
                                <Printer className="h-4 w-4" /> Vendimi
                              </Button>
                              <button type="button" aria-label="Fshi" onClick={() => confirm('Ta fshij këtë pushim?') && del.mutate(l.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">
        Pushimi vjetor: së paku 4 javë (20 ditë pune për 5 ditë në javë, 24 për 6), 1 ditë shtesë për çdo 5 vjet përvojë te punëdhënësi, ditët shtesë të punonjësit; proporcionalisht me muajt e punës në vit. Festat zyrtare nuk llogariten si ditë pushimi.
      </p>

      <LeaveDialog client={client} list={active} value={add} year={year} onClose={() => setAdd(null)} onSaved={(e, leave) => { setAdd(null); if (leave.kind !== 'other') setPrint({ kind: 'decision', e, leave }) }} />
      {print && (
        <PrintPortal onDone={() => setPrint(null)}>
          {print.kind === 'decision' ? (
            <LeaveDecision client={client} e={print.e} leave={print.leave} ent={entitlement(print.e, Number(print.leave.from_date.slice(0, 4)), print.e.leaves.some((l) => l.id === print.leave.id) ? print.e.leaves : [...print.e.leaves, print.leave])} />
          ) : print.kind === 'report' ? (
            <LeaveReport client={client} e={print.e} year={year} />
          ) : (
            <LeaveReportAll client={client} list={active} year={year} />
          )}
        </PrintPortal>
      )}
    </div>
  )
}

function LeaveDialog({ client, list, value, year, onClose, onSaved }: { client: Client; list: Employee[]; value: { employee_id?: string } | null; year: number; onClose: () => void; onSaved: (e: Employee, l: Leave) => void }) {
  const qc = useQueryClient()
  const today = kosovoDateISO()
  const [f, setF] = useState({ employee_id: '', kind: 'annual' as LeaveKind, from_date: today, to_date: today, days: '1', decision_no: '', decision_date: today, note: '', printNow: true })
  const emp = list.find((e) => e.id === f.employee_id)
  const auto = useMemo(() => (emp ? workingDays(f.from_date, f.to_date, emp.work_days ?? 5) : 0), [emp, f.from_date, f.to_date])

  useEffect(() => {
    if (!value) return
    setF({ employee_id: value.employee_id ?? list[0]?.id ?? '', kind: 'annual', from_date: today, to_date: today, days: '1', decision_no: '', decision_date: today, note: '', printNow: true })
    void nextDecisionNo(client.id, year).then((no) => setF((x) => ({ ...x, decision_no: no })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  useEffect(() => setF((x) => ({ ...x, days: String(auto || 1) })), [auto])

  const save = useMutation({
    mutationFn: async () => {
      const l = { employee_id: f.employee_id, kind: f.kind, from_date: f.from_date, to_date: f.to_date, days: Number(f.days.replace(',', '.')), note: f.note.trim() || null, decision_no: f.decision_no.trim() || null, decision_date: f.decision_date || null }
      const id = await saveLeaveFull(l)
      return { ...l, id } as Leave
    },
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ['client', client.id] })
      if (f.printNow && emp) onSaved(emp, l)
      else onClose()
    },
  })
  if (!value) return null
  const ent = emp ? entitlement(emp, Number(f.from_date.slice(0, 4)), emp.leaves) : null
  return (
    <Dialog
      open
      onClose={onClose}
      title="Shto pushim"
      width="md:max-w-[620px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {save.error ? <span className="text-sm text-warn-700">{(save.error as Error).message}</span> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Anulo
            </Button>
            <Button loading={save.isPending} disabled={!f.employee_id || !(Number(f.days.replace(',', '.')) > 0) || f.to_date < f.from_date} onClick={() => save.mutate()}>
              Ruaj
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Select label="Punonjësi" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} options={list.map((e) => ({ value: e.id, label: fullName(e) }))} />
        </div>
        <div className="sm:col-span-2">
          <Select label="Lloji i pushimit" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LeaveKind })} options={(Object.keys(LEAVE_LABELS) as LeaveKind[]).map((k) => ({ value: k, label: LEAVE_LABELS[k] }))} />
        </div>
        <Input label="Nga" type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: e.target.value > f.to_date ? e.target.value : f.to_date })} />
        <Input label="Deri" type="date" value={f.to_date} min={f.from_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} />
        <Input label={`Ditë pune${auto ? ` (llogaritur: ${auto})` : ''}`} inputMode="decimal" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
        <div className="self-end pb-2 text-sm text-muted">
          {f.kind === 'annual' && ent && (
            <>
              Të mbetura: <b className={cn(ent.remaining - Number(f.days.replace(',', '.')) < 0 && 'text-warn-700')}>{days(ent.remaining)}</b> → {days(ent.remaining - (Number(f.days.replace(',', '.')) || 0))} ditë
            </>
          )}
        </div>
        <Input label="Nr. i vendimit" value={f.decision_no} onChange={(e) => setF({ ...f, decision_no: e.target.value })} />
        <Input label="Data e vendimit" type="date" value={f.decision_date} onChange={(e) => setF({ ...f, decision_date: e.target.value })} />
        <div className="sm:col-span-2">
          <Input label="Shënim" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-[15px] sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.printNow} onChange={(e) => setF({ ...f, printNow: e.target.checked })} /> Printo vendimin pas ruajtjes
        </label>
        {f.kind === 'annual' && auto > 0 && auto < 10 && (
          <p className="text-xs text-muted sm:col-span-2">Punëtori duhet të marrë së paku 10 ditë të njëpasnjëshme pushim vjetor gjatë vitit (pjesa tjetër mund të ndahet).</p>
        )}
      </div>
    </Dialog>
  )
}
