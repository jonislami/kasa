// Edge Function: acc-scan (Kasa Kontabilist, phase K6)
// Reads a supplier invoice (photo or PDF already uploaded to bucket acc-files and registered with acc_scan_add)
// with Claude and stores what it read with the RPC acc_scan_result.
//   POST { scan_id, strong? }  →  { status: 'read' | 'failed', extracted?, suggest?, error? }
// Runs entirely with the caller's own JWT (anon key + Authorization header): the scan row, the client and the
// file are reachable only through RLS / storage policies of that accountant. No service role is used.
// Secret needed in Supabase: ANTHROPIC_API_KEY.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

// Claude Haiku 5.5 reads ordinary invoices for a fraction of a cent; "strong" re-reads a hard one with Opus 5.5.
const MODEL_FAST = 'claude-haiku-5-5'
const MODEL_STRONG = 'claude-opus-5-5'
const MAX_BYTES = 20 * 1024 * 1024

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

function mediaType(mime: string | null, name: string): ImageType | 'application/pdf' | null {
  const m = (mime ?? '').toLowerCase()
  if (m === 'application/pdf' || /\.pdf$/i.test(name)) return 'application/pdf'
  if ((IMAGE_TYPES as readonly string[]).includes(m)) return m as ImageType
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.webp$/i.test(name)) return 'image/webp'
  return null
}

const nul = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })
const CATEGORIES = [
  'goods', 'assets', 'services', 'rent', 'utilities', 'telecom', 'fuel', 'vehicles', 'transport', 'taxes',
  'admin', 'operating', 'travel', 'representation', 'maintenance', 'marketing', 'bank', 'other',
]

// Structured output: every field required, null when not on the document.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_invoice', 'doc_type', 'supplier_name', 'supplier_nui', 'supplier_fiscal_no', 'supplier_vat_no', 'supplier_address',
    'buyer_name', 'buyer_nui', 'doc_no', 'doc_date', 'due_date', 'currency', 'payment', 'lines',
    'net_e', 'vat_e', 'net_d', 'vat_d', 'amt_c', 'amt_a', 'discount', 'total', 'category', 'summary', 'confidence', 'warnings',
  ],
  properties: {
    is_invoice: { type: 'boolean' },
    doc_type: { type: 'string', enum: ['invoice', 'credit_note', 'receipt'] },
    supplier_name: nul('string'),
    supplier_nui: nul('string'),
    supplier_fiscal_no: nul('string'),
    supplier_vat_no: nul('string'),
    supplier_address: nul('string'),
    buyer_name: nul('string'),
    buyer_nui: nul('string'),
    doc_no: nul('string'),
    doc_date: nul('string'),
    due_date: nul('string'),
    currency: { type: 'string' },
    payment: { type: 'string', enum: ['cash', 'card', 'bank', 'due', 'unknown'] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'unit', 'unit_price_net', 'vat_rate', 'total_gross'],
        properties: {
          description: { type: 'string' },
          quantity: nul('number'),
          unit: nul('string'),
          unit_price_net: nul('number'),
          vat_rate: { type: 'string', enum: ['E', 'D', 'C', 'A'] },
          total_gross: nul('number'),
        },
      },
    },
    net_e: { type: 'number' },
    vat_e: { type: 'number' },
    net_d: { type: 'number' },
    vat_d: { type: 'number' },
    amt_c: { type: 'number' },
    amt_a: { type: 'number' },
    discount: { type: 'number' },
    total: { type: 'number' },
    category: { type: 'string', enum: CATEGORIES },
    summary: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}

