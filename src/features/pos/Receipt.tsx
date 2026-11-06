import { formatKosovoDateTime } from '@/lib/clock'
import { createPortal } from 'react-dom'
import { Store } from 'lucide-react'
import type { Business } from '@/app/AuthProvider'
import { cn } from '@/lib/cn'
import { formatInvoiceNo } from '@/lib/money'
import type { Sale } from './api'
import type { ReceiptSettings } from '@/features/settings/api'

const n2 = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const qty = (v: number, unit: string) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: unit === 'kg' ? 3 : 0 }).format(v)

export function formatDateTime(iso: string) {
  return formatKosovoDateTime(iso)
}

const TITLES = { sale: null, void: 'ANULIM', refund: 'KTHIM MALLI' } as const

/** Receipt as specified by ATK fields we have so far. Fiscal fields (QR, NUIKF…) come in phase 9. */
export function Receipt({
  sale,
  business,
  width,
  copy,
  settings,
}: {
  sale: Sale
  business: Business
  width?: 58 | 80
  copy?: boolean
  settings?: ReceiptSettings
}) {
  width = width ?? settings?.paper_width ?? 80
  const opt = settings?.settings ?? {}
  const title = TITLES[sale.kind]
  const when = sale.client_created_at ?? sale.created_at
  return (
    <div className={cn('mx-auto bg-white font-mono text-[13px] leading-snug text-black', width === 58 ? 'w-[58mm] px-1' : 'w-[80mm] px-3')}>
      <div className="flex flex-col items-center pt-3 text-center">
        {opt.show_logo !== false && (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-black">
            <Store className="h-5 w-5" />
          </div>
        )}
        <div className="mt-2 text-[15px] font-semibold uppercase">{business.name}</div>
        {settings?.receipt_header && <div>{settings.receipt_header}</div>}
        {(business.address || business.city) && <div>{[business.address, business.city].filter(Boolean).join(', ')}</div>}
        {business.phone && <div>Tel: {business.phone}</div>}
        {business.nui && <div>NUI: {business.nui}</div>}
        {business.vat_number && <div>Nr. TVSH: {business.vat_number}</div>}
      </div>
      <Rule />
      {title && <div className="pb-1 text-center text-[15px] font-semibold">{title}</div>}
      {copy && <div className="pb-1 text-center font-semibold">KOPJE E KUPONIT</div>}
      {sale.offline && <div className="pb-1 text-center font-semibold">OFFLINE</div>}
      <Row l="Fatura:" r={<b>{sale.offline_no && sale.invoice_no === 0 ? sale.offline_no : formatInvoiceNo(sale.invoice_no)}</b>} />
      {sale.ref_invoice_no != null && <Row l="Për faturën:" r={formatInvoiceNo(sale.ref_invoice_no)} />}
      <Row l="Nr. ditor:" r={sale.daily_no || '—'} />
      <Row l="Data:" r={formatDateTime(when)} />
      {sale.register_name && <Row l="Arka:" r={sale.register_name} />}
      {sale.worker_name && <Row l="Operatori:" r={sale.worker_name} />}
      <Rule />
      {sale.items.map((i) => (
        <div key={i.id} className="pb-1.5">
          <div>{i.name}</div>
          <Row
            l={`${qty(i.quantity, i.unit)} x ${n2(i.unit_price)}`}
            r={
              <span>
                {n2(i.total)} {i.vat_code}
              </span>
            }
          />
          {i.line_discount + i.invoice_discount !== 0 && <Row l="  zbritje" r={`-${n2(Math.abs(i.line_discount + i.invoice_discount))}`} />}
        </div>
      ))}
      <Rule />
      {sale.discount_total !== 0 && <Row l="Zbritje gjithsej" r={`-${n2(Math.abs(sale.discount_total))}`} />}
      <div className="flex items-end justify-between py-1">
        <span className="text-[15px] font-semibold">TOTALI EUR</span>
        <span className="text-[24px] font-semibold">{n2(sale.total)}</span>
      </div>
      {sale.cash_amount !== 0 && <Row l="Kesh" r={n2(sale.kind === 'sale' && sale.tendered != null ? sale.tendered : sale.cash_amount)} />}
      {sale.card_amount !== 0 && <Row l="Kartelë" r={n2(sale.card_amount)} />}
      {sale.change_amount > 0 && <Row l={<b>Kusuri</b>} r={<b>{n2(sale.change_amount)}</b>} />}
      {opt.show_vat !== false && (
      <>
      <Rule />
      <div className="grid grid-cols-3 font-semibold">
        <span>TVSH</span>
        <span className="text-center">Baza</span>
        <span className="text-right">Tvsh</span>
      </div>
      {sale.vat_lines.map((v) => (
        <div key={v.code} className="grid grid-cols-3">
          <span>
            {v.code} {v.code === 'A' ? 'lir.' : `${Math.round(v.rate * 100)}%`}
          </span>
          <span className="text-center">{n2(v.net)}</span>
          <span className="text-right">{n2(v.vat)}</span>
        </div>
      ))}
      <div className="grid grid-cols-3">
        <span>Gjithsej</span>
        <span className="text-center">{n2(sale.net_total)}</span>
        <span className="text-right">{n2(sale.vat_total)}</span>
      </div>
      </>
      )}
      <Rule />
      {sale.reason && <div className="pb-1">Arsyeja: {sale.reason}</div>}
      {(settings ? settings.receipt_footer : 'Faleminderit për blerjen!') && (
        <div className="text-center font-semibold">{settings ? settings.receipt_footer : 'Faleminderit për blerjen!'}</div>
      )}
      <div className="pb-4 pt-1 text-center text-[11px]">Kupon jo-fiskal</div>
    </div>
  )
}

function Row({ l, r }: { l: React.ReactNode; r: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="min-w-0">{l}</span>
      <span className="shrink-0 text-right">{r}</span>
    </div>
  )
}

function Rule() {
  return <div className="my-2 border-t border-dashed border-black" />
}

/** Renders the receipt only for printing (window.print) – Bluetooth ESC/POS arrives in phase 6. */
export function PrintArea({ sale, business, copy, settings }: { sale: Sale | null; business: Business; copy?: boolean; settings?: ReceiptSettings }) {
  if (!sale) return null
  return createPortal(
    <div className="print-root hidden">
      <Receipt sale={sale} business={business} copy={copy} settings={settings} />
    </div>,
    document.body,
  )
}
