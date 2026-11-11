// SEF onboarding (0029): registration, the owner's panel while waiting, application for a till, license.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { BusinessType } from '@/lib/business'

export type BusinessStatus = 'pending' | 'needs_info' | 'approved' | 'active' | 'rejected' | 'suspended'
export const STATUS_LABELS: Record<BusinessStatus, string> = {
  pending: 'Në shqyrtim',
  needs_info: 'Kërkohen të dhëna',
  approved: 'Aprovuar – pret pagesën',
  active: 'Aktiv',
  rejected: 'Refuzuar',
  suspended: 'Pezulluar',
}

export type LicenseStateCode = 'active' | 'expiring' | 'grace' | 'expired' | 'suspended' | 'cancelled'
export interface LicenseState {
  state: LicenseStateCode
  plan: 'monthly' | 'yearly' | 'custom' | null
  expires_on: string | null
  grace_until: string | null
  days_left: number | null
  max_devices: number
  price?: number | null
  status?: string
}
export const LICENSE_LABELS: Record<LicenseStateCode, string> = {
  active: 'Aktive',
  expiring: 'Skadon së shpejti',
  grace: 'Ka skaduar – periudha e tolerancës',
  expired: 'Ka skaduar',
  suspended: 'E pezulluar',
  cancelled: 'E çaktivizuar',
}

export interface RegisterInput {
  owner_name: string
  business_name: string
  type: BusinessType
  nui: string
  fiscal_number: string
  vat_number?: string
  address: string
  city: string
  phone: string
  email: string
  password: string
  activity?: string
  registers?: number
  note?: string
  website?: string // honeypot
}

export async function registerBusiness(input: RegisterInput): Promise<void> {
  const { error } = await supabase.functions.invoke('register-business', { body: input })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'Regjistrimi nuk u ruajt')
    }
    throw new Error('Nuk ka lidhje me serverin. Provo përsëri pas pak.')
  }
}

export interface RegisterApplication {
  id: string
  status: 'pending' | 'needs_info' | 'approved' | 'rejected'
  name: string
  location: string | null
  device_type: 'windows' | 'android' | 'ios' | 'web'
  printer: 'bluetooth' | 'usb' | 'network' | 'none'
  paper_width: 58 | 80
  fiscal: boolean
  contact: string | null
  note: string | null
  admin_note: string | null
  register_id: string | null
  created_at: string
  decided_at: string | null
}
export const APP_STATUS: Record<RegisterApplication['status'], string> = { pending: 'Në shqyrtim', needs_info: 'Kërkohen të dhëna', approved: 'Aprovuar', rejected: 'Refuzuar' }
export const DEVICE_LABELS: Record<RegisterApplication['device_type'], string> = { windows: 'Kompjuter me Windows', android: 'Tablet / telefon Android', ios: 'iPad / iPhone', web: 'Shfletues' }
export const PRINTER_LABELS: Record<RegisterApplication['printer'], string> = { bluetooth: 'Printer Bluetooth', usb: 'Printer USB', network: 'Printer në rrjet', none: 'Pa printer' }

export interface OnboardingState {
  business: {
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
    registration: { registers?: number; note?: string | null }
    applied_at: string | null
    decided_at: string | null
    created_at: string
  }
  license: LicenseState
  payments: { paid_on: string; amount: number; method: string; months: number; extended_to: string | null; reference: string | null }[]
  events: { action: string; note: string | null; created_at: string }[]
  register_applications: RegisterApplication[]
  can_install: boolean
  payment_info: { bank_name: string | null; iban: string | null; account_holder: string | null; monthly_price: number; yearly_price: number; payment_note: string | null; grace_days: number }
}

export async function fetchOnboarding(): Promise<OnboardingState> {
  const { data, error } = await supabase.rpc('onboarding_state')
  if (error) throw new Error(error.message)
  const r = data as OnboardingState
  return {
    ...r,
    payments: (r.payments ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
    payment_info: { ...r.payment_info, monthly_price: Number(r.payment_info?.monthly_price ?? 0), yearly_price: Number(r.payment_info?.yearly_price ?? 0) },
  }
}

export async function updateOnboarding(p: Partial<OnboardingState['business']> & { message?: string }): Promise<void> {
  const { error } = await supabase.rpc('onboarding_update', { p })
  if (error) throw new Error(error.message)
}

export async function submitRegisterApplication(p: Partial<RegisterApplication>): Promise<void> {
  const { error } = await supabase.rpc('register_application_submit', { p })
  if (error) throw new Error(error.message)
}

export const EVENT_LABELS: Record<string, string> = {
  submitted: 'Regjistrimi u dërgua',
  updated: 'Të dhënat u përditësuan',
  info_sent: 'Të dhënat e kërkuara u dërguan',
  request_info: 'Kërkohen të dhëna',
  approve: 'Regjistrimi u aprovua',
  reject: 'Regjistrimi u refuzua',
  suspend: 'Llogaria u pezullua',
  reactivate: 'Llogaria u riaktivizua',
  payment_confirmed: 'Pagesa u konfirmua',
  payment_deleted: 'Pagesa u fshi',
  license_changed: 'Licenca u ndryshua',
  register_applied: 'Aplikim për arkë',
  register_approve: 'Arka u aprovua',
  register_reject: 'Aplikimi për arkë u refuzua',
  register_request_info: 'Kërkohen të dhëna për arkën',
  device_on: 'Pajisja u aktivizua',
  device_off: 'Pajisja u çaktivizua',
  activation_key: 'U krijua çelës aktivizimi',
  device_activated: 'Pajisja u aktivizua me çelës',
}
