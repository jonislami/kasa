// Client portal (0024): what the client company sees of its books, uploads, messages.
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'
import { prepareUpload } from '../scan'

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

export interface PortalClient {
  client_id: string
  name: string
  nui: string | null
  vat_registered: boolean
  office_name: string | null
  office_email: string | null
  office_phone: string | null
  unread: number
  open_requests: number
  office_logo?: string | null
  shared_files?: number
}
export interface PortalMe {
  user_id: string
  full_name: string | null
  email: string | null
  clients: PortalClient[]
}
export async function fetchPortalMe(): Promise<PortalMe> {
  const r = await rpc<PortalMe>('portal_me')
  return { ...r, clients: (r.clients ?? []).map((c) => ({ ...c, unread: n(c.unread), open_requests: n(c.open_requests) })) }
}

export interface Totals {
  gross: number
  net: number
  vat: number
  docs: number
}
export interface PortalOverview {
  month: string
  sales: Totals
  purchases: Totals
  months: { month: string; sales: number; purchases: number }[]
  receivable: number
  payable: number
  vat_return: { month: string; status: 'draft' | 'filed'; amount: number; credit: number; filed_at: string | null; paid_at: string | null } | null
  office_open: number
  open_requests: number
  unread: number
  kasa_linked: boolean
}
const totals = (t: Record<string, unknown>): Totals => ({ gross: n(t?.gross), net: n(t?.net), vat: n(t?.vat), docs: n(t?.docs) })
export async function fetchOverview(clientId: string, month: string): Promise<PortalOverview> {
  const r = await rpc<Record<string, unknown>>('portal_overview', { p_client: clientId, p_month: month })
  const v = r.vat_return as Record<string, unknown> | null
  return {
    ...(r as unknown as PortalOverview),
    sales: totals(r.sales as Record<string, unknown>),
    purchases: totals(r.purchases as Record<string, unknown>),
    months: ((r.months as Record<string, unknown>[]) ?? []).map((m) => ({ month: String(m.month).slice(0, 10), sales: n(m.sales), purchases: n(m.purchases) })),
    receivable: n(r.receivable),
    payable: n(r.payable),
    vat_return: v ? { ...(v as unknown as NonNullable<PortalOverview['vat_return']>), month: String(v.month).slice(0, 10), amount: n(v.amount), credit: n(v.credit) } : null,
    office_open: n(r.office_open),
    open_requests: n(r.open_requests),
    unread: n(r.unread),
  }
}

export interface PortalDoc {
  id: string
  kind: 'sale' | 'purchase'
  doc_type: 'invoice' | 'credit_note' | 'debit_note'
  doc_no: string | null
  doc_date: string
  due_date: string | null
  partner_name: string | null
  description: string | null
  net: number
  vat: number
  total: number
  open: number
  files: number
}
export async function fetchDocuments(clientId: string, kind: 'sale' | 'purchase', from: string, to: string): Promise<PortalDoc[]> {
  const rows = await rpc<Record<string, unknown>[]>('portal_documents', { p_client: clientId, p_kind: kind, p_from: from, p_to: to })
  return (rows ?? []).map((d) => ({ ...(d as unknown as PortalDoc), net: n(d.net), vat: n(d.vat), total: n(d.total), open: n(d.open), files: n(d.files) }))
}

export interface Declarations {
  vat: { month: string; status: 'draft' | 'filed'; amount: number; credit: number; filed_at: string | null; reference: string | null; paid_at: string | null }[]
  payroll: { month: string; status: 'confirmed' | 'filed'; filed_at: string | null; employees: number; gross: number; net: number; to_pay: number }[]
  other: { kind: string; period: string; amount: number; status: 'draft' | 'filed' | 'paid'; filed_at: string | null; paid_at: string | null; reference: string | null }[]
}
export async function fetchDeclarations(clientId: string, year: number): Promise<Declarations> {
  const r = await rpc<Record<string, Record<string, unknown>[]>>('portal_declarations', { p_client: clientId, p_year: year })
  return {
    vat: (r.vat ?? []).map((x) => ({ ...(x as unknown as Declarations['vat'][number]), month: String(x.month).slice(0, 10), amount: n(x.amount), credit: n(x.credit) })),
    payroll: (r.payroll ?? []).map((x) => ({ ...(x as unknown as Declarations['payroll'][number]), month: String(x.month).slice(0, 10), employees: n(x.employees), gross: n(x.gross), net: n(x.net), to_pay: n(x.to_pay) })),
    other: (r.other ?? []).map((x) => ({ ...(x as unknown as Declarations['other'][number]), period: String(x.period).slice(0, 10), amount: n(x.amount) })),
  }
}

