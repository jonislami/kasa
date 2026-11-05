import { Store } from 'lucide-react'
import { cn } from '@/lib/cn'

export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-[10px] bg-brand-400 text-brand-900', className)}
      style={{ width: size, height: size }}
    >
      <Store style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
    </div>
  )
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}
