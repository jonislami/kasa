import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Archive, RotateCcw, X } from 'lucide-react'
import { Button, Input, Select, Tabs } from '@/components/ui'
import { Link } from 'react-router-dom'
import { businessType, hasModule, type BusinessType } from '@/lib/business'
import { cn } from '@/lib/cn'
import { UNIT_OPTIONS, type UnitCode } from '@/lib/units'
import { VAT_LABELS, type VatCode } from '@/lib/vat'
import { margin, nextInternalBarcode, type Category, type Product, type ProductInput, type ProductKind } from './api'

const VAT_OPTIONS = (Object.keys(VAT_LABELS) as VatCode[]).map((v) => ({ value: v, label: VAT_LABELS[v] }))

/** "1,25" or "1.25" → 1.25; empty → null */
function num(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

interface Draft {
  kind: ProductKind
  name: string
  barcode: string
  category_id: string
  unit: UnitCode
  purchase: string
  sale: string
  vat: VatCode
  min_stock: string
  initial_stock: string
  duration: string
  substance: string
  show_in_pos: boolean
}

function toDraft(p: Product | null, type: BusinessType, categoryId: string | null): Draft {
  const defaultKind: ProductKind = type === 'salon' ? 'service' : 'product'
  return {
    kind: p?.kind ?? defaultKind,
    name: p?.name ?? '',
    barcode: p?.barcode ?? '',
    category_id: p?.category_id ?? categoryId ?? '',
    unit: p?.unit ?? 'cope',
    purchase: p?.purchase_price ? String(p.purchase_price) : '',
    sale: p ? String(p.sale_price) : '',
    vat: p?.vat_code ?? 'E',
    min_stock: p?.min_stock ? String(p.min_stock) : '',
    initial_stock: '',
    duration: p?.duration_min ? String(p.duration_min) : '',
    substance: p?.substance ?? '',
    show_in_pos: p?.show_in_pos ?? true,
  }
}

export function ProductForm({
  product,
  businessType: type,
  categories,
  defaultCategoryId,
  saving,
  error,
  onSave,
  onCancel,
  onToggleActive,
}: {
  product: Product | null
  businessType: BusinessType
  categories: Category[]
  defaultCategoryId: string | null
  saving: boolean
  error: string | null
  onSave: (input: ProductInput) => void
  onCancel: () => void
  onToggleActive?: (p: Product) => void
}) {
  const info = businessType(type)
  const [d, setD] = useState<Draft>(() => toDraft(product, type, defaultCategoryId))
  const [localError, setLocalError] = useState<string | null>(null)
  const [genBusy, setGenBusy] = useState(false)

  useEffect(() => {
    setD(toDraft(product, type, defaultCategoryId))
    setLocalError(null)
    // reset only when another product is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }))

  const isService = d.kind === 'service'
  const showBarcode = hasModule(type, 'barcode') && !isService
  const showStock = hasModule(type, 'stock') && !isService
  const m = useMemo(() => {
    const s = num(d.sale)
    const p = num(d.purchase)
    return s && p && !Number.isNaN(s) && !Number.isNaN(p) ? margin(s, p) : null
  }, [d.sale, d.purchase])

  const generate = async () => {
    setGenBusy(true)
    try {
      set('barcode', await nextInternalBarcode())
    } catch (e) {
      setLocalError((e as Error).message)
    } finally {
      setGenBusy(false)
    }
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const sale = num(d.sale)
    const purchase = num(d.purchase)
    const minStock = num(d.min_stock)
    const initial = num(d.initial_stock)
    const duration = num(d.duration)
    if (!d.name.trim()) return setLocalError('Shkruaj emrin')
    if (sale == null || Number.isNaN(sale) || sale < 0) return setLocalError('Çmimi i shitjes nuk është i saktë')
    if (purchase != null && (Number.isNaN(purchase) || purchase < 0)) return setLocalError('Çmimi i blerjes nuk është i saktë')
    if (minStock != null && (Number.isNaN(minStock) || minStock < 0)) return setLocalError('Stoku minimal nuk është i saktë')
    if (initial != null && Number.isNaN(initial)) return setLocalError('Stoku fillestar nuk është i saktë')
    if (isService && duration != null && (Number.isNaN(duration) || duration < 1 || duration > 1440))
      return setLocalError('Kohëzgjatja duhet të jetë 1–1440 minuta')
    setLocalError(null)
    onSave({
      id: product?.id,
      kind: d.kind,
      name: d.name.trim(),
      barcode: showBarcode ? d.barcode.trim() || null : null,
      category_id: d.category_id || null,
      unit: isService ? 'cope' : d.unit,
      sale_price: sale,
      purchase_price: purchase ?? 0,
      vat_code: d.vat,
      min_stock: showStock ? (minStock ?? 0) : 0,
      initial_stock: !product && showStock ? (initial ?? 0) : undefined,
      duration_min: isService ? (duration ?? null) : null,
      substance: type === 'pharmacy' ? d.substance.trim() || null : null,
      show_in_pos: d.show_in_pos,
    })
  }

  const shownError = localError ?? error
  const itemWord = isService ? 'shërbimit' : info.terms.itemOf

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {product ? 'Ndrysho' : isService ? 'Shërbim i ri' : info.terms.newItem}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Mbyll"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bg hover:bg-line md:flex"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {product && hasModule(type, 'variants') && !product.parent_id && product.kind === 'product' && (
        <Link
          to={`/produktet/${product.id}`}
          className="flex items-center justify-between rounded-ctl border border-brand-600/30 bg-brand-100 px-4 py-3 text-[15px] font-semibold text-brand-600"
        >
          {product.has_variants ? 'Madhësitë, ngjyrat dhe etiketat' : 'Shto madhësi dhe ngjyra'}
          <span aria-hidden>→</span>
        </Link>
      )}

      {product && !product.active && (
        <div className="rounded-ctl bg-amber-100 px-4 py-2.5 text-sm text-amber-700">I arkivuar: nuk shfaqet në arkë.</div>
      )}

      <Tabs
        size="sm"
        className="w-full"
        value={d.kind}
        onChange={(v) => set('kind', v)}
        options={[
          { value: 'product', label: type === 'restaurant' ? 'Artikull' : 'Produkt' },
          { value: 'service', label: 'Shërbim' },
        ]}
      />

      <Input
        label={`Emri i ${itemWord}`}
        value={d.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder={isService ? 'p.sh. Prerje flokësh' : 'p.sh. Qumësht i freskët 1L'}
        autoFocus={!product}
      />

      {showBarcode && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Barkodi</span>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                aria-label="Barkodi"
                value={d.barcode}
                inputMode="numeric"
                onChange={(e) => set('barcode', e.target.value)}
                onKeyDown={(e) => {
                  // USB scanners end with Enter – don't submit the form
                  if (e.key === 'Enter') e.preventDefault()
                }}
                placeholder="Skano ose shkruaj"
              />
            </div>
            <Button variant="secondary" className="h-[46px] shrink-0" loading={genBusy} onClick={() => void generate()}>
              Gjenero
            </Button>
          </div>
        </div>
      )}

      {type === 'pharmacy' && !isService && (
        <Input label="Substanca aktive" value={d.substance} onChange={(e) => set('substance', e.target.value)} placeholder="p.sh. Paracetamol" />
      )}

      <div className={cn('grid gap-3', isService ? 'grid-cols-1' : 'grid-cols-2')}>
        <Select
          label="Kategoria"
          value={d.category_id}
          onChange={(e) => set('category_id', e.target.value)}
          options={[{ value: '', label: 'Pa kategori' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
        {!isService && <Select label="Njësia" value={d.unit} onChange={(e) => set('unit', e.target.value as UnitCode)} options={UNIT_OPTIONS} />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="Çmimi i blerjes" inputMode="decimal" value={d.purchase} onChange={(e) => set('purchase', e.target.value)} placeholder="€0.00" />
        <Input label="Çmimi i shitjes" inputMode="decimal" value={d.sale} onChange={(e) => set('sale', e.target.value)} placeholder="€0.00" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select label="TVSH" value={d.vat} onChange={(e) => set('vat', e.target.value as VatCode)} options={VAT_OPTIONS} />
        {isService ? (
          <Input label="Kohëzgjatja (min)" inputMode="numeric" value={d.duration} onChange={(e) => set('duration', e.target.value)} placeholder="p.sh. 30" />
        ) : showStock ? (
          <Input label="Stoku minimal" inputMode="decimal" value={d.min_stock} onChange={(e) => set('min_stock', e.target.value)} placeholder="p.sh. 10" />
        ) : (
          <div />
        )}
      </div>

      {showStock && !product && (
        <Input
          label="Stoku fillestar"
          inputMode="decimal"
          value={d.initial_stock}
          onChange={(e) => set('initial_stock', e.target.value)}
          placeholder="0"
          hint="Më vonë stoku ndryshon vetëm me hyrje malli, shitje ose inventarizim."
        />
      )}
      {showStock && product && (
        <div className="flex items-center justify-between rounded-ctl border border-line px-4 py-3 text-sm">
          <span className="text-muted">Stoku aktual</span>
          <span className="font-semibold tabular-nums">{product.stock}</span>
        </div>
      )}

      <div className="flex items-center justify-between rounded-ctl bg-[#F0F7F3] px-4 py-3 text-sm">
        <span className="text-muted">Marzha e llogaritur</span>
        <span className={cn('font-semibold tabular-nums', m != null && m < 0 ? 'text-warn-700' : 'text-brand-600')}>
          {m == null ? '—' : `${(m * 100).toFixed(1)}%`}
        </span>
      </div>

      <label className="flex cursor-pointer items-center gap-3 text-[15px]">
        <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={d.show_in_pos} onChange={(e) => set('show_in_pos', e.target.checked)} />
        Shfaq në arkë (POS)
      </label>

      {shownError && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{shownError}</p>}

      <div className="grid grid-cols-[auto_1fr] gap-2.5">
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={saving}>
          Anulo
        </Button>
        <Button type="submit" size="lg" loading={saving}>
          {product ? 'Ruaj ndryshimet' : 'Ruaj'}
        </Button>
      </div>

      {product && onToggleActive && (
        <Button variant={product.active ? 'danger' : 'secondary'} onClick={() => onToggleActive(product)} disabled={saving}>
          {product.active ? (
            <>
              <Archive className="h-4 w-4" /> Arkivo
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4" /> Rikthe në listë
            </>
          )}
        </Button>
      )}
    </form>
  )
}

