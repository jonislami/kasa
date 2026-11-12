// Edge Function: fiscal-relay – the bridge between Kasa and the ATK fiscalization service (SEF).
// ATK's servers do not allow calls from a browser (no CORS), so every request passes through here.
// The signing key never comes here: the device signs, this function only forwards and records.
//   { action: 'verify',  register_id }
//       owner/manager → POST /ca/verify/{nui} → { business_name, verification_code }
//   { action: 'signcsr', register_id, business_name, verification_code, csr, public_key, device_id, platform }
//       owner/manager → POST /ca/signcsr → certificate stored, register "registered"
//   { action: 'coupon',  sale_id, register_id, device_id, coupon_type, coupon_id, coupon_seq, reference_no?,
//                        verification_no, issued_at, details, signature, qr, offline }
//       any staff of the business → stored in fiscal_coupons, POST /pos/coupon
//       → { status: 'sent' | 'pending' | 'failed', transaction_no?, error? }
//   { action: 'retry', sale_id } – sends a stored coupon again (pending/failed), e.g. from the Fiskalizimi page
// Every call to ATK is written to fiscal_log.
import { createClient } from 'npm:@supabase/supabase-js@2'

const ATK = { test: 'https://fiskalizimi-test.atk-ks.org', prod: 'https://fiskalizimi.atk-ks.org' } as const
type Env = keyof typeof ATK
const TIMEOUT_MS = 10_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const fail = (error: string, status = 400) => json({ error }, status)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/

interface AtkAnswer {
  ok: boolean
  status: number // 0 = no answer (network / timeout)
  /** Body as text: ATK's transaction numbers are larger than JavaScript numbers can hold exactly. */
  raw?: string
  data: Record<string, unknown>
  message: string
}

