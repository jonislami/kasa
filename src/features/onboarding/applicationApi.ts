import { NOT_READY } from '@/lib/friendlyError'
// The business application in four steps (0041): activities, units, documents, the tax profile.
import { supabase } from '@/lib/supabase'
import type { LegalForm } from '@/lib/taxProfile'

const NOT_MIGRATED = ['PGRST202', '42883', '42P01', 'PGRST205']
export class ApplicationNotMigrated extends Error {}

function check(error: { code?: string; message: string } | null) {
  if (!error) return
  if (NOT_MIGRATED.includes(error.code ?? '')) throw new ApplicationNotMigrated(NOT_READY)
  throw new Error(error.message)
}

export interface Activity {
  id: string
  name: string
  sort: number
  active: boolean
}

/** Activities offered for a unit (the platform admin also sees the inactive ones). */
export async function fetchActivities(): Promise<Activity[]> {
  const { data, error } = await supabase.from('business_activities').select('id, name, sort, active').order('sort').order('name')
  check(error)
  return (data ?? []) as Activity[]
}

export async function saveActivity(a: { id?: string | null; name: string; active?: boolean; sort?: number | null }): Promise<string> {
  const { data, error } = await supabase.rpc('platform_activity_save', { p_id: a.id ?? null, p_name: a.name, p_active: a.active ?? true, p_sort: a.sort ?? null })
  check(error)
  return data as string
}

/** true when another business already registered this NUI; null when it cannot be checked (before 0041 / offline). */
export async function nuiTaken(nui: string): Promise<boolean | null> {
  const ask = supabase.rpc('registration_nui_taken', { p_nui: nui }).then(({ data, error }) => (error ? null : Boolean(data)))
  // a slow or missing answer does not hold the form: the server checks again when it is sent
  return Promise.race([ask, new Promise<null>((r) => setTimeout(() => r(null), 4000))]).catch(() => null)
}

export interface UnitInput {
  id?: string
  name: string
  unit_no: string
  country: string
  city: string
  address: string
  activities: string[]
  registers: number
  status?: 'pending' | 'approved' | 'rejected'
}

export interface TaxInput {
  legal_form: LegalForm | ''
  tax_category: string
  real_income: boolean
  vat_registered: boolean | null
  vat_number: string
  vat_date: string
  tax_center: string
}

export interface ApplicationInput {
  name: string
  nui: string
  address: string
  country: string
  city: string
  owner_name?: string
  phone?: string
  partner_code?: string
  tax: TaxInput
  units: UnitInput[]
  message?: string
  initial?: boolean
}

export async function saveApplication(p: ApplicationInput): Promise<void> {
  const { error } = await supabase.rpc('owner_application_save', { p })
  check(error)
}

export interface BusinessDocument {
  id: string
  kind: 'certificate' | 'other'
  path: string
  file_name: string
  mime: string | null
  size_bytes: number | null
  created_at: string
}

export interface OwnerApplication {
  open: boolean
  units: (UnitInput & { id: string; status: 'pending' | 'approved' | 'rejected' })[]
  documents: BusinessDocument[]
}

export async function fetchOwnerApplication(): Promise<OwnerApplication> {
  const { data, error } = await supabase.rpc('owner_application')
  check(error)
  const r = data as OwnerApplication
  return { ...r, units: (r.units ?? []).map((u) => ({ ...u, unit_no: u.unit_no ?? '', activities: u.activities ?? [] })), documents: r.documents ?? [] }
}

export const DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
export const DOC_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp'
export const DOC_MAX = 10 * 1024 * 1024

/** The reason a file cannot be uploaded, or null. */
export function docProblem(f: File): string | null {
  const type = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : '')
  if (!DOC_TYPES.includes(type)) return `${f.name}: lejohen vetëm PDF, PNG, JPG dhe WebP.`
  if (f.size > DOC_MAX) return `${f.name}: skedari është më i madh se 10 MB.`
  return null
}

export const safeName = (n: string) =>
  n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .slice(-80)

/** Uploads a document to the business's folder and records it; a new certificate replaces the old one. */
export async function uploadDocument(businessId: string, kind: 'certificate' | 'other', f: File): Promise<void> {
  const problem = docProblem(f)
  if (problem) throw new Error(problem)
  const mime = f.type || 'application/pdf'
  const path = `${businessId}/${crypto.randomUUID()}-${safeName(f.name)}`
  const up = await supabase.storage.from('business-docs').upload(path, f, { contentType: mime, upsert: false })
  if (up.error) throw new Error(`${f.name}: ${up.error.message}`)
  const { data, error } = await supabase.rpc('owner_document_add', { p_kind: kind, p_path: path, p_name: f.name, p_mime: mime, p_size: f.size })
  if (error) {
    await supabase.storage.from('business-docs').remove([path])
    check(error)
  }
  const old = (data as { replaced_path?: string | null } | null)?.replaced_path
  if (old) await supabase.storage.from('business-docs').remove([old])
}

export async function removeDocument(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('owner_document_remove', { p_id: id })
  check(error)
  if (data) await supabase.storage.from('business-docs').remove([data as string])
}

/** A link valid for 10 minutes (the owner's own documents, or any for the platform admin). */
export async function documentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('business-docs').createSignedUrl(path, 600)
  if (error || !data) throw new Error(error?.message ?? 'Dokumenti nuk u hap')
  return data.signedUrl
}

// --- platform admin ---
export interface AdminApplication {
  units: (UnitInput & { id: string; status: 'pending' | 'approved' | 'rejected' })[]
  documents: BusinessDocument[]
}

export async function fetchAdminApplication(businessId: string): Promise<AdminApplication> {
  const { data, error } = await supabase.rpc('platform_application_extra', { p_business: businessId })
  check(error)
  const r = data as AdminApplication
  return { units: r.units ?? [], documents: r.documents ?? [] }
}

export async function decideUnit(unitId: string, status: 'pending' | 'approved' | 'rejected'): Promise<void> {
  const { error } = await supabase.rpc('platform_unit_decide', { p_unit: unitId, p_status: status })
  check(error)
}
