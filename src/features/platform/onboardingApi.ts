// Platform admin side of SEF onboarding (0029): applications, decisions, payments, licenses, tills, devices.
import { supabase } from '@/lib/supabase'
import type { BusinessType } from '@/lib/business'
import type { BusinessStatus, LicenseState, RegisterApplication } from '@/features/onboarding/api'

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) throw new Error('Kjo pjesë kërkon migrimin supabase/migrations/0029_sef_onboarding.sql në Supabase.')
    throw new Error(error.message)
  }
  return data as T
}

export interface OnboardingRow {
  id: string
  name: string
  type: BusinessType
  status: BusinessStatus
  active: boolean
  city: string | null
  nui: string | null
  fiscal_number: string | null
  phone: string | null
  owner_name: string | null
  owner_email: string | null
  created_at: string
  applied_at: string | null
  waiting: boolean
  license: LicenseState
  price: number | null
  last_payment: string | null
  register_pending: number
  devices: number
  registers: number
}
export const fetchOnboardingList = (status: string | null) =>
  rpc<OnboardingRow[]>('platform_onboarding_list', { p_status: status }).then((r) =>
    (r ?? []).map((x) => ({ ...x, price: x.price == null ? null : Number(x.price), register_pending: Number(x.register_pending), devices: Number(x.devices), registers: Number(x.registers) })),
  )

export interface AdminDetail {
  business: Record<string, unknown> & {
    id: string
    name: string
    type: BusinessType
    status: BusinessStatus
    status_note: string | null
    active: boolean
    nui: string | null
    fiscal_number: string | null
    vat_number: string | null
    address: string | null
    city: string | null
    phone: string | null
    owner_name: string | null
    owner_email: string | null
    activity: string | null
    registration: { registers?: number; note?: string | null; ip?: string | null }
    created_at: string
    applied_at: string | null
  }
  license: {
    plan: 'monthly' | 'yearly' | 'custom'
    price: number | null
    status: 'active' | 'suspended' | 'cancelled'
    starts_on: string | null
    expires_on: string | null
    max_devices: number
    note: string | null
    computed: LicenseState
  } | null
  payments: { id: string; amount: number; method: string; paid_on: string; reference: string | null; months: number; extended_to: string | null; note: string | null; confirmed_by_name: string | null }[]
  events: { id: number; action: string; note: string | null; created_at: string; by_name: string | null }[]
  register_applications: RegisterApplication[]
  registers: { id: string; name: string; active: boolean }[]
  devices: { id: string; name: string; platform: string; app_version: string | null; active: boolean; last_seen_at: string; linked_at: string; register: string | null }[]
  owner_last_sign_in: string | null
}
export async function fetchAdminDetail(id: string): Promise<AdminDetail> {
  const r = await rpc<AdminDetail>('platform_onboarding_detail', { p_business: id })
  return {
    ...r,
    license: r.license ? { ...r.license, price: r.license.price == null ? null : Number(r.license.price) } : null,
    payments: (r.payments ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
  }
}

export type Decision = 'approve' | 'reject' | 'request_info' | 'suspend' | 'reactivate'
export const decide = (id: string, action: Decision, note?: string) => rpc<{ status: BusinessStatus; active: boolean }>('platform_decide', { p_business: id, p_action: action, p_note: note ?? null })
export const confirmPayment = (p: { business_id: string; amount: number; method: string; paid_on: string; reference?: string; months: number; note?: string }) =>
  rpc<{ expires_on: string | null; status: BusinessStatus }>('platform_confirm_payment', { p })
export const deletePayment = (id: string) => rpc<void>('platform_payment_delete', { p_id: id })
export const saveLicense = (p: { business_id: string; plan?: string; price?: string; status?: string; expires_on?: string; max_devices?: number; note?: string }) =>
  rpc<LicenseState>('platform_license_save', { p })
export const decideRegister = (id: string, action: 'approve' | 'reject' | 'request_info', note?: string, registerId?: string | null) =>
  rpc<{ register_id: string | null }>('platform_register_application_decide', { p_id: id, p_action: action, p_note: note ?? null, p_register: registerId ?? null })
export const setDevice = (id: string, active: boolean) => rpc<void>('platform_device_set', { p_device: id, p_active: active })

export interface PlatformSettings {
  bank_name: string | null
  iban: string | null
  account_holder: string | null
  monthly_price: number
  yearly_price: number
  payment_note: string | null
  grace_days: number
}
export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const { data, error } = await supabase.from('platform_settings').select('bank_name, iban, account_holder, monthly_price, yearly_price, payment_note, grace_days').eq('id', 1).maybeSingle()
  if (error) throw new Error(/does not exist|schema cache/.test(error.message) ? 'Kjo pjesë kërkon migrimin 0029 në Supabase.' : error.message)
  const r = (data ?? {}) as PlatformSettings
  return { ...r, monthly_price: Number(r.monthly_price ?? 0), yearly_price: Number(r.yearly_price ?? 0), grace_days: Number(r.grace_days ?? 7) }
}
export const savePlatformSettings = (p: Partial<Record<keyof PlatformSettings, string | number | null>>) => rpc<void>('platform_settings_save', { p })

// ---------------------------------------------------------------------------
// Activation keys for the installed SEF app (0030)
// ---------------------------------------------------------------------------
export interface ActivationKey {
  id: string
  hint: string
  label: string | null
  register: string | null
  created_at: string
  expires_at: string
  used_at: string | null
  device: string | null
  device_active: boolean | null
  status: 'open' | 'used' | 'expired' | 'revoked'
}

async function keysRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) throw new Error('Çelësat kërkojnë migrimin supabase/migrations/0030_activation_keys.sql në Supabase.')
    throw new Error(error.message)
  }
  return data as T
}
export const fetchActivationKeys = (businessId: string) => keysRpc<ActivationKey[]>('platform_activation_keys', { p_business: businessId })
export const createActivationKey = (p: { business: string; register: string | null; label: string; days: number }) =>
  keysRpc<{ id: string; key: string; expires_at: string }>('platform_activation_key_create', { p_business: p.business, p_register: p.register, p_label: p.label || null, p_days: p.days })
export const revokeActivationKey = (id: string) => keysRpc<void>('platform_activation_key_revoke', { p_id: id })
