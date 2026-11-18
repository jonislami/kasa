import { cn } from '@/lib/cn'

/**
 * KontoSef.app mark: a T-account (the accountant's "konto" – debit | credit) inside a navy tile,
 * with one entry on each side, offset like two posted lines. Same geometry as public/icon.svg.
 */
export function LogoMark({ size = 40, className, tone = 'dark' }: { size?: number; className?: string; tone?: 'dark' | 'light' }) {
  const tile = tone === 'dark' ? '#0F1B2D' : '#FFFFFF'
  const fg = tone === 'dark' ? '#FFFFFF' : '#0F1B2D'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn('shrink-0', className)} aria-hidden="true">
      <rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill={tile} stroke={tone === "dark" ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.08)"} />
      <rect x="15" y="17" width="34" height="5" rx="1" fill={fg} />
      <rect x="29.5" y="17" width="5" height="31" rx="1" fill={fg} />
      <rect x="18" y="29" width="7" height="7" rx="1" fill={fg} opacity="0.55" />
      <rect x="39" y="38" width="7" height="7" rx="1" fill="#8AAEEB" />
    </svg>
  )
}

/** Mark + "KontoSef.app" wordmark. */
export function Logo({ size = 32, className, tone = 'dark' }: { size?: number; className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} tone={tone === 'dark' ? 'dark' : 'light'} />
      <Wordmark className={tone === 'dark' ? 'text-ink' : 'text-white'} size={size * 0.56} />
    </span>
  )
}

export function Wordmark({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <span className={cn('font-semibold leading-none tracking-[-0.025em]', className)} style={{ fontSize: size }}>
      KontoSef<span className="font-medium opacity-50">.app</span>
    </span>
  )
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}
