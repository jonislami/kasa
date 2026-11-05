import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'warn' | 'amber' | 'neutral' | 'info'

const tones: Record<Tone, string> = {
  success: 'bg-brand-100 text-brand-600',
  warn: 'bg-warn-100 text-warn-700',
  amber: 'bg-amber-100 text-amber-700',
  neutral: 'bg-[#EEF1EE] text-muted',
  info: 'bg-[#E6EDFD] text-bt-600',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>
      {children}
    </span>
  )
}
