import { useCallback, useMemo, useRef, useState } from 'react'
import { Camera, ScanLine, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatQty } from '@/lib/units'
import type { Product } from '@/features/products/api'
import { CameraScanner, cameraScanSupported } from '@/features/pos/dialogs'

/**
 * Scan a barcode (USB scanner types + Enter) or search by name and pick a product.
 * Only stock products (no services).
 */
export function ProductPicker({
  products,
  onPick,
  placeholder = 'Skano barkodin ose kërko produktin për ta shtuar',
  autoFocus,
}: {
  products: Product[]
  onPick: (p: Product) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const stockProducts = useMemo(() => products.filter((p) => p.active && p.kind === 'product'), [products])
  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return stockProducts
      .filter((p) => p.name.toLowerCase().includes(s) || p.barcode?.startsWith(s) || p.substance?.toLowerCase().includes(s))
      .slice(0, 8)
  }, [q, stockProducts])

  const pick = (p: Product) => {
    onPick(p)
    setQ('')
    setOpen(false)
    setActive(0)
    setError(null)
    inputRef.current?.focus()
  }

  const pickRef = useRef(pick)
  pickRef.current = pick
  const onCameraCode = useCallback(
    (code: string) => {
      setCamera(false)
      const p = stockProducts.find((x) => x.barcode === code.trim())
      if (p) pickRef.current(p)
      else setError(`Barkodi ${code} nuk u gjet`)
    },
    [stockProducts],
  )

  const submit = () => {
    const s = q.trim()
    if (!s) return
    const exact = stockProducts.find((p) => p.barcode === s)
    if (exact) return pick(exact)
    if (results[active]) return pick(results[active])
    if (/^\d{6,}$/.test(s)) setError(`Barkodi ${s} nuk u gjet`)
  }

  return (
    <div>
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
              setActive(0)
              setError(null)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Escape') setQ('')
            }}
            placeholder={placeholder}
            className="h-[52px] w-full rounded-xl border-2 border-brand-600/70 bg-white pl-12 pr-10 text-[16px] focus:border-brand-600 focus:outline-none"
          />
          {q && (
            <button type="button" aria-label="Pastro" onClick={() => setQ('')} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-bg">
              <X className="h-4 w-4" />
            </button>
          )}
          {open && results.length > 0 && (
            <ul className="absolute inset-x-0 top-[56px] z-20 max-h-[320px] overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-xl">
              {results.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                    className={cn('flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left', i === active ? 'bg-brand-100' : 'hover:bg-bg')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      {p.barcode && <span className="block text-xs text-muted">{p.barcode}</span>}
                    </span>
                    <span className="shrink-0 text-sm text-muted tabular-nums">Stoku: {formatQty(p.stock, p.unit)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {cameraScanSupported() && (
          <button
            type="button"
            aria-label="Skano me kamerë"
            onClick={() => setCamera((v) => !v)}
            className={cn('flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border', camera ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-field bg-white')}
          >
            <Camera className="h-5 w-5" />
          </button>
        )}
      </div>
      {camera && (
        <CameraScanner active={camera} className="mt-3" onCode={onCameraCode} />
      )}
      {error && <p className="mt-2 text-sm text-warn-700">{error}</p>}
    </div>
  )
}
