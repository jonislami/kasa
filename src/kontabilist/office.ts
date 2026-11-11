// Office team, roles, access to clients, history of actions, two-factor login (0022 + Edge Function acc-office).
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}

export type OfficeRole = 'admin' | 'accountant' | 'assistant'
export const ROLE_LABELS: Record<OfficeRole, string> = { admin: 'Administrator', accountant: 'Kontabilist', assistant: 'Asistent' }
export const ROLE_HELP: Record<OfficeRole, string> = {
  admin: 'Gjithçka, edhe ekipin dhe cilësimet e zyrës',
  accountant: 'Puna e plotë te klientët e tij: TVSH, mbyllja e muajit, pagat',
  assistant: 'Regjistron fatura, pagesa, skanime; nuk deklaron, nuk mbyll muaj, nuk fshin klientë',
}

export interface Member {
  user_id: string
  full_name: string
  email: string
  phone: string | null
  role: OfficeRole
  is_owner: boolean
  active: boolean
  all_clients: boolean
  created_at: string
  clients: string[] | null
  last_sign_in_at: string | null
  mfa: boolean | null
}

export interface Office {
  office_id: string
  office_name: string | null
  require_mfa: boolean
  is_admin: boolean
  members: Member[]
}

export async function fetchOffice(): Promise<Office> {
  const { data, error } = await supabase.rpc('acc_office')
  if (error) fail(error)
  return data as Office
}

export async function saveMember(p: { user_id: string; role?: OfficeRole; active?: boolean; all_clients?: boolean; clients?: string[]; full_name?: string; phone?: string | null }): Promise<void> {
  const { error } = await supabase.rpc('acc_office_save_member', { p })
  if (error) fail(error)
}

export async function saveOfficeSettings(p: { office_name?: string; require_mfa?: boolean }): Promise<void> {
  const { error } = await supabase.rpc('acc_office_settings', { p })
  if (error) fail(error)
}

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
    if (/Failed to send|404/i.test(msg)) msg = 'Shërbimi i ekipit (Edge Function acc-office) nuk është vendosur ende në Supabase.'
    throw new Error(msg)
  }
  return data as Record<string, unknown>
}

export async function createMember(p: { full_name: string; email: string; password: string; role: OfficeRole; phone?: string; all_clients: boolean; clients: string[] }): Promise<void> {
  await callOffice({ action: 'create_member', ...p })
}

export async function setMemberPassword(userId: string, password: string): Promise<void> {
  await callOffice({ action: 'set_password', user_id: userId, password })
}

export interface Activity {
  id: number
  created_at: string
  entity: string
  entity_id: string | null
  action: 'insert' | 'update' | 'delete'
  label: string | null
  amount: number | null
  client_id: string | null
  client_name: string | null
  user_id: string | null
  user_name: string | null
}

export const ENTITY_LABELS: Record<string, string> = {
  acc_clients: 'Klienti',
  acc_documents: 'Fatura',
  acc_payments: 'Pagesa',
  acc_transactions: 'Arka / banka',
  acc_partners: 'Partneri',
  acc_employees: 'Punëtori',
  acc_payroll_runs: 'Lista e pagave',
  acc_journal_entries: 'Regjistrim në ditar',
  acc_assets: 'Mjet themelor',
  acc_periods: 'Muaji',
  acc_vat_returns: 'Deklarata e TVSH-së',
  acc_tax_filings: 'Deklaratë tatimore',
  acc_scans: 'Skanim',
  acc_loans: 'Kredi / hua',
  accountants: 'Ekipi',
  office: 'Zyra',
}
export const ACTION_LABELS: Record<Activity['action'], string> = { insert: 'shtoi', update: 'ndryshoi', delete: 'fshiu' }

export async function fetchActivity(from: string, to: string, userId?: string | null, clientId?: string | null): Promise<Activity[]> {
  const { data, error } = await supabase.rpc('acc_activity_list', { p_from: from, p_to: to, p_user: userId ?? null, p_client: clientId ?? null })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((a) => ({ ...(a as unknown as Activity), amount: a.amount == null ? null : Number(a.amount) }))
}

// ---------------------------------------------------------------------------
// Two-factor login (TOTP) with Supabase Auth
// ---------------------------------------------------------------------------
export async function mfaStatus(): Promise<{ current: string | null; next: string | null; factorId: string | null }> {
  const [aal, factors] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()])
  const verified = factors.data?.totp?.find((f) => f.status === 'verified') ?? null
  return { current: aal.data?.currentLevel ?? null, next: aal.data?.nextLevel ?? null, factorId: verified?.id ?? null }
}

/** Starts enrolling an authenticator app; returns the QR code (SVG data URL) and the secret to type by hand. */
export async function mfaEnroll(): Promise<{ factorId: string; qr: string; secret: string }> {
  const list = await supabase.auth.mfa.listFactors()
  for (const f of list.data?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Kasa Kontabilist ' + new Date().toISOString().slice(0, 16) })
  if (error || !data) throw new Error('Nuk u nis: ' + (error?.message ?? ''))
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

export async function mfaVerify(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'Kodi nuk është i saktë ose ka skaduar' : error.message)
}

export async function mfaRemove(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw new Error(/aal2/i.test(error.message) ? 'Për ta hequr, hyr fillimisht me kodin e dy faktorëve' : error.message)
}
