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
  width?: number
  copy?: boolean
  settings?: ReceiptSettings
}) {
  width = width ?? settings?.paper_width ?? 80
  const f = sale.fiscal ?? null
  const x = receiptFacts(sale, business, copy)
  const footer = settings ? settings.receipt_footer : 'Faleminderit për blerjen!'
  const narrow = width < 70
  // As the SEF coupons ATK has seen (e.g. the PDF of another certified SEF): Lato, 8 pt text, 10.5 pt title, 7 pt
  // worker line, on the printable width of the roll (80 mm paper → 72 mm, 58 → 48, 100 → 90).
  const printable = narrow ? 48 : width > 90 ? 90 : 72
  const big = narrow ? 'text-[9.5pt]' : 'text-[10.5pt]'

  const lines = (ls: ReceiptLine[]) => (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-2">
      <span className="border-b border-black">{x.L.item}</span>
      <span className="border-b border-black text-right">{x.L.qtyPrice}</span>
      <span className="border-b border-black text-right">{x.L.amount}</span>
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
    <div className={cn('mx-auto bg-white px-[3mm] font-receipt leading-[1.3] text-black', narrow ? 'text-[7pt]' : 'text-[8pt]')} style={{ width: `${printable}mm` }}>
      {/* the page of the print (driver / dialog) follows the paper roll */}
      <style>{`@media print { @page { size: ${width}mm auto; margin: 0 } }`}</style>
      <div className="flex flex-col items-center pt-4 text-center">
        {settings?.receipt_header && <div className={cn('font-bold', big)}>{settings.receipt_header}</div>}
        <div className="font-bold">{x.L.taxpayer}: {business.name}</div>
        {x.header.map(([k, v]) => (
          <div key={k} className={k === x.header.find(([h]) => h.includes('NUI') || h.includes('JIB'))?.[0] || k.includes('TVSH') || k.includes('PDV') ? 'font-semibold' : undefined}>
            {k}: {v}
          </div>
        ))}
      </div>
      <Rule hash />
      {x.workerLine && <div className="text-right text-[7pt]">{x.workerLine}</div>}
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
          <Row l={<b>{x.L.subtotal}</b>} r={<b>{x.main.subtotal.value}</b>} />
          <Row l={<i>{x.main.subtotal.label}</i>} r={<i>{x.main.subtotal.discount}</i>} />
        </>
      )}
      <div className="mt-1 flex items-baseline justify-between border-t border-black pt-1 font-bold">
        <span>{x.L.total}</span>
        <span className="tabular-nums">{x.main.total}€</span>
      </div>
      <Row l={x.L.payment} r={x.main.payment} />
      {!x.returned && sale.kind === 'sale' && sale.tendered != null && sale.tendered !== sale.cash_amount && <Row l={x.L.paid} r={n2(sale.tendered)} />}
      {!x.returned && sale.change_amount > 0 && <Row l={x.L.change} r={n2(sale.change_amount)} />}
      {x.main.vat.map(([k, v]) => (
        <Row key={k} l={k} r={`${v}€`} />
      ))}
      <div className="border-b border-dashed border-black">
        {x.hasVat && <Row l={x.L.net} r={`${x.main.net}€`} />}
      </div>

      {x.returned && (
        <>
          <Rule hash />
          <div className="text-center">{x.L.returnedTitle}</div>
          <Rule hash />
          {lines(x.returned.lines)}
          <div className="border-t border-black">
            <Row l={x.L.returnedTotal} r={`${x.returned.total}€`} />
          </div>
          <div className="flex items-baseline justify-between border-t border-black pt-1 font-bold">
            <span>{x.L.remaining}</span>
            <span className="tabular-nums">{x.returned.remaining}€</span>
          </div>
        </>
      )}

      <div className="text-right">{x.returned ? `${x.L.itemsReturned} - ${x.returned.count}` : `${x.L.items} - ${x.main.itemsCount}`}</div>
      <div>{x.number}</div>
      <Row l={x.L.dateTime} r={x.dateTime} />
      {f && <Row l={x.L.sefNo} r={f.sef_no} />}
      {f && <div className="mt-1 font-semibold">NUIKF: {f.verification_no}</div>}
      <div className="mt-2 text-center">
        {x.L.daily} {x.dailyNo}
      </div>

      {f ? (
        <>
          <QrImage text={f.qr} className={cn('mx-auto my-2', narrow ? 'w-[36mm]' : 'w-[40mm]')} />
          {f.status === 'failed' && <div className="text-center text-[7pt]">{x.L.rejected}: {f.error}</div>}
          <FiscalLogo />
        </>
      ) : (
        <div className="mt-3 text-center text-[7pt]">{x.L.notFiscal}</div>
      )}

      <div className="mt-2 pb-1 text-center">
        {footer && <div className="uppercase">{footer}</div>}
        <div className="text-[7pt]">{x.L.poweredBy}</div>
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
  if (!svg) return <div className={cn('aspect-square bg-[#F3F4F6]', className)} />
  return <div className={cn('aspect-square [&>svg]:h-full [&>svg]:w-full', className)} dangerouslySetInnerHTML={{ __html: svg }} />
}

function Row({ l, r }: { l: React.ReactNode; r: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="min-w-0 whitespace-nowrap">{l}</span>
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
