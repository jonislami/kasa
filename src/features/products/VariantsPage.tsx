import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, X } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { VAT_RATES } from '@/lib/vat'
import { fetchCategories, fetchProducts, saveVariants, type Product } from './api'
import { Label, LABEL_SIZES, usePrintLabels, type LabelData, type LabelSize } from './Labels'

const PRESET_COLORS: { name: string; hex: string }[] = [
  { name: 'E zezë', hex: '#111111' },
  { name: 'E bardhë', hex: '#F5F5F5' },
  { name: 'Gri', hex: '#9CA3AF' },
  { name: 'Blu e errët', hex: '#1E3A5F' },
  { name: 'Blu', hex: '#2563EB' },
  { name: 'Kafe', hex: '#7C4A2D' },
  { name: 'Bezhë', hex: '#D6BF9B' },
  { name: 'E kuqe', hex: '#DC2626' },
  { name: 'E gjelbër', hex: '#15803D' },
  { name: 'Rozë', hex: '#EC4899' },
]
const SIZE_PRESETS: Record<string, string[]> = {
  Rroba: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  Xhinse: ['28/32', '29/32', '30/32', '31/32', '32/34', '34/34'],
  Këpucë: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
  Fëmijë: ['2', '4', '6', '8', '10', '12', '14'],
}

