import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/business'

const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST202', '42883', '42703'])

export class SettingsNotMigrated extends Error {
  constructor() {
    super('Kjo pjesë aktivizohet pasi të ekzekutohet migrimi 0005_users_devices.sql në Supabase.')
  }
}

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_MIGRATED.has(error.code)) throw new SettingsNotMigrated()
  throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Business data
// ---------------------------------------------------------------------------
export interface BusinessInfo {
  id: string
  name: string
  city: string | null
  address: string | null
  phone: string | null
  nui: string | null
  vat_number: string | null
  fiscal_number: string | null
}

export async function fetchBusinessInfo(id: string): Promise<BusinessInfo> {
  const { data, error } = await supabase.from('businesses').select('id, name, city, address, phone, nui, vat_number, fiscal_number').eq('id', id).single()
  if (error) fail(error)
  return data as BusinessInfo
}

export async function saveBusinessInfo(b: BusinessInfo): Promise<void> {
  const clean = (v: string | null) => (v ?? '').trim() || null
  if (!b.name.trim()) throw new Error('Shkruaj emrin e biznesit')
  if (b.nui && !/^\d{9}$/.test(b.nui.trim())) throw new Error('NUI ka 9 shifra')
  const { error } = await supabase
    .from('businesses')
    .update({ name: b.name.trim(), city: clean(b.city), address: clean(b.address), phone: clean(b.phone), nui: clean(b.nui), vat_number: clean(b.vat_number), fiscal_number: clean(b.fiscal_number) })
    .eq('id', b.id)
  if (error) fail(error)
  void supabase.rpc('log_action', { p_action: 'settings_change', p_entity: 'business', p_entity_id: b.id, p_details: { section: 'business' } })
}

// ---------------------------------------------------------------------------
// Printer & receipt settings (business_settings)
// ---------------------------------------------------------------------------
export interface ReceiptSettings {
  receipt_header: string | null
  receipt_footer: string | null
  paper_width: 58 | 80
  printer_chunk: number
  printer_charset: 'cp1250' | 'cp852' | 'replace'
  settings: {
    auto_print?: boolean
    copies?: number
    open_drawer?: boolean
    show_logo?: boolean
    show_vat?: boolean
    show_barcode?: boolean
    cut?: boolean
  }
}

export const DEFAULT_RECEIPT: ReceiptSettings = {
  receipt_header: null,
  receipt_footer: 'Faleminderit për blerjen!',
  paper_width: 80,
  printer_chunk: 180,
  printer_charset: 'replace',
  settings: { auto_print: false, copies: 1, open_drawer: false, show_logo: true, show_vat: true, show_barcode: false, cut: true },
}

const RECEIPT_CACHE = 'kasa.receiptSettings'

/** Printer/receipt settings; the last copy is kept on the device so printing works offline. */
export async function fetchReceiptSettings(): Promise<ReceiptSettings> {
  try {
    const { data, error } = await supabase.from('business_settings').select('receipt_header, receipt_footer, paper_width, printer_chunk, printer_charset, settings').maybeSingle()
    if (error) throw error
    const out = data
      ? { ...DEFAULT_RECEIPT, ...(data as ReceiptSettings), settings: { ...DEFAULT_RECEIPT.settings, ...((data as ReceiptSettings).settings ?? {}) } }
      : DEFAULT_RECEIPT
    try {
      localStorage.setItem(RECEIPT_CACHE, JSON.stringify(out))
    } catch {
      /* storage unavailable */
    }
    return out
  } catch (e) {
    try {
      const cached = localStorage.getItem(RECEIPT_CACHE)
      if (cached) return JSON.parse(cached) as ReceiptSettings
    } catch {
      /* ignore */
    }
    if (e && typeof e === 'object' && 'code' in e) fail(e as { code?: string; message: string })
    throw e
  }
}

export async function saveReceiptSettings(businessId: string, s: ReceiptSettings): Promise<void> {
  const { error } = await supabase
    .from('business_settings')
    .update({ ...s, updated_at: new Date().toISOString() })
    .eq('business_id', businessId)
  if (error) fail(error)
  void supabase.rpc('log_action', { p_action: 'settings_change', p_entity: 'business_settings', p_entity_id: businessId, p_details: { section: 'printer' } })
}

