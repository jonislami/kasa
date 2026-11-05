import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  labelRight?: ReactNode
  mono?: boolean
}

export const inputClass =
  'w-full h-[46px] rounded-ctl border border-field bg-white px-3.5 text-ink placeholder:text-[#8A968F] ' +
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-bg read-only:bg-[#F2F5F2]'

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, labelRight, mono, className, id, ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="flex flex-col gap-1.5">
      {(label || labelRight) && (
        <div className="flex items-center justify-between">
          {label && (
            <label htmlFor={inputId} className="text-sm font-medium text-ink">
              {label}
            </label>
          )}
          {labelRight}
        </div>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(inputClass, mono && 'font-mono font-semibold tracking-wide', error && 'border-warn-700', className)}
        {...rest}
      />
      {error ? (
        <p className="text-sm text-warn-700">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  )
})
