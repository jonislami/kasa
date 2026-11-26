// Self-test of src/lib/fiscal (no network):  npx tsx scripts/fiscal-selftest.ts
//  1. our protobuf bytes == protobufjs bytes for docs/atk/models.proto (ATK sample coupon + a return)
//  2. the DER signature verifies with Node's crypto (as Go's ecdsa.VerifyASN1 would)
//  3. the CSR is a valid PKCS#10 request (openssl req -verify, if openssl is installed)
import { webcrypto, createPublicKey, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import protobuf from 'protobufjs'
import { encodeCitizenCoupon, encodePosCoupon } from '../src/lib/fiscal/protobuf'
import { buildCoupons } from '../src/lib/fiscal/coupon'
import { citizenQr, signPosCoupon, type RawSigner } from '../src/lib/fiscal/sign'
import { buildCsr } from '../src/lib/fiscal/csr'
import { b64decode, b64encode } from '../src/lib/fiscal/der'

let failed = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`)
  if (!ok) failed++
}
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

const root = protobuf.loadSync('docs/atk/models.proto')
const PosT = root.lookupType('atk.PosCoupon')
const CitT = root.lookupType('atk.CitizenCoupon')
const asPlain = (o: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

// --- 1. the sample from github.com/fiskalizimi (sale, three rates, three payment types)
const sale = buildCoupons(
  {
    kind: 'sale',
    total: 18.2,
    discount_total: 0,
    cash_amount: 17.2,
    card_amount: 1,
    vat_lines: [
      { code: 'C', gross: 4.5, net: 4.5, vat: 0 },
      { code: 'D', gross: 3.2, net: 2.96, vat: 0.24 },
      { code: 'E', gross: 10.5, net: 8.89, vat: 1.61 },
    ],
    items: [
      { name: 'uje rugove', unit: 'cope', quantity: 3, unit_price: 1.5, total: 4.5, vat_code: 'C' },
      { name: 'sendviq', unit: 'cope', quantity: 2, unit_price: 3, total: 6, vat_code: 'E' },
      { name: 'buke', unit: 'cope', quantity: 4, unit_price: 0.8, total: 3.2, vat_code: 'D' },
      { name: 'machiato e madhe', unit: 'cope', quantity: 3, unit_price: 1.5, total: 4.5, vat_code: 'E' },
    ],
  },
  { nui: '810000001', branchId: 1, posId: 1, applicationId: 1234, location: 'Prishtinë', operatorId: '001 Kushtrimi', couponId: 10, verificationNo: '1234567890123456', time: 1727151089 },
)
check('citizen totals as ATK sample', sale.citizen.Total === 1820n && sale.citizen.TotalTax === 185n && sale.citizen.TotalNoTax === 1635n, `${sale.citizen.Total}/${sale.citizen.TotalTax}/${sale.citizen.TotalNoTax}`)

for (const [name, c] of [['sale', sale], ['return', buildCoupons({ kind: 'refund', total: -3.2, discount_total: 0, cash_amount: -3.2, card_amount: 0, vat_lines: [{ code: 'D', gross: -3.2, net: -2.96, vat: -0.24 }], items: [{ name: 'buke', unit: 'kg', quantity: -1.25, unit_price: 2.56, total: -3.2, vat_code: 'D' }] }, { nui: '810000001', branchId: 1, posId: 2, applicationId: 1234, location: 'Pejë', operatorId: '002', couponId: 11, verificationNo: 'ABCDEF2345678XYZ', time: 1727151200, referenceNo: 10 })]] as const) {
  const ours = encodePosCoupon(c.pos)
  const ref = PosT.encode(PosT.fromObject(asPlain(c.pos))).finish()
  check(`PosCoupon bytes (${name})`, hex(ours) === hex(ref), hex(ours) === hex(ref) ? `${ours.length} B` : `\n ours ${hex(ours)}\n ref  ${hex(ref)}`)
  const cOurs = encodeCitizenCoupon(c.citizen)
  const cRef = CitT.encode(CitT.fromObject(asPlain(c.citizen))).finish()
  check(`CitizenCoupon bytes (${name})`, hex(cOurs) === hex(cRef), `${cOurs.length} B`)
  const back = PosT.toObject(PosT.decode(ours), { longs: String })
  check(`decode round-trip (${name})`, back.CouponId === String(c.pos.CouponId) && back.Total === String(c.pos.Total) && (back.Items as unknown[]).length === c.pos.Items.length)
}
let threw = false
try {
  buildCoupons({ kind: 'void', total: -1, discount_total: 0, cash_amount: -1, card_amount: 0, vat_lines: [], items: [] }, { nui: '1', branchId: 1, posId: 1, applicationId: 1, location: '', operatorId: '', couponId: 1, verificationNo: 'X', time: 1 })
} catch {
  threw = true
}
check('cancel without ReferenceNo is refused', threw)

// --- 1b. item Price carries the discounts (ATK, testimi teknik 2027): Price = line Total / Quantity
{
  const h = { nui: '810000001', branchId: 1, posId: 1, applicationId: 1234, location: 'Prishtinë', operatorId: '001', couponId: 12, verificationNo: 'DISC234567890ABC', time: 1727151300 }
  const d = buildCoupons(
    {
      kind: 'sale',
      total: 20.87,
      discount_total: 2.17,
      cash_amount: 20.87,
      card_amount: 0,
      vat_lines: [
        { code: 'E', gross: 13.07, net: 11.08, vat: 1.99 },
        { code: 'D', gross: 7.8, net: 7.22, vat: 0.58 },
      ],
      items: [
        // no discount → shelf price
        { name: 'pa zbritje', unit: 'cope', quantity: 3, unit_price: 1.5, total: 4.5, vat_code: 'E' },
        // 10% on the line: 2 × 2.50 = 5.00 − 0.50 = 4.50 → 2.25
        { name: 'ulje 10%', unit: 'cope', quantity: 2, unit_price: 2.5, total: 4.5, vat_code: 'E' },
        // 1.00 € on the line + 0.33 share of the total discount: 3 × 1.80 = 5.40 − 1.33 = 4.07 → 1.3567
        { name: 'ulje € + total', unit: 'cope', quantity: 3, unit_price: 1.8, total: 4.07, vat_code: 'E' },
        // weighed: 0.755 kg × 4.00 = 3.02 − 0.10 = 2.92 → 3.8675
        { name: 'kg me ulje', unit: 'kg', quantity: 0.755, unit_price: 4, total: 2.92, vat_code: 'D' },
        // 4 decimals: 1 × 5.1234, total discount share 0.24 → 4.88
        { name: '4 shifra', unit: 'cope', quantity: 1, unit_price: 5.1234, total: 4.88, vat_code: 'D' },
      ],
    },
    h,
  )
  const p = d.pos.Items.map((i) => Number(i.Price))
  check('Price without discount = shelf price', p[0] === 15000, String(p[0]))
  check('Price after 10% line discount', p[1] === 22500, String(p[1]))
  check('Price after € line + total discount', p[2] === 13567, String(p[2]))
  check('Price of weighed item after discount', p[3] === 38675, String(p[3]))
  check('Price with 4 decimals after total discount', p[4] === 48800, String(p[4]))
  check('item Totals add up to coupon Total', d.pos.Items.reduce((n, i) => n + BigInt(i.Total), 0n) === d.pos.Total * 100n)
  check('|Price × Quantity − Total| < 1 cent', d.pos.Items.every((i) => Math.abs(Number(i.Price) * i.Quantity - Number(i.Total)) < 100))
  check('TotalDiscount in cents', d.pos.TotalDiscount === 217n)
}

// --- 2. signature
const pair = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair
const signer: RawSigner = async (data) => new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data))
const spkiDer = new Uint8Array(await webcrypto.subtle.exportKey('spki', pair.publicKey))
const pub = createPublicKey({ key: Buffer.from(spkiDer), format: 'der', type: 'spki' })

const signed = await signPosCoupon(signer, sale.pos)
check('details = base64(protobuf)', signed.details === b64encode(encodePosCoupon(sale.pos)))
check('DER signature verifies over base64 text', verify('sha256', Buffer.from(signed.details), { key: pub, dsaEncoding: 'der' }, Buffer.from(b64decode(signed.signature))))
const qr = await citizenQr(signer, sale.citizen)
const [qrData, qrSig] = qr.split('|')
check('QR = base64(citizen)|signature', qrData === b64encode(encodeCitizenCoupon(sale.citizen)) && verify('sha256', Buffer.from(qrData), { key: pub, dsaEncoding: 'der' }, Buffer.from(b64decode(qrSig))), `${qr.length} characters`)

// --- 3. CSR
const pem = await buildCsr(signer, b64encode(spkiDer), { nui: '810000001', posId: 1, branchId: 1, businessName: 'Market Ëmbëlsira' })
try {
  const dir = mkdtempSync(join(tmpdir(), 'csr-'))
  writeFileSync(join(dir, 'r.pem'), pem)
  const out = execFileSync('openssl', ['req', '-in', join(dir, 'r.pem'), '-noout', '-verify', '-subject', '-nameopt', 'utf8'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  check('CSR verifies (openssl)', /subject=/.test(out), out.trim().replace(/\s+/g, ' '))
} catch (e) {
  const msg = String((e as { stderr?: string }).stderr ?? e)
  if (/ENOENT/.test(msg)) console.log('SKIP CSR check: openssl not installed')
  else check('CSR verifies (openssl)', /verify OK/i.test(msg), msg.trim())
}

console.log(failed ? `\n${failed} FAILED` : '\nAll fiscal checks passed')
process.exit(failed ? 1 : 0)
