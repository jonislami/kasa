import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm [&_tbody_tr:hover]:bg-[#FAFBFC]', className)} {...rest} />
    </div>
  )
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-line bg-[#F9FAFB] px-3 py-2.5 text-left text-[12px] font-medium uppercase tracking-[0.04em] text-muted',
        className,
      )}
      {...rest}
    />
  )
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-line px-3 py-3 align-middle tabular-nums text-ink', className)} {...rest} />
}
