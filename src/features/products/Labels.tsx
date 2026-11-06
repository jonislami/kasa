import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { barcodeModules } from '@/lib/barcode'

export type LabelSize = '40x30' | '50x30' | '58x40'
export const LABEL_SIZES: { value: LabelSize; label: string; w: number; h: number }[] = [
  { value: '40x30', label: '40 × 30 mm', w: 40, h: 30 },
  { value: '50x30', label: '50 × 30 mm', w: 50, h: 30 },
  { value: '58x40', label: '58 × 40 mm (rrotull kuponësh)', w: 58, h: 40 },
]

export interface LabelData {
  shop: string
  name: string
  detail: string | null
  barcode: string
  price: string
}

export function BarcodeSvg({ code, height = 40, className }: { code: string; height?: number; className?: string }) {
  const { modules } = barcodeModules(code)
  const w = modules.length
  const rects = []
  for (let i = 0; i < w; ) {
    if (modules[i] === '1') {
      let j = i
      while (j < w && modules[j] === '1') j++
      rects.push(<rect key={i} x={i} y={0} width={j - i} height={height} />)
      i = j
    } else i++
  }
  return (
    <svg viewBox={`-6 0 ${w + 12} ${height}`} preserveAspectRatio="none" className={className} aria-label={`Barkodi ${code}`} role="img">
      <g fill="#000">{rects}</g>
    </svg>
  )
}

export function Label({ d, size }: { d: LabelData; size: LabelSize }) {
  const s = LABEL_SIZES.find((x) => x.value === size) ?? LABEL_SIZES[0]
  return (
    <div
      className="flex flex-col overflow-hidden bg-white font-mono text-black"
      style={{ width: `${s.w}mm`, height: `${s.h}mm`, padding: '1.6mm 2mm', boxSizing: 'border-box', fontSize: s.w >= 50 ? '7.5pt' : '6.5pt', lineHeight: 1.15 }}
    >
      <div className="truncate font-bold uppercase">{d.shop}</div>
      <div className="truncate font-sans font-semibold" style={{ fontSize: s.w >= 50 ? '8.5pt' : '7.5pt' }}>
        {d.name}
      </div>
      {d.detail && <div className="truncate">{d.detail}</div>}
      <BarcodeSvg code={d.barcode} className="mt-auto w-full" height={40} />
      <div className="flex items-end justify-between">
        <span>{d.barcode}</span>
        <span className="font-bold" style={{ fontSize: s.w >= 50 ? '11pt' : '9.5pt' }}>
          {d.price}
        </span>
      </div>
    </div>
  )
}

/** Prints labels with the browser (any label printer installed in Windows/Android works). */
export function usePrintLabels() {
  const [job, setJob] = useState<{ items: LabelData[]; size: LabelSize } | null>(null)
  useEffect(() => {
    if (!job) return
    const s = LABEL_SIZES.find((x) => x.value === job.size) ?? LABEL_SIZES[0]
    const style = document.createElement('style')
    style.textContent = `@page { size: ${s.w}mm ${s.h}mm; margin: 0 } @media print { .label-sheet > div { page-break-after: always; break-after: page } }`
    document.head.appendChild(style)
    const t = setTimeout(() => window.print(), 80)
    const done = () => {
      setJob(null)
      style.remove()
    }
    window.addEventListener('afterprint', done, { once: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      style.remove()
    }
  }, [job])

  const area = job
    ? createPortal(
        <div className="print-root label-sheet hidden">
          {job.items.map((d, i) => (
            <Label key={i} d={d} size={job.size} />
          ))}
        </div>,
        document.body,
      )
    : null
  return { print: (items: LabelData[], size: LabelSize) => setJob({ items, size }), area }
}
