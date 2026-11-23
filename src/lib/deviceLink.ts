import { supabase } from '@/lib/supabase'
import { device } from '@/lib/device'

/**
 * Link between this installation and a business (for PIN login).
 * Created when a manager signs in with email here; the secret is kept only on this device (encrypted).
 */
export interface DeviceLink {
  device_id: string
  business_id: string
  business_name: string
  secret: string
  linked_at: string
}

const KEY = 'device-link'

export async function getLink(): Promise<DeviceLink | null> {
  try {
    return await device.storage.get<DeviceLink>(KEY)
  } catch {
    return null
  }
}

export async function clearLink(): Promise<void> {
  try {
    await device.storage.remove(KEY)
  } catch {
    /* storage unavailable */
  }
}

/** "Chrome · Windows", "Safari · iPhone"… – default name of the device in Settings → Arkat. */
export function defaultDeviceName(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Shfletues'
  const os = /Android/.test(ua) ? 'Android' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  if (device.platform === 'electron') return `KontoSef · ${os || 'Windows'}`
  if (device.platform === 'capacitor') return `KontoSef · ${os || 'telefon'}`
  return [browser, os].filter(Boolean).join(' · ')
}

/**
 * The till this device was activated for (its activation key, or the register a manager assigned to it). A device
 * bound to a till sells and signs only as that till: its ATK key and POS ID belong to it.
 */
const lockKey = (businessId: string) => `kasa.registerLock.${businessId}`
export function registerLock(businessId: string): string | null {
  try {
    return localStorage.getItem(lockKey(businessId))
  } catch {
    return null
  }
}
export function setRegisterLock(businessId: string, registerId: string | null) {
  try {
    if (registerId) {
      localStorage.setItem(lockKey(businessId), registerId)
      localStorage.setItem(`kasa.register.${businessId}`, registerId)
    } else localStorage.removeItem(lockKey(businessId))
  } catch {
    /* storage unavailable */
  }
}

/**
 * The till this device belongs to, as the server knows it now: the id, null when it has none, undefined when it
 * cannot be asked (offline, or not a linked device). Keeps the local binding in step.
 */
export async function fetchDeviceRegister(businessId: string): Promise<string | null | undefined> {
  const link = await getLink()
  if (!link || link.business_id !== businessId) return undefined
  const { data, error } = await supabase.rpc('device_heartbeat', { p: { device_id: link.device_id, app_version: device.appVersion } })
  if (error || !data || typeof data !== 'object' || !('register_id' in data)) return undefined
  const reg = (data as { register_id: string | null }).register_id
  setRegisterLock(businessId, reg)
  return reg
}

/** The owner / manager gives this device its till (once); from then on it sells only as that till. */
export async function assignDeviceRegister(businessId: string, registerId: string): Promise<void> {
  const link = await getLink()
  if (!link || link.business_id !== businessId) throw new Error('Kjo pajisje nuk është e lidhur me biznesin')
  const { error } = await supabase.rpc('update_device', { p: { device_id: link.device_id, register_id: registerId } })
  if (error) throw new Error(/42501|admini ose menaxheri/i.test(`${error.code} ${error.message}`) ? 'Vetëm pronari ose menaxheri e cakton arkën' : error.message)
  setRegisterLock(businessId, registerId)
}

/**
 * Called after a manager signs in: links this device to the business (once), then keeps it alive.
 * Silent when the migration is missing or the user is not a manager.
 */
export async function ensureDeviceLinked(business: { id: string; name: string }, isManager: boolean): Promise<DeviceLink | null> {
  const deviceId = await device.getDeviceId()
  const link = await getLink()
  if (link && link.business_id === business.id && link.device_id === deviceId) {
    const { data } = await supabase.rpc('device_heartbeat', { p: { device_id: deviceId, app_version: device.appVersion } })
    // The register this device is bound to (activation key / assigned by a manager): the till uses only that one.
    if (data && typeof data === 'object' && 'register_id' in data) setRegisterLock(business.id, (data as { register_id: string | null }).register_id)
    // Removed, moved or blocked on the server: a manager signing in here links it again.
    if ((data && (data as { active: boolean }).active) || !isManager) return link
  }
  if (!isManager) return link && link.business_id === business.id ? link : null

  const { data, error } = await supabase.rpc('link_device', {
    p: {
      device_id: deviceId,
      name: defaultDeviceName(),
      platform: device.platform,
      app_version: device.appVersion,
      user_agent: navigator.userAgent,
    },
  })
  if (error || !data) return null
  const next: DeviceLink = {
    device_id: deviceId,
    business_id: business.id,
    business_name: business.name,
    secret: (data as { secret: string }).secret,
    linked_at: new Date().toISOString(),
  }
  try {
    await device.storage.set(KEY, next)
  } catch {
    return null
  }
  return next
}

