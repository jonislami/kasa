import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Device frames for the public site. The screens inside are the program's own layout with demo data
 * (screens.tsx), drawn at a fixed design width and scaled to fit, so they stay sharp and readable.
 */

/** Renders `children` at `width`×`height` CSS px and scales it to the box it is put in. */
export function Scaled({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative w-full overflow-hidden', className)} style={{ aspectRatio: `${width} / ${height}`, containerType: 'inline-size' }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `scale(calc(100cqw / ${width}px))` }}>
        {children}
      </div>
    </div>
  )
}

/** A POS touchscreen / monitor on its stand. */
export function MonitorFrame({ children, className, stand = true }: { children: ReactNode; className?: string; stand?: boolean }) {
  return (
    <figure className={cn('mx-auto w-full', className)}>
      <div className="rounded-[14px] bg-[#1B2433] p-[1.6%] shadow-[0_24px_48px_-24px_rgba(15,23,42,0.45)]">
        <div className="overflow-hidden rounded-[6px] bg-white">{children}</div>
      </div>
      {stand && (
        <div className="mx-auto flex flex-col items-center">
          <div className="h-6 w-[14%] bg-[#232D3D]" />
          <div className="h-2 w-[34%] rounded-t-[10px] bg-[#1B2433]" />
        </div>
      )}
    </figure>
  )
}

/** A laptop (the office computer). */
export function LaptopFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <figure className={cn('mx-auto w-full', className)}>
      <div className="rounded-t-[14px] bg-[#1B2433] px-[2%] pb-[1.4%] pt-[1.8%]">
        <div className="overflow-hidden rounded-[4px] bg-white">{children}</div>
      </div>
      <div className="relative mx-[-4%] h-3 rounded-b-[12px] bg-[#C9CED6]">
        <div className="absolute left-1/2 top-0 h-1.5 w-[16%] -translate-x-1/2 rounded-b-[6px] bg-[#AEB4BE]" />
      </div>
    </figure>
  )
}

/** A phone with the app open. */
export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <figure className={cn('mx-auto w-full max-w-[300px]', className)}>
      <div className="rounded-[36px] bg-[#1B2433] p-[3.2%] shadow-[0_24px_48px_-20px_rgba(15,23,42,0.45)]">
        <div className="relative overflow-hidden rounded-[28px] bg-white">
          <div className="absolute left-1/2 top-[1.4%] z-10 h-[2.6%] w-[28%] -translate-x-1/2 rounded-full bg-[#1B2433]" />
          {children}
        </div>
      </div>
    </figure>
  )
}

/**
 * A close-up of the part of the screen where the action happens: the same component, drawn larger in a frame,
 * with a short label. Next to the full screen on desktop, under it on the phone.
 */
export function ZoomCallout({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-card border-2 border-brand-600 bg-white shadow-pop', className)}>
      <div className="border-b border-line bg-brand-50 px-3 py-1.5 text-[12px] font-semibold text-brand-700">{label}</div>
      <div className="p-3">{children}</div>
    </div>
  )
}

/** Thermal paper coming out of a printer slot (for the receipt component). */
export function PaperRoll({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <figure className={cn('inline-flex flex-col items-center', className)}>
      <div className="h-3 w-full rounded-t-[6px] bg-[#2A3444]" />
      <div className="border-x border-b border-[#E5E7EB] bg-white shadow-[0_18px_30px_-18px_rgba(15,23,42,0.4)] [clip-path:polygon(0_0,100%_0,100%_calc(100%-6px),97%_100%,94%_calc(100%-6px),91%_100%,88%_calc(100%-6px),85%_100%,82%_calc(100%-6px),79%_100%,76%_calc(100%-6px),73%_100%,70%_calc(100%-6px),67%_100%,64%_calc(100%-6px),61%_100%,58%_calc(100%-6px),55%_100%,52%_calc(100%-6px),49%_100%,46%_calc(100%-6px),43%_100%,40%_calc(100%-6px),37%_100%,34%_calc(100%-6px),31%_100%,28%_calc(100%-6px),25%_100%,22%_calc(100%-6px),19%_100%,16%_calc(100%-6px),13%_100%,10%_calc(100%-6px),7%_100%,4%_calc(100%-6px),1%_100%,0_calc(100%-6px))]">
        {children}
      </div>
      {label && <figcaption className="mt-3 text-center text-[13px] text-muted">{label}</figcaption>}
    </figure>
  )
}
