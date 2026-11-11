// Employees, leaves and payroll (0020). Kosovo: pension 5% + 5% (Trust), monthly wage tax on
// (gross − employee contribution): primary employer 0% to 250 €, 8% 250–450 €, 10% above; secondary 10%.
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}
const n = (v: unknown) => (v == null ? 0 : Number(v))
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Same as the database (acc_wage_tax), for the preview in forms. */
export function wageTax(base: number, primary: boolean): number {
  return primary ? r2(Math.max(Math.min(base, 450) - 250, 0) * 0.08 + Math.max(base - 450, 0) * 0.1) : r2(Math.max(base, 0) * 0.1)
}

export function salaryPreview(gross: number, empPct: number, erPct: number, primary: boolean) {
  const emp = r2((gross * empPct) / 100)
  const er = r2((gross * erPct) / 100)
  const tax = wageTax(gross - emp, primary)
  return { emp, er, tax, net: r2(gross - emp - tax), cost: r2(gross + er) }
}

export type Contract = 'indefinite' | 'fixed' | 'part_time' | 'service'
export const CONTRACT_LABELS: Record<Contract, string> = { indefinite: 'Me kohë të pacaktuar', fixed: 'Me kohë të caktuar', part_time: 'Me kohë të pjesshme', service: 'Kontratë shërbimi' }
export type LeaveKind = 'annual' | 'sick' | 'unpaid' | 'maternity' | 'other'
export const LEAVE_LABELS: Record<LeaveKind, string> = { annual: 'Pushim vjetor', sick: 'Pushim mjekësor', unpaid: 'Pushim pa pagesë', maternity: 'Lehonie', other: 'Tjetër' }

export interface Leave {
  id: string
  employee_id: string
  kind: LeaveKind
  from_date: string
  to_date: string
  days: number
  note: string | null
}

export interface Employee {
  id: string
  first_name: string
  last_name: string
  personal_no: string | null
  position: string | null
  start_date: string
  end_date: string | null
  contract: Contract
  primary_job: boolean
  gross_salary: number
  emp_pension_pct: number
  er_pension_pct: number
  iban: string | null
  email: string | null
  phone: string | null
  note: string | null
  active: boolean
  leave_days: Partial<Record<LeaveKind, number>>
  leaves: Leave[]
}

export async function fetchEmployees(clientId: string, year?: number): Promise<Employee[]> {
  const { data, error } = await supabase.rpc('acc_employees_list', { p_client: clientId, p_year: year ?? null })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((e) => ({
    ...(e as unknown as Employee),
    gross_salary: n(e.gross_salary),
    emp_pension_pct: n(e.emp_pension_pct),
    er_pension_pct: n(e.er_pension_pct),
    leave_days: Object.fromEntries(Object.entries((e.leave_days as Record<string, unknown>) ?? {}).map(([k, v]) => [k, n(v)])),
    leaves: ((e.leaves as Record<string, unknown>[]) ?? []).map((l) => ({ ...(l as unknown as Leave), days: n(l.days) })),
  }))
}

export async function saveEmployee(clientId: string, e: Partial<Employee>): Promise<void> {
  const { leave_days: _ld, leaves: _l, ...rest } = e
  void _ld
  void _l
  const { error } = await supabase.rpc('acc_save_employee', { p: { ...rest, client_id: clientId } })
  if (error) fail(error)
}

export async function saveLeave(l: Omit<Leave, 'id'>): Promise<void> {
  const { error } = await supabase.rpc('acc_save_leave', { p: l })
  if (error) fail(error)
}

export async function deleteLeave(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_leave', { p_id: id })
  if (error) fail(error)
}

export interface PayrollLine {
  id: string
  employee_id: string
  name: string
  personal_no: string | null
  position: string | null
  iban: string | null
  primary_job: boolean
  base_salary: number
  unpaid_days: number
  bonus: number
  advance: number
  gross: number
  emp_pct: number
  er_pct: number
  emp_contrib: number
  er_contrib: number
  tax_base: number
  tax: number
  net: number
  payable: number
}

export interface PayrollRun {
  id: string
  month: string
  working_days: number
  status: 'draft' | 'confirmed' | 'filed'
  filed_at: string | null
  reference: string | null
  paid_at: string | null
  lines: PayrollLine[]
}

const NUMS = ['base_salary', 'unpaid_days', 'bonus', 'advance', 'gross', 'emp_pct', 'er_pct', 'emp_contrib', 'er_contrib', 'tax_base', 'tax', 'net', 'payable'] as const

export async function fetchPayroll(clientId: string, month: string): Promise<PayrollRun | null> {
  const { data, error } = await supabase.rpc('acc_payroll', { p_client: clientId, p_month: month })
  if (error) fail(error)
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    ...(r as unknown as PayrollRun),
    month: String(r.month).slice(0, 10),
    working_days: n(r.working_days),
    lines: ((r.lines as Record<string, unknown>[]) ?? []).map((l) => {
      const x = { ...(l as unknown as PayrollLine) }
      for (const k of NUMS) (x as unknown as Record<string, number>)[k] = n(l[k])
      return x
    }),
  }
}

export async function preparePayroll(clientId: string, month: string, workingDays?: number): Promise<void> {
  const { error } = await supabase.rpc('acc_payroll_prepare', { p_client: clientId, p_month: month, p_working_days: workingDays ?? null })
  if (error) fail(error)
}

export async function updatePayrollLine(lineId: string, p: Partial<Pick<PayrollLine, 'bonus' | 'advance' | 'unpaid_days' | 'base_salary'>>): Promise<void> {
  const { error } = await supabase.rpc('acc_payroll_update_line', { p_line: lineId, p })
  if (error) fail(error)
}

export async function setPayrollStatus(runId: string, p: { status: PayrollRun['status']; filed_at?: string; reference?: string; paid_at?: string }): Promise<void> {
  const { error } = await supabase.rpc('acc_payroll_set_status', { p_run: runId, p })
  if (error) fail(error)
}

export interface PayrollMonth {
  month: string
  status: PayrollRun['status']
  filed_at: string | null
  employees: number
  gross: number
  tax: number
  contrib: number
  net: number
}

export async function fetchPayrollYear(clientId: string, year: number): Promise<PayrollMonth[]> {
  const { data, error } = await supabase.rpc('acc_payroll_year', { p_client: clientId, p_year: year })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((m) => ({ ...(m as unknown as PayrollMonth), month: String(m.month).slice(0, 10), employees: n(m.employees), gross: n(m.gross), tax: n(m.tax), contrib: n(m.contrib), net: n(m.net) }))
}
