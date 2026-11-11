// Fiscalization on this device (ATK – SEF). The only place the app talks to the fiscal service.
//  - registerOnDevice(): creates the register's non-exportable key, asks ATK for the certificate
//    (verify → CSR signed here → signcsr) through the Edge Function fiscal-relay.
//  - fiscalize(): builds and signs the coupon + QR for a sale, keeps it in the encrypted queue and,
//    when online, sends it to ATK *before* the receipt is printed. Without an answer the receipt is
//    printed "OFFLINE" and the coupon goes out later (flushFiscal), within 48 hours.
// The key never leaves the device; the server only stores what was signed.
import { supabase } from '@/lib/supabase'
import { device } from '@/lib/device'
import { serverNow } from '@/lib/clock'
import { buildCoupons, newVerificationNo, sefNumber, type FiscalSale } from './coupon'
import { buildCsr } from './csr'
import { b64decode } from './der'
import { citizenQr, signPosCoupon, type RawSigner } from './sign'

export { sefNumber } from './coupon'
export type { FiscalSale } from './coupon'

export type FiscalEnv = 'test' | 'prod'

export interface FiscalRegister {
  id: string
  name: string
  pos_id: string | null
  status: 'none' | 'registered'
  device_id: string | null
  platform: string | null
  env: FiscalEnv | null
  registered_at: string | null
  coupon_seq: number
  last_sent_at: string | null
  pending: number
  oldest_pending: string | null
}

export interface FiscalContext {
  nui: string | null
  fiscal_number: string | null
  branch_id: number | null
  env: FiscalEnv
  location: string
  business_name: string
  unit_saved_at: string | null
  application_id: number | null
  register: FiscalRegister | null
}

/** What the receipt shows and prints. */
export interface FiscalReceipt {
  coupon_id: string
  verification_no: string
  qr: string
  sef_no: string
  issued_at: string
  status: 'sent' | 'pending' | 'failed'
  offline: boolean
  env: FiscalEnv
  transaction_no?: string | null
  error?: string | null
}

interface QueuedCoupon {
  key: string // client_id of the sale
  sale_id: string | null
  register_id: string
  device_id: string
  coupon_type: 1 | 2 | 3
  coupon_id: string
  coupon_seq: number
  reference_no: string | null
  verification_no: string
  issued_at: string
  details: string
  signature: string
  qr: string
  offline: boolean
  status: 'pending' | 'failed'
  error: string | null
  attempts: number
}

const CTX_KEY = (registerId: string) => `fiscal.ctx.${registerId}`
const SEQ_KEY = (registerId: string) => `fiscal.seq.${registerId}`
const Q_PREFIX = 'fiscal.q.'
export const keyAlias = (registerId: string) => `atk:${registerId}`
const signer =
  (alias: string): RawSigner =>
  async (data) =>
    b64decode(await device.keys.sign(alias, data))

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

export class FiscalNetworkError extends Error {}

async function relay<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fiscal-relay', { body })
  if (!error) return data as T
  const ctx = (error as { context?: Response }).context
  if (!ctx || typeof ctx.status !== 'number') throw new FiscalNetworkError('Nuk ka lidhje me serverin')
  if (ctx.status === 404 && !(await ctx.clone().text()).includes('"error"')) throw new Error('Edge Function "fiscal-relay" nuk është vendosur ende në Supabase.')
  let msg = ''
  try {
    msg = String(((await ctx.json()) as { error?: string }).error ?? '')
  } catch {
    msg = ''
  }
  throw new Error(msg || error.message)
}

/** Fiscal data of the business and of one register. Cached on the device for offline use. */
export async function fetchFiscalContext(registerId: string | null): Promise<FiscalContext | null> {
  const { data, error } = await supabase.rpc('fiscal_context', { p_register: registerId })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) return null // migration 0015 not applied yet
    if (registerId) {
      const cached = await device.storage.get<FiscalContext>(CTX_KEY(registerId))
      if (cached) return cached
    }
    throw new Error(error.message)
  }
  const ctx = data as FiscalContext
  if (registerId) await device.storage.set(CTX_KEY(registerId), ctx)
  return ctx
}

/** Cached context only (no network) – used by the till at the moment of a sale. */
export async function cachedFiscalContext(registerId: string): Promise<FiscalContext | null> {
  return device.storage.get<FiscalContext>(CTX_KEY(registerId))
}

/** This device is the register's fiscal device (registered at ATK, key present here). */
export async function isFiscalHere(ctx: FiscalContext | null): Promise<boolean> {
  const r = ctx?.register
  if (!r || r.status !== 'registered' || !r.device_id) return false
  if (r.device_id !== (await device.getDeviceId())) return false
  return device.keys.hasKey(keyAlias(r.id))
}

// ---------------------------------------------------------------------------
// Onboarding (Hapi 3: register this device at ATK)
// ---------------------------------------------------------------------------

