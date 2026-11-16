// Fetching the documents of a period and downloading a book (atkBooks.ts holds the pure logic).
import { supabase } from '@/lib/supabase'
import { addMonths } from '@/features/accounting/api'
import { TEMPLATES, type BookDoc, type BookKind, type BookRow } from './atkBooks'
import { fillTemplate } from './atkXlsx'

const NUMS = ['net_e', 'vat_e', 'net_d', 'vat_d', 'amt_c', 'amt_a', 'vat_nd', 'total'] as const
const missing = (code?: string) => ['PGRST202', '42883'].includes(code ?? '')

/** Documents of a period; before migration 0032 month by month from acc_vat_book (without the category). */
export async function fetchBookDocs(clientId: string, from: string, to: string): Promise<BookDoc[]> {
  const norm = (x: Record<string, unknown>, kind?: 'sale' | 'purchase'): BookDoc => {
    const d = { category: null, ...x, kind: (x.kind as BookDoc['kind']) ?? kind } as unknown as BookDoc
    for (const k of NUMS) d[k] = Number(x[k]) || 0
    d.date = String(x.date).slice(0, 10)
    return d
  }
  const { data, error } = await supabase.rpc('acc_vat_book_range', { p_client: clientId, p_from: from, p_to: to })
  if (!error) return ((data as Record<string, unknown>[]) ?? []).map((x) => norm(x))
  if (!missing(error.code)) throw new Error(error.message)
  const out: BookDoc[] = []
  for (let m = `${from.slice(0, 7)}-01`; m <= to; m = addMonths(m, 1)) {
    for (const kind of ['sale', 'purchase'] as const) {
      const r = await supabase.rpc('acc_vat_book', { p_client: clientId, p_month: m, p_kind: kind })
      if (r.error) throw new Error(r.error.message)
      out.push(...((r.data as Record<string, unknown>[]) ?? []).map((x) => norm(x, kind)).filter((d) => d.date >= from && d.date <= to))
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.doc_no ?? '').localeCompare(b.doc_no ?? ''))
}

/** Downloads the book: the original ATK file (public/atk) filled with the rows. */
export async function downloadBook(filename: string, book: BookKind, rows: BookRow[]): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}atk/${book}.xlsx`)
  if (!res.ok) throw new Error('Modeli i librit të ATK-së nuk u gjet.')
  const bytes = fillTemplate(new Uint8Array(await res.arrayBuffer()), book, rows, TEMPLATES[book].widths.length)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
