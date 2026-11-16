// Human resources (0032): leave entitlement, working days, attendance, history of the employment relation.
import { supabase } from '@/lib/supabase'
import type { Employee, Leave, LeaveKind } from './payroll'

const missing = (code?: string) => ['PGRST202', '42883', '42P01', 'PGRST205'].includes(code ?? '')
const NEEDS = 'Kjo kërkon migrimin supabase/migrations/0032_acc_atk_books_hr.sql në Supabase.'
function fail(error: { code?: string; message: string }): never {
  if (missing(error.code)) throw new Error(NEEDS)
  throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Calendar: official holidays (fixed dates) and working days
// ---------------------------------------------------------------------------
/** Fixed official holidays of Kosovo. Bajrams and Easter change every year: adjust the days when they fall in a leave. */
const FIXED_HOLIDAYS: [string, string][] = [
  ['01-01', 'Viti i Ri'],
  ['01-02', 'Viti i Ri (dita e dytë)'],
  ['01-07', 'Krishtlindjet Ortodokse'],
  ['02-17', 'Dita e Pavarësisë'],
  ['04-09', 'Dita e Kushtetutës'],
  ['05-01', 'Dita Ndërkombëtare e Punës'],
  ['05-09', 'Dita e Evropës'],
  ['12-25', 'Krishtlindjet Katolike'],
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (s: string) => new Date(`${s}T00:00:00Z`)
export const addDay = (s: string, n: number) => {
  const d = day(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** Holidays of a year; one that falls on a Sunday moves to Monday. */
export function holidays(year: number): Map<string, string> {
  const m = new Map<string, string>()
  for (const [md, name] of FIXED_HOLIDAYS) {
    let d = `${year}-${md}`
    if (day(d).getUTCDay() === 0) d = addDay(d, 1)
    while (m.has(d)) d = addDay(d, 1)
    m.set(d, name)
  }
  return m
}

export function isWorkingDay(d: string, workDays: 5 | 6): boolean {
  const wd = day(d).getUTCDay()
  if (wd === 0 || (workDays === 5 && wd === 6)) return false
  return !holidays(Number(d.slice(0, 4))).has(d)
}

/** Working days between two dates (inclusive), without the weekly rest days and the official holidays. */
export function workingDays(from: string, to: string, workDays: 5 | 6): number {
  if (!from || !to || to < from) return 0
  let n = 0
  for (let d = from; d <= to; d = addDay(d, 1)) if (isWorkingDay(d, workDays)) n++
  return n
}

/** The first working day after the leave (the day to come back). */
export function returnDay(to: string, workDays: 5 | 6): string {
  let d = addDay(to, 1)
  for (let i = 0; i < 20 && !isWorkingDay(d, workDays); i++) d = addDay(d, 1)
  return d
}

// ---------------------------------------------------------------------------
// Annual leave entitlement
// ---------------------------------------------------------------------------
export interface Entitlement {
  base: number
  seniority: number
  extra: number
  /** For a year not worked in full: share of the months worked. */
  months: number
  earned: number
  carried: number
  available: number
  used: number
  remaining: number
  other: Partial<Record<LeaveKind, number>>
}

/**
 * Annual leave of a year: at least 4 weeks (20 working days for a 5-day week, 24 for a 6-day week, unless set
 * by contract), one more day for every 5 years of service with the employer, the extra days of the employee
 * (mothers of children up to 3, single parents, persons with disabilities: +2), proportional to the months worked
 * in that year, plus the days carried over from the year before.
 */
export function entitlement(e: Employee, year: number, leaves: Leave[]): Entitlement {
  const wd = e.work_days ?? 5
  const base = e.annual_leave_days ?? (wd === 6 ? 24 : 20)
  const endOfYear = `${year}-12-31`
  const years = e.start_date ? Math.max(0, Math.floor((day(endOfYear).getTime() - day(e.start_date).getTime()) / (365.25 * 86400000))) : 0
  const seniority = Math.floor(years / 5)
  const extra = e.extra_leave_days ?? 0
  const start = e.start_date > `${year}-01-01` ? e.start_date : `${year}-01-01`
  const end = e.end_date && e.end_date < endOfYear ? e.end_date : endOfYear
  // months worked in the year: a started month counts from the 15th on, a last month when worked up to the 15th
  const months =
    start > end
      ? 0
      : Math.max(
          0,
          Math.min(
            12,
            Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1 - (Number(start.slice(8, 10)) > 15 ? 1 : 0) - (Number(end.slice(8, 10)) < 15 ? 1 : 0),
          ),
        )
  const full = base + seniority + extra
  const earned = months >= 12 ? full : Math.round(((full * months) / 12) * 2) / 2
  const carried = e.carried_leave_days ?? 0
  const inYear = leaves.filter((l) => l.from_date.slice(0, 4) === String(year))
  const used = inYear.filter((l) => l.kind === 'annual').reduce((a, l) => a + l.days, 0)
  const other: Partial<Record<LeaveKind, number>> = {}
  for (const l of inYear) if (l.kind !== 'annual') other[l.kind] = (other[l.kind] ?? 0) + l.days
  return { base, seniority, extra, months, earned, carried, available: earned + carried, used, remaining: earned + carried - used, other }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export async function saveLeaveFull(l: Omit<Leave, 'id'> & { id?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('acc_save_leave', { p: l })
  if (error) fail(error)
  return data as string
}

export async function nextDecisionNo(clientId: string, year: number): Promise<string> {
  const { data, error } = await supabase.rpc('acc_next_leave_decision_no', { p_client: clientId, p_year: year })
  if (error) return `1/${year}`
  return data as string
}

export interface HistoryEntry {
  id: string
  change_date: string
  kind: string
  old_value: string | null
  new_value: string | null
  note: string | null
  by: string | null
}

export const HISTORY_LABELS: Record<string, string> = {
  start: 'Fillimi i punës',
  position: 'Pozita',
  salary: 'Paga bruto',
  contract: 'Lloji i kontratës',
  schedule: 'Orari (orë/javë, ditë/javë, nga–deri)',
  end: 'Përfundimi i marrëdhënies së punës',
  active: 'Statusi',
  note: 'Shënim',
}

export async function fetchHistory(employeeId: string): Promise<HistoryEntry[] | null> {
  const { data, error } = await supabase.rpc('acc_employee_history_list', { p_employee: employeeId })
  if (error) {
    if (missing(error.code)) return null
    fail(error)
  }
  return (data as HistoryEntry[]) ?? []
}

export type AttStatus = 'present' | 'absent' | 'late' | 'leave' | 'sick' | 'holiday' | 'off'
export const ATT: Record<AttStatus, { short: string; label: string; cls: string }> = {
  present: { short: 'P', label: 'Prezent', cls: 'bg-brand-100 text-brand-600' },
  late: { short: 'V', label: 'Me vonesë', cls: 'bg-amber-100 text-amber-700' },
  absent: { short: 'M', label: 'Mungesë', cls: 'bg-warn-100 text-warn-700' },
  leave: { short: 'PV', label: 'Pushim', cls: 'bg-[#E0ECFF] text-bt-600' },
  sick: { short: 'S', label: 'Pushim mjekësor', cls: 'bg-[#F3E8FF] text-[#7E22CE]' },
  holiday: { short: 'F', label: 'Festë zyrtare', cls: 'bg-bg text-muted' },
  off: { short: 'J', label: 'Pushim javor', cls: 'bg-bg text-muted' },
}

export interface AttendanceRow {
  employee_id: string
  name: string
  position: string | null
  work_days: 5 | 6
  weekly_hours: number
  start_date: string
  end_date: string | null
  days: Record<string, { status: AttStatus; hours: number | null; note: string | null }>
  leaves: { kind: LeaveKind; from_date: string; to_date: string }[]
}

export async function fetchAttendance(clientId: string, month: string): Promise<AttendanceRow[]> {
  const { data, error } = await supabase.rpc('acc_attendance_month', { p_client: clientId, p_month: month })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    ...(r as unknown as AttendanceRow),
    work_days: r.work_days === 6 ? 6 : 5,
    weekly_hours: Number(r.weekly_hours) || 40,
    days: Object.fromEntries(
      Object.entries((r.days as Record<string, { status: AttStatus; hours: unknown; note: string | null }>) ?? {}).map(([k, v]) => [k, { status: v.status, hours: v.hours == null ? null : Number(v.hours), note: v.note ?? null }]),
    ),
  }))
}

export async function setAttendance(clientId: string, marks: { employee_id: string; day: string; status: AttStatus | null; hours?: number | null }[]): Promise<void> {
  const { error } = await supabase.rpc('acc_attendance_set', { p_client: clientId, p: marks })
  if (error) fail(error)
}

export const fullName = (e: Pick<Employee, 'first_name' | 'last_name'>) => `${e.first_name} ${e.last_name}`
