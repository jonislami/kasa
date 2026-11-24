// Edge Function: platform-admin
// Actions for the platform admin (rows in public.platform_admins):
//   { action: 'create_business', type, name, city?, owner_name, email, password }
//   { action: 'reset_password', business_id, password }                – the admin chooses the password
//   { action: 'password_link', business_id, redirect_to, send_email? } – one-time link; the owner chooses the password
//   { action: 'create_accountant', full_name, office_name?, phone?, email, password }   – account for the "KontoSef Kontabilist" program
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

const MIN_PASSWORD = 6 // Supabase Auth's minimum; the admin may choose any password from here up
function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= 72
}
const PASSWORD_RULE = `Fjalëkalimi duhet të ketë ${MIN_PASSWORD} deri në 72 shenja`

/** Supabase's own password errors in Albanian (its project setting may ask for more than ours). */
function authMessage(m: string): string {
  const len = m.match(/at least (\d+) characters/i)
  if (len) return `Supabase kërkon të paktën ${len[1]} shenja për fjalëkalimin`
  if (/weak|pwned|leaked/i.test(m)) return 'Supabase e refuzoi këtë fjalëkalim si të dobët – zgjidh një tjetër'
  return m
}

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!key || !from) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `KontoSef <${from}>`, to: [to], subject, text, html }),
    })
    return r.ok
  } catch {
    return false
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * One e-mail in Albanian and Serbian (the two official languages): the Albanian part first, then the Serbian one,
 * with the shared part (a key, a button) once between them. Plain text in the same order.
 */
function bilingual(o: { titleSq: string; titleSr: string; sq: string[]; sr: string[]; middle?: string; sqAfter?: string[]; middleText?: string; noteSq?: string; noteSr?: string }) {
  const para = (lines: string[]) => lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join('')
  const strip = (h: string) => h.replace(/<[^>]+>/g, '')
  const lang = (code: string) => `<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#5F6B7A;margin:0 0 6px">${code}</div>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#F7F8FA;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A"><table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E6E8EC;border-radius:12px;overflow:hidden"><tr><td style="background:#0F1B2D;color:#fff;padding:18px 24px;font-size:17px;font-weight:700">KontoSef.app</td></tr><tr><td style="padding:24px">
${lang('SHQIP')}<h1 style="margin:0 0 12px;font-size:20px">${o.titleSq}</h1>${para(o.sq)}
${o.middle ?? ''}
${para(o.sqAfter ?? [])}
${o.noteSq ? `<p style="color:#5F6B7A;font-size:13px;margin:0 0 4px">${o.noteSq}</p>` : ''}
<hr style="border:none;border-top:1px solid #E6E8EC;margin:22px 0">
${lang('SRPSKI')}<h2 style="margin:0 0 12px;font-size:18px">${o.titleSr}</h2>${para(o.sr)}
${o.noteSr ? `<p style="color:#5F6B7A;font-size:13px;margin:0">${o.noteSr}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`
  const text = [
    o.titleSq, '', ...o.sq.map(strip), ...(o.middleText ? ['', o.middleText, ''] : []), ...(o.sqAfter ?? []).map(strip), ...(o.noteSq ? [strip(o.noteSq)] : []),
    '', '— SRPSKI —', '', o.titleSr, '', ...o.sr.map(strip), ...(o.middleText ? ['', o.middleText] : []), ...(o.noteSr ? ['', strip(o.noteSr)] : []),
  ].join('\n')
  return { html, text }
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
    if (!validPassword(password)) return fail(PASSWORD_RULE)

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
    if (!validPassword(password)) return fail(PASSWORD_RULE)

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
    if (error) return fail('Fjalëkalimi nuk u ndryshua: ' + authMessage(error.message), 500)

    await admin.from('audit_log').insert([
      { business_id: null, user_id: caller.id, action: 'owner_password_reset', entity: 'business', entity_id: businessId, details: {} },
      { business_id: businessId, user_id: caller.id, action: 'owner_password_reset', entity: 'profile', entity_id: owner.id, details: { by: 'platform' } },
    ])

    return json({ email: owner.email })
  }

  // --- one-time link: the owner opens it and chooses the new password himself ---
  if (body.action === 'password_link') {
    const businessId = String(body.business_id ?? '')
    const redirectTo = String(body.redirect_to ?? '')
    if (!/^https?:\/\/\S+$/.test(redirectTo)) return fail('Adresa e kthimit mungon')

    const { data: owner } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .eq('business_id', businessId)
      .eq('role', 'admin')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!owner?.email) return fail('Pronari i këtij biznesi nuk u gjet', 404)

    // Supabase makes the recovery link (valid as long as the project's e-mail OTP expiry, 1 hour by default);
    // nothing is e-mailed by Supabase here – the admin sends it, or Resend below.
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: owner.email, options: { redirectTo } })
    if (error || !link?.properties?.action_link) return fail('Linku nuk u krijua: ' + (error?.message ?? 'pa përgjigje'), 500)
    const actionLink = link.properties.action_link

    let emailed = false
    if (body.send_email === true) {
      const name = esc(owner.full_name || 'pronar')
      const who = esc(owner.full_name || '')
      const button = `<p style="margin:20px 0"><a href="${esc(actionLink)}" style="background:#1F4FA8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">Vendos fjalëkalimin · Postavi lozinku</a></p>`
      const m = bilingual({
        titleSq: 'Fjalëkalimi i ri',
        titleSr: 'Nova lozinka',
        sq: [`Përshëndetje ${who},`, 'Shtyp butonin dhe zgjidh fjalëkalimin e ri për KontoSef.app.'],
        sr: [`Poštovani/a ${who},`, 'Kliknite na dugme iznad i izaberite novu lozinku za KontoSef.app.'],
        middle: button,
        middleText: actionLink,
        noteSq: 'Linku vlen vetëm një herë dhe skadon pas pak kohe. Nëse nuk e ke kërkuar ti, mos e hap.',
        noteSr: 'Link važi samo jednom i ističe ubrzo. Ako ga niste vi zatražili, nemojte ga otvarati.',
      })
      emailed = await sendEmail(owner.email, 'Fjalëkalimi i ri · Nova lozinka – KontoSef.app', m.text, m.html)
    }

    await admin.from('audit_log').insert([
      { business_id: null, user_id: caller.id, action: 'owner_password_link', entity: 'business', entity_id: businessId, details: { emailed } },
      { business_id: businessId, user_id: caller.id, action: 'owner_password_link', entity: 'profile', entity_id: owner.id, details: { by: 'platform', emailed } },
    ])

    return json({ email: owner.email, link: actionLink, emailed })
  }

  // --- accountant account (the separate "KontoSef Kontabilist" program) ---
  // --- the activation key of a till, e-mailed to the owner right after the admin made it ---
  if (body.action === 'email_activation_key') {
    const businessId = String(body.business_id ?? '')
    const key = String(body.key ?? '').toUpperCase()
    if (!/^KASA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return fail('Çelësi nuk është i saktë')
    const { data: biz } = await admin.from('businesses').select('name').eq('id', businessId).maybeSingle()
    if (!biz) return fail('Biznesi nuk u gjet', 404)
    const { data: owner } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .eq('business_id', businessId)
      .eq('role', 'admin')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!owner?.email || /@pin\.kasa\.app$/i.test(owner.email)) return fail('Pronari i këtij biznesi nuk ka email', 404)
    const register = String(body.register_name ?? '').slice(0, 80)
    const expires = String(body.expires_at ?? '')
    const until = /^\d{4}-\d{2}-\d{2}/.test(expires) ? expires.slice(0, 10).split('-').reverse().join('.') : ''
    const name = owner.full_name || ''
    const who = esc(name)
    const reg = esc(register || '')
    const box = `<p style="margin:18px 0;padding:14px;background:#F1F5F9;border-radius:8px;text-align:center;font-family:Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:2px">${esc(key)}</p>`
    const m = bilingual({
      titleSq: 'Çelësi i aktivizimit',
      titleSr: 'Aktivacioni ključ',
      sq: [
        `Përshëndetje ${who},`,
        `Çelësi për <b>${reg || 'arkën'}</b> të <b>${esc(biz.name)}</b>:`,
      ],
      sr: [
        `Poštovani/a ${who},`,
        `Ključ za <b>${reg || 'kasu'}</b> preduzeća <b>${esc(biz.name)}</b> je naveden iznad.`,
        '1. Instalirajte program KontoSef na uređaj kase (kontosef.app/shkarko).',
        '2. Otvorite ga i jednom unesite ovaj ključ.',
        '3. Zatim se prijavljujete PIN-om.',
      ],
      middle: box,
      sqAfter: ['1. Instalo programin KontoSef në pajisjen e arkës (kontosef.app/shkarko).', '2. Hape dhe shkruaj këtë çelës njëherë.', '3. Pastaj hyn me PIN.'],
      middleText: key,
      noteSq: `Çelësi vlen për një pajisje${until ? ` dhe deri më ${until}` : ''}. Mos ia jep askujt tjetër.`,
      noteSr: `Ključ važi za jedan uređaj${until ? ` i do ${until}` : ''}. Ne dajte ga nikome drugom.`,
    })
    const emailed = await sendEmail(owner.email, `Çelësi i aktivizimit · Aktivacioni ključ${register ? ` – ${register}` : ''} – KontoSef`, m.text, m.html)
    if (!emailed) return fail('Email-i nuk u dërgua (kontrollo RESEND_API_KEY / EMAIL_FROM)', 502)
    await admin.from('audit_log').insert({ business_id: businessId, user_id: caller.id, action: 'activation_key_emailed', entity: 'business', entity_id: businessId, details: { to: owner.email.replace(/^(.).*?@/, '$1***@'), hint: key.slice(-4) } })
    return json({ email: owner.email })
  }

  if (body.action === 'create_accountant') {
    const fullName = String(body.full_name ?? '').trim().slice(0, 120)
    const office = String(body.office_name ?? '').trim().slice(0, 160) || null
    const phone = String(body.phone ?? '').trim().slice(0, 50) || null
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = body.password
    if (!fullName) return fail('Shkruaj emrin e kontabilistit')
    if (!EMAIL_RE.test(email)) return fail('Email-i nuk është i saktë')
    if (!validPassword(password)) return fail(PASSWORD_RULE)

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
    if (!validPassword(password)) return fail(PASSWORD_RULE)
    const { data: acc } = await admin.from('accountants').select('user_id, email').eq('user_id', userId).maybeSingle()
    if (!acc) return fail('Kontabilisti nuk u gjet', 404)
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return fail('Fjalëkalimi nuk u ndryshua: ' + authMessage(error.message), 500)
    await admin.from('audit_log').insert({ business_id: null, user_id: caller.id, action: 'accountant_password_reset', entity: 'accountant', entity_id: userId, details: {} })
    return json({ email: acc.email })
  }

  return fail('Veprim i panjohur')
})
