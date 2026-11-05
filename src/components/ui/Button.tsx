import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'bluetooth'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-[#0b5a41] disabled:bg-brand-600/50',
  secondary: 'bg-white text-ink border border-field hover:bg-bg disabled:text-muted',
  ghost: 'bg-transparent text-ink hover:bg-black/5',
  danger: 'bg-white text-warn-700 border border-[#F3C9AE] hover:bg-warn-100',
  dark: 'bg-ink text-white hover:bg-black',
  bluetooth: 'bg-bt-600 text-white hover:bg-[#1a43bf]',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-ctl',
  md: 'min-h-btn px-4 text-[15px] rounded-ctl',
  lg: 'h-[54px] px-5 text-base rounded-xl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
      {children}
    </button>
  )
})
