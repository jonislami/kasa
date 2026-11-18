import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'warn' | 'amber' | 'neutral' | 'info'

const tones: Record<Tone, string> = {
  success: 'bg-ok-100 text-ok-700',
  warn: 'bg-warn-100 text-warn-700',
  amber: 'bg-amber-100 text-amber-700',
  neutral: 'bg-[#F0F2F5] text-[#475467]',
  info: 'bg-brand-100 text-brand-700',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-md px-2 py-[3px] text-[12px] font-medium leading-none', tones[tone], className)}>
      {children}
    </span>
  )
}
