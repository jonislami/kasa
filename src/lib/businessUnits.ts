// The units (points of sale) of a business, and the units a worker works in / a product sells in (0050).
// An empty list means every unit, as before; the choice only shows when the business has two or more units.
import { useQuery } from '@tanstack/react-query'
import { friendlyMessage, NOT_READY } from './friendlyError'
import { supabase } from './supabase'

export interface BusinessUnit {
  id: string
  name: string
}

const MISSING = ['PGRST202', '42883', '42703', '42P01', 'PGRST205', 'PGRST204']

/** The approved units of the signed-in business; [] before 0041 or offline. */
export async function fetchBusinessUnits(): Promise<BusinessUnit[]> {
  const { data, error } = await supabase.from('business_units').select('id, name, sort, created_at').eq('status', 'approved').order('sort').order('created_at')
  if (error) return []
  return (data ?? []).map((u) => ({ id: u.id as string, name: u.name as string }))
}

export function useBusinessUnits() {
  return useQuery({ queryKey: ['business-units'], queryFn: fetchBusinessUnits, staleTime: 5 * 60_000 })
}

/** The units saved on a worker (profiles) or a product; [] before 0050. */
export async function fetchUnitIds(table: 'profiles' | 'products', id: string): Promise<string[]> {
  const { data, error } = await supabase.from(table).select('unit_ids').eq('id', id).maybeSingle()
  if (error || !data) return []
  return ((data as { unit_ids?: string[] | null }).unit_ids ?? []) as string[]
}

async function call(fn: 'set_worker_units' | 'set_product_units', args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, args)
  if (!error) return
  if (MISSING.includes(error.code ?? '')) throw new Error(NOT_READY)
  throw new Error(friendlyMessage(error.message))
}

export const setWorkerUnits = (userId: string, units: string[]) => call('set_worker_units', { p_user: userId, p_units: units })
export const setProductUnits = (productId: string, units: string[]) => call('set_product_units', { p_product: productId, p_units: units })

/** Whether something with these units belongs to a unit (empty list or no unit = everywhere). */
export const inUnit = (unitIds: string[] | null | undefined, unit: string | null | undefined) => !unit || !unitIds?.length || unitIds.includes(unit)
