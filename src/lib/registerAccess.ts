// Who may work on a till (0052): every worker of the business, or only the ones given access. Owners and managers may
// always use every till. The owner / manager of the business and the platform admin change it.
import { friendlyMessage, NOT_READY } from './friendlyError'
import { supabase } from './supabase'

const MISSING = ['PGRST202', '42883', '42P01', 'PGRST205']

export interface RegisterAccess {
  register: { id: string; name: string; unit: string | null }
  restricted: boolean
  workers: { id: string; full_name: string; worker_no: number | null; has_pin: boolean; allowed: boolean }[]
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (MISSING.includes(error.code ?? '')) throw new Error(NOT_READY)
    throw new Error(friendlyMessage(error.message))
  }
  return data as T
}

export const fetchRegisterAccess = (registerId: string) => rpc<RegisterAccess>('register_access', { p_register: registerId })
export const setRegisterAccess = (registerId: string, userId: string, allowed: boolean) =>
  rpc<void>('register_access_set', { p_register: registerId, p_user: userId, p_allowed: allowed })
export const openRegisterAccess = (registerId: string) => rpc<void>('register_access_open', { p_register: registerId })
