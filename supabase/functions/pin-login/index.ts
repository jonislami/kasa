// Edge Function: pin-login (public – the device secret is the credential, then the PIN)
//   { action: 'workers', device_id, secret }                 → { business, workers }
//   { action: 'login',   device_id, secret, user_id, pin }   → { session: { access_token, refresh_token } }
// The device secret comes from link_device() (a manager signed in with email on this device).
// PIN check, failure counting and the 15-minute lock are in SQL (pin_check, bcrypt).
// A session is minted with a one-time magic-link token that never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('Metoda nuk lejohet', 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Kërkesë e pavlefshme')
  }
  const deviceId = String(body.device_id ?? '')
  const secret = String(body.secret ?? '')
  if (!UUID_RE.test(deviceId) || secret.length < 32) return fail('device', 401)

  if (body.action === 'workers') {
    const { data, error } = await admin.rpc('pin_device_workers', { p_device: deviceId, p_secret: secret })
    if (error) return fail('Gabim në server: ' + error.message, 500)
    if (!data) return fail('device', 401)
    return json(data)
  }

  if (body.action === 'login') {
    const userId = String(body.user_id ?? '')
    const pin = String(body.pin ?? '')
    if (!UUID_RE.test(userId) || !/^\d{4}$/.test(pin)) return fail('wrong_pin', 400)

    const { data: check, error } = await admin.rpc('pin_check', { p_device: deviceId, p_secret: secret, p_user: userId, p_pin: pin })
    if (error) return fail('Gabim në server: ' + error.message, 500)
    const r = check as { ok: boolean; error?: string; email?: string; left?: number; until?: string }
    if (!r.ok) return fail(r.error ?? 'wrong_pin', r.error === 'device' ? 401 : 400, { left: r.left, until: r.until })

    // Mint a session for this user without knowing their password.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: r.email! })
    if (linkErr || !link?.properties?.hashed_token) return fail('Seanca nuk u krijua: ' + (linkErr?.message ?? ''), 500)
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: verified, error: otpErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
    if (otpErr || !verified.session) return fail('Seanca nuk u krijua: ' + (otpErr?.message ?? ''), 500)

    return json({ session: { access_token: verified.session.access_token, refresh_token: verified.session.refresh_token } })
  }

  return fail('Veprim i panjohur')
})
