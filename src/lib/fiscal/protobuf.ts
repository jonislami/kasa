// Minimal protobuf (proto3) encoder for the ATK messages in docs/atk/models.proto.
// Hand-written so the bytes are fully under our control and identical on every platform:
//  - fields are written in field-number order (as protoc / Go's proto.Marshal do),
//  - proto3 default values (0, "", empty list) are not written,
//  - repeated messages are length-delimited, one entry per element.
// Checked against protobufjs in scripts/fiscal-selftest.mjs.

export const CouponType = { Sale: 1, Cancel: 2, Return: 3 } as const
export type CouponTypeValue = (typeof CouponType)[keyof typeof CouponType]

export const PaymentType = { Cash: 1, CreditCard: 2, Voucher: 3, Cheque: 4, CryptoCurrency: 5, Other: 6 } as const
export type PaymentTypeValue = (typeof PaymentType)[keyof typeof PaymentType]

/** Integer fields are bigint-safe: pass number (safe integer) or bigint. */
type Int = number | bigint

export interface CouponItem {
  Name: string
  Price: Int // €0.0001
  Unit: string
  Quantity: number // float
  Total: Int // €0.0001
  TaxRate: string // A | C | D | E
  Type: string // ATK item type, e.g. "TT"
}

export interface Payment {
  Type: PaymentTypeValue
  Amount: Int // cents
}

export interface TaxGroup {
  TaxRate: string
  TotalForTax: Int // cents
  TotalTax: Int // cents
}

export interface PosCoupon {
  BusinessId: Int
  CouponId: Int
  BranchId: Int
  Location: string
  OperatorId: string
  PosId: Int
  ApplicationId: Int
  VerificationNo: string
  Type: CouponTypeValue
  Time: Int // unix seconds
  Items: CouponItem[]
  Payments: Payment[]
  Total: Int
  TaxGroups: TaxGroup[]
  TotalTax: Int
  TotalNoTax: Int
  ReferenceNo: Int
  TransactionNo: Int
  TotalDiscount: Int
}

export interface CitizenCoupon {
  BusinessId: Int
  CouponId: Int
  BranchId: Int
  PosId: Int
  VerificationNo: string
  Type: CouponTypeValue
  Time: Int
  Total: Int
  TaxGroups: TaxGroup[]
  TotalTax: Int
  TotalNoTax: Int
}

const WIRE_VARINT = 0
const WIRE_LEN = 2
const WIRE_FIXED32 = 5
const MASK64 = (1n << 64n) - 1n

class Writer {
  private bytes: number[] = []

  private varint(v: bigint) {
    let x = v & MASK64 // negative int64 → two's complement (10 bytes), as protobuf requires
    while (x > 0x7fn) {
      this.bytes.push(Number(x & 0x7fn) | 0x80)
      x >>= 7n
    }
    this.bytes.push(Number(x))
  }

  private tag(field: number, wire: number) {
    this.varint(BigInt((field << 3) | wire))
  }

  int(field: number, value: Int) {
    const v = BigInt(value)
    if (v === 0n) return
    this.tag(field, WIRE_VARINT)
    this.varint(v)
  }

  uint(field: number, value: Int) {
    const v = BigInt(value)
    if (v < 0n) throw new Error(`Fusha ${field} nuk mund të jetë negative`)
    this.int(field, v)
  }

  string(field: number, value: string) {
    if (!value) return
    this.raw(field, new TextEncoder().encode(value))
  }

  float(field: number, value: number) {
    if (value === 0) return
    this.tag(field, WIRE_FIXED32)
    const buf = new DataView(new ArrayBuffer(4))
    buf.setFloat32(0, value, true)
    for (let i = 0; i < 4; i++) this.bytes.push(buf.getUint8(i))
  }

  message(field: number, body: Uint8Array) {
    // A repeated message element is always written, even when empty.
    this.raw(field, body)
  }

  private raw(field: number, body: Uint8Array) {
    this.tag(field, WIRE_LEN)
    this.varint(BigInt(body.length))
    for (const b of body) this.bytes.push(b)
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

function encodeItem(i: CouponItem): Uint8Array {
  const w = new Writer()
  w.string(1, i.Name)
  w.int(2, i.Price)
  w.string(3, i.Unit)
  w.float(4, i.Quantity)
  w.int(5, i.Total)
  w.string(6, i.TaxRate)
  w.string(7, i.Type)
  return w.finish()
}

function encodePayment(p: Payment): Uint8Array {
  const w = new Writer()
  w.int(1, p.Type)
  w.int(2, p.Amount)
  return w.finish()
}

function encodeTaxGroup(t: TaxGroup): Uint8Array {
  const w = new Writer()
  w.string(1, t.TaxRate)
  w.int(2, t.TotalForTax)
  w.int(3, t.TotalTax)
  return w.finish()
}

export function encodePosCoupon(c: PosCoupon): Uint8Array {
  const w = new Writer()
  w.uint(1, c.BusinessId)
  w.uint(2, c.CouponId)
  w.uint(3, c.BranchId)
  w.string(4, c.Location)
  w.string(5, c.OperatorId)
  w.uint(6, c.PosId)
  w.uint(7, c.ApplicationId)
  w.string(8, c.VerificationNo)
  w.int(9, c.Type)
  w.int(10, c.Time)
  for (const i of c.Items) w.message(11, encodeItem(i))
  for (const p of c.Payments) w.message(12, encodePayment(p))
  w.int(13, c.Total)
  for (const t of c.TaxGroups) w.message(14, encodeTaxGroup(t))
  w.int(15, c.TotalTax)
  w.int(16, c.TotalNoTax)
  w.uint(17, c.ReferenceNo)
  w.uint(18, c.TransactionNo)
  w.int(19, c.TotalDiscount)
  return w.finish()
}

export function encodeCitizenCoupon(c: CitizenCoupon): Uint8Array {
  const w = new Writer()
  w.uint(1, c.BusinessId)
  w.uint(2, c.CouponId)
  w.uint(3, c.BranchId)
  w.uint(4, c.PosId)
  w.string(5, c.VerificationNo)
  w.int(6, c.Type)
  w.int(7, c.Time)
  w.int(8, c.Total)
  for (const t of c.TaxGroups) w.message(9, encodeTaxGroup(t))
  w.int(10, c.TotalTax)
  w.int(11, c.TotalNoTax)
  return w.finish()
}
