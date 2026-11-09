// Edge Function: platform-admin
// Actions for the platform admin (rows in public.platform_admins):
//   { action: 'create_business', type, name, city?, owner_name, email, password }
//   { action: 'reset_password', business_id, password }
//   { action: 'create_accountant', full_name, office_name?, phone?, email, password }   – account for the "Kasa Kontabilist" program
//   { action: 'reset_accountant_password', user_id, password }
// The service role key is used only here, never in the client.
import { createClient } from 'npm:@supabase/supabase-js@2'

const BUSINESS_TYPES = ['market', 'restaurant', 'pharmacy', 'boutique', 'salon'] as const
type BusinessType = (typeof BUSINESS_TYPES)[number]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function fail(message: string, status = 400) {
  return json({ error: message }, status)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 8 && p.length <= 72
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
  const caller = userData.user

  const { data: pa } = await admin.from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle()
  if (!pa) return fail('Vetëm admini i platformës', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Kërkesë e pavlefshme')
  }

  // --- create business + owner account ---
  if (body.action === 'create_business') {
    const type = body.type as BusinessType
    const name = String(body.name ?? '').trim()
    const city = String(body.city ?? '').trim() || null
    const ownerName = String(body.owner_name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = body.password

    if (!BUSINESS_TYPES.includes(type)) return fail('Zgjidh llojin e biznesit')
    if (!name) return fail('Shkruaj emrin e biznesit')
    if (!ownerName) return fail('Shkruaj emrin e pronarit')
    if (!EMAIL_RE.test(email)) return fail('Email-i nuk është i saktë')
    if (!validPassword(password)) return fail('Fjalëkalimi duhet të ketë të paktën 8 shenja')

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: ownerName },
    })
    if (createErr || !created.user) {
      const msg = /already|registered|exists/i.test(createErr?.message ?? '')
        ? 'Ky email përdoret tashmë'
        : 'Llogaria nuk u krijua: ' + (createErr?.message ?? '')
      return fail(msg)
    }
    const ownerId = created.user.id

    // Roll back the auth user if anything below fails.
    const rollback = async (businessId?: string) => {
      if (businessId) await admin.from('businesses').delete().eq('id', businessId)
      await admin.auth.admin.deleteUser(ownerId)
    }

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name, type, city, owner_name: ownerName, owner_email: email, created_by: caller.id })
      .select('id')
      .single()
    if (bizErr || !biz) {
      await rollback()
      return fail('Biznesi nuk u krijua: ' + (bizErr?.message ?? ''), 500)
    }

    const steps = [
      admin.from('profiles').insert({ id: ownerId, business_id: biz.id, role: 'admin', full_name: ownerName, email }),
      admin.from('business_settings').insert({ business_id: biz.id }),
      admin.from('registers').insert({ business_id: biz.id, name: 'Arka 1' }),
    ]
    for (const step of steps) {
      const { error } = await step
      if (error) {
        await rollback(biz.id)
        return fail('Biznesi nuk u krijua: ' + error.message, 500)
      }
    }

    await admin.from('audit_log').insert([
      { business_id: null, user_id: caller.id, action: 'business_create', entity: 'business', entity_id: biz.id, details: { name, type, owner_email: email } },
      { business_id: biz.id, user_id: caller.id, action: 'business_create', entity: 'business', entity_id: biz.id, details: { by: 'platform' } },
    ])

    return json({ business_id: biz.id, email })
  }

  // --- new password for the owner ---
  if (body.action === 'reset_password') {
    const businessId = String(body.business_id ?? '')
    const password = body.password
    if (!validPassword(password)) return fail('Fjalëkalimi duhet të ketë të paktën 8 shenja')

    const { data: owner } = await admin
      .from('profiles')
      .select('id, email')
      .eq('business_id', businessId)
      .eq('role', 'admin')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!owner) return fail('Pronari i këtij biznesi nuk u gjet', 404)

    const { error } = await admin.auth.admin.updateUserById(owner.id, { password })
    if (error) return fail('Fjalëkalimi nuk u ndryshua: ' + error.message, 500)

    await admin.from('audit_log').insert([
      { business_id: null, user_id: caller.id, action: 'owner_password_reset', entity: 'business', entity_id: businessId, details: {} },
      { business_id: businessId, user_id: caller.id, action: 'owner_password_reset', entity: 'profile', entity_id: owner.id, details: { by: 'platform' } },
    ])

    return json({ email: owner.email })
  }

  // --- accountant account (the separate "Kasa Kontabilist" program) ---
  if (body.action === 'create_accountant') {
    const fullName = String(body.full_name ?? '').trim().slice(0, 120)
    const office = String(body.office_name ?? '').trim().slice(0, 160) || null
    const phone = String(body.phone ?? '').trim().slice(0, 50) || null
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = body.password
    if (!fullName) return fail('Shkruaj emrin e kontabilistit')
    if (!EMAIL_RE.test(email)) return fail('Email-i nuk është i saktë')
    if (!validPassword(password)) return fail('Fjalëkalimi duhet të ketë të paktën 8 shenja')

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, kasa_login: 'accountant' },
    })
    if (createErr || !created.user) {
      const msg = /already|registered|exists/i.test(createErr?.message ?? '') ? 'Ky email përdoret tashmë' : 'Llogaria nuk u krijua: ' + (createErr?.message ?? '')
      return fail(msg)
    }
    const userId = created.user.id
    const { error: accErr } = await admin.from('accountants').insert({ user_id: userId, full_name: fullName, email, office_name: office, phone, created_by: caller.id })
    if (accErr) {
      await admin.auth.admin.deleteUser(userId)
      return fail('Kontabilisti nuk u krijua: ' + accErr.message, 500)
    }
    await admin.from('audit_log').insert({ business_id: null, user_id: caller.id, action: 'accountant_create', entity: 'accountant', entity_id: userId, details: { name: fullName, email, office } })
    return json({ user_id: userId, email })
  }

  if (body.action === 'reset_accountant_password') {
    const userId = String(body.user_id ?? '')
    const password = body.password
    if (!validPassword(password)) return fail('Fjalëkalimi duhet të ketë të paktën 8 shenja')
    const { data: acc } = await admin.from('accountants').select('user_id, email').eq('user_id', userId).maybeSingle()
    if (!acc) return fail('Kontabilisti nuk u gjet', 404)
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return fail('Fjalëkalimi nuk u ndryshua: ' + error.message, 500)
    await admin.from('audit_log').insert({ business_id: null, user_id: caller.id, action: 'accountant_password_reset', entity: 'accountant', entity_id: userId, details: {} })
    return json({ email: acc.email })
  }

  return fail('Veprim i panjohur')
})