function systemPrompt(clientName: string, clientNui: string | null) {
  return `You read supplier invoices, fiscal receipts and credit notes from Kosovo for an accounting office and return the data as JSON in the given schema.

The buyer is normally the office's client "${clientName}"${clientNui ? ` (NUI ${clientNui})` : ''}. The supplier is the issuer/seller of the document. Never swap them.

Rules:
- Amounts in EUR as plain numbers with a dot for decimals (the documents often write 1.234,56 – that is 1234.56).
- VAT rates in Kosovo: E = 18%, D = 8%, C = 0%, A = exempt. Fill net_e/vat_e (base and VAT at 18%), net_d/vat_d (8%), amt_c (0%) and amt_a (exempt) exactly as printed in the VAT summary of the document. If there is no summary, compute them from the lines (prices include VAT unless the document says otherwise). Use 0 for rates that do not appear.
- total = the amount to pay including VAT. discount = total discount shown, or 0.
- NUI is the 9-digit business number (Numri Unik Identifikues); fiscal number and VAT number are separate fields. Keep only what is printed.
- Dates as YYYY-MM-DD. doc_no exactly as printed (invoice number or receipt number).
- doc_type: "receipt" for a cash-register fiscal coupon, "credit_note" for a credit note / return (amounts stay positive), otherwise "invoice".
- payment: cash / card / bank when the document says how it was paid; "due" if it has a due date or says unpaid; else "unknown".
- lines: the items as printed (max 60; group the rest into one line). vat_rate as the letter E/D/C/A.
- category: the best accounting category for the whole document (goods = goods for resale, assets = equipment and furniture lasting more than a year, fuel, utilities = electricity/water/waste, telecom = phone/internet, vehicles = vehicle service/insurance/registration, representation = meals and gifts, etc.).
- summary: one short line in Albanian describing what was bought (e.g. "Karburant 45 L", "Material zyre").
- warnings: short notes in Albanian for anything the accountant must check: unreadable parts, totals that do not add up, missing NUI, a buyer that is not the client, a handwritten or damaged document.
- If the image is not an invoice or receipt at all, set is_invoice to false, explain in warnings and fill the rest with nulls/0.
- Never invent values that are not on the document: use null.`
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Arithmetic checks on what the model read; problems are added as warnings for the accountant. */
function checks(x: Record<string, unknown>): string[] {
  const n = (k: string) => Number(x[k] ?? 0) || 0
  const w: string[] = []
  const sum = r2(n('net_e') + n('vat_e') + n('net_d') + n('vat_d') + n('amt_c') + n('amt_a'))
  if (n('total') && Math.abs(sum - n('total')) > 0.05) w.push(`Shuma e normave (${sum.toFixed(2)} €) nuk përputhet me totalin (${n('total').toFixed(2)} €).`)
  if (n('net_e') && Math.abs(n('net_e') * 0.18 - n('vat_e')) > 0.05 + n('net_e') * 0.002) w.push('TVSH-ja 18% nuk është 18% e bazës – kontrollo.')
  if (n('net_d') && Math.abs(n('net_d') * 0.08 - n('vat_d')) > 0.05 + n('net_d') * 0.002) w.push('TVSH-ja 8% nuk është 8% e bazës – kontrollo.')
  const d = typeof x.doc_date === 'string' ? x.doc_date : null
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) w.push('Data e faturës nuk u lexua.')
  else {
    const t = Date.parse(d)
    if (Number.isNaN(t) || t > Date.now() + 3 * 86400000 || t < Date.now() - 6 * 366 * 86400000) w.push('Data e faturës duket e pasaktë.')
  }
  const nui = typeof x.supplier_nui === 'string' ? x.supplier_nui.replace(/\D/g, '') : ''
  if (!nui) w.push('NUI e furnitorit nuk u gjet.')
  else if (nui.length !== 9) w.push(`NUI e furnitorit (${nui}) nuk ka 9 shifra.`)
  return w
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Metoda nuk lejohet' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ error: 'Nuk je i kyçur' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let scanId: string
  let strong = false
  try {
    const body = (await req.json()) as { scan_id?: string; strong?: boolean }
    scanId = String(body.scan_id ?? '')
    strong = body.strong === true
  } catch {
    return json({ error: 'Kërkesë e pavlefshme' }, 400)
  }
  if (!/^[0-9a-f-]{36}$/i.test(scanId)) return json({ error: 'Skanimi mungon' }, 400)

  const { data: scan, error: scanErr } = await db.from('acc_scans').select('id, client_id, path, file_name, mime, status').eq('id', scanId).maybeSingle()
  if (scanErr || !scan) return json({ error: 'Skanimi nuk u gjet' }, 404)
  if (scan.status === 'confirmed') return json({ error: 'Skanimi është konfirmuar tashmë' }, 409)

  const MODEL = strong ? MODEL_STRONG : MODEL_FAST
  const store = async (p: Record<string, unknown>) => {
    const { data, error } = await db.rpc('acc_scan_result', { p_id: scanId, p })
    if (error) throw new Error(error.message)
    return data as { status: string; suggest?: unknown }
  }
  const failWith = async (message: string, status = 200) => {
    try {
      await store({ error: message, model: MODEL })
    } catch {
      /* the scan row stays as it was */
    }
    return json({ status: 'failed', error: message }, status)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return failWith('Shërbimi AI nuk është konfiguruar (mungon ANTHROPIC_API_KEY në Supabase).', 500)

  const type = mediaType(scan.mime, scan.file_name)
  if (!type) return failWith('Formati nuk lexohet. Përdor JPG, PNG, WEBP ose PDF.')

  const { data: client } = await db.from('acc_clients').select('name, nui').eq('id', scan.client_id).maybeSingle()
  const file = await db.storage.from('acc-files').download(scan.path)
  if (file.error || !file.data) return failWith('Skedari nuk u gjet në arkiv.')
  if (file.data.size > MAX_BYTES) return failWith('Skedari është më i madh se 20 MB.')
  const data = encodeBase64(new Uint8Array(await file.data.arrayBuffer()))

  const anthropic = new Anthropic({ apiKey })
  try {
    const params = {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' as const, format: { type: 'json_schema' as const, schema: SCHEMA } },
      system: systemPrompt(client?.name ?? 'klienti', client?.nui ?? null),
      messages: [
        {
          role: 'user' as const,
          content: [
            type === 'application/pdf'
              ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
              : { type: 'image' as const, source: { type: 'base64' as const, media_type: type, data } },
            { type: 'text' as const, text: 'Read this document and return the JSON.' },
          ],
        },
      ],
      stream: false as const,
    }
    // Opus: on a policy decline the API re-runs the request on a fallback model inside the same call.
    // Haiku has no server-side fallback; a declined scan can be re-read with the strong model.
    const response = strong
      ? await anthropic.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as Parameters<typeof anthropic.beta.messages.create>[0] & { stream: false })
      : await anthropic.beta.messages.create(params as Parameters<typeof anthropic.beta.messages.create>[0] & { stream: false })

    if (response.stop_reason === 'refusal') return failWith(strong ? 'Shërbimi AI nuk e lexoi këtë dokument.' : 'Shërbimi AI nuk e lexoi këtë dokument. Provo "Lexo me AI më të fortë".')
    if (response.stop_reason === 'max_tokens') return failWith('Dokumenti është shumë i gjatë për t’u lexuar njëherësh.')
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(text)
    } catch {
      return failWith('Përgjigjja e shërbimit AI nuk u kuptua. Provo përsëri.')
    }
    if (extracted.is_invoice === false) {
      const why = Array.isArray(extracted.warnings) && extracted.warnings.length ? String(extracted.warnings[0]) : 'Dokumenti nuk duket si faturë.'
      return failWith(why)
    }
    extracted.warnings = [...(Array.isArray(extracted.warnings) ? extracted.warnings : []), ...checks(extracted)]
    const saved = await store({ extracted, model: response.model })
    return json({ status: saved.status, extracted, suggest: saved.suggest ?? null })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return failWith('Shërbimi AI është i zënë. Provo përsëri pas pak.', 429)
    if (e instanceof Anthropic.AuthenticationError) return failWith('Çelësi i shërbimit AI nuk vlen (ANTHROPIC_API_KEY).', 500)
    if (e instanceof Anthropic.BadRequestError) return failWith('Shërbimi AI e refuzoi skedarin: ' + e.message.slice(0, 200))
    if (e instanceof Anthropic.APIError) return failWith(`Gabim te shërbimi AI (${e.status ?? '—'}). Provo përsëri.`, 502)
    return failWith('Gabim: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200), 500)
  }
})
