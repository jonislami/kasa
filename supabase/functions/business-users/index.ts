// Edge Function: business-users
// Owner/manager actions inside their own business (creating auth users needs the service role):
//   { action: 'create_user', full_name, role: 'worker'|'manager', pin?, email?, password?, commission_pct?, phone? }
//       worker without email → PIN-only account (synthetic e-mail, random password, never shown)
//       manager              → needs email + password (signs in on new devices and links them)
//   { action: 'set_password', user_id, password }   – owner only, for email accounts of the business
// Editing, PINs and (de)activation use the RPCs update_business_user / set_user_pin with the caller's own JWT.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const fail = (message: string, status = 400) => json({ error: message }, status)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WEAK_PINS = new Set(['0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '4321'])

function randomSecret(bytes = 24): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('Metoda nuk lejohet', 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // --- who is calling? ---
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return fail('Nuk je i kyçur', 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return fail('Seanca ka skaduar, hyr përsëri', 401)
  const callerId = userData.user.id

  const { data: me } = await admin
    .from('profiles')
    .select('id, business_id, role, active, businesses!inner(active)')
    .eq('id', callerId)
    .maybeSingle()
  const bizActive = (me as unknown as { businesses?: { active: boolean } } | null)?.businesses?.active
  if (!me || !me.active || !bizActive || !['admin', 'manager'].includes(me.role)) {
    return fail('Vetëm pronari ose menaxheri', 403)
  }
  const businessId = me.business_id as string

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Kërkesë e pavlefshme')
  }

  // --- create a worker / manager ---
  if (body.action === 'create_user') {
    const fullName = String(body.full_name ?? '').trim()
    const role = String(body.role ?? 'worker')
    const pin = body.pin == null || body.pin === '' ? null : String(body.pin)
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = body.password == null ? '' : String(body.password)
    const commission = Number(body.commission_pct ?? 0)
    const phone = String(body.phone ?? '').trim() || null

    if (!fullName) return fail('Shkruaj emrin')
    if (!['worker', 'manager'].includes(role)) return fail('Roli nuk njihet')
    if (role === 'manager' && me.role !== 'admin') return fail('Vetëm pronari shton menaxherë', 403)
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) return fail('Komisioni duhet të jetë 0–100%')
    if (pin !== null && (!/^\d{4}$/.test(pin) || WEAK_PINS.has(pin))) return fail('PIN-i duhet të ketë 4 shifra dhe të mos jetë i thjeshtë')
    if (role === 'manager' && !email) return fail('Menaxheri ka nevojë për email dhe fjalëkalim')
    if (!email && pin === null) return fail('Vendos PIN-in e punëtorit')
    if (email && !EMAIL_RE.test(email)) return fail('Email-i nuk është i saktë')
    if (email && (password.length < 8 || password.length > 72)) return fail('Fjalëkalimi duhet të ketë të paktën 8 shenja')

    const loginKind = email ? 'email' : 'pin'
    const authEmail = email || `pin-${crypto.randomUUID()}@pin.kasa.app`
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: authEmail,
      password: email ? password : randomSecret(),
      email_confirm: true,
      user_metadata: { full_name: fullName, kasa_login: loginKind },
    })
    if (createErr || !created.user) {
      const msg = /already|registered|exists/i.test(createErr?.message ?? '') ? 'Ky email përdoret tashmë' : 'Llogaria nuk u krijua: ' + (createErr?.message ?? '')
      return fail(msg)
    }
    const userId = created.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: userId,
      business_id: businessId,
      role,
      full_name: fullName,
      email: email || null,
      login_kind: loginKind,
      phone,
      commission_pct: Math.round(commission * 100) / 100,
    })
    if (profErr) {
      await admin.auth.admin.deleteUser(userId)
      return fail('Përdoruesi nuk u krijua: ' + profErr.message, 500)
    }
    if (pin !== null) {
      const { error: pinErr } = await admin.rpc('admin_set_pin', { p_user: userId, p_pin: pin })
      if (pinErr) {
        await admin.from('profiles').delete().eq('id', userId)
        await admin.auth.admin.deleteUser(userId)
        return fail('PIN-i nuk u ruajt: ' + pinErr.message, 500)
      }
    }

    await admin.from('audit_log').insert({
      business_id: businessId,
      user_id: callerId,
      action: 'user_create',
      entity: 'profile',
      entity_id: userId,
      details: { name: fullName, role, login: loginKind, commission_pct: commission },
    })
    return json({ user_id: userId })
  }

  // --- owner sets a new password for an email account of the business ---
  if (body.action === 'set_password') {
    if (me.role !== 'admin') return fail('Vetëm pronari', 403)
    const userId = String(body.user_id ?? '')
    const password = String(body.password ?? '')
    if (password.length < 8 || password.length > 72) return fail('Fjalëkalimi duhet të ketë të paktën 8 shenja')
    const { data: target } = await admin.from('profiles').select('id, role, login_kind, business_id').eq('id', userId).maybeSingle()
    if (!target || target.business_id !== businessId) return fail('Përdoruesi nuk u gjet', 404)
    if (target.login_kind !== 'email') return fail('Ky punëtor hyn vetëm me PIN')
    if (target.role === 'admin' && target.id !== callerId) return fail('Nuk lejohet', 403)
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return fail('Fjalëkalimi nuk u ndryshua: ' + error.message, 500)
    await admin.from('audit_log').insert({ business_id: businessId, user_id: callerId, action: 'password_reset', entity: 'profile', entity_id: userId, details: {} })
    return json({ ok: true })
  }

  return fail('Veprim i panjohur')
})
