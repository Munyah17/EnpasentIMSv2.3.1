import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { AppUser, UserRole } from '../types'
import { supabase } from '../lib/supabase'

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  /** `identifier` may be an email address or a staff member's username —
   *  whichever the single login field was given. Returns the freshly
   *  fetched profile (the authoritative role source — profiles.role, not
   *  the JWT's user_metadata.role, which can be stale) so callers that
   *  need to gate on role (AdminLogin, SuperAdminLogin) don't have to
   *  re-derive it from a separate, racy supabase.auth.getSession() call. */
  login: (identifier: string, password: string) => Promise<{ profile: AppUser | null; error: string | null }>
  logout: () => Promise<void>
  hasPermission: (permission: string) => boolean
  canAccess: (panel: string) => boolean
  /** Merges a patch into the locally-held user (e.g. after Profile.tsx saves name/phone). */
  updateLocalUser: (patch: Partial<AppUser>) => void
  /** Re-verifies the current password by attempting a fresh sign-in. Required before
   *  allowing a password or email change — proves the caller isn't just an open session
   *  on an unlocked device. Returns false without throwing on a wrong password. */
  reauthenticate: (password: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const PANEL_ACCESS: Record<string, UserRole[]> = {
  dashboard: ['super_admin', 'admin', 'claims_officer', 'policy_admin', 'finance', 'client_relations', 'agent'],
  policies: ['super_admin', 'admin', 'policy_admin', 'finance', 'client_relations', 'agent'],
  claims: ['super_admin', 'admin', 'claims_officer', 'finance'],
  payments: ['super_admin', 'admin', 'finance'],
  products: ['super_admin', 'admin', 'policy_admin'],
  pre_loss_assessments: ['super_admin', 'admin', 'policy_admin', 'claims_officer'],
  agriculture_insurance: ['super_admin', 'admin', 'policy_admin', 'claims_officer'],
  insurer_management: ['super_admin', 'admin'],
  clients: ['super_admin', 'admin', 'policy_admin', 'client_relations', 'agent'],
  member_cards: ['super_admin', 'admin', 'policy_admin', 'claims_officer', 'client_relations', 'finance'],
  staff: ['super_admin', 'admin'],
  system_access_roles: ['super_admin'],
  reminders: ['super_admin', 'admin', 'client_relations'],
  reports: ['super_admin', 'admin', 'finance'],
  leads: ['super_admin', 'admin', 'client_relations', 'agent'],
  email: ['super_admin', 'admin', 'claims_officer', 'policy_admin', 'finance', 'client_relations', 'agent'],
  tickets: ['super_admin', 'admin', 'client_relations'],
  live_chat: ['super_admin', 'admin', 'client_relations'],
  fraud: ['super_admin', 'admin', 'claims_officer'],
  profile: ['super_admin', 'admin', 'claims_officer', 'policy_admin', 'finance', 'client_relations', 'agent', 'policyholder'],
  my_policies: ['policyholder'],
  my_claims: ['policyholder'],
  my_payments: ['policyholder'],
}

/** Guarantees a promise settles within `ms`, so a stalled Supabase auth call
 *  (e.g. a stuck client-side lock) can never leave the UI hung on "Authenticating…"
 *  forever — it fails fast and lets the user retry instead. */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutValue: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(timeoutValue), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, () => { clearTimeout(timer); resolve(timeoutValue) })
  })
}

