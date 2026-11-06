import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import type { PosProduct } from './cart'

/** Boutique: pick colour and size of a model; the chosen variant goes on the bill. */
export function VariantPicker({
  model,
  variants,
  onClose,
  onPick,
}: {
  model: PosProduct | null
  variants: PosProduct[]
  onClose: () => void
  onPick: (v: PosProduct) => void
}) {
  const mine = useMemo(() => (model ? variants.filter((v) => v.parent_id === model.id) : []), [model, variants])
  const colors = useMemo(() => {
    const order = model?.variant_colors?.map((c) => c.name) ?? []
    const names = [...new Set(mine.map((v) => v.variant_color ?? ''))]
    return names.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999))
  }, [mine, model])
  const sizes = useMemo(() => {
    const order = model?.variant_sizes ?? []
    const names = [...new Set(mine.map((v) => v.variant_size ?? ''))]
    return names.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999))
  }, [mine, model])
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')

  useEffect(() => {
    if (!model) return
    // start on the first colour that has something in stock
    const firstInStock = mine.find((v) => v.stock > 0)
    setColor(firstInStock?.variant_color ?? colors[0] ?? '')
    setSize('')
  }, [model, mine, colors])

  const pick = (c: string, s: string) => mine.find((v) => (v.variant_color ?? '') === c && (v.variant_size ?? '') === s)
  const chosen = pick(color, size)
  const hex = (name: string) => mine.find((v) => v.variant_color === name)?.color_hex ?? model?.variant_colors?.find((c) => c.name === name)?.hex ?? '#ccc'
  const soldOut = sizes.filter((s) => (pick(color, s)?.stock ?? 0) <= 0)

  if (!model) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={model.name}
      subtitle={`${formatEUR(model.sale_price)} · zgjidh ${sizes.length > 1 || sizes[0] ? 'madhësinë' : ''}${colors.length > 1 || colors[0] ? (sizes[0] ? ' dhe ngjyrën' : 'ngjyrën') : ''}`}
      width="md:max-w-[560px]"
    >
      <div className="flex flex-col gap-5">
        {colors.some(Boolean) && (
          <div>
            <div className="mb-2 text-sm font-semibold">Ngjyra</div>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('flex h-12 items-center gap-2 rounded-xl border bg-white px-3.5 font-medium', color === c ? 'border-2 border-ink' : 'border-line')}
                >
                  <span className="h-5 w-5 rounded-full border border-line" style={{ background: hex(c) }} />
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {sizes.some(Boolean) && (
          <div>
            <div className="mb-2 text-sm font-semibold">Madhësia</div>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => {
                const v = pick(color, s)
                const out = !v || v.stock <= 0
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!v}
                    onClick={() => setSize(s)}
                    className={cn(
                      'h-12 min-w-[56px] rounded-xl border px-3 font-semibold',
                      size === s ? 'border-ink bg-ink text-white' : out ? 'border-line bg-[#F2F5F2] text-muted line-through' : 'border-line bg-white',
                    )}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <p className="text-sm text-muted">
          {chosen
            ? `${[chosen.variant_size, chosen.variant_color].filter(Boolean).join(' · ')} · ${chosen.stock} copë në stok`
            : 'Zgjidh madhësinë.'}
          {soldOut.length > 0 && ` · ${soldOut.join(', ')} ka mbaruar`}
        </p>
        {chosen && chosen.stock <= 0 && <p className="-mt-3 text-sm font-medium text-amber-700">Në sistem nuk ka stok – shitja lejohet, stoku del negativ.</p>}
        <Button size="lg" block disabled={!chosen && sizes.some(Boolean)} onClick={() => (chosen ?? pick(color, '')) && onPick((chosen ?? pick(color, ''))!)}>
          Shto në faturë
        </Button>
      </div>
    </Dialog>
  )
}
