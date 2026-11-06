import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { configureConnectivity, trackedFetch } from '@/lib/connectivity'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False when .env.local is missing – the app shows a setup message instead of crashing. */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true }, global: { fetch: trackedFetch } },
)

if (url && anonKey) configureConnectivity(url, anonKey)

/** Postgres / PostgREST codes meaning "not migrated yet" – callers fall back gracefully. */
const MISSING_SCHEMA_CODES = new Set(['42703', 'PGRST202', '42P01', 'PGRST205', '42883'])

export function isMissingSchema(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code))
}
