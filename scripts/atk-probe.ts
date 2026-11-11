// Sends one coupon built by src/lib/fiscal to the ATK *test* server, with a throw-away key,
// to check that ATK can read our protobuf (it will refuse the unknown business / signature).
//   npx tsx scripts/atk-probe.ts
import { webcrypto } from 'node:crypto'
import { buildCoupons } from '../src/lib/fiscal/coupon'
import { signPosCoupon, type RawSigner } from '../src/lib/fiscal/sign'

const pair = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])) as CryptoKeyPair
const signer: RawSigner = async (d) => new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, d))
const { pos } = buildCoupons(
  { kind: 'sale', total: 3.2, discount_total: 0, cash_amount: 3.2, card_amount: 0, vat_lines: [{ code: 'D', gross: 3.2, net: 2.96, vat: 0.24 }], items: [{ name: 'Bukë', unit: 'cope', quantity: 4, unit_price: 0.8, total: 3.2, vat_code: 'D' }] },
  { nui: process.argv[2] ?? '810000001', branchId: 1, posId: 1, applicationId: 1, location: 'Prishtinë', operatorId: 'Test', couponId: 1000100000001, verificationNo: 'TEST2345ABCD6789', time: Math.floor(Date.now() / 1000) },
)
const signed = await signPosCoupon(signer, pos)
const res = await fetch('https://fiskalizimi-test.atk-ks.org/pos/coupon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signed) })
console.log(res.status, await res.text())
