import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'bluetooth'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-card hover:bg-brand-700 disabled:bg-brand-600/45',
  secondary: 'bg-white text-ink border border-field shadow-card hover:bg-[#F9FAFB] hover:border-[#B5BCC7] disabled:text-muted',
  ghost: 'bg-transparent text-ink hover:bg-[#F0F2F5]',
  danger: 'bg-white text-warn-700 border border-[#F3C4BE] shadow-card hover:bg-warn-100',
  dark: 'bg-brand-900 text-white hover:bg-brand-800',
  bluetooth: 'bg-bt-600 text-white hover:bg-[#1a43bf]',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px] rounded-ctl',
  md: 'min-h-btn px-4 text-[14px] rounded-ctl',
  lg: 'h-[52px] px-5 text-[15px] rounded-[10px]',
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
        'inline-flex select-none items-center justify-center gap-2 font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/35 focus-visible:ring-offset-1',
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
