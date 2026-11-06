import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, History, MinusCircle } from 'lucide-react'
import { Button, Card, Dialog, EmptyState, Input, Select, Table, Tabs, Td, Th } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatQty } from '@/lib/units'
import type { Product } from '@/features/products/api'
import {
  adjustStock,
  fetchMovements,
  formatDateTime,
  MOVEMENT_LABELS,
  REASON_LABELS,
  type AdjustReason,
  type MovementKind,
} from './api'
import { ProductPicker } from './ProductPicker'

type Period = 'today' | '7' | '30' | 'all'

function since(period: Period): string | undefined {
  if (period === 'all') return undefined
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (period !== 'today') d.setDate(d.getDate() - Number(period) + 1)
  return d.toISOString()
}

export function MovementsTab({ products, people }: { products: Product[]; people: Map<string, string> }) {
  const [period, setPeriod] = useState<Period>('7')
  const [kind, setKind] = useState<MovementKind | 'all'>('all')
  const [productId, setProductId] = useState<string>('')
  const [adjustOpen, setAdjustOpen] = useState(false)
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const movements = useQuery({
    queryKey: ['stock', 'movements', period, kind, productId],
    queryFn: () => fetchMovements({ from: since(period), kind: kind === 'all' ? undefined : kind, productId: productId || undefined, limit: 500 }),
  })
  const rows = movements.data ?? []
  const selected = productId ? byId.get(productId) : undefined

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            size="sm"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'today', label: 'Sot' },
              { value: '7', label: '7 ditë' },
              { value: '30', label: '30 ditë' },
              { value: 'all', label: 'Të gjitha' },
            ]}
          />
          <Select
            aria-label="Lloji"
            value={kind}
            onChange={(e) => setKind(e.target.value as MovementKind | 'all')}
            className="h-10 w-auto"
            options={[{ value: 'all', label: 'Të gjitha llojet' }, ...Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label }))]}
          />
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setAdjustOpen(true)}>
            <MinusCircle className="h-4 w-4" /> Shkarkim / korrigjim
          </Button>
        </div>
        {selected ? (
          <div className="flex items-center justify-between rounded-ctl bg-brand-100 px-3 py-2 text-sm">
            <span>
              <b>{selected.name}</b> · stoku tani {formatQty(selected.stock, selected.unit)}
            </span>
            <button type="button" className="font-medium text-brand-600" onClick={() => setProductId('')}>
              Hiq filtrin
            </button>
          </div>
        ) : (
          <ProductPicker products={products} onPick={(p) => setProductId(p.id)} placeholder="Filtro sipas produktit (skano ose kërko)" />
        )}
      </div>

      {movements.isLoading ? (
        <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
      ) : movements.isError ? (
        <EmptyState title="Lista nuk u ngarkua" text={(movements.error as Error).message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<History className="h-6 w-6" />} title="Asnjë lëvizje në këtë periudhë" />
      ) : (
        <Table>
          <thead className="bg-[#F8FAF8]">
            <tr>
              <Th className="pl-5">Koha</Th>
              <Th>Produkti</Th>
              <Th>Lloji</Th>
              <Th className="text-right">Sasia</Th>
              <Th className="text-right">Stoku pas</Th>
              <Th className="hidden lg:table-cell">Kush</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const p = byId.get(m.product_id)
              const unit = p?.unit ?? 'cope'
              const inbound = m.quantity > 0
              return (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap pl-5 text-muted">{formatDateTime(m.created_at)}</Td>
                  <Td>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setProductId(m.product_id)}>
                      {p?.name ?? '—'}
                    </button>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      {inbound ? <ArrowDownLeft className="h-4 w-4 text-brand-600" /> : <ArrowUpRight className="h-4 w-4 text-warn-700" />}
                      {MOVEMENT_LABELS[m.kind]}
                      {m.reason && <span className="text-muted">· {REASON_LABELS[m.reason]}</span>}
                    </span>
                    {m.note && <div className="text-xs text-muted">{m.note}</div>}
                  </Td>
                  <Td className={cn('text-right font-semibold', inbound ? 'text-brand-600' : 'text-warn-700')}>
                    {inbound ? '+' : '−'}
                    {formatQty(Math.abs(m.quantity), unit)}
                  </Td>
                  <Td className="text-right">{formatQty(m.stock_after, unit)}</Td>
                  <Td className="hidden text-muted lg:table-cell">{m.worker_id ? people.get(m.worker_id) ?? '—' : '—'}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      {rows.length >= 500 && <p className="px-5 py-3 text-sm text-muted">Shfaqen 500 lëvizjet e fundit. Ngushto periudhën ose zgjidh produktin.</p>}

      <AdjustDialog open={adjustOpen} products={products} initial={selected ?? null} onClose={() => setAdjustOpen(false)} />
    </Card>
  )
}

const REASONS: AdjustReason[] = ['expired', 'damage', 'loss', 'own_use', 'return_supplier', 'correction', 'other']

export function AdjustDialog({ open, products, initial, onClose }: { open: boolean; products: Product[]; initial: Product | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [product, setProduct] = useState<Product | null>(initial)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<AdjustReason>('expired')
  const [direction, setDirection] = useState<'out' | 'in'>('out')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setProduct(initial)
    setQty('')
    setReason('expired')
    setDirection('out')
    setNote('')
    setError(null)
  }
  useEffect(() => {
    if (open) setProduct(initial)
  }, [open, initial])

  const save = useMutation({
    mutationFn: () => {
      const n = Number(qty.replace(',', '.'))
      const signed = reason === 'correction' && direction === 'in' ? n : -n
      return adjustStock({ product_id: product!.id, quantity: signed, reason, note })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
      reset()
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const submit = () => {
    if (!product) return setError('Zgjidh produktin')
    const n = Number(qty.replace(',', '.'))
    if (!(n > 0)) return setError('Shkruaj sasinë')
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Shkarkim nga stoku"
      subtitle="Skadim, dëmtim, humbje ose korrigjim i stokut"
      width="md:max-w-[520px]"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Regjistro
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {product ? (
          <div className="flex items-center justify-between rounded-ctl border border-line px-3 py-2.5">
            <div>
              <div className="font-semibold">{product.name}</div>
              <div className="text-sm text-muted">Stoku tani: {formatQty(product.stock, product.unit)}</div>
            </div>
            <button type="button" className="text-sm font-medium text-brand-600" onClick={() => setProduct(null)}>
              Ndrysho
            </button>
          </div>
        ) : (
          <ProductPicker products={products} onPick={setProduct} placeholder="Skano ose kërko produktin" autoFocus />
        )}
        <Select label="Arsyeja" value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)} options={REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }))} />
        {reason === 'correction' && (
          <Tabs
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'out', label: 'Zbrit nga stoku' },
              { value: 'in', label: 'Shto në stok' },
            ]}
          />
        )}
        <Input
          label={`Sasia${product ? ` (${formatQty(0, product.unit).replace(/^0 /, '')})` : ''}`}
          inputMode="decimal"
          type="number"
          min="0"
          step={product?.unit === 'kg' ? '0.001' : '1'}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Input label="Shënim" value={note} onChange={(e) => setNote(e.target.value)} placeholder="p.sh. Jogurt 500g skadoi më 01.11" />
        {error && <p className="text-sm text-warn-700">{error}</p>}
      </div>
    </Dialog>
  )
}
