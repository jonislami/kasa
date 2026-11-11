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
  if (device.platform === 'electron') return `Kasa · ${os || 'Windows'}`
  if (device.platform === 'capacitor') return `Kasa · ${os || 'telefon'}`
  return [browser, os].filter(Boolean).join(' · ')
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
    // The register a manager assigned to this device becomes the till's default.
    const reg = (data as { register_id?: string | null } | null)?.register_id
    if (reg) {
      try {
        localStorage.setItem(`kasa.register.${business.id}`, reg)
      } catch {
        /* storage unavailable */
      }
    }
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
  if (r.register_id) {
    try {
      localStorage.setItem(`kasa.register.${r.business_id}`, r.register_id)
    } catch {
      /* storage unavailable */
    }
  }
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
    public code: 'device' | 'wrong_pin' | 'locked' | 'no_pin' | 'not_found' | 'server' | 'network',
    message: string,
    public left?: number,
  ) {
    super(message)
  }
}

async function callPin(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('pin-login', { body })
  if (!error) return data as Record<string, unknown>
  // FunctionsHttpError carries the response; read our { error } payload from it.
  const ctx = (error as { context?: Response }).context
  let payload: Record<string, unknown> | null = null
  try {
    payload = ctx ? ((await ctx.json()) as Record<string, unknown>) : null
  } catch {
    payload = null
  }
  const code = String(payload?.error ?? '')
  if (code === 'device') throw new PinLoginError('device', 'Kjo pajisje nuk është më e lidhur me biznesin. Hyr njëherë me email.')
  if (code === 'wrong_pin') {
    const left = Number(payload?.left ?? 0)
    throw new PinLoginError('wrong_pin', left ? `PIN-i është gabim. Të mbetën ${left} prova.` : 'PIN-i është gabim.', left)
  }
  if (code === 'locked') throw new PinLoginError('locked', 'Shumë prova të gabuara. Provo pas 15 minutash ose kërko PIN të ri nga menaxheri.')
  if (code === 'no_pin') throw new PinLoginError('no_pin', 'Ky punëtor nuk ka PIN. Menaxheri e vendos te Cilësimet → Përdoruesit.')
  if (code === 'not_found') throw new PinLoginError('not_found', 'Punëtori nuk u gjet ose është çaktivizuar.')
  if (!ctx) throw new PinLoginError('network', 'Nuk ka lidhje me serverin.')
  throw new PinLoginError('server', code || 'Hyrja me PIN nuk punon ende (Edge Function pin-login).')
}

export async function fetchPinWorkers(link: DeviceLink): Promise<{ business: { name: string }; workers: PinWorker[] }> {
  const r = await callPin({ action: 'workers', device_id: link.device_id, secret: link.secret })
  return r as unknown as { business: { name: string }; workers: PinWorker[] }
}

export async function pinLogin(link: DeviceLink, userId: string, pin: string): Promise<void> {
  const r = await callPin({ action: 'login', device_id: link.device_id, secret: link.secret, user_id: userId, pin })
  const s = r.session as { access_token: string; refresh_token: string } | undefined
  if (!s) throw new PinLoginError('server', 'Seanca nuk u krijua')
  const { error } = await supabase.auth.setSession(s)
  if (error) throw new PinLoginError('server', error.message)
}
