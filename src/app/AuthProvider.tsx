import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import type { BusinessType, Role } from '@/lib/business'

export interface Profile {
  id: string
  business_id: string
  role: Role
  full_name: string
  email: string | null
  active: boolean
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
}

export interface SessionContext {
  user_id: string
  is_platform_admin: boolean
  profile: Profile | null
  business: Business | null
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
  const ctxQuery = useQuery({
    queryKey: ['session-context', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_context')
      if (error) throw error
      return data as SessionContext
    },
  })

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
    await supabase.auth.signOut()
    queryClient.clear()
  }, [queryClient])

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
