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
  'w-full h-[44px] rounded-ctl border border-field bg-white px-3 text-ink shadow-card placeholder:text-[#98A2B3] transition-colors hover:border-[#B5BCC7] ' +
  'focus:border-brand-600 focus:outline-none focus:ring-[3px] focus:ring-brand-600/15 disabled:bg-bg disabled:text-muted read-only:bg-[#F9FAFB]'

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
            <label htmlFor={inputId} className="text-[13px] font-medium text-[#344054]">
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
        <p className="text-[13px] text-warn-700">{error}</p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  )
})
