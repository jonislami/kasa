import { useEffect, useId, useRef, type ReactNode } from 'react'
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
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // the latest onClose without re-running the effect (an inline onClose changes on every render; re-running would
  // move the focus out of the field being typed in)
  const close = useRef(onClose)
  close.current = onClose
  // the element that had the focus before the window opened (read while rendering, before a field inside takes it)
  const opener = useRef<HTMLElement | null>(null)
  if (open && !opener.current && typeof document !== 'undefined') opener.current = document.activeElement as HTMLElement | null
  if (!open && opener.current) opener.current = null
  useEffect(() => {
    if (!open) return
    // keyboard: the focus goes into the window, Tab stays inside it, Escape closes, the focus comes back after
    const before = opener.current
    const focusables = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter(
        (el) => el.offsetParent !== null,
      )
    const t = window.setTimeout(() => {
      if (panel.current && !panel.current.contains(document.activeElement)) (focusables()[0] ?? panel.current).focus()
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      const inside = panel.current?.contains(document.activeElement)
      if (e.key === 'Escape' && dismissable && inside !== false) close.current()
      if (e.key === 'Tab' && inside) {
        const list = focusables()
        if (!list.length) return
        const first = list[0]
        const last = list[list.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      if (before && document.contains(before)) before.focus()
    }
  }, [open, dismissable])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0F172A]/45 md:items-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'flex max-h-[calc(92dvh/var(--zoom,1))] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop outline-none md:rounded-2xl',
          width,
        )}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="pt-1.5">
              <h2 id={titleId} className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
            {dismissable && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Mbyll"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl text-muted hover:bg-[#F0F2F5] hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-line bg-[#F9FAFB] px-6 py-4 pb-safe">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
