// Edge Function: acc-office (Kasa Kontabilist, phase K7)
// Team of an accounting office. Only an office admin (the owner or a member with role admin) may call it.
//   { action: 'create_member', full_name, email, password, role: 'admin'|'accountant'|'assistant', phone?, all_clients?, clients?: uuid[] }
//   { action: 'set_password', user_id, password }      – for a member of the same office (not the owner)
//   { action: 'create_portal_user', client_id, full_name, email, password? }   – admin or accountant (client portal, K7)
//       an existing account with this e-mail (e.g. the owner who uses Kasa) is linked and keeps its password
//   { action: 'set_portal_password', portal_id, password }  – only for accounts created for the portal
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

  // Caller: an active member of an active office; team actions only for admins.
  const { data: me } = await admin.from('accountants').select('user_id, office_id, role, active, full_name, all_clients').eq('user_id', callerId).maybeSingle()
  if (!me || !me.active) return fail('Vetëm për zyrën e kontabilitetit', 403)
  const officeId: string = me.office_id ?? me.user_id
  const role: string = me.office_id ? me.role : 'admin'
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
  const portalAction = body.action === 'create_portal_user' || body.action === 'set_portal_password'
  if (portalAction ? role === 'assistant' : role !== 'admin') {
    return fail(portalAction ? 'Ky veprim kërkon kontabilistin ose administratorin e zyrës' : 'Vetëm administratori i zyrës', 403)
  }
  // A client of this office that the caller may see (0022: all clients, or the ones given to the member).
  const clientOf = async (clientId: string) => {
    const { data: c } = await admin.from('acc_clients').select('id, name, active').eq('id', clientId).eq('accountant_id', officeId).maybeSingle()
    if (!c) return null
    if (role !== 'admin' && !me.all_clients) {
      const { data: g } = await admin.from('acc_member_clients').select('client_id').eq('member_id', callerId).eq('client_id', clientId).maybeSingle()
      if (!g) return null
    }
    return c
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

  if (body.action === 'create_portal_user') {
    const clientId = String(body.client_id ?? '')
    const fullName = String(body.full_name ?? '').trim().slice(0, 120)
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return fail('Zgjidh kompaninë')
    const client = await clientOf(clientId)
    if (!client) return fail('Kompania nuk u gjet', 404)
    if (!fullName) return fail('Shkruaj emrin')
    if (!EMAIL_RE.test(email)) return fail('Email-i nuk është i saktë')

    let userId: string | null = null
    let linked = false
    const { data: existing } = await admin.rpc('_auth_user_id_by_email', { p_email: email })
    if (existing) {
      const { data: acc } = await admin.from('accountants').select('user_id').eq('user_id', existing).maybeSingle()
      if (acc) return fail('Ky email është llogari kontabilisti; për portalin përdor email-in e klientit')
      userId = existing as string
      linked = true
    } else {
      if (!validPassword(body.password)) return fail('Fjalëkalimi duhet të ketë 8–72 shenja')
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: body.password as string,
        email_confirm: true,
        user_metadata: { full_name: fullName, kasa_login: 'portal' },
      })
      if (createErr || !created.user) return fail('Llogaria nuk u krijua: ' + (createErr?.message ?? ''))
      userId = created.user.id
    }
    const { data: row, error: puErr } = await admin
      .from('acc_portal_users')
      .upsert({ office_id: officeId, client_id: clientId, user_id: userId, full_name: fullName, email, active: true, created_by: callerId }, { onConflict: 'client_id,user_id' })
      .select('id')
      .single()
    if (puErr || !row) {
      if (!linked && userId) await admin.auth.admin.deleteUser(userId)
      return fail('Qasja nuk u krijua: ' + (puErr?.message ?? ''), 500)
    }
    await admin.from('acc_activity').insert({ office_id: officeId, client_id: clientId, user_id: callerId, entity: 'acc_portal_users', entity_id: row.id, action: 'insert', label: `Portali: ${fullName} (${email})`.slice(0, 200) })
    return json({ id: row.id, linked })
  }

  if (body.action === 'set_portal_password') {
    const portalId = String(body.portal_id ?? '')
    if (!validPassword(body.password)) return fail('Fjalëkalimi duhet të ketë 8–72 shenja')
    const { data: pu } = await admin.from('acc_portal_users').select('id, user_id, client_id, full_name').eq('id', portalId).eq('office_id', officeId).maybeSingle()
    if (!pu || !(await clientOf(pu.client_id))) return fail('Përdoruesi nuk u gjet', 404)
    // Only accounts made for the portal: never the password of a Kasa owner or of an accountant.
    const [{ data: prof }, { data: acc }] = await Promise.all([
      admin.from('profiles').select('id').eq('id', pu.user_id).maybeSingle(),
      admin.from('accountants').select('user_id').eq('user_id', pu.user_id).maybeSingle(),
    ])
    if (prof || acc) return fail('Kjo llogari përdoret edhe në Kasa; fjalëkalimin e ndryshon vetë pronari')
    const { error } = await admin.auth.admin.updateUserById(pu.user_id, { password: body.password as string })
    if (error) return fail('Fjalëkalimi nuk u ndryshua: ' + error.message, 500)
    await admin.from('acc_activity').insert({ office_id: officeId, client_id: pu.client_id, user_id: callerId, entity: 'acc_portal_users', entity_id: pu.id, action: 'update', label: `Portali: fjalëkalim i ri për ${pu.full_name}`.slice(0, 200) })
    return json({ ok: true })
  }

  return fail('Veprim i panjohur')
})
