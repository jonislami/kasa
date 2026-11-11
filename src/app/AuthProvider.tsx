import { setLicense } from '@/lib/license'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { cacheOwnerChanged, forgetCache } from '@/lib/queryPersist'
import type { BusinessType, Role } from '@/lib/business'

export interface Profile {
  id: string
  business_id: string
  role: Role
  full_name: string
  email: string | null
  active: boolean
  login_kind?: 'email' | 'pin'
}

export interface Business {
  id: string
  name: string
  type: BusinessType
  active: boolean
  city: string | null
  address: string | null
  nui: string | null
  vat_number: string | null
  phone?: string | null
  fiscal_number?: string | null
  /** 0029 (SEF): registration status, license, whether the apps may be installed. Absent on older databases. */
  status?: 'pending' | 'needs_info' | 'approved' | 'active' | 'rejected' | 'suspended'
  status_note?: string | null
  license?: {
    state: 'active' | 'expiring' | 'grace' | 'expired' | 'suspended' | 'cancelled'
    expires_on: string | null
    grace_until: string | null
    days_left: number | null
    max_devices: number
  }
  can_install?: boolean
}

export interface SessionContext {
  user_id: string
  is_platform_admin: boolean
  profile: Profile | null
  business: Business | null
  /** Set for an accountant account (migration 0012): how many clients and open invitations it has. */
  accountant?: { full_name: string; email: string; clients: number; invited: number } | null
  /** true when the server could not be reached and the last known context is used (offline start). */
  offline?: boolean
}

// Last known session context per user, so the till opens without internet.
const ctxKey = (userId: string) => `kasa.ctx.${userId}`

function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  return /fetch|network|load failed|timeout|ERR_INTERNET/i.test(String((e as { message?: string })?.message ?? e))
}

type Status = 'loading' | 'anonymous' | 'ready' | 'error'

interface AuthValue {
  status: Status
  session: Session | null
  ctx: SessionContext | null
  error: string | null
  signIn: (email: string, password: string, remember: boolean) => Promise<string | null>
  signOut: () => Promise<void>
  refresh: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

// "Më mbaj të kyçur" unchecked: the session lives only while this browser session lives.
const NO_REMEMBER_KEY = 'kasa.noRemember'
const ALIVE_KEY = 'kasa.alive'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(!supabaseConfigured)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!supabaseConfigured) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session && localStorage.getItem(NO_REMEMBER_KEY) && !sessionStorage.getItem(ALIVE_KEY)) {
        await supabase.auth.signOut({ scope: 'local' })
        localStorage.removeItem(NO_REMEMBER_KEY)
        if (!cancelled) setSession(null)
      } else if (!cancelled) {
        setSession(data.session)
      }
      if (!cancelled) setSessionLoaded(true)
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id

  // Another person signed in on this device: drop the previous person's cached screens.
  useEffect(() => {
    if (userId && cacheOwnerChanged(userId)) {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session-context' })
      void forgetCache()
    }
  }, [userId, queryClient])
  const ctxQuery = useQuery({
    queryKey: ['session-context', userId],
    networkMode: 'always', // falls back to the last known context offline
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    // a till stays open for days: keep the license and the business status current
    refetchInterval: 30 * 60_000,
    retry: (count, e) => !isNetworkError(e) && count < 1,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc('my_context')
        if (error) throw error
        try {
          localStorage.setItem(ctxKey(userId!), JSON.stringify(data))
        } catch {
          /* storage unavailable */
        }
        return data as SessionContext
      } catch (e) {
        if (isNetworkError(e)) {
          try {
            const cached = localStorage.getItem(ctxKey(userId!))
            if (cached) return { ...(JSON.parse(cached) as SessionContext), offline: true }
          } catch {
            /* fall through */
          }
        }
        throw e
      }
    },
  })

  // SEF license (0029): the till checks it before every sale.
  useEffect(() => {
    setLicense(ctxQuery.data?.business?.license)
  }, [ctxQuery.data?.business?.license])

  // Back online after an offline start: load the fresh context.
  useEffect(() => {
    if (!ctxQuery.data?.offline) return
    const onOnline = () => void queryClient.invalidateQueries({ queryKey: ['session-context'] })
    window.addEventListener('online', onOnline)
    const t = window.setInterval(onOnline, 60_000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.clearInterval(t)
    }
  }, [ctxQuery.data?.offline, queryClient])

  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      if (/invalid login credentials/i.test(error.message)) return 'Email-i ose fjalëkalimi është gabim'
      if (/email not confirmed/i.test(error.message)) return 'Email-i nuk është konfirmuar'
      if (/fetch/i.test(error.message)) return 'Nuk ka lidhje me serverin'
      return error.message
    }
    if (remember) localStorage.removeItem(NO_REMEMBER_KEY)
    else localStorage.setItem(NO_REMEMBER_KEY, '1')
    sessionStorage.setItem(ALIVE_KEY, '1')
    // Best effort; not critical if the schema is not deployed yet.
    void supabase.rpc('log_action', { p_action: 'login', p_entity: 'auth', p_details: { method: 'password' } })
    return null
  }, [])

  const signOut = useCallback(async () => {
    try {
      if (session?.user.id) localStorage.removeItem(ctxKey(session.user.id))
    } catch {
      /* storage unavailable */
    }
    // Only this device: the same person may be signed in on another till or phone.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    queryClient.clear()
    await forgetCache()
  }, [queryClient, session?.user.id])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['session-context'] })
  }, [queryClient])

  const value = useMemo<AuthValue>(() => {
    let status: Status
    if (!sessionLoaded) status = 'loading'
    else if (!session) status = 'anonymous'
    else if (ctxQuery.isError) status = 'error'
    else if (!ctxQuery.data) status = 'loading'
    else status = 'ready'
    return {
      status,
      session,
      ctx: ctxQuery.data ?? null,
      error: ctxQuery.error ? (ctxQuery.error as Error).message : null,
      signIn,
      signOut,
      refresh,
    }
  }, [sessionLoaded, session, ctxQuery.data, ctxQuery.isError, ctxQuery.error, signIn, signOut, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

/** Business + profile of a signed-in business user (guaranteed inside AuthGuard). */
export function useBusiness(): { business: Business; profile: Profile } {
  const { ctx } = useAuth()
  if (!ctx?.business || !ctx.profile) throw new Error('useBusiness outside a business session')
  return { business: ctx.business, profile: ctx.profile }
}
