// Edge Function: send-ecoupon – the fiscal coupon sent to the buyer by e-mail ("e-kupon"), with the buyer's consent.
// ATK: UA 01/2026 neni 39 (a non-cash payment or a distance sale may get the coupon electronically, the buyer agrees),
// Kërkesat specifike neni 25 pika 18 (all elements of the coupon, QR, the text "e-kupon").
//   POST { sale_id, email, consent: true }  →  { ok: true } | { error }
// Runs with the caller's own JWT (anon key + Authorization): the sale, its fiscal coupon and the business are read
// through RLS, so a till can send only its own business's coupons. The content is built here from the database –
// the till sends no HTML. Secrets: RESEND_API_KEY, EMAIL_FROM; optional APP_URL (for the RKS image).
import { createClient } from 'npm:@supabase/supabase-js@2'
import QRCode from 'npm:qrcode@1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const n2 = (v: unknown) => Math.abs(Number(v ?? 0)).toFixed(2)
const pad = (v: unknown, n: number) => String(Math.trunc(Number(v ?? 0))).padStart(n, '0')
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Belgrade', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const dt = (iso: string) => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`
}
const PAY: Record<string, string> = { cash: 'KESH', card: 'KARTELË', mixed: 'KESH + KARTELË' }
const KIND: Record<string, string> = { bank: 'TRANSFER BANKAR', voucher: 'VAUÇER', cheque: 'ÇEK' }

type Item = { name: string; unit: string; quantity: number; unit_price: number; line_discount: number; vat_code: string }
type Sale = Record<string, unknown> & {
  id: string
  kind: 'sale' | 'void' | 'refund'
  invoice_no: number
  daily_no: number
  created_at: string
  client_created_at: string | null
  total: number
  net_total: number
  invoice_discount: number
  payment_method: string
  payment_kind: string | null
  vat_lines: { code: string; rate: number; vat: number }[]
  items: Item[]
  worker_name: string | null
  worker_no?: number | null
  unit?: { name: string | null; unit_no: string | null; address: string | null; city: string | null } | null
  reason: string | null
  ref_invoice_no: number | null
}

/** Same item on one line (ATK). */
function group(items: Item[]): Item[] {
  const out: Item[] = []
  const at = new Map<string, number>()
  for (const i of items) {
    const k = [i.name, i.unit, i.unit_price, i.vat_code, Math.sign(Number(i.quantity))].join('|')
    const j = at.get(k)
    if (j == null) {
      at.set(k, out.length)
      out.push({ ...i, quantity: Number(i.quantity), line_discount: Number(i.line_discount) })
    } else {
      out[j].quantity += Number(i.quantity)
      out[j].line_discount += Number(i.line_discount)
    }
  }
  return out
}