async function callAtk(env: Env, path: string, body: unknown): Promise<AtkAnswer> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ATK[env] + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    let data: Record<string, unknown> = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text.slice(0, 300) }
    }
    const err = data.error as unknown
    const message =
      typeof err === 'string' ? err : err && typeof err === 'object' ? String((err as { message?: string }).message ?? JSON.stringify(err)) : String(data.message ?? '')
    return { ok: res.ok, status: res.status, raw: text, data, message: message || (res.ok ? 'OK' : `ATK u përgjigj me ${res.status}`) }
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    return { ok: false, status: 0, data: {}, message: aborted ? 'ATK nuk u përgjigj brenda 10 sekondave' : 'Nuk u lidh me ATK: ' + (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('Metoda nuk lejohet', 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // --- who is calling? ---
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return fail('Nuk je i kyçur', 401)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return fail('Seanca ka skaduar, hyr përsëri', 401)
  const userId = userData.user.id
  const { data: me } = await admin
    .from('profiles')
    .select('id, business_id, role, active, full_name, businesses!inner(id, active, name, nui, fiscal_number, fiscal_branch_id, fiscal_env)')
    .eq('id', userId)
    .maybeSingle()
  const biz = (me as unknown as { businesses?: { id: string; active: boolean; name: string; nui: string | null; fiscal_number: string | null; fiscal_branch_id: number | null; fiscal_env: Env } } | null)?.businesses
  if (!me || !me.active || !biz?.active) return fail('Llogaria nuk ka qasje', 403)
  const businessId = biz.id
  const manager = me.role === 'admin' || me.role === 'manager'

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Kërkesë e pavlefshme')
  }
  const action = String(body.action ?? '')

  const log = (row: { register_id?: string | null; sale_id?: string | null; env: Env; action: string; ok: boolean; http_status: number; coupon_id?: number | null; message: string }) =>
    admin.from('fiscal_log').insert({ business_id: businessId, user_id: userId, ...row, message: row.message.slice(0, 500) })

  const loadRegister = async (id: unknown) => {
    if (!UUID_RE.test(String(id ?? ''))) return null
    const { data } = await admin.from('registers').select('*').eq('id', String(id)).eq('business_id', businessId).maybeSingle()
    return data as null | { id: string; name: string; atk_pos_id: string | null; fiscal_status: string; fiscal_device_id: string | null; fiscal_env: Env | null; coupon_seq: number }
  }
  const applicationId = async (env: Env) => {
    const { data } = await admin.from('fiscal_config').select('application_id_test, application_id_prod').eq('id', 1).maybeSingle()
    return (env === 'prod' ? data?.application_id_prod : data?.application_id_test) ?? null
  }

  // ------------------------------------------------------------------ onboarding
  if (action === 'verify' || action === 'signcsr') {
    if (!manager) return fail('Vetëm pronari ose menaxheri e regjistron arkën', 403)
    const reg = await loadRegister(body.register_id)
    if (!reg) return fail('Arka nuk u gjet', 404)
    if (!biz.nui || !biz.fiscal_number || !biz.fiscal_branch_id) return fail('Plotëso Hapin 1: NUI, numri i fiskalizimit dhe numri i njësisë')
    if (!reg.atk_pos_id) return fail('Vendos POS ID-në e kësaj arke (Hapi 2)')
    if (reg.fiscal_status === 'registered') return fail('Kjo arkë është regjistruar tashmë. Çregjistroje para se ta regjistrosh në një pajisje tjetër.')
    const env = biz.fiscal_env
    const appId = await applicationId(env)
    if (!appId) return fail(`Mungon Application ID e Kasa-s për mjedisin ${env}. Administratori i platformës e vendos te fiscal_config.`)

    if (action === 'verify') {
      const r = await callAtk(env, `/ca/verify/${encodeURIComponent(biz.nui)}`, {
        fiscalization_no: biz.fiscal_number,
        pos_id: Number(reg.atk_pos_id),
        branch_id: Number(biz.fiscal_branch_id),
        application_id: Number(appId),
      })
      await log({ register_id: reg.id, env, action: 'verify', ok: r.ok, http_status: r.status, message: r.message })
      if (!r.ok) return fail('ATK: ' + r.message, 502)
      return json({ business_name: String(r.data.business_name ?? ''), verification_code: String(r.data.verification_code ?? ''), nui: biz.nui, branch_id: biz.fiscal_branch_id, pos_id: reg.atk_pos_id, env })
    }

    const csr = String(body.csr ?? '')
    const publicKey = String(body.public_key ?? '')
    const deviceId = String(body.device_id ?? '').slice(0, 100)
    if (!csr.includes('BEGIN CERTIFICATE REQUEST') || !B64_RE.test(publicKey) || !deviceId) return fail('Kërkesa për certifikatë nuk është e plotë')
    const r = await callAtk(env, '/ca/signcsr', {
      business_name: String(body.business_name ?? ''),
      business_id: Number(biz.nui),
      branch_id: Number(biz.fiscal_branch_id),
      verification_code: String(body.verification_code ?? ''),
      pos_id: Number(reg.atk_pos_id),
      application_id: Number(appId),
      csr,
    })
    await log({ register_id: reg.id, env, action: 'signcsr', ok: r.ok, http_status: r.status, message: r.message })
    const cert = String(r.data.signed_certificate ?? '')
    if (!r.ok || !cert) return fail('ATK: ' + (r.ok ? 'certifikata mungon në përgjigje' : r.message), 502)
    const { error } = await admin.rpc('_fiscal_registered', {
      p_register: reg.id, p_device: deviceId, p_platform: String(body.platform ?? 'web').slice(0, 20),
      p_public_key: publicKey, p_certificate: cert, p_env: env, p_user: userId,
    })
    if (error) return fail('Certifikata u mor, por nuk u ruajt: ' + error.message, 500)
    return json({ ok: true, certificate: cert })
  }

  // ------------------------------------------------------------------ coupons
  if (action === 'coupon' || action === 'retry') {
    const saleId = String(body.sale_id ?? '')
    if (!UUID_RE.test(saleId)) return fail('Shitja mungon')
    const { data: sale } = await admin.from('sales').select('id, business_id, register_id, kind').eq('id', saleId).maybeSingle()
    if (!sale || sale.business_id !== businessId) return fail('Shitja nuk u gjet', 404)

    let { data: row } = await admin.from('fiscal_coupons').select('*').eq('sale_id', saleId).maybeSingle()
    if (row?.status === 'sent') return json({ status: 'sent', transaction_no: row.transaction_no })

    if (!row) {
      if (action === 'retry') return fail('Kuponi fiskal nuk u gjet', 404)
      const reg = await loadRegister(body.register_id)
      if (!reg) return fail('Arka nuk u gjet', 404)
      if (reg.fiscal_status !== 'registered' || !reg.fiscal_env) return fail('Arka nuk është regjistruar në ATK')
      if (reg.fiscal_device_id && String(body.device_id ?? '') !== reg.fiscal_device_id) return fail('Kjo pajisje nuk e mban çelësin e kësaj arke', 403)
      const seq = Number(body.coupon_seq)
      const couponId = Number(body.coupon_id)
      const expected = Number(biz.fiscal_branch_id) * 1e12 + Number(reg.atk_pos_id) * 1e8 + seq
      if (!Number.isSafeInteger(seq) || seq <= 0 || seq >= 1e8 || couponId !== expected) return fail('Numri i kuponit fiskal nuk përputhet me arkën')
      const type = Number(body.coupon_type)
      const expectedType = { sale: 1, void: 2, refund: 3 }[sale.kind as 'sale' | 'void' | 'refund']
      if (type !== expectedType) return fail('Lloji i kuponit nuk përputhet me shitjen')
      const details = String(body.details ?? '')
      const signature = String(body.signature ?? '')
      const qr = String(body.qr ?? '')
      const verificationNo = String(body.verification_no ?? '')
      if (!B64_RE.test(details) || !B64_RE.test(signature) || !qr.includes('|') || !/^[A-Za-z0-9]{1,16}$/.test(verificationNo)) return fail('Kuponi i nënshkruar nuk është i plotë')
      const { data: stored, error } = await admin.rpc('_fiscal_store', {
        p: {
          sale_id: saleId, business_id: businessId, register_id: reg.id, env: reg.fiscal_env, coupon_type: type,
          coupon_id: couponId, coupon_seq: seq, branch_id: biz.fiscal_branch_id, pos_id: Number(reg.atk_pos_id),
          reference_no: body.reference_no ? Number(body.reference_no) : null, verification_no: verificationNo,
          issued_at: String(body.issued_at ?? new Date().toISOString()), details, signature, qr, offline: Boolean(body.offline),
        },
      })
      if (error) {
        const dup = /duplicate|unique/i.test(error.message)
        return fail(dup ? 'Ky numër kuponi ose NUIKF është përdorur tashmë' : 'Kuponi nuk u ruajt: ' + error.message, dup ? 409 : 500)
      }
      row = stored
    }

    const env = row.env as Env
    const r = await callAtk(env, '/pos/coupon', { details: row.details, signature: row.signature })
    await log({ register_id: row.register_id, sale_id: saleId, env, action: 'coupon', ok: r.ok, http_status: r.status, coupon_id: row.coupon_id, message: r.message })
    // 2xx → sent; 4xx → rejected by ATK (needs attention); no answer / 5xx → stays pending, sent again later.
    const status = r.ok ? 'sent' : r.status >= 400 && r.status < 500 ? 'failed' : 'pending'
    // Read the number from the raw text (JSON.parse would round a 19-digit number).
    const transactionNo = r.ok ? (/"(?:transaction_id|TransactionNo|transaction_no)"\s*:\s*"?(\d+)"?/.exec(r.raw ?? '')?.[1] ?? null) : null
    const { error: saveError } = await admin.rpc('_fiscal_store', { p: { sale_id: saleId, status, transaction_no: transactionNo, error: r.ok ? null : r.message } })
    if (saveError) {
      // ATK has the coupon; only our copy of the answer is missing. Never send it again because of this.
      await log({ register_id: row.register_id, sale_id: saleId, env, action: 'store', ok: false, http_status: 500, coupon_id: row.coupon_id, message: 'Përgjigjja e ATK-së nuk u ruajt: ' + saveError.message })
    }
    return json({ status, transaction_no: transactionNo, error: r.ok ? undefined : r.message })
  }

  return fail('Veprim i panjohur')
})