export async function registerOnDevice(registerId: string, onStep?: (s: string) => void): Promise<void> {
  const alias = keyAlias(registerId)
  onStep?.('Duke krijuar çelësin e arkës në këtë pajisje…')
  await device.keys.deleteKey(alias) // a new registration always gets a new key
  const publicKey = await device.keys.ensureKey(alias)

  onStep?.('Duke marrë kodin e verifikimit nga ATK…')
  const v = await relay<{ business_name: string; verification_code: string; nui: string; branch_id: number; pos_id: string }>({ action: 'verify', register_id: registerId })

  onStep?.('Duke nënshkruar kërkesën për certifikatë…')
  const csr = await buildCsr(signer(alias), publicKey, { nui: v.nui, posId: v.pos_id, branchId: v.branch_id, businessName: v.business_name })

  onStep?.('ATK po e lëshon certifikatën…')
  await relay({
    action: 'signcsr',
    register_id: registerId,
    business_name: v.business_name,
    verification_code: v.verification_code,
    csr,
    public_key: publicKey,
    device_id: await device.getDeviceId(),
    platform: device.platform,
  })

  const ctx = await fetchFiscalContext(registerId)
  if (ctx?.register) await bumpSeq(registerId, ctx.register.coupon_seq)
}

// ---------------------------------------------------------------------------
// Coupon sequence (per register, kept on the device so offline sales get numbers too)
// ---------------------------------------------------------------------------

async function bumpSeq(registerId: string, atLeast: number): Promise<number> {
  const cur = (await device.storage.get<number>(SEQ_KEY(registerId))) ?? 0
  const v = Math.max(cur, atLeast)
  await device.storage.set(SEQ_KEY(registerId), v)
  return v
}

async function nextSeq(registerId: string, serverSeq: number): Promise<number> {
  const seq = (await bumpSeq(registerId, serverSeq)) + 1
  await device.storage.set(SEQ_KEY(registerId), seq)
  return seq
}

// ---------------------------------------------------------------------------
// Fiscalizing a sale
// ---------------------------------------------------------------------------

export interface FiscalizeInput {
  /** client_id of the sale (stable before and after the offline sync). */
  key: string
  /** Server id of the sale; null while the sale itself waits in the offline queue. */
  saleId: string | null
  registerId: string
  sale: FiscalSale
  operator: string
  /** CouponId of the original sale, for cancel / return. */
  referenceNo?: string | null
}

/** Signs the coupon; sends it now when possible. Returns null when this register does not fiscalize. */
export async function fiscalize(input: FiscalizeInput): Promise<FiscalReceipt | null> {
  const ctx = await cachedFiscalContext(input.registerId)
  if (!ctx || !(await isFiscalHere(ctx)) || !ctx.nui || !ctx.branch_id || !ctx.register?.pos_id || !ctx.application_id) return null
  const r = ctx.register
  const seq = await nextSeq(r.id, r.coupon_seq)
  const couponId = BigInt(ctx.branch_id) * 10n ** 12n + BigInt(r.pos_id!) * 10n ** 8n + BigInt(seq)
  const issued = Math.floor(serverNow() / 1000)
  const verificationNo = newVerificationNo()
  const { pos, citizen } = buildCoupons(input.sale, {
    nui: ctx.nui,
    branchId: ctx.branch_id,
    posId: r.pos_id!,
    applicationId: ctx.application_id,
    location: ctx.location,
    operatorId: input.operator.slice(0, 60),
    couponId: couponId.toString(),
    verificationNo,
    time: issued,
    referenceNo: input.referenceNo ?? null,
  })
  const alias = keyAlias(r.id)
  const signed = await signPosCoupon(signer(alias), pos)
  const qr = await citizenQr(signer(alias), citizen)

  const q: QueuedCoupon = {
    key: input.key,
    sale_id: input.saleId,
    register_id: r.id,
    device_id: r.device_id!,
    coupon_type: Number(pos.Type) as 1 | 2 | 3,
    coupon_id: couponId.toString(),
    coupon_seq: seq,
    reference_no: input.referenceNo ?? null,
    verification_no: verificationNo,
    issued_at: new Date(issued * 1000).toISOString(),
    details: signed.details,
    signature: signed.signature,
    qr,
    offline: !input.saleId,
    status: 'pending',
    error: null,
    attempts: 0,
  }
  await device.storage.set(Q_PREFIX + q.key, q) // kept until ATK confirms

  const base = { coupon_id: q.coupon_id, verification_no: verificationNo, qr, sef_no: sefNumber(ctx.branch_id, ctx.nui, r.pos_id!), issued_at: q.issued_at, env: r.env ?? ctx.env }
  if (!q.sale_id) return { ...base, status: 'pending', offline: true }
  const res = await send(q)
  return { ...base, ...res }
}