function html(s: Sale, b: Record<string, unknown>, f: Record<string, unknown>, footer: string | null, logoUrl: string | null): string {
  const row = (l: string, r: string, strong = false) =>
    `<tr><td style="padding:1px 0;${strong ? 'font-weight:bold;font-size:15px' : ''}">${l}</td><td style="padding:1px 0;text-align:right;${strong ? 'font-weight:bold;font-size:15px' : ''}">${r}</td></tr>`
  const title = s.kind === 'void' ? 'KUPON FISKAL I ANULUAR' : s.kind === 'refund' ? 'KUPON FISKAL KTHIMI' : 'KUPON FISKAL'
  const items = group(s.items)
  const lines = items
    .map((i) => {
      const q = Math.abs(i.quantity)
      const gross = q * Number(i.unit_price)
      const disc = Math.abs(i.line_discount)
      return (
        `<tr><td>${esc(i.name)}</td><td style="text-align:right;white-space:nowrap">${q} X ${n2(i.unit_price)}</td><td style="text-align:right;white-space:nowrap">${s.kind === 'sale' ? '' : '-'}${n2(gross)} ${esc(i.vat_code)}</td></tr>` +
        (disc > 0.004 ? `<tr><td colspan="2" style="padding-left:8px;font-style:italic">Ulje</td><td style="text-align:right;font-style:italic">-${n2(disc)}</td></tr>` : '')
      )
    })
    .join('')
  const payment = s.payment_kind && KIND[s.payment_kind] ? (s.payment_method === 'mixed' ? `KESH + ${KIND[s.payment_kind]}` : KIND[s.payment_kind]) : PAY[s.payment_method] ?? s.payment_method
  const vat = (s.vat_lines ?? []).filter((v) => (v.code === 'D' || v.code === 'E') && Math.abs(Number(v.vat)) > 0.004)
  // a business with several units: the name and address of the register's unit (0047)
  const u = s.unit ?? null
  const header = [
    ['EMRI I NJËSISË', u?.name || b.name],
    ['NUMRI I NJËSISË', f.branch_id],
    ['ADRESA E NJËSISË', u?.address || b.address],
    ['VENDI', u?.address ? u?.city || b.city : b.city],
    ['TELEFONI', b.phone],
    ['NF-NUI', b.nui],
    ['NUMRI I TVSH-SË', b.vat_number],
  ]
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<div>${k}: ${esc(v)}</div>`)
    .join('')
  const sefNo = `${f.branch_id}-${b.nui}-${f.pos_id}`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6f3;padding:16px">
<div style="max-width:380px;margin:0 auto 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#334155;line-height:1.45">
  <div>Kuponi juaj fiskal elektronik nga <b>${esc(b.name)}</b>.</div>
  <div style="color:#64748B">Vaš elektronski fiskalni kupon od <b>${esc(b.name)}</b>.</div>
</div>
<div style="max-width:380px;margin:0 auto;background:#fff;padding:16px;font-family:Lato,Arial,Helvetica,sans-serif;font-size:13px;color:#000;line-height:1.35">
  <div style="text-align:center">
    <div>TATIMPAGUESI: ${esc(b.name)}</div>${header}
  </div>
  <div style="overflow:hidden;white-space:nowrap;margin:6px 0">################################################</div>
  ${s.worker_name ? `<div style="text-align:right;font-size:12px">EMRI I PUNËTORIT: ${esc(s.worker_name)}${s.worker_no ? ` (ID ${String(s.worker_no).padStart(3, '0')})` : ''}</div>` : ''}
  <div style="text-align:center;font-weight:bold;font-size:16px;margin-top:4px">${title}</div>
  ${f.env === 'test' ? '<div style="text-align:center;font-weight:bold">TEST – PA VLERË FISKALE</div>' : ''}
  ${s.kind !== 'sale' && s.ref_invoice_no ? `<div style="text-align:center">KUPON FISKAL NR. ${s.ref_invoice_no}</div>` : ''}
  ${s.reason ? `<div style="text-align:center;font-style:italic">${s.kind === 'void' ? 'ARSYEJA E ANULIMIT' : 'ARSYEJA'}: ${esc(s.reason)}</div>` : ''}
  <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
    <tr><td style="border-bottom:1px solid #000">ARTIKULLI</td><td style="border-bottom:1px solid #000;text-align:right">SASIA X ÇMIMI</td><td style="border-bottom:1px solid #000;text-align:right">SHUMA</td></tr>
    ${lines}
  </table>
  <table style="width:100%;border-collapse:collapse;margin-top:6px;border-top:1px solid #000;font-size:13px">
    ${Number(s.invoice_discount) > 0.004 ? row('NËNTOTALI', n2(Math.abs(Number(s.total)) + Math.abs(Number(s.invoice_discount)))) + row('<i>ULJE</i>', `<i>-${n2(s.invoice_discount)}</i>`) : ''}
    ${row(s.kind === 'refund' ? 'TOTALI I KTHIMIT' : 'TOTALI PËR PAGESË', `${s.kind === 'sale' ? '' : '-'}${n2(s.total)}€`, true)}
    ${row('MËNYRA E PAGESËS', esc(payment))}
    ${vat.map((v) => row(`TVSH ${esc(v.code)} ${Math.round(Number(v.rate) * 100)}%`, `${n2(v.vat)}€`)).join('')}
    ${row('TOTALI PA TVSH', `${n2(s.net_total)}€`)}
  </table>
  <div style="border-top:1px dashed #000;margin-top:6px;padding-top:4px;text-align:right">ARTIKUJ - ${items.length}</div>
  <div>${pad(s.invoice_no, 10)}</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    ${row('DATA DHE ORA', dt(String(s.client_created_at ?? s.created_at)))}
    ${row('NR. IDENTIFIKUES I SEF', esc(sefNo))}
  </table>
  <div style="margin-top:6px;font-weight:bold">NUIKF: ${esc(f.verification_no)}</div>
  <div style="text-align:center;margin-top:8px">KUPON FISKAL DITOR NR. ${pad(s.daily_no, 4)}</div>
  <div style="text-align:center;margin:8px 0"><img src="cid:kupon-qr" alt="Kodi QR i kuponit fiskal" width="180" height="180" style="display:inline-block"></div>
  <div style="text-align:center">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" height="36" style="vertical-align:middle">` : ''}
    <span style="display:inline-block;vertical-align:middle;font-family:Arial,sans-serif;font-weight:900;font-size:13px;line-height:1.05;text-align:left">RKS<br>MF</span>
  </div>
  <div style="text-align:center;font-style:italic;font-weight:bold;margin-top:8px">e-kuponi</div>
  ${footer ? `<div style="text-align:center;text-transform:uppercase">${esc(footer)}</div>` : ''}
  <div style="text-align:center;font-size:11px;color:#555;margin-top:8px">Kuponin mund ta verifikoni duke skanuar kodin QR me aplikacionin e ATK-së.</div>
  <div style="text-align:center;font-size:11px;color:#555;margin-top:2px">Kupon možete proveriti skeniranjem QR koda aplikacijom PAK-a.</div>
