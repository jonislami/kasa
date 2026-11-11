// PKCS#10 certificate request for the ATK onboarding (/ca/signcsr), signed on the device.
// Subject as ATK asks: C=RKS, L=BranchId, O=NUI (BusinessId), OU=PosId, CN=business name (from /ca/verify).
import { b64decode, bitString, oid, printable, rawToDer, sequence, set, tlv, toPem, utf8 } from './der'
import type { RawSigner } from './sign'

const OID = {
  country: '2.5.4.6',
  locality: '2.5.4.7',
  organization: '2.5.4.10',
  orgUnit: '2.5.4.11',
  commonName: '2.5.4.3',
  ecdsaSha256: '1.2.840.10045.4.3.2',
}

const PRINTABLE = /^[A-Za-z0-9 '()+,\-./:=?]*$/
const attr = (type: string, value: string) => set(sequence(oid(type), PRINTABLE.test(value) ? printable(value) : utf8(value)))

export interface CsrSubject {
  nui: string
  posId: string | number
  branchId: string | number
  businessName: string
}

/** Builds the CSR and signs it with the register's key; `spki` is the public key (SubjectPublicKeyInfo, base64). Returns PEM. */
export async function buildCsr(sign: RawSigner, spki: string, s: CsrSubject): Promise<string> {
  const subject = sequence(
    attr(OID.country, 'RKS'),
    attr(OID.locality, String(s.branchId)),
    attr(OID.organization, String(s.nui)),
    attr(OID.orgUnit, String(s.posId)),
    attr(OID.commonName, s.businessName),
  )
  const info = sequence(
    tlv(0x02, Uint8Array.of(0)), // version 0
    subject,
    b64decode(spki), // SubjectPublicKeyInfo, already DER
    tlv(0xa0), // attributes [0] – empty
  )
  const der = sequence(info, sequence(oid(OID.ecdsaSha256)), bitString(rawToDer(await sign(info))))
  return toPem('CERTIFICATE REQUEST', der)
}
