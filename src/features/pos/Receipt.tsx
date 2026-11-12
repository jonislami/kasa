import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { createPortal } from 'react-dom'
import type { Business } from '@/app/AuthProvider'
import { cn } from '@/lib/cn'
import { n2, qty, receiptFacts } from '@/lib/printer/receiptFacts'
import type { Sale } from './api'
import type { ReceiptSettings } from '@/features/settings/api'

/**
 * The receipt as ATK lays out a fiscal coupon: taxpayer and unit, worker, title, items table, total and
 * payment, VAT by rate, then the fiscal block (number, date and time, SEF number, NUIKF, daily number),
 * the QR and RKS. The thermal printer prints the same text (lib/printer/receipt.ts).
 */
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
  const f = sale.fiscal ?? null
  const x = receiptFacts(sale, business, copy)
  const footer = settings ? settings.receipt_footer : 'Faleminderit për blerjen!'
  const narrow = width === 58

  return (
    <div className={cn('mx-auto bg-white font-mono leading-snug text-black', narrow ? 'w-[58mm] px-1 text-[11px]' : 'w-[80mm] px-3 text-[12.5px]')}>
      <div className="flex flex-col items-center pt-4 text-center">
        <div className={cn('font-bold', narrow ? 'text-[13px]' : 'text-[15px]')}>TATIMPAGUESI: {business.name}</div>
        {settings?.receipt_header && <div className="mt-0.5">{settings.receipt_header}</div>}
        <div className="mt-1.5">
          {x.header.map(([k, v]) => (
            <div key={k}>
              {k}: {v}
            </div>
          ))}
        </div>
      </div>
      <Rule />
      {sale.worker_name && <div className="text-right">EMRI I PUNËTORIT: {sale.worker_name}</div>}
      <div className={cn('mt-1.5 text-center font-bold tracking-[0.2em]', narrow ? 'text-[13px]' : 'text-[15px]')}>{x.title}</div>
      {x.marks.map((m) => (
        <div key={m} className="text-center font-semibold">
          {m}
        </div>
      ))}
      {x.refInvoice && <div className="text-center">PËR KUPONIN: {x.refInvoice}</div>}
      <Rule />

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2">
        <span className="font-semibold">ARTIKULLI</span>
        <span className="text-right font-semibold">SASIA</span>
        <span className="text-right font-semibold">ÇMIMI</span>
        <span className="text-right font-semibold">SHUMA</span>
        {sale.items.map((i) => {
          const disc = i.line_discount + i.invoice_discount
          return (
            <div key={i.id} className="contents">
              <span className="min-w-0 break-words">{i.name}</span>
              <span className="text-right tabular-nums">{qty(i.quantity, i.unit)}</span>
              <span className="text-right tabular-nums">{n2(i.unit_price)}</span>
              <span className="text-right tabular-nums">
                {n2(i.total)} {i.vat_code}
              </span>
              {disc !== 0 && (
                <>
                  <span className="col-span-3 pl-2">zbritje</span>
                  <span className="text-right tabular-nums">-{n2(Math.abs(disc))}</span>
                </>
              )}
            </div>
          )
        })}
      </div>
      <Rule />

      {sale.discount_total !== 0 && <Row l="ZBRITJE GJITHSEJ" r={`-${n2(Math.abs(sale.discount_total))} €`} />}
      <div className={cn('flex items-baseline justify-between font-bold', narrow ? 'text-[14px]' : 'text-[16px]')}>
        <span>{sale.kind === 'sale' ? 'TOTALI PËR PAGESË' : 'TOTALI'}</span>
        <span className="tabular-nums">{n2(sale.total)} €</span>
      </div>
      <Row l="MËNYRA E PAGESËS" r={x.payment} />
      {sale.payment_method === 'mixed' && (
        <>
          <Row l="  Kesh" r={n2(sale.cash_amount)} />
          <Row l="  Kartelë" r={n2(sale.card_amount)} />
        </>
      )}
      {sale.kind === 'sale' && sale.tendered != null && sale.tendered !== sale.cash_amount && <Row l="PAGUAR" r={n2(sale.tendered)} />}
      {sale.change_amount > 0 && <Row l={<b>KUSURI</b>} r={<b>{n2(sale.change_amount)}</b>} />}

      {opt.show_vat !== false && (
        <>
          <Rule />
          <div className="grid grid-cols-3">
            <span className="font-semibold">TVSH</span>
            <span className="text-center font-semibold">PA TVSH</span>
            <span className="text-right font-semibold">TVSH</span>
            {sale.vat_lines.map((v) => (
              <div key={v.code} className="contents">
                <span>
                  {v.code} {v.code === 'A' ? 'e liruar' : `${Math.round(v.rate * 100)}%`}
                </span>
                <span className="text-center tabular-nums">{n2(v.net)}</span>
                <span className="text-right tabular-nums">{n2(v.vat)}</span>
              </div>
            ))}
            <span>Gjithsej</span>
            <span className="text-center tabular-nums">{n2(sale.net_total)}</span>
            <span className="text-right tabular-nums">{n2(sale.vat_total)}</span>
          </div>
        </>
      )}
      <Rule />

      <div className="text-right">ARTIKUJ - {x.itemsCount}</div>
      <div className="mt-1">{x.number}</div>
      <Row l="DATA DHE ORA" r={x.dateTime} />
      {f && <Row l="NR. IDENTIFIKUES I SEF" r={f.sef_no} />}
      {f && <div>NUIKF: {f.verification_no}</div>}
      <div className="mt-0.5 text-center">
        {f ? 'KUPON FISKAL' : 'KUPON'} DITOR NR. {x.dailyNo}
      </div>
      {sale.reason && <div className="mt-1">ARSYEJA: {sale.reason}</div>}

      {f ? (
        <>
          <QrImage text={f.qr} className={cn('mx-auto my-3', narrow ? 'w-[40mm]' : 'w-[46mm]')} />
          {f.status === 'failed' && <div className="text-center text-[11px]">ATK e refuzoi: {f.error}</div>}
          <img src="/rks.png" alt="Stema e Republikës së Kosovës" className={cn('mx-auto mt-1', narrow ? 'w-[11mm]' : 'w-[13mm]')} />
          <div className="mt-1 text-center font-bold tracking-[0.15em]">RKS / MF</div>
        </>
      ) : (
        <div className="mt-3 text-center text-[11px]">Ky kupon nuk është fiskal.</div>
      )}

      <div className="mt-2 pb-1 text-center">
        {footer && <div className="font-semibold uppercase">{footer}</div>}
        <div className="text-[11px]">Mundësuar nga Kasa</div>
      </div>
      <div className="pb-5" />
    </div>
  )
}

/** QR code as SVG (screen and window.print). */
export function QrImage({ text, className }: { text: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }).then((s) => alive && setSvg(s), () => alive && setSvg(null))
    return () => {
      alive = false
    }
  }, [text])
  if (!svg) return <div className={cn('aspect-square bg-[#F2F5F2]', className)} />
  return <div className={cn('aspect-square [&>svg]:h-full [&>svg]:w-full', className)} dangerouslySetInnerHTML={{ __html: svg }} />
}

function Row({ l, r }: { l: React.ReactNode; r: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="min-w-0">{l}</span>
      <span className="shrink-0 text-right tabular-nums">{r}</span>
    </div>
  )
}

function Rule() {
  return <div className="my-2 border-t border-dashed border-black" />
}

/** Renders the receipt only for printing (window.print). */
export function PrintArea({ sale, business, copy, settings }: { sale: Sale | null; business: Business; copy?: boolean; settings?: ReceiptSettings }) {
  if (!sale) return null
  return createPortal(
    <div className="print-root hidden">
      <Receipt sale={sale} business={business} copy={copy} settings={settings} />
    </div>,
    document.body,
  )
}