/**
 * SEF app (0030): links this installation with the one-time key the platform admin generated,
 * without anyone signing in. The result is the same link a manager's e-mail sign-in creates.
 */
export async function activateWithKey(key: string): Promise<DeviceLink> {
  const deviceId = await device.getDeviceId()
  const { data, error } = await supabase.rpc('activate_device', {
    p: { key, device_id: deviceId, name: defaultDeviceName(), platform: device.platform, app_version: device.appVersion, user_agent: navigator.userAgent },
  })
  if (error) {
    if (error.hint === 'activation_key' || error.hint === 'license_devices') throw new Error(error.message)
    if (error.code === 'PGRST202') throw new Error('Aktivizimi me çelës nuk është vendosur ende në server.')
    if (/fetch|network|load failed/i.test(error.message)) throw new Error('Nuk ka lidhje me internetin. Aktivizimi kërkon internet.')
    throw new Error(error.message)
  }
  const r = data as { device_id: string; secret: string; business_id: string; business_name: string; register_id: string | null }
  const link: DeviceLink = { device_id: r.device_id, business_id: r.business_id, business_name: r.business_name, secret: r.secret, linked_at: new Date().toISOString() }
  await device.storage.set(KEY, link)
  setRegisterLock(r.business_id, r.register_id)
  return link
}

// ---------------------------------------------------------------------------
// PIN login (Edge Function pin-login)
// ---------------------------------------------------------------------------
export interface PinWorker {
  id: string
  full_name: string
  role: 'admin' | 'manager' | 'worker'
  has_pin: boolean
  locked: boolean
}

export class PinLoginError extends Error {
  constructor(
    public code: 'device' | 'wrong_pin' | 'locked' | 'no_pin' | 'not_found' | 'no_access' | 'server' | 'network',
    message: string,
    public left?: number,
  ) {
    super(message)
  }
}

async function callPin(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new PinLoginError('network', 'Nuk ka lidhje me serverin.')
  let res
  try {
    res = await supabase.functions.invoke('pin-login', { body })
  } catch {
    throw new PinLoginError('network', 'Nuk ka lidhje me serverin.')
  }
  const { data, error } = res
  if (!error) return data as Record<string, unknown>
  // FunctionsHttpError carries the response; read our { error } payload from it.
  const raw = (error as { context?: unknown }).context
  // a fetch failure (no internet) carries an Error, not the server's Response
  const ctx = raw instanceof Response ? raw : undefined
  let payload: Record<string, unknown> | null = null
  try {
    payload = ctx ? ((await ctx.json()) as Record<string, unknown>) : null
  } catch {
    payload = null
  }
  const code = String(payload?.error ?? '')
  if (code === 'device') throw new PinLoginError('device', 'Kjo pajisje nuk është më e lidhur me biznesin. Shkruaj një çelës të ri aktivizimi.')
  if (code === 'wrong_pin') {
    const left = Number(payload?.left ?? 0)
    throw new PinLoginError('wrong_pin', left ? `PIN-i është gabim. Të mbetën ${left} prova.` : 'PIN-i është gabim.', left)
  }
  if (code === 'locked') throw new PinLoginError('locked', 'Shumë prova të gabuara. Provo pas 15 minutash ose kërko PIN të ri nga menaxheri.')
  if (code === 'no_pin') throw new PinLoginError('no_pin', 'Ky punëtor nuk ka PIN. Menaxheri e vendos te Cilësimet → Përdoruesit.')
  if (code === 'not_found') throw new PinLoginError('not_found', 'Punëtori nuk u gjet ose është çaktivizuar.')
  if (code === 'no_access') throw new PinLoginError('no_access', 'Nuk ke qasje në këtë arkë. Pronari ose menaxheri ta jep te Cilësimet → Arkat → Punëtorët.')
  if (!ctx) throw new PinLoginError('network', 'Nuk ka lidhje me serverin.')
  throw new PinLoginError('server', code || 'Hyrja me PIN nuk punon ende (Edge Function pin-login).')
}

export async function fetchPinWorkers(link: DeviceLink): Promise<{ business: { name: string }; workers: PinWorker[]; offline?: boolean }> {
  try {
    const r = (await callPin({ action: 'workers', device_id: link.device_id, secret: link.secret })) as unknown as { business: { name: string }; workers: PinWorker[] }
    void saveCachedPinWorkers(r)
    return r
  } catch (e) {
    // no internet: the list kept from the last time
    if (e instanceof PinLoginError && e.code === 'network') {
      const cached = await cachedPinWorkers()
      if (cached) return { ...cached, offline: true }
    }
    throw e
  }
}

