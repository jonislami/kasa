import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR, round2 } from '@/lib/money'
import { unitLabel } from '@/lib/units'
import { fetchCategories, fetchProducts } from '@/features/products/api'
import { ProductPicker } from '@/features/stock/ProductPicker'
import {
  fetchCategoryStations,
  fetchModifiers,
  fetchRecipe,
  saveModifiers,
  saveRecipe,
  setCategoryStation,
  STATION_LABELS,
  type ModifierGroup,
  type Station,
} from './api'

const num = (s: string) => {
  const n = Number(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Restaurant menu item: kitchen/bar station, recipe (ingredient stock) and modifiers. */
export function MenuItemPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const products = useQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true) })
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories })
  const stations = useQuery({ queryKey: ['category-stations'], queryFn: fetchCategoryStations })
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => fetchRecipe(id) })
  const mods = useQuery({ queryKey: ['modifiers', id], queryFn: () => fetchModifiers(id) })
  const item = products.data?.find((p) => p.id === id)
  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data])

  const [lines, setLines] = useState<{ ingredient_id: string; quantity: string }[]>([])
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (recipe.data) setLines(recipe.data.map((r) => ({ ingredient_id: r.ingredient_id, quantity: String(r.quantity) })))
  }, [recipe.data])
  useEffect(() => {
    if (mods.data) setGroups(mods.data)
  }, [mods.data])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(t)
  }, [notice])

  const ingredients = useMemo(
    () => (products.data ?? []).filter((p) => p.active && p.kind === 'product' && p.id !== id && !p.has_recipe && !p.addon_of && !p.has_variants),
    [products.data, id],
  )
  const cost = round2(lines.reduce((s, l) => s + num(l.quantity) * (byId.get(l.ingredient_id)?.purchase_price ?? 0), 0))
  const margin = item && item.sale_price > 0 ? (item.sale_price - cost) / item.sale_price : null

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['menu'] })
  }
  const saveR = useMutation({
    mutationFn: () => saveRecipe(id, lines.filter((l) => num(l.quantity) > 0).map((l) => ({ ingredient_id: l.ingredient_id, quantity: num(l.quantity) }))),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: ['recipe', id] })
      setNotice(lines.length ? 'Receta u ruajt – shitja zbret stokun e përbërësve' : 'Receta u hoq')
    },
  })
  const saveM = useMutation({
    mutationFn: () => saveModifiers(id, groups),
    onSuccess: (g) => {
      setGroups(g)
      invalidate()
      void qc.invalidateQueries({ queryKey: ['modifiers', id] })
      setNotice('Opsionet u ruajtën')
    },
  })
  const station = useMutation({
    mutationFn: (s: Station | null) => setCategoryStation(item!.category_id!, s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['category-stations'] })
      setNotice('U ruajt')
    },
  })

  const setGroup = (gi: number, patch: Partial<ModifierGroup>) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, ...patch } : g)))
  const setOption = (gi: number, oi: number, patch: { name?: string; price?: number }) =>
    setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : g)))

  if (products.isLoading) return <p className="px-8 py-12 text-muted">Duke ngarkuar…</p>
  if (!item) return <p className="px-8 py-12 text-muted">Artikulli nuk u gjet.</p>
  const cat = categories.data?.find((c) => c.id === item.category_id)
  const st = item.category_id ? stations.data?.get(item.category_id) ?? null : null

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/produktet" className="inline-flex items-center gap-1 font-semibold text-brand-600">
            <ChevronLeft className="h-4 w-4" /> Menuja
          </Link>
        }
        title={item.name}
      />
      <div className="flex flex-col gap-5 px-4 pb-28 pt-2 md:px-8 md:pb-8">
        <p className="-mt-3 text-muted">
          {formatEUR(item.sale_price)}
          {cat && ` · ${cat.name}`}
        </p>
        {notice && <div className="rounded-card border border-brand-600/30 bg-brand-100 px-4 py-3 font-medium text-brand-600">{notice}</div>}

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Ku dërgohet porosia</h2>
          {item.category_id ? (
            <>
              <p className="mt-1 text-sm text-muted">Vlen për gjithë kategorinë "{cat?.name}". Fletëporosia del në ekranin dhe printerin e asaj stacioni.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {([['kitchen', STATION_LABELS.kitchen], ['bar', STATION_LABELS.bar], [null, 'Pa fletëporosi']] as const).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={station.isPending}
                    onClick={() => station.mutate(v)}
                    className={cn('h-11 rounded-full border px-5 font-medium', st === v ? 'border-ink bg-ink text-white' : 'border-field bg-white')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {station.error && <p className="mt-2 text-sm text-warn-700">{(station.error as Error).message}</p>}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">Vendose artikullin në një kategori (p.sh. Pije, Ushqim) dhe zgjidh kuzhinën ose barin për të.</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[17px] font-semibold">Receta</h2>
              <p className="text-sm text-muted">Sa përbërës shkon për 1 {unitLabel(item.unit)}. Kur shitet, zbritet stoku i përbërësve.</p>
            </div>
            <div className="text-right text-sm">
              <div>
                Kosto: <b className="tabular-nums">{formatEUR(cost)}</b>
              </div>
              {margin !== null && lines.length > 0 && <div className={cn('tabular-nums', margin < 0.3 ? 'text-warn-700' : 'text-muted')}>Marzha {Math.round(margin * 100)}%</div>}
            </div>
          </div>
          <div className="mt-3">
            <ProductPicker
              products={ingredients}
              onPick={(p) => setLines((ls) => (ls.some((l) => l.ingredient_id === p.id) ? ls : [...ls, { ingredient_id: p.id, quantity: p.unit === 'kg' ? '0.1' : '1' }]))}
            />
          </div>
          {lines.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {lines.map((l, i) => {
                const ing = byId.get(l.ingredient_id)
                return (
                  <li key={l.ingredient_id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{ing?.name ?? '—'}</div>
                      <div className="text-xs text-muted">
                        {formatEUR(ing?.purchase_price ?? 0)} / {unitLabel(ing?.unit ?? 'cope')} · në stok {ing?.stock ?? 0}
                      </div>
                    </div>
                    <input
                      aria-label={`Sasia ${ing?.name}`}
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                      className="h-11 w-24 rounded-ctl border border-field px-3 text-right tabular-nums"
                    />
                    <span className="w-10 text-sm text-muted">{unitLabel(ing?.unit ?? 'cope')}</span>
                    <button type="button" aria-label="Hiqe" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-warn-700">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {saveR.error && <p className="mt-2 text-sm text-warn-700">{(saveR.error as Error).message}</p>}
          <div className="mt-3 flex justify-end">
            <Button loading={saveR.isPending} disabled={!recipe.data} onClick={() => saveR.mutate()}>
              Ruaj recetën
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Opsionet (modifikuesit)</h2>
          <p className="text-sm text-muted">P.sh. "Qumështi": i zakonshëm, bajame +€0.30. Opsionet me çmim dalin si rresht i veçantë në faturë.</p>
          <div className="mt-3 flex flex-col gap-3">
            {groups.map((g, gi) => (
              <div key={gi} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={g.name}
                    onChange={(e) => setGroup(gi, { name: e.target.value })}
                    placeholder="Emri i grupit, p.sh. Qumështi"
                    className="h-11 min-w-0 flex-1 rounded-ctl border border-field px-3 font-semibold"
                  />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={g.multi} onChange={(e) => setGroup(gi, { multi: e.target.checked })} /> Disa njëherësh
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={g.required} onChange={(e) => setGroup(gi, { required: e.target.checked })} /> I detyrueshëm
                  </label>
                  <button type="button" aria-label="Hiq grupin" onClick={() => setGroups((gs) => gs.filter((_, i) => i !== gi))} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-warn-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {g.options.map((o, oi) => (
                    <li key={oi} className="flex items-center gap-2">
                      <input value={o.name} onChange={(e) => setOption(gi, oi, { name: e.target.value })} placeholder="Opsioni" className="h-10 min-w-0 flex-1 rounded-ctl border border-field px-3" />
                      <span className="text-sm text-muted">+€</span>
                      <input
                        inputMode="decimal"
                        value={o.price ? String(o.price) : ''}
                        onChange={(e) => setOption(gi, oi, { price: num(e.target.value) })}
                        placeholder="0.00"
                        className="h-10 w-20 rounded-ctl border border-field px-2 text-right tabular-nums"
                      />
                      <button
                        type="button"
                        aria-label="Hiq opsionin"
                        onClick={() => setGroup(gi, { options: g.options.filter((_, j) => j !== oi) })}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-warn-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => setGroup(gi, { options: [...g.options, { name: '', price: 0 }] })} className="mt-2 text-sm font-semibold text-brand-600">
                  + Opsion
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2">
            <Button variant="secondary" disabled={groups.length >= 10} onClick={() => setGroups((gs) => [...gs, { name: '', multi: false, required: false, options: [{ name: '', price: 0 }] }])}>
              <Plus className="h-4 w-4" /> Grup opsionesh
            </Button>
            <div className="flex items-center gap-2">
              {saveM.error && <span className="text-sm text-warn-700">{(saveM.error as Error).message}</span>}
              <Button loading={saveM.isPending} disabled={!mods.data} onClick={() => saveM.mutate()}>
                Ruaj opsionet
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}

