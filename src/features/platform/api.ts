import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { BusinessType } from '@/lib/business'

export interface PlatformBusiness {
  id: string
  name: string
  type: BusinessType
  active: boolean
  city: string | null
  owner_name: string | null
  owner_email: string | null
  users_count: number
  registers_count: number
  has_logged_in: boolean
  sales_today: number
  created_at: string
}

export async function fetchPlatformBusinesses(): Promise<PlatformBusiness[]> {
  const { data, error } = await supabase.rpc('platform_businesses')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: PlatformBusiness) => ({
    ...r,
    users_count: Number(r.users_count),
    registers_count: Number(r.registers_count),
    sales_today: Number(r.sales_today),
  }))
}

export async function setBusinessActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('platform_set_business_active', { p_business_id: id, p_active: active })
  if (error) throw new Error(error.message)
}

async function callPlatformAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('platform-admin', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'Gabim në server')
    }
    throw new Error('Nuk ka lidhje me serverin (a është vendosur funksioni platform-admin?)')
  }
  return data as T
}

export function createBusiness(input: {
  type: BusinessType
  name: string
  city?: string
  owner_name: string
  email: string
  password: string
}) {
  return callPlatformAdmin<{ business_id: string; email: string }>({ action: 'create_business', ...input })
}

export function resetOwnerPassword(business_id: string, password: string) {
  return callPlatformAdmin<{ email: string }>({ action: 'reset_password', business_id, password })
}

/** 10 characters without look-alikes (0/O, 1/l/I), at least one of each class. */
export function generatePassword(length = 10): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '#@$%&*!?'
  const all = lower + upper + digits + symbols
  const rand = (n: number) => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0] % n
  }
  const chars = [upper[rand(upper.length)], lower[rand(lower.length)], digits[rand(digits.length)], symbols[rand(symbols.length)]]
  while (chars.length < length) chars.push(all[rand(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
