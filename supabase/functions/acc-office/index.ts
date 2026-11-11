// Edge Function: acc-office (Kasa Kontabilist, phase K7)
// Team of an accounting office. Only an office admin (the owner or a member with role admin) may call it.
//   { action: 'create_member', full_name, email, password, role: 'admin'|'accountant'|'assistant', phone?, all_clients?, clients?: uuid[] }
//   { action: 'set_password', user_id, password }      – for a member of the same office (not the owner)
// Roles, access to clients and (de)activation are changed with the RPC acc_office_save_member (caller's JWT).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (message: string, status = 400) => json({ error: message }, status)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES = ['admin', 'accountant', 'assistant']
const validPassword = (p: unknown) => typeof p === 'string' && p.length >= 8 && p.length <= 72

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('Metoda nuk lejohet', 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return fail('Nuk je i kyçur', 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return fail('Seanca ka skaduar, hyr përsëri', 401)
  const callerId = userData.user.id

  // Caller: an active office admin; the office (owner) must be active too.
  const { data: me } = await admin.from('accountants').select('user_id, office_id, role, active, full_name').eq('user_id', callerId).maybeSingle()
  if (!me || !me.active || (me.office_id && me.role !== 'admin')) return fail('Vetëm administratori i zyrës', 403)
  const officeId: string = me.office_id ?? me.user_id
  const { data: office } = await admin.from('accountants').select('user_id, active, office_name, require_mfa').eq('user_id', officeId).maybeSingle()
  if (!office?.active) return fail('Zyra është çaktivizuar', 403)
  if (office.require_mfa) {
    // The JWT carries the assurance level; a required second factor must have been passed.
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.aal !== 'aal2') return fail('Hyr me kodin e dy faktorëve', 403)
    } catch {
      return fail('Seanca nuk vlen', 401)
    }
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Kërkesë e pavlefshme')
  }

  const log = (label: string, entityId: string) =>
    admin.from('acc_activity').insert({ office_id: officeId, user_id: callerId, entity: 'accountants', entity_id: entityId, action: 'insert', label: label.slice(0, 200) })

  if (body.action === 'create_member') {
    const fullName = String(body.full_name ?? '').trim().slice(0, 120)
    const email = String(body.email ?? '').trim().toLowerCase()
    const phone = String(body.phone ?? '').trim().slice(0, 50) || null
    const role = String(body.role ?? 'accountant')
    const allClients = body.all_clients !== false
    const clients = Array.isArray(body.clients) ? body.clients.map(String).filter((c) => /^[0-9a-f-]{36}$/i.test(c)) : []
    if (!fullName) return fail('Shkruaj emrin')
    if (!EMAIL_RE.test(email)) return fail('Email-i nuk është i saktë')
    if (!validPassword(body.password)) return fail('Fjalëkalimi duhet të ketë 8–72 shenja')
    if (!ROLES.includes(role)) return fail('Zgjidh rolin')

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: body.password as string,
      email_confirm: true,
      user_metadata: { full_name: fullName, kasa_login: 'accountant' },
    })
    if (createErr || !created.user) {
      return fail(/already|registered|exists/i.test(createErr?.message ?? '') ? 'Ky email përdoret tashmë' : 'Llogaria nuk u krijua: ' + (createErr?.message ?? ''))
    }
    const userId = created.user.id
    const { error: accErr } = await admin.from('accountants').insert({
      user_id: userId,
      full_name: fullName,
      email,
      phone,
      office_id: officeId,
      office_name: office.office_name,
      role,
      all_clients: role === 'admin' ? true : allClients,
      created_by: callerId,
    })
    if (accErr) {
      await admin.auth.admin.deleteUser(userId)
      return fail('Anëtari nuk u krijua: ' + accErr.message, 500)
    }
    if (!allClients && clients.length && role !== 'admin') {
      // only clients of this office
      const { data: own } = await admin.from('acc_clients').select('id').eq('accountant_id', officeId).in('id', clients)
      if (own?.length) await admin.from('acc_member_clients').insert(own.map((c) => ({ member_id: userId, client_id: c.id })))
    }
    await log(`Anëtar i ri: ${fullName} (${role})`, userId)
    return json({ user_id: userId, email })
  }

  if (body.action === 'set_password') {
    const userId = String(body.user_id ?? '')
    if (!validPassword(body.password)) return fail('Fjalëkalimi duhet të ketë 8–72 shenja')
    const { data: m } = await admin.from('accountants').select('user_id, full_name').eq('user_id', userId).eq('office_id', officeId).maybeSingle()
    if (!m) return fail('Anëtari nuk u gjet', 404)
    const { error } = await admin.auth.admin.updateUserById(userId, { password: body.password as string })
    if (error) return fail('Fjalëkalimi nuk u ndryshua: ' + error.message, 500)
    await log(`Fjalëkalim i ri për ${m.full_name}`, userId)
    return json({ ok: true })
  }

  return fail('Veprim i panjohur')
})
