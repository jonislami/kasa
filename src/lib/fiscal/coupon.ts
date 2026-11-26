// Builds the two ATK messages of one receipt from a KontoSef sale.
// Units (github.com/fiskalizimi, "Important notes" + the sample coupon):
//   item Price and item Total → €0.0001 (×10000); both after the discounts of the line (Price = Total / Quantity)
//   coupon Total, Payments, TaxGroups, TotalTax, TotalNoTax, TotalDiscount → cents (×100)
//   TaxGroups: TotalForTax = base without VAT, TotalTax = VAT (as in the ATK sample: E 10.50 → 889 / 161)
// PosCoupon and CitizenCoupon get the same header and totals, otherwise ATK marks the coupon
// "FAILED VERIFICATION". Cancel / return coupons carry positive amounts and ReferenceNo = original CouponId.
import type { VatCode } from '@/lib/vat'
import { categoryCode, unitCode } from '../atk/catalog'
import { UNITS, type UnitCode } from '../units'
import { CouponType, PaymentType, type CitizenCoupon, type CouponItem, type CouponTypeValue, type Payment, type PosCoupon, type TaxGroup } from './protobuf'

export interface FiscalSaleItem {
  name: string
  unit: string
  quantity: number
  unit_price: number
  total: number // line total after discounts (negative on void/refund rows)
  vat_code: VatCode
  atk_type?: string | null
}

/** Non-cash part when it is not a card (0033). */
export type FiscalPaymentKind = 'bank' | 'voucher' | 'cheque' | null | undefined

export interface FiscalSale {
  kind: 'sale' | 'void' | 'refund'
  total: number
  discount_total: number
  cash_amount: number
  card_amount: number
  /** Two non-cash parts (0046): the second one; card_amount holds both, payment_kind is the first (null = card). */
  split_kind?: 'card' | 'bank' | 'voucher' | null
  split_amount?: number
  payment_kind?: FiscalPaymentKind
  vat_lines: { code: VatCode; gross: number; net: number; vat: number }[]
  items: FiscalSaleItem[]
}

export interface FiscalHeader {
  nui: string
  branchId: number | string
  posId: number | string
  applicationId: number | string
  location: string
  operatorId: string
  couponId: number | string
  verificationNo: string
  /** Unix seconds (server time). */
  time: number
  /** CouponId of the original sale for cancel / return, else 0. */
  referenceNo?: number | string | null
}

const cents = (eur: number) => BigInt(Math.round(Math.abs(eur) * 100))
const tenThousandths = (eur: number) => BigInt(Math.round(Math.abs(eur) * 10000))
const big = (v: number | string) => BigInt(String(v).trim() || '0')

const TYPE: Record<FiscalSale['kind'], CouponTypeValue> = { sale: CouponType.Sale, void: CouponType.Cancel, refund: CouponType.Return }
const RATE_ORDER: VatCode[] = ['A', 'C', 'D', 'E']

/**
 * Unit price sent to ATK: the price after every discount of the line – its own discount and its share of the
 * discount on the total (ATK, testimi teknik 2027: "çmimi sipas artikullit duhet të jetë me zbritje, si te fusha
 * price ashtu edhe te totali i CouponItem"). Total is the line total after discounts (it adds up to the coupon
 * Total), Price = Total / Quantity in €0.0001. Without a discount it is the shelf price, as before.
 */
function discountedPrice(i: FiscalSaleItem): bigint {
  const qty = Math.abs(i.quantity)
  const total = tenThousandths(i.total)
  if (!(qty > 0)) return tenThousandths(i.unit_price)
  // no discount on the line: the shelf price itself (avoids 1.4999 for 3 × 1.50 = 4.50 after float division)
  if (total === tenThousandths(Math.round(qty * Math.abs(i.unit_price) * 100) / 100)) return tenThousandths(i.unit_price)
  return BigInt(Math.round(Number(total) / qty))
}

/** NUIKF / VerificationNo: unique per coupon, alphanumeric, no spaces, at most 16 characters. */
export function newVerificationNo(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function buildCoupons(sale: FiscalSale, h: FiscalHeader): { pos: PosCoupon; citizen: CitizenCoupon } {
  const type = TYPE[sale.kind]
  const reference = type === CouponType.Sale ? 0n : big(h.referenceNo ?? 0)
  if (type !== CouponType.Sale && reference === 0n) throw new Error('Anulimi dhe kthimi kërkojnë numrin e kuponit origjinal')

  const items: CouponItem[] = sale.items.map((i) => ({
    Name: i.name.trim().slice(0, 100),
    Price: discountedPrice(i),
    // official ATK codes: "Njësitë matëse" (CP, KGN, PK, LTR…) and "Kategoritë e mallrave dhe shërbimeve"
    Unit: UNITS[i.unit as UnitCode]?.atk ?? unitCode(i.unit) ?? 'CP',
    Quantity: Math.abs(i.quantity),
    Total: tenThousandths(i.total),
    TaxRate: i.vat_code,
    Type: categoryCode(i.atk_type),
  }))

  const groups: TaxGroup[] = RATE_ORDER.flatMap((code) => {
    const l = sale.vat_lines.find((v) => v.code === code)
    return l && Math.abs(l.gross) > 0 ? [{ TaxRate: code, TotalForTax: cents(l.net), TotalTax: cents(l.vat) }] : []
  })
  const totalTax = groups.reduce((n, g) => n + BigInt(g.TotalTax), 0n)
  const totalNoTax = groups.reduce((n, g) => n + BigInt(g.TotalForTax), 0n)
  const total = cents(sale.total)

  // Payments add up exactly to the total; cash takes the rounding difference.
  const nonCash = cents(sale.card_amount) > total ? total : cents(sale.card_amount)
  const cash = total - nonCash > 0n ? total - nonCash : 0n
  // two non-cash parts (e.g. Kartelë + Vauçer): the second part is its own payment
  const second = sale.split_kind && cents(sale.split_amount ?? 0) < nonCash ? cents(sale.split_amount ?? 0) : 0n
  const first = nonCash - second
  // ATK PaymentType of a non-cash part: card, voucher, cheque, bank transfer ("Other")
  const typeOf = (k: string | null | undefined) =>
    k === 'voucher' ? PaymentType.Voucher : k === 'cheque' ? PaymentType.Cheque : k === 'bank' ? PaymentType.Other : PaymentType.CreditCard
  const payments: Payment[] = [
    ...(cash > 0n ? [{ Type: PaymentType.Cash, Amount: cash }] : []),
    ...(first > 0n ? [{ Type: typeOf(sale.payment_kind), Amount: first }] : []),
    ...(second > 0n ? [{ Type: typeOf(sale.split_kind), Amount: second }] : []),
  ]

  const head = {
    BusinessId: big(h.nui),
    CouponId: big(h.couponId),
    BranchId: big(h.branchId),
    PosId: big(h.posId),
    VerificationNo: h.verificationNo,
    Type: type,
    Time: BigInt(h.time),
    Total: total,
    TaxGroups: groups,
    TotalTax: totalTax,
    TotalNoTax: totalNoTax,
  }
  return {
    pos: {
      ...head,
      Location: h.location,
      OperatorId: h.operatorId,
      ApplicationId: big(h.applicationId),
      Items: items,
      Payments: payments,
      ReferenceNo: reference,
      TransactionNo: 0n,
      TotalDiscount: cents(sale.discount_total),
    },
    citizen: head,
  }
}

/** "Numri i SEF-it" printed on the receipt: [unit]-[NUI]-[PosId]. */
export const sefNumber = (branchId: string | number, nui: string, posId: string | number) => `${branchId}-${nui}-${posId}`
