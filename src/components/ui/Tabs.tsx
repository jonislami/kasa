import { cn } from '@/lib/cn'

export interface TabOption<T extends string> {
  value: T
  label: string
}

/** Segmented control (Javë / Muaj / Vit, Menaxher / Arkëtar). */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: TabOption<T>[]
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="tablist" className={cn('inline-flex rounded-xl bg-[#E8ECE9] p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-[9px] font-semibold transition-colors',
            size === 'sm' ? 'px-3 py-1.5 text-sm' : 'min-h-[44px] px-4 text-[15px]',
            o.value === value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