/** /produktet/:id – stock per size × colour, barcodes and labels (boutique). */
export function VariantsPage() {
  const { id } = useParams()
  const { business } = useBusiness()
  const qc = useQueryClient()
  const products = useQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true) })
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories })
  const model = products.data?.find((p) => p.id === id)
  const variants = useMemo(() => (products.data ?? []).filter((p) => p.parent_id === id && p.active), [products.data, id])
  const [editOpen, setEditOpen] = useState<'size' | 'color' | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const { print, area } = usePrintLabels()

  const sizes = model?.variant_sizes?.length ? model.variant_sizes : [...new Set(variants.map((v) => v.variant_size).filter(Boolean) as string[])]
  const colors = model?.variant_colors?.length ? model.variant_colors : [...new Set(variants.map((v) => v.variant_color).filter(Boolean) as string[])].map((name) => ({ name, hex: null }))
  const rows = colors.length ? colors : [{ name: null as unknown as string, hex: null }]
  const cols = sizes.length ? sizes : [null as unknown as string]
  const cell = (color: string | null, size: string | null) => variants.find((v) => (v.variant_color ?? null) === (color ?? null) && (v.variant_size ?? null) === (size ?? null))
  const sel = variants.find((v) => v.id === selected) ?? null
  const total = variants.reduce((s, v) => s + v.stock, 0)

  useEffect(() => {
    if (!selected && variants.length) setSelected(variants[0].id)
  }, [variants, selected])

  const save = useMutation({
    mutationFn: (p: { sizes: string[]; colors: { name: string; hex: string | null }[] }) => saveVariants({ product_id: id!, ...p }),
    onSuccess: () => {
      setEditOpen(null)
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['pos-products'] })
    },
  })

  if (products.isLoading) return <p className="px-8 py-10 text-muted">Duke ngarkuar…</p>
  if (!model) {
    return (
      <div className="px-4 py-6 md:px-8">
        <Card>
          <EmptyState title="Artikulli nuk u gjet" action={<Link to="/produktet" className="font-semibold text-brand-600 underline">Kthehu te artikujt</Link>} />
        </Card>
      </div>
    )
  }

  const catName = model.category_id ? categories.data?.find((c) => c.id === model.category_id)?.name : null

  return (
    <div className="px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-6">
      <Link to="/produktet" className="flex items-center gap-1 text-sm font-semibold text-brand-600">
        <ChevronLeft className="h-4 w-4" /> Artikujt
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight md:text-[30px]">{model.name}</h1>
          <p className="text-muted">
            {[catName, formatEUR(model.sale_price), `TVSH ${Math.round(VAT_RATES[model.vat_code] * 100)}%`, `${variants.length} variante`, `${total} copë në stok`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditOpen('size')}>
            <Plus className="h-4 w-4" /> Madhësi
          </Button>
          <Button variant="secondary" onClick={() => setEditOpen('color')}>
            <Plus className="h-4 w-4" /> Ngjyrë
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-5 xl:flex-row xl:items-start">
        <Card className="min-w-0 flex-1 overflow-x-auto p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold">Stoku sipas madhësisë × ngjyrës</h2>
            <div className="flex items-center gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded-full border border-[#F5D98B] bg-amber-100" /> 1 copë
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded-full border border-[#F3C9AE] bg-warn-100" /> Mungon
              </span>
            </div>
          </div>
          {variants.length === 0 ? (
            <EmptyState title="Ende pa variante" text="Shto madhësitë dhe ngjyrat – çdo kombinim merr barkodin dhe stokun e vet." action={<Button onClick={() => setEditOpen('size')}>Shto madhësitë</Button>} />
          ) : (
            <table className="mt-4 border-separate" style={{ borderSpacing: 8 }}>
              <thead>
                <tr>
                  <th />
                  {cols.map((s) => (
                    <th key={s ?? '-'} className="min-w-[84px] text-center text-sm font-semibold text-muted">
                      {s ?? '—'}
                    </th>
                  ))}
                  <th className="px-3 text-center text-sm font-semibold text-muted">Gjithsej</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const rowTotal = cols.reduce((s, size) => s + (cell(c.name, size)?.stock ?? 0), 0)
                  return (
                    <tr key={c.name ?? '-'}>
                      <td className="whitespace-nowrap pr-3 text-sm font-medium">
                        {c.name ? (
                          <span className="flex items-center gap-2">
                            <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: c.hex ?? '#ccc' }} />
                            {c.name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      {cols.map((size) => {
                        const v = cell(c.name, size)
                        if (!v) return <td key={size ?? '-'} className="h-[72px] rounded-xl border border-dashed border-line" />
                        const st = v.stock
                        return (
                          <td key={size ?? '-'} className="p-0">
                            <button
                              type="button"
                              onClick={() => setSelected(v.id)}
                              className={cn(
                                'flex h-[72px] w-full flex-col items-center justify-center rounded-xl border',
                                st <= 0 ? 'border-[#F3C9AE] bg-warn-100' : st === 1 ? 'border-[#F5D98B] bg-amber-100' : 'border-line bg-white',
                                selected === v.id && 'ring-2 ring-brand-600 ring-offset-1',
                              )}
                            >
                              <span className={cn('text-[22px] font-bold tabular-nums', st <= 0 && 'text-warn-700')}>{st}</span>
                              <span className="font-mono text-[10px] text-muted">…{(v.barcode ?? '').slice(-4)}</span>
                            </button>
                          </td>
                        )
                      })}
                      <td className="text-center text-lg font-semibold tabular-nums">{rowTotal}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {sel && (
            <div className="mt-2 border-t border-line pt-3 text-sm">
              Zgjedhur: <b>{[sel.variant_color, sel.variant_size].filter(Boolean).join(' · ')}</b>
              <span className="ml-4 text-muted">Barkodi</span> <span className="font-mono">{sel.barcode}</span>
              <span className="ml-4 text-muted">Stoku</span> <b>{sel.stock}</b>
              <span className="ml-4 text-muted">Hyrjet e mallit dhe numërimi bëhen te Stoku për çdo variant.</span>
            </div>
          )}
        </Card>

        <LabelsPanel shop={business.name} model={model} variants={variants} selected={sel} onPrint={print} />
      </div>
      {area}

      <EditListDialog
        mode={editOpen}
        sizes={sizes}
        colors={colors.map((c) => ({ name: c.name, hex: c.hex }))}
        saving={save.isPending}
        error={save.error ? (save.error as Error).message : null}
        onClose={() => setEditOpen(null)}
        onSave={(next) => save.mutate(next)}
      />
    </div>
  )
}

function LabelsPanel({
  shop,
  model,
  variants,
  selected,
  onPrint,
}: {
  shop: string
  model: Product
  variants: Product[]
  selected: Product | null
  onPrint: (items: LabelData[], size: LabelSize) => void
}) {
  const [what, setWhat] = useState<'one' | 'stock' | 'all'>('one')
  const [qty, setQty] = useState('1')
  const [size, setSize] = useState<LabelSize>(() => {
    try {
      return (localStorage.getItem('kasa.labelSize') as LabelSize) || '40x30'
    } catch {
      return '40x30'
    }
  })
  const toLabel = (v: Product): LabelData => ({
    shop,
    name: model.name,
    detail: [v.variant_color, v.variant_size].filter(Boolean).join(' · ') || null,
    barcode: v.barcode ?? '',
    price: formatEUR(v.sale_price),
  })
  const preview = selected ?? variants[0]
  const items = (): LabelData[] => {
    const n = Math.max(1, Math.min(500, Number(qty) || 1))
    if (what === 'one') return selected ? Array.from({ length: n }, () => toLabel(selected)) : []
    if (what === 'stock') return variants.flatMap((v) => Array.from({ length: Math.max(0, Math.round(v.stock)) }, () => toLabel(v)))
    return variants.flatMap((v) => Array.from({ length: n }, () => toLabel(v)))
  }
  const count = items().length

  return (
    <Card className="p-5 xl:sticky xl:top-6 xl:w-[340px] xl:shrink-0">
      <h2 className="text-[17px] font-semibold">Printo etiketa</h2>
      {preview?.barcode ? (
        <div className="mt-4 flex justify-center rounded-card bg-[#E9EDEA] p-4">
          <div className="rounded border border-line shadow-sm">
            <Label d={toLabel(preview)} size={size} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Shto variantet që të printosh etiketa.</p>
      )}
      <div className="mt-4 flex flex-col gap-3">
        <Select
          label="Çfarë të printohet"
          value={what}
          onChange={(e) => setWhat(e.target.value as typeof what)}
          options={[
            { value: 'one', label: 'Vetëm varianti i zgjedhur' },
            { value: 'stock', label: 'Të gjitha – një për çdo copë në stok' },
            { value: 'all', label: 'Të gjitha variantet' },
          ]}
        />
        {what !== 'stock' && <Input label={what === 'one' ? 'Sasia' : 'Sasia për variant'} type="number" min={1} max={500} value={qty} onChange={(e) => setQty(e.target.value)} />}
        <Select
          label="Madhësia e etiketës"
          value={size}
          onChange={(e) => {
            setSize(e.target.value as LabelSize)
            try {
              localStorage.setItem('kasa.labelSize', e.target.value)
            } catch {
              /* storage unavailable */
            }
          }}
          options={LABEL_SIZES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <Button size="lg" block disabled={count === 0} onClick={() => onPrint(items(), size)}>
          Printo {count > 0 ? `${count} etiketa` : 'etiketat'}
        </Button>
        <p className="text-xs text-muted">Printohet me printerin e etiketave të instaluar në kompjuter ose telefon (p.sh. Zebra, Xprinter, Brother).</p>
      </div>
    </Card>
  )
}

function EditListDialog({
  mode,
  sizes,
  colors,
  saving,
  error,
  onClose,
  onSave,
}: {
  mode: 'size' | 'color' | null
  sizes: string[]
  colors: { name: string; hex: string | null }[]
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (p: { sizes: string[]; colors: { name: string; hex: string | null }[] }) => void
}) {
  const [s, setS] = useState<string[]>([])
  const [c, setC] = useState<{ name: string; hex: string | null }[]>([])
  const [newSize, setNewSize] = useState('')
  const [newColor, setNewColor] = useState('')
  const [newHex, setNewHex] = useState('#111111')
  useEffect(() => {
    if (mode) {
      setS(sizes)
      setC(colors)
      setNewSize('')
      setNewColor('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const addSize = (v: string) => {
    const t = v.trim()
    if (t && !s.some((x) => x.toLowerCase() === t.toLowerCase())) setS((a) => [...a, t])
  }
  const addColor = (name: string, hex: string | null) => {
    const t = name.trim()
    if (t && !c.some((x) => x.name.toLowerCase() === t.toLowerCase())) setC((a) => [...a, { name: t, hex }])
  }
  const combos = Math.max(s.length, 1) * Math.max(c.length, 1)

  return (
    <Dialog
      open={mode !== null}
      onClose={onClose}
      title="Madhësitë dhe ngjyrat"
      subtitle={`${combos} variante · çdo kombinim i ri merr barkod të vetin`}
      width="md:max-w-[620px]"
      footer={
        <div className="flex items-center justify-end gap-2.5">
          {error && <span className="mr-auto text-sm text-warn-700">{error}</span>}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={saving} disabled={s.length === 0 && c.length === 0} onClick={() => onSave({ sizes: s, colors: c })}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <div className="text-sm font-semibold">Madhësitë</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {s.map((x) => (
              <span key={x} className="flex items-center gap-1 rounded-full bg-bg py-1 pl-3 pr-1 text-sm font-medium">
                {x}
                <button type="button" aria-label={`Hiq ${x}`} onClick={() => setS((a) => a.filter((y) => y !== x))} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-line">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addSize(newSize)
              setNewSize('')
            }}
          >
            <input value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="p.sh. M ose 38" className="h-11 flex-1 rounded-ctl border border-field px-3" autoFocus={mode === 'size'} />
            <Button type="submit" variant="secondary">
              Shto
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {Object.entries(SIZE_PRESETS).map(([k, list]) => (
              <button key={k} type="button" onClick={() => list.forEach(addSize)} className="rounded-ctl border border-line px-3 py-1.5 hover:bg-bg">
                + {k}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold">Ngjyrat</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.map((x) => (
              <span key={x.name} className="flex items-center gap-1.5 rounded-full bg-bg py-1 pl-1.5 pr-1 text-sm font-medium">
                <span className="h-5 w-5 rounded-full border border-line" style={{ background: x.hex ?? '#ccc' }} />
                {x.name}
                <button type="button" aria-label={`Hiq ${x.name}`} onClick={() => setC((a) => a.filter((y) => y.name !== x.name))} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-line">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addColor(newColor, newHex)
              setNewColor('')
            }}
          >
            <input type="color" aria-label="Ngjyra" value={newHex} onChange={(e) => setNewHex(e.target.value)} className="h-11 w-12 rounded-ctl border border-field p-1" />
            <input value={newColor} onChange={(e) => setNewColor(e.target.value)} placeholder="Emri i ngjyrës" className="h-11 flex-1 rounded-ctl border border-field px-3" autoFocus={mode === 'color'} />
            <Button type="submit" variant="secondary">
              Shto
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_COLORS.map((p) => (
              <button key={p.name} type="button" onClick={() => addColor(p.name, p.hex)} className="flex items-center gap-1.5 rounded-ctl border border-line px-2.5 py-1.5 text-sm hover:bg-bg">
                <span className="h-4 w-4 rounded-full border border-line" style={{ background: p.hex }} /> {p.name}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted">Kombinimet që heqësh arkivohen (shitjet e tyre mbeten në raporte). Artikulli duhet të ketë stok 0 para se të ndahet në variante.</p>
      </div>
    </Dialog>
  )
}