</div></body></html>`
}

/** The same coupon as plain text: mail filters trust a message that has a text part next to the HTML. */
function text(s: Sale, b: Record<string, unknown>, f: Record<string, unknown>, footer: string | null): string {
  const title = s.kind === 'void' ? 'KUPON FISKAL I ANULUAR' : s.kind === 'refund' ? 'KUPON FISKAL KTHIMI' : 'KUPON FISKAL'
  const sign = s.kind === 'sale' ? '' : '-'
  const u = s.unit ?? null
  const vat = (s.vat_lines ?? []).filter((v) => (v.code === 'D' || v.code === 'E') && Math.abs(Number(v.vat)) > 0.004)
  const payment = s.payment_kind && KIND[s.payment_kind] ? (s.payment_method === 'mixed' ? `KESH + ${KIND[s.payment_kind]}` : KIND[s.payment_kind]) : PAY[s.payment_method] ?? s.payment_method
  const out = [
    `Kuponi juaj fiskal elektronik nga ${b.name}.`,
    `Vaš elektronski fiskalni kupon od ${b.name}.`,
    '',
    `TATIMPAGUESI: ${b.name}`,
    u?.name ? `EMRI I NJËSISË: ${u.name}` : null,
    `NUMRI I NJËSISË: ${f.branch_id}`,
    (u?.address || b.address) ? `ADRESA: ${u?.address || b.address}${(u?.city || b.city) ? `, ${u?.city || b.city}` : ''}` : null,
    b.nui ? `NF-NUI: ${b.nui}` : null,
    b.vat_number ? `NUMRI I TVSH-SË: ${b.vat_number}` : null,
    '',
    title,
    f.env === 'test' ? 'TEST – PA VLERË FISKALE' : null,
    s.kind !== 'sale' && s.ref_invoice_no ? `KUPON FISKAL NR. ${s.ref_invoice_no}` : null,
    s.reason ? `ARSYEJA: ${s.reason}` : null,
    '',
    ...group(s.items).map((i) => `${i.name}  ${Math.abs(i.quantity)} x ${n2(i.unit_price)} = ${sign}${n2(Math.abs(i.quantity) * Number(i.unit_price))} ${i.vat_code}`),
    '',
    `${s.kind === 'refund' ? 'TOTALI I KTHIMIT' : 'TOTALI PËR PAGESË'}: ${sign}${n2(s.total)} EUR`,
    `MËNYRA E PAGESËS: ${payment}`,
    ...vat.map((v) => `TVSH ${v.code} ${Math.round(Number(v.rate) * 100)}%: ${n2(v.vat)} EUR`),
    `TOTALI PA TVSH: ${n2(s.net_total)} EUR`,
    '',
    `Nr. ${pad(s.invoice_no, 10)} · ${dt(String(s.client_created_at ?? s.created_at))}`,
    `NR. IDENTIFIKUES I SEF: ${f.branch_id}-${b.nui}-${f.pos_id}`,
    `NUIKF: ${f.verification_no}`,
    `KUPON FISKAL DITOR NR. ${pad(s.daily_no, 4)}`,
    '',
    'e-kuponi – kodi QR është në versionin HTML të këtij email-i; skanoje me aplikacionin e ATK-së.',
    'e-kupon – QR kod je u HTML verziji ove poruke; skenirajte ga aplikacijom PAK-a.',
    footer ? footer.toUpperCase() : null,
  ]
  return out.filter((l) => l !== null).join('\n')
}

async function send(to: string, subject: string, body: string, plain: string, qrPng: string, fromName: string, replyTo: string | null): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!key || !from) return 'Email-et nuk janë konfiguruar (RESEND_API_KEY / EMAIL_FROM në Supabase)'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName.replace(/["<>]/g, '').slice(0, 60)} <${from}>`,
      to: [to],
      subject,
      html: body,
      text: plain,
      // the buyer's answer goes to the business, not to KontoSef
      ...(replyTo ? { reply_to: replyTo } : {}),
      attachments: [{ filename: 'kupon-qr.png', content: qrPng, content_id: 'kupon-qr', content_type: 'image/png' }],
    }),
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
  const auth = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ error: 'Nuk je i kyçur' }, 401)

  let p: { sale_id?: string; email?: string; consent?: boolean }
  try {
    p = await req.json()
  } catch {
    return json({ error: 'Kërkesë e pavlefshme' }, 400)
  }
  const saleId = String(p.sale_id ?? '')
  const email = String(p.email ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) return json({ error: 'Shitja mungon' }, 400)
  if (!EMAIL.test(email)) return json({ error: 'Adresa e email-it nuk është e saktë' }, 400)
  if (p.consent !== true) return json({ error: 'Duhet pëlqimi i blerësit për kuponin elektronik' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: sale, error: saleErr } = await db.rpc('sale_json', { p_sale_id: saleId })
  if (saleErr || !sale) return json({ error: 'Shitja nuk u gjet' }, 404)
  const { data: coupon } = await db.from('fiscal_coupons').select('verification_no, qr, branch_id, pos_id, env, status').eq('sale_id', saleId).maybeSingle()
  if (!coupon) return json({ error: 'Kjo shitje nuk ka kupon fiskal' }, 409)
  const { data: business } = await db.from('businesses').select('id, name, nui, vat_number, address, city, phone').maybeSingle()
  if (!business) return json({ error: 'Biznesi nuk u gjet' }, 404)
  const { data: settings } = await db.from('business_settings').select('receipt_footer').maybeSingle()

  const png = (await QRCode.toDataURL(String(coupon.qr), { errorCorrectionLevel: 'M', margin: 1, width: 360 })).split(',')[1]
  const appUrl = (Deno.env.get('APP_URL') ?? 'https://kasa-two-psi.vercel.app').replace(/\/$/, '')
  const s = sale as Sale
  const subject = `Kuponi fiskal · Fiskalni kupon nr. ${pad(s.invoice_no, 10)} – ${business.name}`
  const footer = (settings?.receipt_footer as string | null) ?? null
  // reply address: the owner's e-mail (a real one, not the internal address of a PIN account)
  const { data: owner } = await db.from('profiles').select('email').eq('role', 'admin').not('email', 'is', null).limit(1).maybeSingle()
  const replyTo = owner?.email && EMAIL.test(String(owner.email)) && !/@pin\.kasa\.app$/i.test(String(owner.email)) ? String(owner.email) : null
  const err = await send(email, subject, html(s, business, coupon, footer, `${appUrl}/rks.png`), text(s, business, coupon, footer), png, String(business.name), replyTo)
  if (err) return json({ error: err }, 502)

  // trail: who sent which coupon (the address is kept masked)
  const masked = email.replace(/^(.).*?(.)?@/, (_m, a: string, z?: string) => `${a}***${z ?? ''}@`)
  await db.rpc('log_action', { p_action: 'ecoupon_sent', p_entity: 'sale', p_entity_id: saleId, p_details: { to: masked, invoice_no: s.invoice_no } })
  return json({ ok: true })
})
