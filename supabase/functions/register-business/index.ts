// Edge Function: register-business (public – the client is not signed in yet).
//   POST { owner_name, business_name, type, nui, fiscal_number, vat_number?, address, city, phone, email, password,
//          activity?, registers?, note?, website? (honeypot – must stay empty) }
// Creates the owner account and the business with status 'pending' and active = false: nothing works until the
// platform admin approves it and confirms the payment (migration 0029). Sends a confirmation e-mail to the client and a
// notice to the platform admins when Resend is configured (RESEND_API_KEY, EMAIL_FROM).
// Deploy with Verify JWT turned OFF (the caller has no session yet).
import { createClient } from 'npm:@supabase/supabase-js@2'

const BUSINESS_TYPES = ['market', 'restaurant', 'pharmacy', 'boutique', 'salon'] as const
const TYPE_LABELS: Record<string, string> = { market: 'Market', restaurant: 'Kafiteri / Restorant', pharmacy: 'Barnatore', boutique: 'Butik', salon: 'Sallon' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (message: string, status = 400) => json({ error: message }, status)
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)

async function sendEmail(to: string[], subject: string, text: string, html: string): Promise<void> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!key || !from || !to.length) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Kasa <${from}>`, to, subject, text, html }),
    })
  } catch {
    /* the registration does not depend on the e-mail */
  }
}

const box = (title: string, body: string) => `<!doctype html><html><body style="margin:0;background:#F4F6F3;font-family:Inter,Segoe UI,Arial,sans-serif;color:#14201A">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E2E7E3;border-radius:14px;overflow:hidden">
<tr><td style="background:#10241B;color:#fff;padding:18px 24px;font-size:17px;font-weight:700">Kasa</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 14px;font-size:20px">${esc(title)}</h1>${body}</td></tr></table></td></tr></table></body></html>`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('Metoda nuk lejohet', 405)
  let b: Record<string, unknown>
  try {
    b = await req.json()
  } catch {
    return fail('Kërkesë e pavlefshme')
  }
  if (clean(b.website)) return json({ ok: true }) // honeypot: bots fill every field

  const type = clean(b.type, 20)
  const ownerName = clean(b.owner_name, 120)
  const businessName = clean(b.business_name, 160)
  const nui = clean(b.nui, 20).replace(/\D/g, '')
  const fiscal = clean(b.fiscal_number, 30)
  const vat = clean(b.vat_number, 30) || null
  const address = clean(b.address, 200)
  const city = clean(b.city, 80)
  const phone = clean(b.phone, 40)
  const email = clean(b.email, 160).toLowerCase()
  const password = typeof b.password === 'string' ? b.password : ''
  const activity = clean(b.activity, 200) || null
  const registers = Math.min(20, Math.max(1, Number(b.registers) || 1))
  const note = clean(b.note, 1000) || null

  if (!(BUSINESS_TYPES as readonly string[]).includes(type)) return fail('Zgjidh llojin e biznesit')
  if (!ownerName) return fail('Shkruaj emrin dhe mbiemrin e pronarit')
  if (!businessName) return fail('Shkruaj emrin e biznesit')
  if (!/^\d{9}$/.test(nui)) return fail('NUI duhet të ketë 9 shifra')
  if (!fiscal) return fail('Shkruaj numrin fiskal')
  if (!address || !city) return fail('Shkruaj adresën dhe qytetin')
  if (phone.replace(/\D/g, '').length < 8) return fail('Shkruaj numrin e telefonit')
  if (!EMAIL_RE.test(email)) return fail('Email-i nuk është i saktë')
  if (password.length < 8 || password.length > 72) return fail('Fjalëkalimi duhet të ketë 8–72 shenja')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null

  // limits: same NUI only once (unless rejected), at most 3 registrations per address per hour
  const { data: sameNui } = await admin.from('businesses').select('id, status').eq('nui', nui).neq('status', 'rejected').limit(1)
  if (sameNui?.length) return fail('Ky NUI është regjistruar tashmë. Nëse jeni pronari, hyni me email-in tuaj ose na kontaktoni.')
  if (ip) {
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await admin.from('businesses').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('registration->>ip', ip)
    if ((count ?? 0) >= 3) return fail('Shumë regjistrime nga kjo adresë. Provo pas një ore.', 429)
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: ownerName, kasa_login: 'owner' },
  })
  if (createErr || !created.user) {
    return fail(/already|registered|exists/i.test(createErr?.message ?? '') ? 'Ky email përdoret tashmë. Hyni me të ose përdorni “Ke harruar fjalëkalimin?”.' : 'Llogaria nuk u krijua: ' + (createErr?.message ?? ''))
  }
  const ownerId = created.user.id
  const rollback = async (businessId?: string) => {
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    await admin.auth.admin.deleteUser(ownerId)
  }

  const { data: biz, error: bizErr } = await admin
    .from('businesses')
    .insert({
      name: businessName,
      type,
      city,
      address,
      phone,
      nui,
      fiscal_number: fiscal,
      vat_number: vat,
      owner_name: ownerName,
      owner_email: email,
      activity,
      status: 'pending',
      active: false,
      applied_at: new Date().toISOString(),
      registration: { registers, note, ip, source: 'web' },
      created_by: ownerId,
    })
    .select('id')
    .single()
  if (bizErr || !biz) {
    await rollback()
    return fail('Regjistrimi nuk u ruajt: ' + (bizErr?.message ?? ''), 500)
  }

  const steps = await Promise.all([
    admin.from('profiles').insert({ id: ownerId, business_id: biz.id, role: 'admin', full_name: ownerName, email }),
    admin.from('business_settings').insert({ business_id: biz.id }),
    admin.from('registers').insert({ business_id: biz.id, name: 'Arka 1' }),
    admin.from('business_events').insert({ business_id: biz.id, action: 'submitted', note: note, by_user: ownerId }),
  ])
  const stepErr = steps.find((s) => s.error)?.error
  if (stepErr) {
    await rollback(biz.id)
    return fail('Regjistrimi nuk u ruajt: ' + stepErr.message, 500)
  }

  // e-mails (best effort)
  const appUrl = (Deno.env.get('KASA_APP_URL') ?? req.headers.get('origin') ?? 'https://kasa-two-psi.vercel.app').replace(/\/$/, '')
  await sendEmail(
    [email],
    'Regjistrimi në Kasa u pranua',
    `Përshëndetje ${ownerName},\n\nRegjistrimi i ${businessName} u pranua dhe është në shqyrtim. Do t'ju njoftojmë kur të aprovohet. Mund ta ndiqni statusin duke hyrë në ${appUrl}/login.`,
    box('Regjistrimi u pranua', `<p>Përshëndetje ${esc(ownerName)},</p><p>regjistrimi i <b>${esc(businessName)}</b> (${esc(TYPE_LABELS[type])}) u pranua dhe është në shqyrtim. Pasi të aprovohet, ju dërgojmë udhëzimet për pagesën dhe aktivizimin.</p><p><a href="${esc(appUrl)}/login" style="color:#0E6B4E;font-weight:600">Shiko statusin</a></p>`),
  )
  const { data: admins } = await admin.from('platform_admins').select('user_id')
  const adminEmails: string[] = []
  for (const a of admins ?? []) {
    const { data } = await admin.auth.admin.getUserById(a.user_id)
    if (data?.user?.email) adminEmails.push(data.user.email)
  }
  await sendEmail(
    adminEmails,
    `Regjistrim i ri: ${businessName}`,
    `${businessName} (${TYPE_LABELS[type]}), NUI ${nui}, ${city}. Pronari: ${ownerName}, ${phone}, ${email}.`,
    box('Regjistrim i ri në Kasa', `<p><b>${esc(businessName)}</b> – ${esc(TYPE_LABELS[type])}<br>NUI ${esc(nui)} · ${esc(city)}<br>${esc(ownerName)} · ${esc(phone)} · ${esc(email)}</p><p><a href="${esc(appUrl)}/platforma" style="color:#0E6B4E;font-weight:600">Shqyrtoje te paneli</a></p>`),
  )

  return json({ ok: true, business_id: biz.id })
})
