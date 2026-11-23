// After the registration (0049): a new unit, and the request to move into VAT (document → the platform admin approves).
import { NOT_READY, friendlyMessage } from '@/lib/friendlyError'
import { supabase } from '@/lib/supabase'
import { docProblem, safeName } from './applicationApi'

const MISSING = ['PGRST202', '42883', '42P01', 'PGRST205']

function check(error: { code?: string; message: string } | null) {
  if (!error) return
  if (MISSING.includes(error.code ?? '')) throw new Error(NOT_READY)
  throw new Error(friendlyMessage(error.message))
}

export interface NewUnit {
  name: string
  unit_no: string
  country: string
  city: string
  address: string
  activities: string[]
  registers: number
}

export async function addUnit(u: NewUnit): Promise<string> {
  const { data, error } = await supabase.rpc('owner_unit_add', { p: u })
  check(error)
  return data as string
}

export async function withdrawUnit(id: string): Promise<void> {
  const { error } = await supabase.rpc('owner_unit_withdraw', { p_unit: id })
  check(error)
}

export interface VatRequest {
  id: string
  vat_number: string
  vat_date: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  note: string | null
  created_at: string
  decided_at: string | null
}

/** The owner's latest requests; [] before 0049. */
export async function fetchVatRequests(businessId: string): Promise<VatRequest[]> {
  const { data, error } = await supabase
    .from('business_vat_requests')
    .select('id, vat_number, vat_date, status, note, created_at, decided_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) {
    if (MISSING.includes(error.code ?? '')) return []
    check(error)
  }
  return (data ?? []) as VatRequest[]
}

/** Uploads the VAT document (<business>/vat/…) and sends the request; the file is removed again if the request fails. */
export async function sendVatRequest(businessId: string, p: { vat_number: string; vat_date: string; file: File }): Promise<void> {
  const problem = docProblem(p.file)
  if (problem) throw new Error(problem)
  const mime = p.file.type || 'application/pdf'
  const path = `${businessId}/vat/${crypto.randomUUID()}-${safeName(p.file.name)}`
  const up = await supabase.storage.from('business-docs').upload(path, p.file, { contentType: mime, upsert: false })
  if (up.error) throw new Error(/row-level|policy|unauthor/i.test(up.error.message) ? NOT_READY : `${p.file.name}: ${up.error.message}`)
  const { error } = await supabase.rpc('owner_vat_request', {
    p_vat_number: p.vat_number,
    p_vat_date: p.vat_date,
    p_path: path,
    p_name: p.file.name,
    p_mime: mime,
    p_size: p.file.size,
  })
  if (error) {
    await supabase.storage.from('business-docs').remove([path])
    check(error)
  }
}

export async function cancelVatRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('owner_vat_cancel', { p_id: id })
  check(error)
}

// --- platform admin ---
export interface PendingUnit {
  id: string
  business_id: string
  business: string
  nui: string | null
  name: string
  unit_no: string | null
  country: string
  city: string
  address: string
  activities: string[]
  registers: number
  created_at: string
}

export interface PendingVat {
  id: string
  business_id: string
  business: string
  nui: string | null
  vat_number: string
  vat_date: string
  document: { path: string; file_name: string; mime: string | null; size_bytes: number | null } | null
  created_at: string
}

/** What active businesses ask for; empty before 0049. */
export async function fetchPendingRequests(): Promise<{ units: PendingUnit[]; vat: PendingVat[] }> {
  const { data, error } = await supabase.rpc('platform_pending_requests')
  if (error) {
    if (MISSING.includes(error.code ?? '')) return { units: [], vat: [] }
    check(error)
  }
  const r = (data ?? {}) as { units?: PendingUnit[]; vat?: PendingVat[] }
  return { units: r.units ?? [], vat: r.vat ?? [] }
}

export async function decideVat(id: string, action: 'approve' | 'reject', note?: string): Promise<void> {
  const { error } = await supabase.rpc('platform_vat_decide', { p_id: id, p_action: action, p_note: note ?? null })
  check(error)
}
