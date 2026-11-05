import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'md:max-w-[720px]',
  dismissable = true,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
  /** false: no ✕, no Escape, no backdrop click (e.g. credentials shown once). */
  dismissable?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, dismissable])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#4d5c53]/70 md:items-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] bg-white shadow-2xl md:rounded-[20px]',
          width,
        )}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div>
              <h2 className="text-xl font-semibold text-ink">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
            {dismissable && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Mbyll"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bg text-ink hover:bg-line"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-line bg-[#F6F8F6] px-6 py-4 pb-safe">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
