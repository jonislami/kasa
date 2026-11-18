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
    <div role="tablist" className={cn('inline-flex max-w-full overflow-x-auto rounded-[10px] bg-[#EEF0F3] p-[3px] [scrollbar-width:none]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-[8px] font-medium transition-colors',
            size === 'sm' ? 'px-3 py-1.5 text-sm' : 'min-h-[40px] px-4 text-[14px]',
            o.value === value ? 'bg-white text-ink shadow-[0_1px_3px_rgba(15,23,42,0.1)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