export interface PortalOfficeInvoices {
  office: { name: string | null; nui: string | null; bank: string | null; iban: string | null; address: string | null; city: string | null; email: string | null; phone: string | null }
  invoices: { id: string; inv_no: string; issue_date: string; due_date: string | null; description: string; vat_rate: number; net: number; vat: number; total: number; paid: number; status: 'open' | 'paid' }[]
}
export async function fetchOfficeInvoices(clientId: string): Promise<PortalOfficeInvoices> {
  const r = await rpc<Record<string, unknown>>('portal_office_invoices', { p_client: clientId })
  return {
    office: r.office as PortalOfficeInvoices['office'],
    invoices: ((r.invoices as Record<string, unknown>[]) ?? []).map((i) => ({ ...(i as unknown as PortalOfficeInvoices['invoices'][number]), vat_rate: n(i.vat_rate), net: n(i.net), vat: n(i.vat), total: n(i.total), paid: n(i.paid) })),
  }
}

export interface PortalRequest {
  id: string
  title: string
  period: string | null
  due_date: string | null
  status: 'requested' | 'received' | 'cancelled'
  note: string | null
  created_at: string
  received_at: string | null
}
export interface PortalUpload {
  id: string
  file_name: string
  path: string
  mime: string | null
  status: 'pending' | 'read' | 'review' | 'confirmed' | 'failed'
  created_at: string
  note: string | null
  request_title: string | null
}
export const fetchRequests = (clientId: string) => rpc<{ requests: PortalRequest[]; uploads: PortalUpload[] }>('portal_requests', { p_client: clientId })

/** Photo / PDF to the client's folder; it reaches the office's "Skanimi me AI". */
export async function uploadToOffice(clientId: string, file: File, requestId?: string | null, note?: string): Promise<void> {
  const ready = await prepareUpload(file)
  if (ready.size > 20 * 1024 * 1024) throw new Error(`${file.name}: më i madh se 20 MB`)
  const pdf = ready.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const base = file.name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-60) || 'dokument'
  const name = pdf ? `${base}.pdf` : ready === file ? file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-70) : `${base}.jpg`
  const mime = pdf ? 'application/pdf' : ready.type || 'image/jpeg'
  const path = `${clientId}/portal-${crypto.randomUUID()}-${name}`
  const up = await supabase.storage.from('acc-files').upload(path, ready, { contentType: mime, upsert: false })
  if (up.error) throw new Error(`${file.name}: nuk u ngarkua (${up.error.message})`)
  await rpc<string>('portal_upload', { p: { client_id: clientId, path, file_name: file.name, mime, size_bytes: ready.size, request_id: requestId ?? null, note: note ?? null } })
}

export interface Message {
  id: number
  from_client: boolean
  body: string
  created_at: string
  read_at: string | null
  sender_name: string | null
}
export const fetchMessages = (clientId: string) => rpc<Message[]>('portal_messages', { p_client: clientId }).then((r) => r ?? [])
export const sendMessage = (clientId: string, body: string) => rpc<void>('portal_send', { p_client: clientId, p_body: body })

// Office side of the same conversation and the portal accounts of a client.
export const fetchOfficeMessages = (clientId: string) => rpc<Message[]>('acc_messages_list', { p_client: clientId }).then((r) => r ?? [])
export const sendOfficeMessage = (clientId: string, body: string) => rpc<void>('acc_message_send', { p_client: clientId, p_body: body })

export interface PortalUser {
  id: string
  user_id: string
  full_name: string
  email: string
  active: boolean
  created_at: string
  last_seen_at: string | null
  kasa_owner: boolean
}
export const fetchPortalUsers = (clientId: string) => rpc<PortalUser[]>('acc_portal_users_list', { p_client: clientId }).then((r) => r ?? [])
export const setPortalUserActive = (id: string, active: boolean) => rpc<void>('acc_portal_user_set', { p_id: id, p_active: active })

async function callOffice(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('acc-office', { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const b = (await ctx.json()) as { error?: string }
        if (b?.error) msg = b.error
      } catch {
        /* keep the generic message */
      }
    }
    throw new Error(msg)
  }
  return data as Record<string, unknown>
}
export async function createPortalUser(p: { client_id: string; full_name: string; email: string; password?: string; send_invite?: boolean }): Promise<{ linked: boolean; invited: boolean; invite_error: string | null }> {
  const r = await callOffice({ action: 'create_portal_user', ...p })
  return { linked: Boolean(r.linked), invited: Boolean(r.invited), invite_error: (r.invite_error as string) ?? null }
}
export const setPortalPassword = (portalId: string, password: string) => callOffice({ action: 'set_portal_password', portal_id: portalId, password }).then(() => undefined)

export interface InboxRow {
  client_id: string
  client_name: string
  unread: number
  uploads: number
  last_at: string | null
}
export const fetchInbox = () => rpc<InboxRow[]>('acc_portal_inbox').then((r) => (r ?? []).map((x) => ({ ...x, unread: n(x.unread), uploads: n(x.uploads) })))

export interface SharedFile {
  id: string
  path: string
  file_name: string
  mime: string | null
  category: string
  title: string | null
  period: string | null
  note: string | null
  created_at: string
}
export const fetchSharedFiles = (clientId: string) => rpc<SharedFile[]>('portal_files', { p_client: clientId }).then((r) => r ?? [])
export async function openFile(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('acc-files').createSignedUrl(path, 300)
  if (error || !data) throw new Error('Skedari nuk u hap')
  return data.signedUrl
}
