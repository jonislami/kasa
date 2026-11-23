// "Libri i shitjes" of the business for a period, downloaded from the web app as the official ATK Excel file
// (public/atk/sales_vat.xlsx or sales_novat.xlsx). One row per fiscal coupon, the same rows the accountant gets
// for a linked business (_acc_kasa_book_rows, migration 0040): buyer "Qytetar" with code 1, voids and refunds as
// credit notes.
import { fetchSaleDocs } from '@/features/accounting/api'
import { buildRows } from '@/kontabilist/atkBooks'
import { downloadBook } from '@/kontabilist/atkBooksApi'
import { couponBookDocs, salesBookKind } from './salesBookRows'

export { salesBookKind }

/** Fetches the coupons of the period and downloads the ATK sales book; returns how many rows it has. */
export async function downloadSalesBook(business: { id: string; name: string; vat_number: string | null }, from: string, to: string): Promise<number> {
  const book = salesBookKind(business.vat_number)
  const rows = buildRows(book, couponBookDocs(await fetchSaleDocs(business.id, from, to)))
  const name = business.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  await downloadBook(`Libri i shitjes ${book === 'sales_vat' ? 'me' : 'jo'} TVSH - ${name} - ${from}_${to}.xlsx`, book, rows)
  return rows.length
}