async function send(q: QueuedCoupon): Promise<Pick<FiscalReceipt, 'status' | 'offline' | 'transaction_no' | 'error'>> {
  try {
    const r = await relay<{ status: 'sent' | 'pending' | 'failed'; transaction_no?: string | null; error?: string }>({ action: 'coupon', ...q })
    if (r.status === 'sent') {
      await device.storage.remove(Q_PREFIX + q.key)
      emit()
      return { status: 'sent', offline: q.offline, transaction_no: r.transaction_no ?? null }
    }
    // ATK did not answer (pending) → the receipt is an offline one; rejected (failed) → needs attention.
    const offline = q.offline || r.status === 'pending'
    await device.storage.set(Q_PREFIX + q.key, { ...q, offline, status: r.status === 'failed' ? 'failed' : 'pending', error: r.error ?? null, attempts: q.attempts + 1 } satisfies QueuedCoupon)
    emit()
    return { status: r.status, offline, error: r.error ?? null }
  } catch (e) {
    const network = e instanceof FiscalNetworkError
    await device.storage.set(Q_PREFIX + q.key, { ...q, offline: true, error: (e as Error).message, attempts: q.attempts + 1, status: network ? 'pending' : 'failed' } satisfies QueuedCoupon)
    emit()
    return { status: network ? 'pending' : 'failed', offline: true, error: (e as Error).message }
  }
}

/** The offline sale reached the server: its coupon can now be sent. */
export async function attachSaleId(key: string, saleId: string): Promise<void> {
  const q = await device.storage.get<QueuedCoupon>(Q_PREFIX + key)
  if (q && !q.sale_id) await device.storage.set(Q_PREFIX + key, { ...q, sale_id: saleId })
}

let flushing: Promise<void> | null = null
/** Sends every waiting coupon (oldest first). Called after the offline sync and when the app comes online. */
export function flushFiscal(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    try {
      const list = await queuedCoupons()
      for (const q of list) {
        if (!q.sale_id || q.status === 'failed') continue
        const r = await send(q)
        if (r.status === 'pending') break // still no answer from ATK – try later
      }
    } finally {
      flushing = null
    }
  })()
  return flushing
}

async function queuedCoupons(): Promise<QueuedCoupon[]> {
  const keys = await device.storage.keys(Q_PREFIX)
  const list = (await Promise.all(keys.map((k) => device.storage.get<QueuedCoupon>(k)))).filter(Boolean) as QueuedCoupon[]
  return list.sort((a, b) => a.coupon_seq - b.coupon_seq)
}

export interface FiscalQueueState {
  waiting: number
  failed: number
  /** Oldest coupon not yet confirmed by ATK – the 48-hour limit counts from here. */
  oldest: string | null
}

export async function fiscalQueueState(): Promise<FiscalQueueState> {
  const list = await queuedCoupons()
  return {
    waiting: list.filter((q) => q.status === 'pending').length,
    failed: list.filter((q) => q.status === 'failed').length,
    oldest: list.reduce<string | null>((m, q) => (!m || q.issued_at < m ? q.issued_at : m), null),
  }
}

/** Hours left of the 48 hours ATK allows for sending offline coupons. */
export const hoursLeft = (oldest: string | null) => (oldest ? 48 - (serverNow() - Date.parse(oldest)) / 3_600_000 : null)

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}
export function onFiscalQueueChange(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// ---------------------------------------------------------------------------
// Owner screens
// ---------------------------------------------------------------------------

export async function saveFiscalUnit(u: { nui: string; fiscal_number: string; branch_id: string; env: FiscalEnv }): Promise<void> {
  const { error } = await supabase.rpc('fiscal_save_unit', { p: u })
  if (error) throw new Error(error.message)
}

export async function setPosId(registerId: string, posId: string): Promise<void> {
  const { error } = await supabase.rpc('fiscal_set_pos_id', { p_register: registerId, p_pos_id: posId })
  if (error) throw new Error(error.message)
}

export async function unregister(registerId: string): Promise<void> {
  const { error } = await supabase.rpc('fiscal_unregister', { p_register: registerId })
  if (error) throw new Error(error.message)
  const thisDevice = await device.storage.get<FiscalContext>(CTX_KEY(registerId))
  if (thisDevice?.register?.device_id === (await device.getDeviceId())) await device.keys.deleteKey(keyAlias(registerId))
  await device.storage.remove(CTX_KEY(registerId))
}

export interface FiscalRegisterRow {
  id: string
  name: string
  active: boolean
  pos_id: string | null
  status: 'none' | 'registered'
  device_id: string | null
  platform: string | null
  env: FiscalEnv | null
  registered_at: string | null
  last_sent_at: string | null
  coupon_seq: number
  app_version: string | null
  last_seen_at: string | null
  sent: number
  pending: number
  failed: number
  oldest_pending: string | null
}

export async function fetchFiscalRegisters(): Promise<FiscalRegisterRow[]> {
  const { data, error } = await supabase.rpc('fiscal_registers')
  if (error) throw new Error(error.message)
  return (data ?? []) as FiscalRegisterRow[]
}

/** Sends a stored coupon again (owner page). */
export async function retryCoupon(saleId: string): Promise<{ status: string; error?: string }> {
  return relay({ action: 'retry', sale_id: saleId })
}

/** Fiscal part of a stored sale (receipt reprint, refunds). */
export async function fetchSaleFiscal(saleId: string): Promise<(FiscalReceipt & { coupon_type: number; branch_id: number; pos_id: number }) | null> {
  const { data, error } = await supabase.rpc('sale_fiscal', { p_sale_id: saleId })
  if (error) return null
  return (data as never) ?? null
}
