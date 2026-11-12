// Signing as ATK specifies (github.com/fiskalizimi):
//   protobuf bytes → base64 string → SHA-256 over that string → ECDSA P-256 → DER (ASN.1) → base64.
// The key never leaves the device: a RawSigner hashes with SHA-256 and signs inside WebCrypto.
import { b64encode, rawToDer } from './der'
import { encodeCitizenCoupon, encodePosCoupon, type CitizenCoupon, type PosCoupon } from './protobuf'

/** ECDSA P-256 / SHA-256 over `data`, returning the raw r||s signature (64 bytes). */
export type RawSigner = (data: Uint8Array) => Promise<Uint8Array>

export interface Signed {
  /** base64 of the protobuf message (POST /pos/coupon `details`, first half of the QR). */
  details: string
  /** base64 of the DER signature. */
  signature: string
}

export async function signBase64(sign: RawSigner, base64: string): Promise<string> {
  return b64encode(rawToDer(await sign(new TextEncoder().encode(base64))))
}

export async function signPosCoupon(sign: RawSigner, c: PosCoupon): Promise<Signed> {
  const details = b64encode(encodePosCoupon(c))
  return { details, signature: await signBase64(sign, details) }
}

/** QR code text: base64(CitizenCoupon) + "|" + signature. */
export async function citizenQr(sign: RawSigner, c: CitizenCoupon): Promise<string> {
  const details = b64encode(encodeCitizenCoupon(c))
  return `${details}|${await signBase64(sign, details)}`
}
