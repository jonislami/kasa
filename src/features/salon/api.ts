import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/business'

export class SalonNotMigrated extends Error {
  constructor() {
    super('Terminet aktivizohen pasi të ekzekutohet migrimi 0008_salon.sql në Supabase.')
  }
}
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883', '42703'])
function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new SalonNotMigrated()
  throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Staff (names for the till and the calendar)
// ---------------------------------------------------------------------------
export interface Staff {
  id: string
  full_name: string
  role: Role
  specialty: string | null
  commission_pct: number | null
}

export async function fetchStaff(): Promise<Staff[]> {
  const { data, error } = await supabase.rpc('business_staff')
  if (error) fail(error)
  return ((data ?? []) as Staff[]).map((s) => ({ ...s, commission_pct: s.commission_pct == null ? null : Number(s.commission_pct) }))
}

/** Stable colour per person (same in the till, calendar and reports). */
const PALETTE = ['#7C3AED', '#BE185D', '#0369A1', '#A16207', '#047857', '#C2410C', '#4338CA', '#0F766E']
export function staffColor(id: string, all: { id: string }[]): string {
  const i = all.findIndex((s) => s.id === id)
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('')
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------
export type AppointmentStatus = 'booked' | 'arrived' | 'done' | 'paid' | 'no_show' | 'cancelled'

export interface Appointment {
  id: string
  staff_id: string
  customer_name: string
  customer_phone: string | null
  product_id: string | null
  service_name: string
  price: number
  starts_at: string
  duration_min: number
  status: AppointmentStatus
  sale_id: string | null
  note: string | null
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'Në pritje',
  arrived: 'Klienti ka ardhur',
  done: 'I kryer',
  paid: 'I paguar',
  no_show: 'Nuk erdhi',
  cancelled: 'I anuluar',
}

const COLS = 'id, staff_id, customer_name, customer_phone, product_id, service_name, price, starts_at, duration_min, status, sale_id, note'

export async function fetchAppointments(fromIso: string, toIso: string): Promise<Appointment[]> {
  const { data, error } = await supabase.from('appointments').select(COLS).gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at')
  if (error) fail(error)
  return ((data ?? []) as Appointment[]).map((a) => ({ ...a, price: Number(a.price) }))
}

export async function fetchAppointment(id: string): Promise<Appointment | null> {
  const { data, error } = await supabase.from('appointments').select(COLS).eq('id', id).maybeSingle()
  if (error) fail(error)
  return data ? { ...(data as Appointment), price: Number(data.price) } : null
}

export interface AppointmentInput {
  id?: string
  staff_id: string
  customer_name: string
  customer_phone?: string
  product_id?: string | null
  service_name?: string
  price?: number
  starts_at: string
  duration_min?: number
  note?: string
}

export async function saveAppointment(p: AppointmentInput): Promise<Appointment> {
  const { data, error } = await supabase.rpc('save_appointment', { p })
  if (error) fail(error)
  return data as Appointment
}

export async function setAppointmentStatus(id: string, status: Exclude<AppointmentStatus, 'paid'>): Promise<Appointment> {
  const { data, error } = await supabase.rpc('set_appointment_status', { p_id: id, p_status: status })
  if (error) fail(error)
  return data as Appointment
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------
export interface CommissionRow {
  staff_id: string
  name: string
  role: Role
  active: boolean
  specialty: string | null
  commission_pct: number
  services: number
  products: number
  value: number
  service_value: number
  commission: number
}

export async function fetchCommission(from: string, to: string): Promise<CommissionRow[]> {
  const { data, error } = await supabase.rpc('commission_report', { p_from: from, p_to: to })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    ...(r as unknown as CommissionRow),
    commission_pct: Number(r.commission_pct),
    services: Number(r.services),
    products: Number(r.products),
    value: Number(r.value),
    service_value: Number(r.service_value),
    commission: Number(r.commission),
  }))
}

export async function setSpecialty(userId: string, specialty: string): Promise<void> {
  const { error } = await supabase.rpc('set_user_specialty', { p_user: userId, p_specialty: specialty })
  if (error) fail(error)
}
