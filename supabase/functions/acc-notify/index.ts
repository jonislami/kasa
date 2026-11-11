// Edge Function: acc-notify (Kasa Kontabilist) – e-mails through Resend.
//   POST { kind: 'request' | 'invoice' | 'report' | 'office_message' | 'client_message', id, month? }
//       with the user's JWT: acc_notify_context checks who may send what to whom, logs it, returns the content.
//   POST { kind: 'cron_monthly', month? } with header x-cron-secret = CRON_SECRET
//       (scheduled job): monthly report to every client of the offices that turned reports on.
// Secrets: RESEND_API_KEY, EMAIL_FROM (an address on the domain verified in Resend, e.g. njoftime@zyra.com),
//          optional APP_URL (link in the e-mails), CRON_SECRET (only for the scheduled job).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Office = { name: string | null; email: string | null; phone: string | null; address: string | null }
type Ctx = { log_id: number; kind: string; to: string[]; subject: string; data: Record<string, unknown>; client: { name: string; nui: string | null }; office: Office }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const eur = (v: unknown) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0)) + ' €'
const day = (d: unknown) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '')
const MONTHS = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor']
const monthLabel = (d: unknown) => {
  const s = String(d ?? '')
  return s.length >= 7 ? `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : ''
}

function layout(office: Office, title: string, body: string, appUrl: string, cta = 'Hap portalin') {
  const name = esc(office.name ?? 'Zyra e kontabilitetit')
  return `<!doctype html><html><body style="margin:0;background:#F4F6F3;font-family:Inter,Segoe UI,Arial,sans-serif;color:#14201A">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F3;padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E2E7E3;border-radius:14px;overflow:hidden">
<tr><td style="background:#10241B;color:#fff;padding:18px 24px;font-size:17px;font-weight:700">${name}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:20px">${esc(title)}</h1>
${body}
<p style="margin:24px 0 0"><a href="${esc(appUrl)}" style="display:inline-block;background:#0E6B4E;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(cta)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E2E7E3;font-size:12px;color:#56645C">${name}${office.address ? ' · ' + esc(office.address) : ''}${office.phone ? ' · ' + esc(office.phone) : ''}${office.email ? ' · ' + esc(office.email) : ''}<br>Ky email u dërgua nga programi Kasa Kontabilist.</td></tr>
</table></td></tr></table></body></html>`
}
const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#56645C">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${v}</td></tr>`
const table = (rows: string) => `<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E2E7E3;margin-top:8px">${rows}</table>`
const quotes = (msgs: unknown) =>
  ((msgs as string[]) ?? []).map((m) => `<p style="margin:0 0 8px;padding:10px 12px;background:#F4F6F3;border-radius:10px;white-space:pre-wrap">${esc(m)}</p>`).join('')

function reportBody(clientName: string, d: Record<string, any>) {
  const vat = d.vat_return
  const reqs = (d.open_requests as string[]) ?? []
  return `<p style="margin:0 0 12px">Përmbledhja e <b>${esc(clientName)}</b> për ${esc(monthLabel(d.month))}:</p>${table(
    row('Shitjet pa TVSH', eur(d.sales?.net)) +
      row('Blerjet pa TVSH', eur(d.purchases?.net)) +
      row('TVSH e shitjeve − e blerjeve', eur(Number(d.sales?.vat ?? 0) - Number(d.purchases?.vat ?? 0))) +
      (vat ? row('Deklarata e TVSH-së', vat.status === 'filed' ? `deklaruar${vat.amount > 0 ? ', për pagesë ' + eur(vat.amount) : vat.credit > 0 ? ', kredi ' + eur(vat.credit) : ''}` : 'në përgatitje') : '') +
      (d.payroll ? row('Pagat', `${d.payroll.employees} punëtorë, tatimi dhe kontributet ${eur(d.payroll.to_pay)}`) : '') +
      row('Klientët ju detyrohen', eur(d.receivable)) +
      row('Ju u detyroheni furnitorëve', eur(d.payable)) +
      (Number(d.office_open) > 0 ? row('Fatura e zyrës e papaguar', eur(d.office_open)) : ''),
  )}${reqs.length ? `<p style="margin:16px 0 6px;font-weight:600">Dokumente që presim nga ju:</p><ul style="margin:0;padding-left:20px">${reqs.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`
}

function build(ctx: Ctx, appUrl: string): { html: string; text: string } {
  const d = ctx.data as Record<string, any>
  const portal = `${appUrl}/portal`
  let title = ctx.subject
  let body = ''
  let url = portal
  let cta = 'Hap portalin'
  if (ctx.kind === 'request') {
    title = 'Ju lutem na dërgoni dokumentin'
    body = `<p style="margin:0 0 12px">Përshëndetje ${esc(ctx.client.name)},</p><p style="margin:0 0 12px">për librat tuaj na nevojitet: <b>${esc(d.title)}</b>${d.period ? ` (${esc(monthLabel(d.period))})` : ''}${d.due_date ? `, deri më <b>${esc(day(d.due_date))}</b>` : ''}.</p>${d.note ? `<p style="margin:0 0 12px">${esc(d.note)}</p>` : ''}<p style="margin:0">Mund ta dërgoni me foto ose PDF nga portali, te “Dokumentet”.</p>`
    cta = 'Dërgo dokumentin'
  } else if (ctx.kind === 'invoice') {
    title = `Fatura ${d.inv_no}`
    body = `<p style="margin:0 0 12px">Përshëndetje ${esc(ctx.client.name)},</p><p style="margin:0 0 4px">${esc(d.description)}</p>${table(
      row('Data', esc(day(d.issue_date))) + (d.due_date ? row('Afati i pagesës', esc(day(d.due_date))) : '') + row('Për pagesë', eur(Number(d.total) - Number(d.paid ?? 0))),
    )}${d.iban ? `<p style="margin:16px 0 0">Pagesa në llogarinë ${esc(d.bank ?? '')} <b>${esc(d.iban)}</b>, me përshkrim “Fatura ${esc(d.inv_no)}”.</p>` : ''}`
    cta = 'Shiko faturat'
  } else if (ctx.kind === 'report') {
    title = `Raporti i muajit ${monthLabel(d.month)}`
    body = reportBody(ctx.client.name, d)
  } else if (ctx.kind === 'office_message') {
    title = 'Keni mesazh të ri nga kontabilisti'
    body = quotes(d.messages)
    cta = 'Përgjigju'
  } else if (ctx.kind === 'client_message') {
    title = `Mesazh i ri nga ${ctx.client.name}`
    body = quotes(d.messages)
    url = appUrl
    cta = 'Hap programin'
  }
  const html = layout(ctx.office, title, body, url, cta)
  const text = `${title}\n\n${body.replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim()}\n\n${url}`
  return { html, text }
}

async function sendEmail(to: string[], subject: string, html: string, text: string, fromName: string | null, replyTo: string | null): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!key || !from) return 'Email-et nuk janë konfiguruar (RESEND_API_KEY / EMAIL_FROM në Supabase)'
  const name = (fromName ?? 'Kasa Kontabilist').replace(/["<>]/g, '').slice(0, 60)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${name} <${from}>`, to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  })
  if (res.ok) return null
  let msg = `Resend ${res.status}`
  try {
    const b = await res.json()
    msg += ': ' + (b.message ?? JSON.stringify(b)).slice(0, 300)
  } catch {
    /* keep the status */
  }
  return msg
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Metoda nuk lejohet' }, 405)
  let body: { kind?: string; id?: string; month?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Kërkesë e pavlefshme' }, 400)
  }
  const appUrl = (Deno.env.get('APP_URL') ?? req.headers.get('origin') ?? 'https://kasa-kontabilist.vercel.app').replace(/\/$/, '')
  const url = Deno.env.get('SUPABASE_URL')!

  // ---- scheduled monthly reports
  if (body.kind === 'cron_monthly') {
    const secret = Deno.env.get('CRON_SECRET')
    if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Nuk lejohet' }, 403)
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const now = new Date()
    const month = body.month ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
    const { data: targets, error } = await admin.rpc('_acc_report_targets', { p_month: month })
    if (error) return json({ error: error.message }, 500)
    let sent = 0
    let failed = 0
    for (const t of (targets as any[]) ?? []) {
      const ctx: Ctx = { log_id: 0, kind: 'report', to: t.to, subject: `Raporti i muajit ${monthLabel(month)} – ${t.client_name}`, data: t.data, client: { name: t.client_name, nui: t.client_nui }, office: t.office }
      const { html, text } = build(ctx, Deno.env.get('APP_URL') ?? 'https://kasa-kontabilist.vercel.app')
      const err = await sendEmail(t.to, ctx.subject, html, text, t.office?.name, t.office?.email)
      await admin.rpc('_acc_email_log_add', { p_office: t.office_id, p_client: t.client_id, p_kind: 'report', p_ref: `${t.client_id}:${month.slice(0, 7)}`, p_to: t.to, p_subject: ctx.subject, p_ok: !err, p_error: err })
      if (err) failed++
      else sent++
    }
    return json({ month, sent, failed })
  }

  // ---- sent by a user (office member or client in the portal)
  const auth = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ error: 'Nuk je i kyçur' }, 401)
  if (!body.kind || !body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return json({ error: 'Kërkesë e pavlefshme' }, 400)
  const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
  if (!Deno.env.get('RESEND_API_KEY') || !Deno.env.get('EMAIL_FROM')) {
    return json({ error: 'Email-et nuk janë konfiguruar ende (RESEND_API_KEY dhe EMAIL_FROM në Supabase).' }, 503)
  }
  const { data, error } = await db.rpc('acc_notify_context', { p_kind: body.kind, p_id: body.id, p_extra: body.month ? { month: body.month } : {} })
  if (error) return json({ error: error.message }, 400)
  const ctx = data as Ctx & { skip?: string }
  if (ctx.skip) return json({ skipped: ctx.skip })
  const { html, text } = build(ctx, appUrl)
  const err = await sendEmail(ctx.to, ctx.subject, html, text, ctx.kind === 'client_message' ? 'Portali i klientit' : ctx.office.name, ctx.kind === 'client_message' ? null : ctx.office.email)
  await db.rpc('acc_email_done', { p_id: ctx.log_id, p_ok: !err, p_error: err })
  if (err) return json({ error: err }, 502)
  return json({ sent: ctx.to.length, to: ctx.to })
})
