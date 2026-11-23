// Rows of the ATK sales book from the business's coupons. Pure (no database / browser imports), so scripts can use it.
import type { SaleDoc } from '@/features/accounting/api'
import type { BookDoc, BookKind } from '@/kontabilist/atkBooks'

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

export function couponBookDocs(sales: SaleDoc[]): BookDoc[] {
  return sales
    .filter((s) => r2(s.total) !== 0)
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.invoice_no - b.invoice_no || a.created_at.localeCompare(b.created_at))
    .map((s) => {
      const lines = Array.isArray(s.vat_lines) ? s.vat_lines : []
      const sum = (pick: (code: string) => boolean, field: 'net' | 'vat' | 'gross') =>
        r2(lines.filter((x) => pick(String(x.code ?? '').toUpperCase())).reduce((a, x) => a + (Number(x[field]) || 0), 0))
      return {
        source: 'kasa',
        kind: 'sale',
        date: s.sale_date.slice(0, 10),
        doc_no: s.offline_no && !s.invoice_no ? s.offline_no : String(s.invoice_no).padStart(10, '0'),
        partner: 'Qytetar',
        nui: '1',
        vat_no: '',
        doc_type: s.kind === 'sale' && s.total > 0 ? 'invoice' : 'credit_note',
        vat_flag: 'none',
        category: 'goods',
        asset: false,
        export: false,
        net_e: sum((c) => c === 'E', 'net'),
        vat_e: sum((c) => c === 'E', 'vat'),
        net_d: sum((c) => c === 'D', 'net'),
        vat_d: sum((c) => c === 'D', 'vat'),
        // a coupon without the split by rate (old rows) counts whole at 0%
        amt_c: lines.length ? sum((c) => c === 'C', 'gross') : r2(s.total),
        amt_a: sum((c) => !['E', 'D', 'C'].includes(c), 'gross'),
        vat_nd: 0,
        total: r2(s.total),
        coupons: s.kind === 'sale' ? 1 : 0,
        returns: s.kind === 'sale' ? 0 : 1,
      } satisfies BookDoc
    })
}

export const salesBookKind = (vatNumber: string | null | undefined): BookKind => (vatNumber?.trim() ? 'sales_vat' : 'sales_novat')
