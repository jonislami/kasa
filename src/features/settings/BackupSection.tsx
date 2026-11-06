import { useState } from 'react'
import { Download } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Button, Card } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { unitLabel } from '@/lib/units'
import { fetchCategories, fetchProducts } from '@/features/products/api'
import { addDays, today } from '@/features/reports/api'

async function fetchPaged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 50000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Excel copy of the business data (catalog, suppliers, sales of the last 12 months, stock movements). */
export function BackupSection() {
  const { business } = useBusiness()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const from = addDays(today(), -365)
      const [products, categories, suppliers, sales, items, movements] = await Promise.all([
        fetchProducts(true),
        fetchCategories(),
        fetchPaged<Record<string, unknown>>((a, b) => supabase.from('suppliers').select('name, nui, vat_number, phone, email, address, active').range(a, b)).catch(() => []),
        fetchPaged<Record<string, unknown>>((a, b) =>
          supabase.from('sales').select('invoice_no, kind, sale_date, created_at, total, net_total, vat_total, payment_method, cash_amount, card_amount, offline, worker_id').gte('sale_date', from).order('invoice_no').range(a, b),
        ),
        fetchPaged<Record<string, unknown>>((a, b) =>
          supabase.from('sale_items').select('sale_id, name, quantity, unit_price, total, vat_code, sales!inner(invoice_no, sale_date)').gte('sales.sale_date', from).range(a, b),
        ).catch(() => []),
        fetchPaged<Record<string, unknown>>((a, b) => supabase.from('stock_movements').select('created_at, product_id, kind, quantity, stock_after, reason, note').gte('created_at', from).order('id').range(a, b)).catch(() => []),
      ])
      const cat = new Map(categories.map((c) => [c.id, c.name]))
      const pname = new Map(products.map((p) => [p.id, p.name]))
      const b = (v: string) => ({ value: v, fontWeight: 'bold' as const })
      const s = (v: unknown) => ({ value: v == null ? '' : String(v), type: String })
      const n = (v: unknown) => ({ value: Number(v ?? 0), type: Number })

      const sheets = [
        {
          sheet: 'Produktet',
          data: [
            ['Emri', 'Lloji', 'Barkodi', 'Kategoria', 'Njësia', 'Ç. blerjes', 'Ç. shitjes', 'TVSH', 'Stoku', 'Min.', 'Aktiv'].map(b),
            ...products.map((p) => [s(p.name), s(p.kind === 'service' ? 'shërbim' : 'produkt'), s(p.barcode), s(p.category_id ? cat.get(p.category_id) : ''), s(unitLabel(p.unit)), n(p.purchase_price), n(p.sale_price), s(p.vat_code), n(p.stock), n(p.min_stock), s(p.active ? 'po' : 'jo')]),
          ],
        },
        { sheet: 'Furnitorët', data: [['Emri', 'NUI', 'Nr. TVSH', 'Telefoni', 'Email', 'Adresa'].map(b), ...suppliers.map((x) => [s(x.name), s(x.nui), s(x.vat_number), s(x.phone), s(x.email), s(x.address)])] },
        {
          sheet: 'Faturat',
          data: [
            ['Nr.', 'Lloji', 'Data', 'Ora', 'Totali', 'Pa TVSH', 'TVSH', 'Pagesa', 'Kesh', 'Kartelë', 'Offline'].map(b),
            ...sales.map((x) => [n(x.invoice_no), s(x.kind), s(x.sale_date), s(new Date(String(x.created_at)).toLocaleTimeString('sq-AL')), n(x.total), n(x.net_total), n(x.vat_total), s(x.payment_method), n(x.cash_amount), n(x.card_amount), s(x.offline ? 'po' : '')]),
          ],
        },
        {
          sheet: 'Rreshtat',
          data: [
            ['Fatura', 'Data', 'Artikulli', 'Sasia', 'Çmimi', 'Totali', 'TVSH'].map(b),
            ...items.map((x) => {
              const sale = x.sales as { invoice_no: number; sale_date: string }
              return [n(sale?.invoice_no), s(sale?.sale_date), s(x.name), n(x.quantity), n(x.unit_price), n(x.total), s(x.vat_code)]
            }),
          ],
        },
        {
          sheet: 'Lëvizjet e stokut',
          data: [['Koha', 'Produkti', 'Lloji', 'Sasia', 'Stoku pas', 'Arsyeja', 'Shënim'].map(b), ...movements.map((x) => [s(x.created_at), s(pname.get(String(x.product_id))), s(x.kind), n(x.quantity), n(x.stock_after), s(x.reason), s(x.note)])],
        },
      ]
      const { default: writeXlsxFile } = await import('write-excel-file/browser')
      await writeXlsxFile(sheets.map((sh) => ({ ...sh, columns: [{ width: 28 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 12 }] }))).toFile(
        `kasa-kopje-${business.name.replace(/[^\w-]+/g, '_')}-${today()}.xlsx`,
      )
      void supabase.rpc('log_action', { p_action: 'backup_export', p_entity: 'business', p_entity_id: business.id, p_details: { products: products.length, sales: sales.length } })
      setMsg({ ok: true, text: `Kopja u shkarkua: ${products.length} produkte, ${sales.length} fatura.` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Kopje rezervë (Backup)</h2>
      <p className="mt-1 text-sm text-muted">
        Të dhënat ruhen në server automatikisht. Këtu shkarkon një kopje në Excel: produktet me çmimet, furnitorët, faturat dhe rreshtat e 12 muajve të fundit, lëvizjet e stokut.
      </p>
      <Button className="mt-4" loading={busy} onClick={() => void run()}>
        <Download className="h-4 w-4" /> Shkarko kopjen (Excel)
      </Button>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-brand-600' : 'text-warn-700'}`}>{msg.text}</p>}
    </Card>
  )
}
