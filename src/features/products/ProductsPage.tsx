import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Select, Table, Td, Th } from '@/components/ui'
import { businessType, hasModule } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatQty, unitLabel } from '@/lib/units'
import type { VatCode } from '@/lib/vat'
import { useMediaQuery } from '@/lib/useMediaQuery'
import {
  CatalogNotMigrated,
  createCategory,
  deleteCategory,
  fetchCategories,
  fetchProducts,
  margin,
  renameCategory,
  saveProduct,
  setProductActive,
  stockLevel,
  type Category,
  type Product,
  type ProductInput,
} from './api'
import { ImportDialog } from './ImportDialog'
import { ProductForm } from './ProductForm'

const PAGE_SIZE = 25
type StockFilter = 'all' | 'low' | 'out' | 'archived'
type Editing = { mode: 'new' } | { mode: 'edit'; product: Product } | null

function StockBadge({ p }: { p: Product }) {
  const level = stockLevel(p)
  const text = formatQty(p.stock, p.unit)
  if (level === 'critical') return <Badge tone="warn">{text}</Badge>
  if (level === 'low') return <Badge tone="amber">{text}</Badge>
  return <span className="tabular-nums">{text}</span>
}

export function ProductsPage() {
  const { business } = useBusiness()
  const info = businessType(business.type)
  const showStock = hasModule(business.type, 'stock')
  const showBarcode = hasModule(business.type, 'barcode')
  const qc = useQueryClient()
  const wide = useMediaQuery('(min-width: 1024px)')

  const products = useQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true) })
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories })

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | 'all' | 'none'>('all')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [vatFilter, setVatFilter] = useState<VatCode | 'all'>('all')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Editing>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const all = products.data ?? []
  const cats = categories.data ?? []
  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats])
  const activeProducts = useMemo(() => all.filter((p) => p.active), [all])

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of activeProducts) m.set(p.category_id ?? 'none', (m.get(p.category_id ?? 'none') ?? 0) + 1)
    return m
  }, [activeProducts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((p) => {
      if (stockFilter === 'archived' ? p.active : !p.active) return false
      if (categoryId === 'none' ? p.category_id : categoryId !== 'all' && p.category_id !== categoryId) return false
      if (vatFilter !== 'all' && p.vat_code !== vatFilter) return false
      if (stockFilter === 'low' && !['low', 'critical'].includes(stockLevel(p))) return false
      if (stockFilter === 'out' && (p.kind === 'service' || p.stock > 0)) return false
      if (q && !(p.name.toLowerCase().includes(q) || p.barcode?.includes(q) || p.substance?.toLowerCase().includes(q))) return false
      return true
    })
  }, [all, search, categoryId, stockFilter, vatFilter])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['categories'] })
  }

  const save = useMutation({
    mutationFn: (input: ProductInput) => saveProduct(input),
    onSuccess: () => {
      setEditing(null)
      setSaveError(null)
      invalidate()
    },
    onError: (e: Error) => setSaveError(e.message),
  })

  const toggleActive = useMutation({
    mutationFn: (p: Product) => setProductActive(p.id, !p.active),
    onSuccess: () => {
      setEditing(null)
      invalidate()
    },
    onError: (e: Error) => setSaveError(e.message),
  })

  const resetPage = () => setPage(0)
  const openNew = () => {
    setSaveError(null)
    setEditing({ mode: 'new' })
  }
  const openEdit = (p: Product) => {
    setSaveError(null)
    setEditing({ mode: 'edit', product: p })
  }

  if (products.error instanceof CatalogNotMigrated || categories.error instanceof CatalogNotMigrated) {
    return (
      <>
        <PageHeader title={info.terms.catalog} />
        <div className="px-4 py-5 md:px-8 md:py-0">
          <Card>
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="Katalogu nuk është aktivizuar ende"
              text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0001_catalog.sql në Supabase."
            />
          </Card>
        </div>
      </>
    )
  }

  const form = editing && (
    <ProductForm
      key={editing.mode === 'edit' ? editing.product.id : 'new'}
      product={editing.mode === 'edit' ? editing.product : null}
      businessType={business.type}
      categories={cats}
      defaultCategoryId={categoryId !== 'all' && categoryId !== 'none' ? categoryId : null}
      saving={save.isPending || toggleActive.isPending}
      error={saveError}
      onSave={(input) => save.mutate(input)}
      onCancel={() => setEditing(null)}
      onToggleActive={(p) => toggleActive.mutate(p)}
    />
  )

  const subtitle = products.isLoading
    ? 'Duke ngarkuar…'
    : `${activeProducts.length} ${info.terms.items} në ${cats.length} ${cats.length === 1 ? 'kategori' : 'kategori'}`

  return (
    <>
      <PageHeader
        eyebrow={<span className="md:hidden">{subtitle}</span>}
        title={info.terms.catalog}
        actions={
          <>
            <Button variant="secondary" className="hidden md:inline-flex" onClick={() => setImportOpen(true)}>
              Importo nga Excel
            </Button>
            <Button className="hidden md:inline-flex" onClick={openNew}>
              <Plus className="h-4 w-4" /> {info.terms.newItem}
            </Button>
          </>
        }
      />
      <p className="-mt-5 hidden px-8 pb-5 text-muted md:block">{subtitle}</p>

      <div className="flex gap-5 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-0">
        {/* Categories (desktop) */}
        <div className="hidden w-[200px] shrink-0 xl:block">
          <CategoryPanel
            categories={cats}
            counts={catCounts}
            total={activeProducts.length}
            selected={categoryId}
            onSelect={(id) => {
              setCategoryId(id)
              resetPage()
            }}
            onChanged={invalidate}
          />
        </div>

        {/* List */}
        <div className="min-w-0 flex-1">
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    resetPage()
                  }}
                  placeholder={business.type === 'pharmacy' ? 'Kërko sipas emrit, substancës ose barkodit' : 'Kërko sipas emrit ose barkodit'}
                  className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:hidden">
                {[{ id: 'all', name: 'Të gjitha' }, ...cats].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(c.id)
                      resetPage()
                    }}
                    className={cn(
                      'h-11 shrink-0 whitespace-nowrap rounded-full border px-5 text-[15px] font-medium',
                      categoryId === c.id ? 'border-ink bg-ink text-white' : 'border-field bg-white',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="hidden md:block xl:hidden">
                  <Select
                    aria-label="Kategoria"
                    value={categoryId}
                    onChange={(e) => {
                      setCategoryId(e.target.value)
                      resetPage()
                    }}
                    className="h-10 w-auto"
                    options={[
                      { value: 'all', label: 'Të gjitha kategoritë' },
                      ...cats.map((c) => ({ value: c.id, label: `${c.name} (${catCounts.get(c.id) ?? 0})` })),
                      { value: 'none', label: 'Pa kategori' },
                    ]}
                  />
                </div>
                <Select
                  aria-label="Stoku"
                  value={stockFilter}
                  onChange={(e) => {
                    setStockFilter(e.target.value as StockFilter)
                    resetPage()
                  }}
                  className="h-10 w-auto"
                  options={[
                    { value: 'all', label: 'Aktive' },
                    ...(showStock
                      ? [
                          { value: 'low', label: 'Stok i ulët' },
                          { value: 'out', label: 'Pa stok' },
                        ]
                      : []),
                    { value: 'archived', label: 'Të arkivuara' },
                  ]}
                />
                <Select
                  aria-label="TVSH"
                  value={vatFilter}
                  onChange={(e) => {
                    setVatFilter(e.target.value as VatCode | 'all')
                    resetPage()
                  }}
                  className="h-10 w-auto"
                  options={[
                    { value: 'all', label: 'TVSH: të gjitha' },
                    { value: 'E', label: 'E – 18%' },
                    { value: 'D', label: 'D – 8%' },
                    { value: 'C', label: 'C – 0%' },
                    { value: 'A', label: 'A – e liruar' },
                  ]}
                />
              </div>
            </div>

            {products.isLoading ? (
              <div className="px-6 py-12 text-center text-muted">Duke ngarkuar…</div>
            ) : products.isError ? (
              <EmptyState title="Lista nuk u ngarkua" text={(products.error as Error).message} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Package className="h-6 w-6" />}
                title={all.length === 0 ? `Ende pa ${info.terms.items}` : 'Asgjë nuk përputhet me kërkimin'}
                text={all.length === 0 ? 'Shto të parin ose importoji të gjitha nga Excel.' : undefined}
                action={
                  all.length === 0 && (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setImportOpen(true)}>
                        Importo nga Excel
                      </Button>
                      <Button onClick={openNew}>{info.terms.newItem}</Button>
                    </div>
                  )
                }
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <thead className="bg-[#F8FAF8]">
                      <tr>
                        {showBarcode && <Th className="pl-4">Barkodi</Th>}
                        <Th className={cn(!showBarcode && 'pl-4')}>Emri</Th>
                        <Th className="hidden 2xl:table-cell">Kategoria</Th>
                        <Th className="text-right">Ç. blerjes</Th>
                        <Th className="text-right">Ç. shitjes</Th>
                        <Th className="text-right">Marzha</Th>
                        <Th>TVSH</Th>
                        {showStock && <Th className="text-right">Stoku</Th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => {
                        const m = margin(p.sale_price, p.purchase_price)
                        const selected = editing?.mode === 'edit' && editing.product.id === p.id
                        return (
                          <tr
                            key={p.id}
                            onClick={() => openEdit(p)}
                            className={cn('cursor-pointer hover:bg-[#F8FAF8]', selected && 'bg-brand-100/60 hover:bg-brand-100/60')}
                          >
                            {showBarcode && <Td className="pl-4 text-muted">{p.barcode ?? '—'}</Td>}
                            <Td className={cn(!showBarcode && 'pl-4')}>
                              <div className="font-semibold">{p.name}</div>
                              <div className="text-xs text-muted 2xl:hidden">
                                {[p.category_id ? catName.get(p.category_id) : null, p.kind === 'service' ? (p.duration_min ? `${p.duration_min} min` : 'shërbim') : unitLabel(p.unit)]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </Td>
                            <Td className="hidden 2xl:table-cell">{p.category_id ? catName.get(p.category_id) : '—'}</Td>
                            <Td className="text-right text-muted">{p.purchase_price ? formatEUR(p.purchase_price) : '—'}</Td>
                            <Td className="text-right font-semibold">{formatEUR(p.sale_price)}</Td>
                            <Td className={cn('text-right', m != null && m < 0 && 'text-warn-700')}>{m == null ? '—' : `${(m * 100).toFixed(1)}%`}</Td>
                            <Td>{p.vat_code}</Td>
                            {showStock && <Td className="text-right">{p.kind === 'service' ? '—' : <StockBadge p={p} />}</Td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </Table>
                </div>

                {/* Phone cards */}
                <ul className="flex flex-col gap-2.5 bg-bg p-3 md:hidden">
                  {rows.map((p) => {
                    const m = margin(p.sale_price, p.purchase_price)
                    return (
                      <li key={p.id}>
                        <button type="button" onClick={() => openEdit(p)} className="flex w-full items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3.5 text-left">
                          <div className="min-w-0">
                            <div className="truncate text-[17px] font-semibold">{p.name}</div>
                            <div className="truncate text-sm text-muted">
                              {[p.category_id ? catName.get(p.category_id) : null, m != null ? `Marzha ${(m * 100).toFixed(1)}%` : null].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[17px] font-bold tabular-nums">{formatEUR(p.sale_price)}</div>
                            <div className="text-sm text-muted">
                              {p.kind === 'service' ? (p.duration_min ? `${p.duration_min} min` : 'shërbim') : showStock ? <StockBadge p={p} /> : unitLabel(p.unit)}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>

                <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
                  <span>
                    {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + rows.length} nga {filtered.length}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
                      ‹
                    </Button>
                    <span className="flex h-9 min-w-9 items-center justify-center rounded-ctl bg-ink px-3 font-semibold text-white">{current + 1}</span>
                    <Button size="sm" variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                      ›
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Form (desktop side panel) */}
        {editing && wide && (
          <div className="w-[340px] shrink-0">
            <Card className="sticky top-6 max-h-[calc(100dvh-48px)] overflow-y-auto p-5">{form}</Card>
          </div>
        )}
      </div>

      {/* Form as a sheet on phones/tablets */}
      <Dialog open={Boolean(editing) && !wide} onClose={() => setEditing(null)} width="md:max-w-[480px]">
        {form}
      </Dialog>

      {/* Phone floating button */}
      {!editing && (
        <button
          type="button"
          onClick={openNew}
          className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 items-center gap-2 rounded-2xl bg-brand-600 px-5 text-[17px] font-semibold text-white shadow-lg shadow-brand-600/30 md:hidden"
        >
          <Plus className="h-5 w-5" /> {info.terms.newItem}
        </button>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={invalidate} services={business.type === 'salon'} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Category list with add / rename / delete
// ---------------------------------------------------------------------------
function CategoryPanel({
  categories,
  counts,
  total,
  selected,
  onSelect,
  onChanged,
}: {
  categories: Category[]
  counts: Map<string, number>
  total: number
  selected: string
  onSelect: (id: string) => void
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      onChanged()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  const item = (id: string, label: string, count: number) => (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        'flex min-h-[40px] w-full items-center justify-between gap-2 rounded-ctl px-3 text-left text-[15px]',
        selected === id ? 'bg-brand-100 font-semibold text-ink' : 'hover:bg-bg',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-muted">{count}</span>
    </button>
  )

  return (
    <Card className="p-3">
      <div className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Kategoritë</div>
      <div className="flex flex-col gap-0.5">
        {item('all', 'Të gjitha', total)}
        {categories.map((c) =>
          editId === c.id ? (
            <form
              key={c.id}
              className="flex items-center gap-1"
              onSubmit={async (e) => {
                e.preventDefault()
                if (editName.trim() && (await run(() => renameCategory(c.id, editName)))) setEditId(null)
              }}
            >
              <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 min-w-0 flex-1 rounded-ctl border border-field px-2" />
              <button type="submit" aria-label="Ruaj" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-bg">
                <Check className="h-4 w-4 text-brand-600" />
              </button>
              <button type="button" aria-label="Fshi" onClick={() => setConfirmDelete(c)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-bg">
                <Trash2 className="h-4 w-4 text-warn-700" />
              </button>
              <button type="button" aria-label="Anulo" onClick={() => setEditId(null)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-bg">
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <div key={c.id} className="group relative">
              {item(c.id, c.name, counts.get(c.id) ?? 0)}
              <button
                type="button"
                aria-label={`Ndrysho ${c.name}`}
                onClick={() => {
                  setEditId(c.id)
                  setEditName(c.name)
                }}
                className="absolute right-8 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-white/80 hover:bg-white group-hover:flex"
              >
                <Pencil className="h-3.5 w-3.5 text-muted" />
              </button>
            </div>
          ),
        )}
        {(counts.get('none') ?? 0) > 0 && item('none', 'Pa kategori', counts.get('none') ?? 0)}
      </div>

      {adding ? (
        <form
          className="mt-2 flex items-center gap-1"
          onSubmit={async (e) => {
            e.preventDefault()
            if (name.trim() && (await run(() => createCategory(name)))) {
              setName('')
              setAdding(false)
            }
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Emri" className="h-10 min-w-0 flex-1 rounded-ctl border border-field px-2" />
          <button type="submit" aria-label="Shto" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-bg">
            <Check className="h-4 w-4 text-brand-600" />
          </button>
          <button type="button" aria-label="Anulo" onClick={() => setAdding(false)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-bg">
            <X className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 flex h-10 w-full items-center justify-center rounded-ctl border border-dashed border-field text-sm font-medium text-brand-600 hover:bg-[#F0F7F3]"
        >
          + Kategori e re
        </button>
      )}
      {error && <p className="mt-2 px-1 text-sm text-warn-700">{error}</p>}

      <Dialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={`Fshi kategorinë "${confirmDelete?.name}"?`}
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Anulo
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const c = confirmDelete
                if (!c) return
                if (await run(() => deleteCategory(c.id))) {
                  setConfirmDelete(null)
                  setEditId(null)
                  if (selected === c.id) onSelect('all')
                }
              }}
            >
              Fshi
            </Button>
          </div>
        }
      >
        <p className="text-[15px] text-muted">Produktet e kësaj kategorie nuk fshihen; mbeten "Pa kategori".</p>
      </Dialog>
    </Card>
  )
}