export async function pinLogin(link: DeviceLink, userId: string, pin: string): Promise<void> {
  const r = await callPin({ action: 'login', device_id: link.device_id, secret: link.secret, user_id: userId, pin })
  const s = r.session as { access_token: string; refresh_token: string } | undefined
  if (!s) throw new PinLoginError('server', 'Seanca nuk u krijua')
  const { error } = await supabase.auth.setSession(s)
  if (error) throw new PinLoginError('server', error.message)
  // for signing in on this device without internet next time
  await rememberPin(userId, pin)
}

// ---------------------------------------------------------------------------
// Working without internet: the list of workers and a local check of the PIN
// ---------------------------------------------------------------------------
// After a worker signs in online with the PIN, this device keeps (encrypted, device.storage) a PBKDF2 hash of the
// PIN – never the PIN itself – and the list of workers. Without internet the PIN is checked against that hash, with
// the same limit as the server (5 wrong tries → 15 minutes). The hash is refreshed at every online sign-in, so a PIN
// changed by the manager takes effect on this device at the next online sign-in; a hash older than 30 days is not used.
const WORKERS_KEY = 'pin-workers'
const VERIFIERS_KEY = 'pin-verifiers'
const MAX_TRIES = 5
const LOCK_MS = 15 * 60_000
const VERIFIER_DAYS = 30
const ITERATIONS = 150_000

interface Verifier {
  salt: string
  hash: string
  at: string
  fails: number
  locked_until: string | null
}

const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function pbkdf2(pin: string, salt: Uint8Array, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${userId}:${pin}`), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, key, 256)
  return toB64(bits)
}

async function verifiers(): Promise<Record<string, Verifier>> {
  try {
    return (await device.storage.get<Record<string, Verifier>>(VERIFIERS_KEY)) ?? {}
  } catch {
    return {}
  }
}

async function saveVerifiers(v: Record<string, Verifier>): Promise<void> {
  try {
    await device.storage.set(VERIFIERS_KEY, v)
  } catch {
    /* storage unavailable – online sign-in still works */
  }
}

/** After a successful online sign-in: the PIN hash for signing in on this device without internet. */
export async function rememberPin(userId: string, pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const all = await verifiers()
  all[userId] = { salt: toB64(salt), hash: await pbkdf2(pin, salt, userId), at: new Date().toISOString(), fails: 0, locked_until: null }
  await saveVerifiers(all)
}

/** Checks the PIN on this device (no internet). */
export async function checkPinOffline(userId: string, pin: string): Promise<void> {
  const all = await verifiers()
  const v = all[userId]
  if (!v || Date.now() - Date.parse(v.at) > VERIFIER_DAYS * 86_400_000)
    throw new PinLoginError('network', 'Pa internet: ky punëtor nuk ka hyrë së fundi në këtë pajisje. Hyrja e parë (dhe pas 30 ditësh) kërkon internet.')
  if (v.locked_until && Date.parse(v.locked_until) > Date.now()) throw new PinLoginError('locked', 'Shumë prova të gabuara. Provo pas 15 minutash.')
  if ((await pbkdf2(pin, fromB64(v.salt), userId)) !== v.hash) {
    v.fails += 1
    const left = Math.max(0, MAX_TRIES - v.fails)
    if (left === 0) {
      v.locked_until = new Date(Date.now() + LOCK_MS).toISOString()
      v.fails = 0
    }
    await saveVerifiers(all)
    if (left === 0) throw new PinLoginError('locked', 'Shumë prova të gabuara. Provo pas 15 minutash.')
    throw new PinLoginError('wrong_pin', `PIN-i është gabim. Të mbetën ${left} prova.`, left)
  }
  v.fails = 0
  v.locked_until = null
  await saveVerifiers(all)
}

/** The workers of this device's business, kept for showing the list without internet. */
export async function cachedPinWorkers(): Promise<{ business: { name: string }; workers: PinWorker[] } | null> {
  try {
    return await device.storage.get<{ business: { name: string }; workers: PinWorker[] }>(WORKERS_KEY)
  } catch {
    return null
  }
}

export async function saveCachedPinWorkers(r: { business: { name: string }; workers: PinWorker[] }): Promise<void> {
  try {
    await device.storage.set(WORKERS_KEY, r)
  } catch {
    /* ignore */
  }
}
