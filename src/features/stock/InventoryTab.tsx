import { useEffect, useMemo, useState } from 'react'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, X } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatQty } from '@/lib/units'
import type { Category, Product } from '@/features/products/api'
import { confirmInventory, fetchInventoryCounts, fetchInventoryItems, formatDateTime, type InventoryCount } from './api'
import { ProductPicker } from './ProductPicker'

/** An inventory in progress is kept on this device until it is confirmed. */
interface CountDraft {
  title: string
  productIds: string[]
  counted: Record<string, string>
}

const STORAGE_KEY = 'kasa.inventoryDraft'

function loadDraft(): CountDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CountDraft) : null
  } catch {
    return null
  }
}

function storeDraft(d: CountDraft | null) {
  try {
    if (d) localStorage.setItem(STORAGE_KEY, JSON.stringify(d))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
}

function num(s: string | undefined): number | null {
  if (s === undefined || s.trim() === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function InventoryTab({ products, categories, people }: { products: Product[]; categories: Category[]; people: Map<string, string> }) {
  const qc = useQueryClient()
  const [draft, setDraftState] = useState<CountDraft | null>(() => loadDraft())
  const [scope, setScope] = useState<string>('all')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openCount, setOpenCount] = useState<InventoryCount | null>(null)

  const stockProducts = useMemo(() => products.filter((p) => p.active && p.kind === 'product' && !p.has_variants && !p.has_recipe), [products])
  const byId = useMemo(() => new Map(stockProducts.map((p) => [p.id, p])), [stockProducts])
  const counts = useQuery({ queryKey: ['stock', 'inventory'], queryFn: fetchInventoryCounts })

  const setDraft = (fn: (d: CountDraft) => CountDraft | null) =>
    setDraftState((prev) => {
      const next = prev ? fn(prev) : null
      storeDraft(next)
      return next
    })

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const start = () => {
    const list = scope === 'all' ? stockProducts : scope === 'scan' ? [] : stockProducts.filter((p) => (scope === 'none' ? !p.category_id : p.category_id === scope))
    const title = scope === 'all' ? 'I plotë' : scope === 'scan' ? 'Me skanim' : scope === 'none' ? 'Pa kategori' : categories.find((c) => c.id === scope)?.name ?? ''
    const d: CountDraft = { title, productIds: list.map((p) => p.id), counted: {} }
    storeDraft(d)
    setDraftState(d)
    setError(null)
  }

  const lines = useMemo(() => (draft ? draft.productIds.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p)) : []), [draft, byId])
  const filled = lines.filter((p) => num(draft?.counted[p.id]) !== null)
  const diffs = filled
    .map((p) => ({ p, diff: (num(draft!.counted[p.id]) ?? 0) - p.stock }))
    .filter((x) => Math.abs(x.diff) > 0.0005)
  const valueDiff = diffs.reduce((s, x) => s + x.diff * (x.p.purchase_price ?? 0), 0)

  const confirm = useMutation({
    mutationFn: () =>
      confirmInventory({
        title: draft?.title,
        items: filled.map((p) => ({ product_id: p.id, counted: num(draft!.counted[p.id]) ?? 0 })),
      }),
    onSuccess: (r) => {
      storeDraft(null)
      setDraftState(null)
      setConfirmOpen(false)
      setNotice(`Inventarizimi #${r.count_no} u konfirmua: ${r.diff_count} dallime (${formatEUR(r.value_diff)})`)
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
    },
    onError: (e: Error) => {
      setConfirmOpen(false)
      setError(e.message)
    },
  })

  const onScan = (p: Product) =>
    setDraft((d) => ({
      ...d,
      productIds: d.productIds.includes(p.id) ? d.productIds : [p.id, ...d.productIds],
      counted: { ...d.counted, [p.id]: String((num(d.counted[p.id]) ?? 0) + 1) },
    }))

  return (
    <div className="flex flex-col gap-5">
      {notice && <div className="rounded-card border border-brand-600/30 bg-brand-100 px-4 py-3 font-medium text-brand-600">{notice}</div>}

      {!draft ? (
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Inventarizim i ri</h2>
          <p className="mt-1 text-sm text-muted">
            Numëro mallin në raft dhe shkruaj sasinë. Dallimet regjistrohen si lëvizje "Inventarizim". Puna ruhet në këtë pajisje derisa ta konfirmosh.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-[320px]">
              <Select
                label="Çka numërohet"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                options={[
                  { value: 'all', label: `Të gjitha produktet (${stockProducts.length})` },
                  ...categories.map((c) => ({ value: c.id, label: `${c.name} (${stockProducts.filter((p) => p.category_id === c.id).length})` })),
                  { value: 'none', label: 'Pa kategori' },
                  { value: 'scan', label: 'Vetëm ato që skanoj' },
                ]}
              />
            </div>
            <Button onClick={start}>
              <ClipboardCheck className="h-4 w-4" /> Fillo numërimin
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div>
              <h2 className="text-[17px] font-semibold">Inventarizimi: {draft.title}</h2>
              <p className="text-sm text-muted">
                {filled.length} nga {lines.length} të numëruara · {diffs.length} dallime
              </p>
            </div>
            <Button
              variant="ghost"
              className="text-warn-700"
              onClick={() => {
                storeDraft(null)
                setDraftState(null)
              }}
            >
              Hiqe numërimin
            </Button>
          </div>
          <div className="border-b border-line px-5 py-4">
            <ProductPicker products={products} onPick={onScan} placeholder="Skano produktin (+1) ose kërko" />
          </div>
          {lines.length === 0 ? (
            <p className="px-5 py-10 text-center text-muted">Skano produktet një nga një; çdo skanim shton 1.</p>
          ) : (
            <Table>
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-5">Produkti</Th>
                  <Th className="text-right">Në sistem</Th>
                  <Th className="text-right">E numëruar</Th>
                  <Th className="text-right">Dallimi</Th>
                  <Th className="hidden text-right md:table-cell">Vlera</Th>
                  <Th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((p) => {
                  const c = num(draft.counted[p.id])
                  const diff = c === null ? null : c - p.stock
                  return (
                    <tr key={p.id}>
                      <Td className="pl-5">
                        <div className="font-medium">{p.name}</div>
                        {p.barcode && <div className="text-xs text-muted">{p.barcode}</div>}
                      </Td>
                      <Td className="text-right text-muted">{formatQty(p.stock, p.unit)}</Td>
                      <Td className="text-right">
                        <input
                          aria-label={`E numëruar ${p.name}`}
                          inputMode="decimal"
                          type="number"
                          min="0"
                          step={p.unit === 'kg' ? '0.001' : '1'}
                          value={draft.counted[p.id] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, counted: { ...d.counted, [p.id]: e.target.value } }))}
                          className="h-11 w-[96px] rounded-ctl border border-field px-3 text-right tabular-nums focus:border-brand-600 focus:outline-none"
                        />
                      </Td>
                      <Td className={cn('text-right font-semibold', diff === null || Math.abs(diff) < 0.0005 ? 'text-muted' : diff < 0 ? 'text-warn-700' : 'text-brand-600')}>
                        {diff === null ? '—' : Math.abs(diff) < 0.0005 ? '0' : `${diff > 0 ? '+' : '−'}${formatQty(Math.abs(diff), p.unit)}`}
                      </Td>
                      <Td className="hidden text-right md:table-cell">{diff ? formatEUR(diff * (p.purchase_price ?? 0)) : '—'}</Td>
                      <Td className="pr-3">
                        <button
                          type="button"
                          aria-label={`Hiq ${p.name}`}
                          onClick={() =>
                            setDraft((d) => {
                              const counted = { ...d.counted }
                              delete counted[p.id]
                              return { ...d, productIds: d.productIds.filter((x) => x !== p.id), counted }
                            })
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-bg"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="text-[15px]">
              Dallimi në vlerë (me çmim blerjeje): <b className={cn('tabular-nums', valueDiff < 0 && 'text-warn-700')}>{formatEUR(valueDiff)}</b>
              <div className="text-sm text-muted">Produktet pa sasi të shkruar nuk ndryshohen.</div>
            </div>
            <Button disabled={filled.length === 0} onClick={() => setConfirmOpen(true)}>
              Konfirmo inventarizimin
            </Button>
          </div>
          {error && <p className="px-5 pb-4 text-sm text-warn-700">{error}</p>}
        </Card>
      )}

      <Card className="overflow-hidden">
        <h2 className="px-5 pt-5 text-[17px] font-semibold">Inventarizimet e mëparshme</h2>
        {(counts.data ?? []).length === 0 ? (
          <EmptyState title="Ende pa inventarizime" />
        ) : (
          <Table className="mt-3">
            <thead className="bg-[#F8FAF8]">
              <tr>
                <Th className="pl-5">Nr.</Th>
                <Th>Data</Th>
                <Th>Çka</Th>
                <Th className="text-right">Produkte</Th>
                <Th className="text-right">Dallime</Th>
                <Th className="text-right">Vlera</Th>
              </tr>
            </thead>
            <tbody>
              {(counts.data ?? []).map((c) => (
                <tr key={c.id} onClick={() => setOpenCount(c)} className="cursor-pointer hover:bg-[#F8FAF8]">
                  <Td className="pl-5 font-semibold">#{c.count_no}</Td>
                  <Td className="text-muted">{formatDateTime(c.created_at)}</Td>
                  <Td>{c.title ?? '—'}</Td>
                  <Td className="text-right">{c.items_count}</Td>
                  <Td className="text-right">{c.diff_count}</Td>
                  <Td className={cn('text-right font-semibold', c.value_diff < 0 && 'text-warn-700')}>{formatEUR(c.value_diff)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Konfirmo inventarizimin?"
        width="md:max-w-[460px]"
        footer={
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Anulo
            </Button>
            <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Konfirmo
            </Button>
          </div>
        }
      >
        <p className="text-[15px]">
          {filled.length} produkte të numëruara, <b>{diffs.length} me dallim</b>. Stoku i tyre bëhet sa sasia e numëruar. Dallimi në vlerë:{' '}
          <b>{formatEUR(valueDiff)}</b>. Ky veprim nuk kthehet mbrapsht.
        </p>
      </Dialog>

      <CountDialog count={openCount} people={people} onClose={() => setOpenCount(null)} />
    </div>
  )
}

function CountDialog({ count, people, onClose }: { count: InventoryCount | null; people: Map<string, string>; onClose: () => void }) {
  const items = useQuery({ queryKey: ['stock', 'inventory-items', count?.id], queryFn: () => fetchInventoryItems(count!.id), enabled: Boolean(count) })
  if (!count) return null
  const rows = items.data ?? []
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Inventarizimi #${count.count_no}`}
      subtitle={[count.title, formatDateTime(count.created_at), count.created_by ? people.get(count.created_by) : null].filter(Boolean).join(' · ')}
    >
      {loadState(items) === 'offline' ? (
              <OfflineEmpty />
            ) : loadState(items) === 'loading' ? (
        <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="pl-0">Produkti</Th>
              <Th className="text-right">Në sistem</Th>
              <Th className="text-right">E numëruar</Th>
              <Th className="pr-0 text-right">Dallimi</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <Td className="pl-0 font-medium">{i.name}</Td>
                <Td className="text-right text-muted">{formatQty(i.expected, i.unit)}</Td>
                <Td className="text-right">{formatQty(i.counted, i.unit)}</Td>
                <Td className="pr-0 text-right">
                  {i.diff === 0 ? (
                    <span className="text-muted">0</span>
                  ) : (
                    <Badge tone={i.diff < 0 ? 'warn' : 'success'}>
                      {i.diff > 0 ? '+' : '−'}
                      {formatQty(Math.abs(i.diff), i.unit)}
                    </Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-4 text-right text-[15px]">
        Dallimi në vlerë: <b>{formatEUR(count.value_diff)}</b>
      </p>
      {count.note && <Input label="Shënim" value={count.note} readOnly />}
    </Dialog>
  )
}
