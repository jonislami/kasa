// The office's own work with its clients (0023): contracts and fees, office invoices, tasks, document requests, notes.
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}
const n = (v: unknown) => (v == null ? 0 : Number(v))
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) fail(error)
  return data as T
}

// ---------------------------------------------------------------------------
// Office profile
// ---------------------------------------------------------------------------
export interface OfficeProfile {
  office_name: string | null
  nui: string | null
  vat_no: string | null
  address: string | null
  city: string | null
  email: string | null
  phone: string | null
  bank: string | null
  iban: string | null
}
export const fetchOfficeProfile = () => rpc<OfficeProfile>('acc_office_profile')
export const saveOfficeProfile = (p: Partial<OfficeProfile>) => rpc<void>('acc_office_profile_save', { p })

// ---------------------------------------------------------------------------
// Contracts and billing
// ---------------------------------------------------------------------------
export interface Contract {
  id: string
  client_id: string
  start_date: string
  end_date: string | null
  monthly_fee: number
  vat_rate: number
  services: string | null
  billing_day: number
  payment_days: number
  active: boolean
  note: string | null
}

export interface ContractRow {
  client_id: string
  client_name: string
  client_nui: string | null
  client_active: boolean
  contract: Contract | null
  open: number
  overdue: number
  last_invoice: string | null
}

const toContract = (c: Record<string, unknown> | null): Contract | null =>
  c ? { ...(c as unknown as Contract), monthly_fee: n(c.monthly_fee), vat_rate: n(c.vat_rate), billing_day: n(c.billing_day), payment_days: n(c.payment_days) } : null

export async function fetchContracts(): Promise<ContractRow[]> {
  const rows = await rpc<Record<string, unknown>[]>('acc_contracts_list')
  return (rows ?? []).map((r) => ({ ...(r as unknown as ContractRow), contract: toContract(r.contract as Record<string, unknown> | null), open: n(r.open), overdue: n(r.overdue) }))
}
export const saveContract = (p: Partial<Contract> & { client_id: string }) => rpc<string>('acc_contract_save', { p })
export const deleteContract = (clientId: string) => rpc<void>('acc_contract_delete', { p_client: clientId })

export interface OfficePayment {
  id: string
  pay_date: string
  amount: number
  method: 'cash' | 'bank'
  note: string | null
}

export interface OfficeInvoice {
  id: string
  client_id: string | null
  client_name: string
  client_nui: string | null
  inv_no: string
  issue_date: string
  due_date: string | null
  period: string | null
  description: string
  vat_rate: number
  net: number
  vat: number
  total: number
  paid: number
  status: 'open' | 'paid' | 'cancelled'
  note: string | null
  payments: OfficePayment[]
}

export async function fetchOfficeInvoices(from: string, to: string): Promise<OfficeInvoice[]> {
  const rows = await rpc<Record<string, unknown>[]>('acc_office_invoices_list', { p_from: from, p_to: to })
  return (rows ?? []).map((i) => ({
    ...(i as unknown as OfficeInvoice),
    vat_rate: n(i.vat_rate),
    net: n(i.net),
    vat: n(i.vat),
    total: n(i.total),
    paid: n(i.paid),
    payments: ((i.payments as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as OfficePayment), amount: n(x.amount) })),
  }))
}
export const billMonth = (month: string) => rpc<number>('acc_office_bill_month', { p_month: month })
export const saveOfficeInvoice = (p: { client_id: string; issue_date?: string; due_date?: string | null; description: string; total: number; vat_rate: number; note?: string }) =>
  rpc<{ id: string; inv_no: string }>('acc_office_invoice_save', { p })
export const cancelOfficeInvoice = (id: string) => rpc<void>('acc_office_invoice_cancel', { p_id: id })
export const addOfficePayment = (p: { invoice_id: string; pay_date?: string; amount?: number; method?: 'cash' | 'bank'; note?: string }) => rpc<void>('acc_office_payment_add', { p })
export const deleteOfficePayment = (id: string) => rpc<void>('acc_office_payment_delete', { p_id: id })

