import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-white', className)} {...rest} />
}

export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-5 pt-5', className)}>
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
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
    <div
      className={cn(
        'rounded-card border px-5 py-5',
        tone === 'warn' ? 'border-[#F3C9AE] bg-[#FFF4EC]' : 'border-line bg-white',
      )}
    >
      <div className={cn('text-sm', tone === 'warn' ? 'text-warn-700' : 'text-muted')}>{label}</div>
      <div className="mt-2 text-[28px] font-bold leading-tight tabular-nums text-ink">{value}</div>
      {sub && <div className={cn('mt-2 text-sm', tone === 'warn' ? 'text-warn-700' : 'text-muted')}>{sub}</div>}
    </div>
  )
}

/** Shown in place of content that arrives in a later phase or when a list is empty. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">{icon}</div>}
      <div className="text-base font-semibold text-ink">{title}</div>
      {text && <div className="max-w-md text-sm text-muted">{text}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
