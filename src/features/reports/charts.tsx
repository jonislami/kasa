import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'

export interface Bar {
  key: string
  label: string
  value: number
  highlight?: boolean
  title?: string
}

function compact(v: number): string {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}k`
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v)
}

/** Vertical bars as in the design: light green, the current one dark; value above each bar. */
export function BarChart({ bars, height = 220, emptyText = 'Ende pa shitje' }: { bars: Bar[]; height?: number; emptyText?: string }) {
  const max = Math.max(...bars.map((b) => b.value), 0)
  if (max <= 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>
        {emptyText}
      </div>
    )
  }
  const dense = bars.length > 14
  return (
    <div className="flex items-end gap-1.5 border-b border-line sm:gap-3" style={{ height }} role="img" aria-label="Grafiku i shitjeve">
      {bars.map((b) => {
        const h = Math.max((b.value / max) * (height - 44), b.value > 0 ? 3 : 0)
        return (
          <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={b.title ?? `${b.label}: ${formatEUR(b.value)}`}>
            {!dense && (
              <span className={cn('mb-1 text-[11px] tabular-nums sm:text-xs', b.highlight ? 'font-semibold text-brand-600' : 'text-muted')}>
                {b.value > 0 ? compact(b.value) : ''}
              </span>
            )}
            <div className={cn('w-full rounded-t-md', b.highlight ? 'bg-brand-600' : 'bg-[#BFE3D0]')} style={{ height: h }} />
          </div>
        )
      })}
    </div>
  )
}

/** Labels row under a BarChart (kept separate so bars align to the baseline). */
export function BarLabels({ bars }: { bars: Bar[] }) {
  const dense = bars.length > 14
  return (
    <div className="mt-2 flex gap-1.5 sm:gap-3">
      {bars.map((b, i) => {
        const show = !dense || i % Math.ceil(bars.length / 8) === 0 || b.highlight
        return (
          <span key={b.key} className={cn('min-w-0 flex-1 truncate text-center text-[11px] sm:text-[13px]', b.highlight ? 'font-semibold text-ink' : 'text-muted', !show && 'invisible')}>
            {b.label}
          </span>
        )
      })}
    </div>
  )
}

/** Horizontal progress bars ("Më të shiturat sot"). */
export function RankBars({ rows }: { rows: { key: string; label: string; value: number; text: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0)
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex justify-between gap-3 text-[15px]">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{r.text}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[#E8ECE9]">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${max ? Math.max((r.value / max) * 100, 2) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-muted">{label}: —</span>
  const up = value >= 0
  return (
    <span className="text-muted">
      <span className={cn('font-semibold', up ? 'text-brand-600' : 'text-warn-700')}>
        {up ? '▲' : '▼'} {Math.abs(value * 100).toFixed(1)}%
      </span>{' '}
      {label}
    </span>
  )
}
