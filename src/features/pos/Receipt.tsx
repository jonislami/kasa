import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { createPortal } from 'react-dom'
import type { Business } from '@/app/AuthProvider'
import { cn } from '@/lib/cn'
import { n2, receiptFacts, type ReceiptLine } from '@/lib/printer/receiptFacts'
import type { Sale } from './api'
import type { ReceiptSettings } from '@/features/settings/api'

/**
 * The receipt as in the ATK samples of SEF coupons (Shtojca F): taxpayer and unit, worker, title, items
 * (SASIA X ÇMIMI), discounts ("Ulje"), total and payment, VAT by rate, total without VAT, then the fiscal block
 * (number, date and time, SEF number, NUIKF, daily number), the QR and the RKS / MF logo. Cancel and return coupons
 * show the original bill (and the returned items). The thermal printer prints the same (lib/printer/receipt.ts).
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
  const f = sale.fiscal ?? null
  const x = receiptFacts(sale, business, copy)
  const footer = settings ? settings.receipt_footer : 'Faleminderit për blerjen!'
  const narrow = width === 58
  const big = narrow ? 'text-[14px]' : 'text-[17px]'

  const lines = (ls: ReceiptLine[]) => (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-2">
      <span className="border-b border-black">ARTIKULLI</span>
      <span className="border-b border-black text-right">SASIA X ÇMIMI</span>
      <span className="border-b border-black text-right">SHUMA</span>
      {ls.map((l, k) => (
        <div key={k} className="contents">
          <span className="min-w-0 break-words">{l.name}</span>
          <span className="text-right tabular-nums">{l.qtyPrice}</span>
          <span className="text-right tabular-nums">{l.amount}</span>
          {l.discount && (
            <>
              <span className="col-span-2 pl-2 italic">{l.discount.label}</span>
              <span className="text-right italic tabular-nums">{l.discount.amount}</span>
            </>
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className={cn('mx-auto bg-white font-mono leading-snug text-black', narrow ? 'w-[58mm] px-1 text-[11px]' : 'w-[80mm] px-3 text-[12.5px]')}>
      <div className="flex flex-col items-center pt-4 text-center">
        {settings?.receipt_header && <div className={cn('font-bold', big)}>{settings.receipt_header}</div>}
        <div>TATIMPAGUESI: {business.name}</div>
        {x.header.map(([k, v]) => (
          <div key={k} className={k === 'NF-NUI' || k === 'NUMRI I TVSH-SË' ? 'font-semibold' : undefined}>
            {k}: {v}
          </div>
        ))}
      </div>
      <Rule hash />
      {sale.worker_name && <div className="text-right text-[0.9em]">EMRI I PUNËTORIT: {sale.worker_name}</div>}
      <div className={cn('mt-1 text-center font-bold', big)}>{x.title}</div>
      {x.marks.map((m) => (
        <div key={m} className="text-center font-semibold">
          {m}
        </div>
      ))}
      {x.refLine && <div className="mt-1 text-center">{x.refLine}</div>}
      {x.reasonLine && <div className="text-center italic">{x.reasonLine}</div>}
      <div className="mt-2" />
      {lines(x.main.lines)}
      {x.main.subtotal && (
        <>
          <Row l={<b>NËNTOTALI</b>} r={<b>{x.main.subtotal.value}</b>} />
          <Row l={<i>{x.main.subtotal.label}</i>} r={<i>{x.main.subtotal.discount}</i>} />
        </>
      )}
      <div className={cn('mt-1 flex items-baseline justify-between border-t border-black pt-1 font-bold', big)}>
        <span>TOTALI PËR PAGESË</span>
        <span className="tabular-nums">{x.main.total}€</span>
      </div>
      <Row l="MËNYRA E PAGESËS" r={x.main.payment} />
      {!x.returned && sale.kind === 'sale' && sale.tendered != null && sale.tendered !== sale.cash_amount && <Row l="PAGUAR" r={n2(sale.tendered)} />}
      {!x.returned && sale.change_amount > 0 && <Row l="KUSURI" r={n2(sale.change_amount)} />}
      {x.main.vat.map(([k, v]) => (
        <Row key={k} l={k} r={`${v}€`} />
      ))}
      <div className="border-b border-dashed border-black">
        <Row l="TOTALI PA TVSH" r={`${x.main.net}€`} />
      </div>

      {x.returned && (
        <>
          <Rule hash />
          <div className="text-center">KTHIMI I ARTIKUJVE</div>
          <Rule hash />
          {lines(x.returned.lines)}
          <div className="border-t border-black">
            <Row l="TOTALI I KTHIMIT" r={`${x.returned.total}€`} />
          </div>
          <div className={cn('flex items-baseline justify-between border-t border-black pt-1 font-bold', big)}>
            <span>TOTALI I MBETUR</span>
            <span className="tabular-nums">{x.returned.remaining}€</span>
          </div>
        </>
      )}

      <div className="text-right">{x.returned ? `ARTIKUJ TË KTHYER - ${x.returned.count}` : `ARTIKUJ - ${x.main.itemsCount}`}</div>
      <div>{x.number}</div>
      <Row l="DATA DHE ORA" r={x.dateTime} />
      {f && <Row l="NR. IDENTIFIKUES I SEF" r={f.sef_no} />}
      {f && <div className="mt-1 font-semibold">NUIKF: {f.verification_no}</div>}
      <div className="mt-2 text-center">
        {f ? 'KUPON FISKAL' : 'KUPON'} DITOR NR. {x.dailyNo}
      </div>

      {f ? (
        <>
          <QrImage text={f.qr} className={cn('mx-auto my-2', narrow ? 'w-[36mm]' : 'w-[40mm]')} />
          {f.status === 'failed' && <div className="text-center text-[11px]">ATK e refuzoi: {f.error}</div>}
          <FiscalLogo />
        </>
      ) : (
        <div className="mt-3 text-center text-[11px]">Ky kupon nuk është fiskal.</div>
      )}

      <div className="mt-2 pb-1 text-center">
        {footer && <div className="uppercase">{footer}</div>}
        <div className="text-[10px]">Mundësuar nga Kasa</div>
      </div>
      <div className="pb-5" />
    </div>
  )
}

/** The fiscal logo of ATK (Shtojca A): coat of arms with "RKS / MF", 19 x 9.5 mm (min 15 x 8, max 20 x 10). */
export function FiscalLogo() {
  return (
    <div className="mx-auto mt-1 flex h-[9.5mm] w-[19mm] items-center gap-[1mm]">
      <img src="/rks.png" alt="Stema e Republikës së Kosovës" className="h-full w-auto" />
      <div className="flex flex-col font-sans text-[3.6mm] font-extrabold leading-[1.05]">
        <span>RKS</span>
        <span>MF</span>
      </div>
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

function Rule({ hash }: { hash?: boolean }) {
  return hash ? <div className="my-1.5 overflow-hidden whitespace-nowrap text-[0.75em] leading-none">{'#'.repeat(80)}</div> : <div className="my-2 border-t border-dashed border-black" />
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