// ---------------------------------------------------------------------------
// Users & PINs
// ---------------------------------------------------------------------------
export interface BusinessUser {
  id: string
  full_name: string
  email: string | null
  role: Role
  login_kind: 'email' | 'pin'
  phone: string | null
  active: boolean
  commission_pct: number
  has_pin: boolean
  pin_locked: boolean
  last_pin_login_at: string | null
  last_sign_in_at: string | null
  created_at: string
  can_manage: boolean
}

export async function fetchUsers(): Promise<BusinessUser[]> {
  const { data, error } = await supabase.rpc('business_users')
  if (error) fail(error)
  return ((data ?? []) as BusinessUser[]).map((u) => ({ ...u, commission_pct: Number(u.commission_pct) }))
}

export interface NewUser {
  full_name: string
  role: 'worker' | 'manager'
  pin?: string
  email?: string
  password?: string
  commission_pct?: number
  phone?: string
}

async function invokeUsers(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('business-users', { body })
  if (!error) return data as Record<string, unknown>
  const ctx = (error as { context?: Response }).context
  let msg = ''
  try {
    msg = ctx ? String(((await ctx.json()) as { error?: string }).error ?? '') : ''
  } catch {
    msg = ''
  }
  if (!ctx) throw new Error('Nuk ka lidhje me serverin')
  if (ctx.status === 404) throw new Error('Edge Function "business-users" nuk është vendosur ende në Supabase.')
  throw new Error(msg || error.message)
}

export async function createUser(u: NewUser): Promise<string> {
  const r = await invokeUsers({ action: 'create_user', ...u })
  return r.user_id as string
}

export async function setUserPassword(userId: string, password: string): Promise<void> {
  await invokeUsers({ action: 'set_password', user_id: userId, password })
}

export async function updateUser(p: { id: string; full_name?: string; role?: Role; commission_pct?: number; phone?: string | null; active?: boolean }): Promise<void> {
  const { error } = await supabase.rpc('update_business_user', { p })
  if (error) fail(error)
}

export async function setUserPin(userId: string, pin: string): Promise<void> {
  const { error } = await supabase.rpc('set_user_pin', { p_user: userId, p_pin: pin })
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// Registers & devices
// ---------------------------------------------------------------------------
export interface Register {
  id: string
  name: string
  active: boolean
  atk_pos_id: string | null
  created_at: string
}

export async function fetchRegisters(): Promise<Register[]> {
  const { data, error } = await supabase.from('registers').select('id, name, active, atk_pos_id, created_at').order('created_at')
  if (error) fail(error)
  return (data ?? []) as Register[]
}

export async function saveRegister(r: { id?: string; name: string; active?: boolean }): Promise<void> {
  if (!r.name.trim()) throw new Error('Shkruaj emrin e arkës')
  const q = r.id
    ? supabase.from('registers').update({ name: r.name.trim(), ...(r.active === undefined ? {} : { active: r.active }) }).eq('id', r.id)
    : supabase.from('registers').insert({ name: r.name.trim() })
  const { error } = await q
  if (error) fail(error)
  void supabase.rpc('log_action', { p_action: 'settings_change', p_entity: 'register', p_entity_id: r.id ?? null, p_details: { name: r.name.trim(), active: r.active } })
}

export interface DeviceRow {
  id: string
  register_id: string | null
  name: string
  platform: 'web' | 'electron' | 'capacitor'
  app_version: string | null
  user_agent: string | null
  active: boolean
  linked_at: string
  last_seen_at: string
  last_user_id: string | null
}

export async function fetchDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from('devices')
    .select('id, register_id, name, platform, app_version, user_agent, active, linked_at, last_seen_at, last_user_id')
    .order('last_seen_at', { ascending: false })
  if (error) fail(error)
  return (data ?? []) as DeviceRow[]
}

export async function updateDevice(p: { device_id: string; name?: string; register_id?: string | null; active?: boolean }): Promise<void> {
  const { error } = await supabase.rpc('update_device', { p })
  if (error) fail(error)
}