async function fetchProfile(userId: string, email: string, metaFallback?: Record<string, unknown>): Promise<AppUser | null> {
  // A 5s cap so a stuck query (e.g. supabase-js's internal session lock
  // contending with a concurrent call — see the onAuthStateChange comment
  // in AuthProvider) falls through to the metadata fallback below instead
  // of leaving the whole login() hung until its own 15s timeout.
  const query = supabase.from('profiles').select('*, custom_roles!profiles_custom_role_id_fkey(name)').eq('id', userId).single()
  const { data, error } = await withTimeout(
    Promise.resolve(query),
    5000,
    { data: null, error: { message: 'profiles query timed out' } } as Awaited<typeof query>,
  )

  if (!error && data) {
    return {
      id: data.id,
      name: data.name,
      username: data.username ?? undefined,
      email,
      role: data.role as UserRole,
      department: data.department ?? '',
      phone: data.phone ?? undefined,
      active: data.active ?? true,
      permissions: data.permissions ?? [],
      customRoleId: data.custom_role_id ?? undefined,
      customRoleName: data.custom_roles?.name ?? undefined,
      lastLogin: data.last_login ?? undefined,
      password: '',
    }
  }

  // RLS may block the read — fall back to auth metadata
  if (metaFallback) {
    const role = (metaFallback.role as UserRole) ?? 'policyholder'
    return {
      id: userId,
      name: (metaFallback.name as string) ?? email,
      email,
      role,
      department: (metaFallback.department as string) ?? '',
      phone: undefined,
      active: true,
      permissions: role === 'super_admin' ? ['all']
        : role === 'admin' ? ['all_except_super']
        : [],
      lastLogin: undefined,
      password: '',
    }
  }

  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 4000)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(timeout)
      // Anonymous sessions (the live chat widget) fire the same auth events
      // as a real login — never treat one as an app sign-in.
      if (session?.user && !session.user.is_anonymous) {
        const meta = session.user.user_metadata as Record<string, unknown>
        const profile = await fetchProfile(session.user.id, session.user.email ?? '', meta)
        setUser(profile)
      }
      setLoading(false)
    }).catch(() => {
      clearTimeout(timeout)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // SIGNED_IN is intentionally not handled here — it fires as a side
      // effect of signInWithPassword() resolving inside login(), which
      // already does its own fetchProfile()+setUser() explicitly and
      // synchronously with the call site. Doing a second, independent
      // fetchProfile() here landed at nearly the same instant as that one,
      // and the two concurrent profiles queries right after a fresh
      // sign-in reliably deadlocked supabase-js's internal session lock in
      // production (reproduced consistently on the deployed build; never
      // on local dev, where slower/HMR-instrumented execution happened to
      // never hit the same race window) — login would hang on
      // "Authenticating…" for the full 15s client-side timeout and then
      // fail with "Invalid credentials" despite the password being right.
      if (event === 'SIGNED_OUT') {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const login = useCallback(async (identifier: string, password: string): Promise<{ profile: AppUser | null; error: string | null }> => {
    return withTimeout((async () => {
      let result: AppUser | null = null
      // Distinct from the generic "wrong password" case shown to the user —
      // this is surfaced verbatim so a real infrastructure problem (RLS,
      // RPC missing, a stuck query) doesn't just look identical to a typo'd
      // password with no way to tell the two apart.
      let errorDetail: string | null = null
      const trimmed = identifier.trim()
      // A bare email is used as-is; anything else (a username) is resolved
      // to its email server-side, since profiles isn't readable pre-auth.
      let email = trimmed
      try {
        if (!trimmed.includes('@')) {
          const { data: resolved, error: rpcError } = await supabase.rpc('resolve_login_email', { p_identifier: trimmed })
          if (rpcError) {
            errorDetail = `Could not look up that username: ${rpcError.message}`
          } else if (!resolved) {
            errorDetail = 'No account found with that username.'
          }
          if (!resolved) {
            void supabase.from('login_attempts').insert({ email: trimmed.toLowerCase(), success: false }).then(() => {})
            return { profile: null, error: errorDetail }
          }
          email = resolved as string
        }

        // 5 failed attempts in a row (broken by any success in between)
        // locks sign-in until a human clears it -- see
        // database/add_login_lockout.sql. Checked via a SECURITY DEFINER
        // function because login_attempts' own RLS only grants SELECT to
        // staff, and this has to work for someone who isn't signed in yet.
        // Not logged as another attempt: it never got as far as trying a
        // password, and the lockout state doesn't need another row to prove
        // it -- the same 5 that caused it are still what future checks see.
        const { data: locked, error: lockError } = await supabase.rpc('is_login_locked', { p_email: email })
        if (!lockError && locked) {
          return {
            profile: null,
            error: 'Too many failed sign-in attempts. This account has been locked for security — email admin@enpassent.co.zw to have it unlocked.',
          }
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          errorDetail = error.message
        } else if (data.user) {
          const meta = data.user.user_metadata as Record<string, unknown>
          const profile = await fetchProfile(data.user.id, data.user.email ?? email, meta)
          if (profile && profile.active) {
            setUser(profile)
            result = profile
          } else if (profile && !profile.active) {
            errorDetail = 'This account has been disabled. Contact a Super Admin.'
            await supabase.auth.signOut().catch(() => {})
          } else {
            errorDetail = 'Signed in, but could not load your account profile.'
            await supabase.auth.signOut().catch(() => {})
          }
        }
      } catch (e) {
        errorDetail = `Unexpected error: ${e}`
      }
      // Direct insert (not via db.ts) so this always-loaded auth module
      // doesn't drag the whole data layer + Supabase SDK into the eager
      // bundle — everything else in the app reaches Supabase through
      // lazy-loaded pages, only auth is loaded up front.
      void supabase.from('login_attempts').insert({ email: email.toLowerCase(), success: !!result }).then(() => {})
      return { profile: result, error: errorDetail }
    })(), 15000, { profile: null, error: 'The sign-in request timed out. Check your connection and try again.' })
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut().catch(() => {})
    setUser(null)
  }, [])

  const hasPermission = useCallback((permission: string): boolean => {
    if (!user) return false
    if (user.permissions.includes('all') || user.permissions.includes('all_except_super')) return true
    return user.permissions.includes(permission)
  }, [user])

  const canAccess = useCallback((panel: string): boolean => {
    if (!user) return false
    const allowed = PANEL_ACCESS[panel]
    if (!allowed) return true
    return allowed.includes(user.role)
  }, [user])

  const updateLocalUser = useCallback((patch: Partial<AppUser>) => {
    setUser(prev => prev ? { ...prev, ...patch } : prev)
  }, [])

  const reauthenticate = useCallback(async (password: string): Promise<boolean> => {
    if (!user?.email) return false
    return withTimeout(
      supabase.auth.signInWithPassword({ email: user.email, password }).then(({ error }) => !error),
      15000, false,
    )
  }, [user])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission, canAccess, updateLocalUser, reauthenticate }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
