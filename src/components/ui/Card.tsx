import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-white shadow-card', className)} {...rest} />
}

export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-5 pt-5', className)}>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {action}
    </div>
  )
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'warn'
}) {
  return (
    <div className={cn('rounded-card border bg-white px-5 py-4 shadow-card', tone === 'warn' ? 'border-[#F3C4BE]' : 'border-line')}>
      <div className={cn('flex items-center gap-1.5 text-[13px] font-medium', tone === 'warn' ? 'text-warn-700' : 'text-muted')}>
        {tone === 'warn' && <span className="h-1.5 w-1.5 rounded-full bg-warn-700" />}
        {label}
      </div>
      <div className="num mt-1.5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className={cn('mt-1 text-[13px]', tone === 'warn' ? 'text-warn-700' : 'text-muted')}>{sub}</div>}
    </div>
  )
}

/** Shown in place of content that arrives in a later phase or when a list is empty. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      {icon && <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] border border-line bg-[#F9FAFB] text-muted [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {text && <div className="max-w-md text-sm text-muted">{text}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
