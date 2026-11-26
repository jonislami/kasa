import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Pencil, Search, Trash2 } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { formatPrice } from '@/lib/money'
import { unitLabel } from '@/lib/units'
import { deleteProduct } from '@/features/products/api'
import type { PosProduct } from './cart'

const SHOWN = 80

/**
 * The till's "Ndrysho": the owner / manager signed in with the PIN finds a product and changes it (the same form as
 * "+") or deletes it. A product that was already sold is not erased: it leaves the till and stays in the history.
 */
export function ManageProductsDialog({
  open,
  products,
  onClose,
  onEdit,
  onDeleted,
}: {
  open: boolean
  products: PosProduct[]
  onClose: () => void
  onEdit: (id: string) => void
  onDeleted: (p: PosProduct, result: 'deleted' | 'archived') => void
}) {
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<PosProduct | null>(null)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products
      .filter((p) => !p.parent_id)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.barcode ?? '').includes(s))
      .sort((a, b) => a.name.localeCompare(b.name, 'sq'))
  }, [products, q])

  const remove = useMutation({
    mutationFn: (p: PosProduct) => deleteProduct(p.id),
    onSuccess: (result, p) => {
      setConfirm(null)
      onDeleted(p, result)
    },
  })

  const close = () => {
    if (remove.isPending) return
    setConfirm(null)
    remove.reset()
    onClose()
  }

  return (
    <>
      <Dialog open={open && !confirm} onClose={close} title="Ndrysho ose fshi produktet" width="md:max-w-[560px]">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Kërko me emër ose barkod"
              aria-label="Kërko produktin"
              autoFocus
              className="h-[46px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none"
            />
          </div>
          {list.length === 0 ? (
            <p className="py-8 text-center text-muted">Asnjë produkt</p>
          ) : (
            <ul className="-mx-1 flex max-h-[min(60dvh,520px)] flex-col overflow-y-auto">
              {list.slice(0, SHOWN).map((p) => (
                <li key={p.id} className="flex items-center gap-2 border-b border-line px-1 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="truncate text-sm text-muted tabular-nums">
                      {formatPrice(p.sale_price)} / {unitLabel(p.unit)}
                      {p.barcode ? ` · ${p.barcode}` : ''}
                      {p.has_variants ? ' · me variante' : ''}
                    </div>
                  </div>
                  <Button variant="secondary" aria-label={`Ndrysho ${p.name}`} onClick={() => onEdit(p.id)}>
                    <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Ndrysho</span>
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={`Fshi ${p.name}`}
                    className="text-warn-700"
                    onClick={() => {
                      remove.reset()
                      setConfirm(p)
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Fshi</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {list.length > SHOWN && <p className="text-sm text-muted">Shfaqen {SHOWN} nga {list.length} – kërko me emër për të tjerët.</p>}
        </div>
      </Dialog>

      <Dialog
        open={open && Boolean(confirm)}
        onClose={() => !remove.isPending && setConfirm(null)}
        title={`Ta fshij "${confirm?.name ?? ''}"?`}
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={remove.isPending} onClick={() => setConfirm(null)}>
              Anulo
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => confirm && remove.mutate(confirm)}>
              <Trash2 className="h-4 w-4" /> Fshi
            </Button>
          </div>
        }
      >
        <p className="text-[15px]">
          Produkti hiqet nga arka dhe nga lista e produkteve. Nëse është shitur më parë, kuponët e lëshuar dhe historiku i stokut mbeten (ATK i kërkon), prandaj ruhet si joaktiv dhe mund
          të rikthehet nga web-i.
        </p>
        {confirm?.has_variants && <p className="mt-2 text-sm text-muted">Fshihen edhe variantet e tij (madhësitë dhe ngjyrat).</p>}
        {remove.error && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{navigator.onLine ? (remove.error as Error).message : 'Pa internet: produkti fshihet kur të kthehet interneti.'}</p>}
      </Dialog>
    </>
  )
}