export interface ClientContract {
  contract: Contract | null
  open: number
  invoices: { id: string; inv_no: string; issue_date: string; due_date: string | null; total: number; paid: number; status: OfficeInvoice['status']; description: string }[]
}
export async function fetchClientContract(clientId: string): Promise<ClientContract | null> {
  const r = await rpc<Record<string, unknown> | null>('acc_client_contract', { p_client: clientId })
  if (!r) return null
  return {
    contract: toContract(r.contract as Record<string, unknown> | null),
    open: n(r.open),
    invoices: ((r.invoices as Record<string, unknown>[]) ?? []).map((i) => ({ ...(i as unknown as ClientContract['invoices'][number]), total: n(i.total), paid: n(i.paid) })),
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export type TaskStatus = 'todo' | 'doing' | 'done'
export type Priority = 'low' | 'normal' | 'high'
export const TASK_STATUS: Record<TaskStatus, string> = { todo: 'Për t’u bërë', doing: 'Në punë', done: 'E kryer' }
export const PRIORITY: Record<Priority, string> = { low: 'E ulët', normal: 'Normale', high: 'E lartë' }

export interface Task {
  id: string
  client_id: string | null
  client_name: string | null
  title: string
  description: string | null
  due_date: string | null
  assigned_to: string | null
  assigned_name: string | null
  status: TaskStatus
  priority: Priority
  repeat: 'none' | 'monthly'
  created_at: string
  done_at: string | null
}
export const fetchTasks = (scope: 'mine' | 'all', clientId?: string | null, done = false) =>
  rpc<Task[]>('acc_tasks_list', { p_scope: scope, p_client: clientId ?? null, p_done: done }).then((r) => r ?? [])
export const saveTask = (p: Partial<Task>) => rpc<string>('acc_task_save', { p })
export const setTaskStatus = (id: string, status: TaskStatus) => rpc<void>('acc_task_status', { p_id: id, p_status: status })
export const deleteTask = (id: string) => rpc<void>('acc_task_delete', { p_id: id })

// ---------------------------------------------------------------------------
// Document requests
// ---------------------------------------------------------------------------
export type RequestStatus = 'requested' | 'received' | 'cancelled'
export const REQUEST_STATUS: Record<RequestStatus, string> = { requested: 'E kërkuar', received: 'E pranuar', cancelled: 'E anuluar' }
export const REQUEST_TEMPLATES = ['Faturat e blerjes', 'Faturat e shitjes', 'Ekstrakti bankar', 'Raporti i arkës (Z-raporti)', 'Listat e pagave dhe ndryshimet e punëtorëve', 'Kontratat e reja', 'Faturat e shpenzimeve (rryma, uji, telefoni)']

export interface DocRequest {
  id: string
  client_id: string
  client_name: string
  client_email: string | null
  client_phone: string | null
  title: string
  period: string | null
  due_date: string | null
  status: RequestStatus
  note: string | null
  requested_by_name: string | null
  created_at: string
  received_at: string | null
  reminders: number
  last_reminded_at: string | null
}
export const fetchRequests = (status: RequestStatus | null, clientId?: string | null) =>
  rpc<DocRequest[]>('acc_requests_list', { p_status: status, p_client: clientId ?? null }).then((r) => r ?? [])
export const saveRequest = (p: { id?: string; client_id: string; title: string; period?: string | null; due_date?: string | null; note?: string | null }) => rpc<string>('acc_request_save', { p })
export const bulkRequests = (p: { title: string; period?: string | null; due_date?: string | null; note?: string | null; client_ids?: string[] }) => rpc<number>('acc_requests_bulk', { p })
export const setRequestStatus = (id: string, status: RequestStatus | 'reminded') => rpc<void>('acc_request_status', { p_id: id, p_status: status })
export const deleteRequest = (id: string) => rpc<void>('acc_request_delete', { p_id: id })

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
export type NoteKind = 'call' | 'email' | 'meeting' | 'message' | 'note'
export const NOTE_KINDS: Record<NoteKind, string> = { call: 'Telefonatë', email: 'Email', meeting: 'Takim', message: 'Mesazh', note: 'Shënim' }
export interface ClientNote {
  id: string
  kind: NoteKind
  body: string
  note_date: string
  created_by: string | null
  author: string | null
}
export const fetchNotes = (clientId: string) => rpc<ClientNote[]>('acc_notes_list', { p_client: clientId }).then((r) => r ?? [])
export const saveNote = (p: { client_id: string; kind: NoteKind; body: string }) => rpc<string>('acc_note_save', { p })
export const deleteNote = (id: string) => rpc<void>('acc_note_delete', { p_id: id })

export interface WorkSummary {
  my_tasks: number
  overdue_tasks: number
  open_requests: number
  overdue_requests: number
  unpaid: number | null
}
export async function fetchWorkSummary(): Promise<WorkSummary> {
  const r = await rpc<Record<string, unknown>>('acc_work_summary')
  return { my_tasks: n(r.my_tasks), overdue_tasks: n(r.overdue_tasks), open_requests: n(r.open_requests), overdue_requests: n(r.overdue_requests), unpaid: r.unpaid == null ? null : n(r.unpaid) }
}

// ---------------------------------------------------------------------------
// Reminder links (no e-mail service needed: the accountant's own e-mail / WhatsApp opens)
// ---------------------------------------------------------------------------
export function reminderText(r: Pick<DocRequest, 'client_name' | 'title' | 'period' | 'due_date'>, office: string | null, periodLabel?: string, dueLabel?: string): string {
  return [
    `Përshëndetje ${r.client_name},`,
    '',
    `Ju lutem na dërgoni: ${r.title}${periodLabel ? ` (${periodLabel})` : ''}${dueLabel ? `, deri më ${dueLabel}` : ''}.`,
    '',
    `Faleminderit,`,
    office ?? 'Zyra e kontabilitetit',
  ].join('\n')
}

export const mailtoLink = (email: string, subject: string, body: string) => `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

/** Kosovo numbers: 044 123 456 → 38344123456. */
export function whatsappLink(phone: string, text: string): string | null {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = '383' + d.slice(1)
  if (d.length < 8) return null
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`
}
