import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatQty } from '@/lib/units'
import { assignLot, expiryStatus, expiryText, formatExpiry, type ExpiryStatus, type Lot } from '@/lib/lots'
import type { Product } from '@/features/products/api'
import { adjustStock } from './api'

type Filter = 'all' | 'expired' | 'soon' | 'near' | 'nolot'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Të gjitha' },
  { value: 'expired', label: 'Të skaduara' },
  { value: 'soon', label: '≤ 30 ditë' },
  { value: 'near', label: '≤ 90 ditë' },
  { value: 'nolot', label: 'Pa seri' },
]

function StatusBadge({ s, expiresOn }: { s: ExpiryStatus; expiresOn: string | null }) {
  const text = expiryText(expiresOn)
  if (s === 'expired') return <Badge tone="warn">{text}</Badge>
  if (s === 'soon') return <Badge tone="warn">{text}</Badge>
  if (s === 'near') return <Badge tone="amber">{text}</Badge>
  return <Badge tone="neutral">{text}</Badge>
}

/** Pharmacy: lots by expiry, write-off of expired lots, lots for stock that has none. */
export function LotsTab({ products, lots, loading }: { products: Product[]; lots: Lot[]; loading: boolean }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [writeOff, setWriteOff] = useState<Lot | null>(null)
  const [assign, setAssign] = useState<Product | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  // Stock without a lot = stock − lots of that product.
  const noLot = useMemo(() => {
    const inLots = new Map<string, number>()
    for (const l of lots) inLots.set(l.product_id, (inLots.get(l.product_id) ?? 0) + l.quantity)
    return products
      .map((p) => ({ p, free: Math.round((p.stock - (inLots.get(p.id) ?? 0)) * 1000) / 1000 }))
      .filter((x) => x.free > 0)
  }, [products, lots])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return lots
      .map((l) => ({ l, p: byId.get(l.product_id), st: expiryStatus(l.expires_on) }))
      .filter((r) => r.p)
      .filter((r) => filter === 'all' || (filter === 'near' ? ['soon', 'near'].includes(r.st) : r.st === filter))
      .filter((r) => !s || r.p!.name.toLowerCase().includes(s) || r.l.lot_no?.toLowerCase().includes(s) || r.p!.substance?.toLowerCase().includes(s))
  }, [lots, byId, filter, q])

  const counts = useMemo(() => {
    const c = { expired: 0, soon: 0, near: 0 }
    for (const l of lots) {
      const st = expiryStatus(l.expires_on)
      if (st === 'expired') c.expired++
      else if (st === 'soon') c.soon++
      else if (st === 'near') c.near++
    }
    return c
  }, [lots])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['lots'] })
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['pos-products'] })
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[19px] font-semibold">Seritë & afatet e skadimit</h2>
          <p className="text-sm text-muted">Arka shet gjithmonë nga seria që skadon e para (FEFO); seritë e skaduara nuk shiten para të vlefshmeve.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn('h-10 rounded-full border px-4 text-sm font-medium', filter === f.value ? 'border-ink bg-ink text-white' : 'border-field bg-white')}
            >
              {f.label}
              {f.value === 'expired' && counts.expired > 0 && ` · ${counts.expired}`}
              {f.value === 'soon' && counts.soon > 0 && ` · ${counts.soon}`}
              {f.value === 'near' && counts.soon + counts.near > 0 && ` · ${counts.soon + counts.near}`}
              {f.value === 'nolot' && noLot.length > 0 && ` · ${noLot.length}`}
            </button>
          ))}
        </div>
        <Input aria-label="Kërko" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko barin, substancën ose serinë" />
      </div>
      {notice && <p className="mx-5 mt-3 rounded-ctl bg-brand-100 px-4 py-2.5 text-sm font-medium text-brand-600">{notice}</p>}

      {loading ? (
        <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
      ) : filter === 'nolot' ? (
        noLot.length === 0 ? (
          <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="I gjithë stoku ka seri" />
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {noLot
              .filter((x) => !q.trim() || x.p.name.toLowerCase().includes(q.trim().toLowerCase()))
              .map(({ p, free }) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="text-sm text-muted">{formatQty(free, p.unit)} pa seri dhe pa afat</div>
                  </div>
                  <Button variant="secondary" onClick={() => setAssign(p)}>
                    Cakto serinë
                  </Button>
                </li>
              ))}
          </ul>
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title={lots.length === 0 ? 'Ende nuk ka seri' : 'Asgjë këtu'}
          text={lots.length === 0 ? 'Seritë krijohen kur konfirmon një hyrje malli me serinë dhe afatin e skadimit.' : undefined}
        />
      ) : (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {rows.map(({ l, p, st }) => (
            <li key={l.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3', st === 'expired' && 'bg-[#FFF7F2]')}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p!.name}</div>
                <div className="text-sm text-muted">
                  Seria {l.lot_no ?? '—'}
                  {l.expires_on && ` · ${formatExpiry(l.expires_on)}`}
                  {p!.substance && ` · ${p!.substance}`}
                </div>
              </div>
              <StatusBadge s={st} expiresOn={l.expires_on} />
              <div className="w-20 text-right font-semibold tabular-nums">{formatQty(l.quantity, p!.unit)}</div>
              {st === 'expired' && (
                <Button variant="secondary" className="text-warn-700" onClick={() => setWriteOff(l)}>
                  Shkarko
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <WriteOffDialog
        lot={writeOff}
        product={writeOff ? byId.get(writeOff.product_id) : undefined}
        onClose={() => setWriteOff(null)}
        onDone={(msg) => {
          setWriteOff(null)
          setNotice(msg)
          refresh()
        }}
      />
      <AssignDialog
        product={assign}
        free={assign ? noLot.find((x) => x.p.id === assign.id)?.free ?? 0 : 0}
        onClose={() => setAssign(null)}
        onDone={(msg) => {
          setAssign(null)
          setNotice(msg)
          refresh()
        }}
      />
    </Card>
  )
}

function WriteOffDialog({ lot, product, onClose, onDone }: { lot: Lot | null; product?: Product; onClose: () => void; onDone: (msg: string) => void }) {
  const m = useMutation({
    mutationFn: () => adjustStock({ product_id: lot!.product_id, quantity: -lot!.quantity, reason: 'expired', lot_id: lot!.id, note: `Seria ${lot!.lot_no ?? '—'}` }),
    onSuccess: () => onDone(`U shkarkuan ${formatQty(lot!.quantity, product?.unit ?? 'cope')} të skaduara nga "${product?.name}"`),
  })
  if (!lot || !product) return null
  return (
    <Dialog open onClose={onClose} title="Shkarko serinë e skaduar" width="md:max-w-[440px]">
      <div className="flex flex-col gap-4">
        <p className="text-[15px]">
          <b>{product.name}</b> · seria {lot.lot_no ?? '—'} · {lot.expires_on && formatExpiry(lot.expires_on)}
          <br />
          Del nga stoku: <b className="tabular-nums">{formatQty(lot.quantity, product.unit)}</b> (arsyeja: skaduar). Shkruhet te lëvizjet e stokut dhe te regjistri.
        </p>
        {m.error && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{(m.error as Error).message}</p>}
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" size="lg" onClick={onClose}>
            Anulo
          </Button>
          <Button size="lg" loading={m.isPending} onClick={() => m.mutate()}>
            Shkarko
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function AssignDialog({ product, free, onClose, onDone }: { product: Product | null; free: number; onClose: () => void; onDone: (msg: string) => void }) {
  const [lotNo, setLotNo] = useState('')
  const [exp, setExp] = useState('')
  const [qty, setQty] = useState('')
  const m = useMutation({
    mutationFn: () => assignLot({ product_id: product!.id, lot_no: lotNo.trim() || undefined, expires_on: exp || undefined, quantity: Number(qty.replace(',', '.')) || free }),
    onSuccess: () => {
      setLotNo('')
      setExp('')
      setQty('')
      onDone(`Seria u caktua për "${product?.name}"`)
    },
  })
  if (!product) return null
  return (
    <Dialog open onClose={onClose} title="Cakto serinë" subtitle={`${product.name} · ${formatQty(free, product.unit)} pa seri`} width="md:max-w-[440px]">
      <div className="flex flex-col gap-3">
        <Input label="Seria / LOT" value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="p.sh. B23K118" />
        <Input label="Skadon më" type="date" value={exp} onChange={(e) => setExp(e.target.value)} />
        <Input label="Sasia" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={String(free)} />
        <p className="text-xs text-muted">Stoku nuk ndryshon – vetëm i jepet seria dhe afati.</p>
        {m.error && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{(m.error as Error).message}</p>}
        <Button size="lg" block loading={m.isPending} disabled={!lotNo.trim() && !exp} onClick={() => m.mutate()}>
          Ruaj
        </Button>
      </div>
    </Dialog>
  )
}

/** Sidebar card on the stock page: expired and soon-to-expire lots. */
export function ExpiryCard({ lots, onOpen }: { lots: Lot[]; onOpen: () => void }) {
  const expired = lots.filter((l) => expiryStatus(l.expires_on) === 'expired').length
  const soon = lots.filter((l) => ['soon', 'near'].includes(expiryStatus(l.expires_on))).length
  if (!expired && !soon) {
    return (
      <Card className="p-5">
        <div className="font-semibold">Afatet në rregull</div>
        <p className="mt-1 text-sm text-muted">Asnjë seri nuk skadon brenda 90 ditëve.</p>
      </Card>
    )
  }
  return (
    <button type="button" onClick={onOpen} className={cn('rounded-card border p-5 text-left', expired ? 'border-[#F3C9AE] bg-[#FFF4EC]' : 'border-amber-700/20 bg-amber-100')}>
      <div className={cn('flex items-center gap-2 text-[17px] font-semibold', expired ? 'text-warn-700' : 'text-amber-700')}>
        <CalendarClock className="h-5 w-5" /> Afatet e skadimit
      </div>
      <ul className="mt-2 text-[15px]">
        {expired > 0 && <li>{expired} seri të skaduara – shkarkoji nga stoku</li>}
        {soon > 0 && <li>{soon} seri skadojnë brenda 90 ditëve</li>}
      </ul>
      <span className="mt-2 block text-sm font-semibold">Shiko seritë →</span>
    </button>
  )
}
