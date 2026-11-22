import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Dialog, Input, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { businessType, hasModule, type BusinessType } from '@/lib/business'
import { UNIT_OPTIONS, type UnitCode } from '@/lib/units'
import { VAT_LABELS, type VatCode } from '@/lib/vat'
import { categoryOptions, DEFAULT_CATEGORY } from '@/lib/atk/catalog'
import { saveProduct } from '@/features/products/api'

const VAT_OPTIONS = (Object.keys(VAT_LABELS) as VatCode[]).map((value) => ({ value, label: VAT_LABELS[value] }))

/**
 * The till's "+": the owner / manager adds a product (salon: a service) without leaving the sale: name, price, VAT
 * (only for a business in VAT), every unit of the ATK list, the category and the ATK category. Purchase price and
 * stock stay in the web app.
 */
export function QuickProductDialog({
  open,
  type,
  barcode: initialBarcode,
  onClose,
  onSaved,
  vatRegistered = true,
  categories = [],
}: {
  open: boolean
  type: BusinessType
  /** false: the business is not in VAT – no VAT field, the product sells as A */
  vatRegistered?: boolean
  categories?: { id: string; name: string }[]
  /** A scanned code that was not found, put into the form. */
  barcode?: string | null
  onClose: () => void
  onSaved: (productId: string) => void
}) {
  const info = businessType(type)
  const withBarcode = hasModule(type, 'barcode')
  const [kind, setKind] = useState<'product' | 'service'>(hasModule(type, 'stock') ? 'product' : 'service')
  const service = kind === 'service'
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [vat, setVat] = useState<VatCode>('E')
  const [barcode, setBarcode] = useState('')
  const [unit, setUnit] = useState<UnitCode>('cope')
  const [category, setCategory] = useState('')
  const [atk, setAtk] = useState(DEFAULT_CATEGORY[type] ?? 'TT')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setPrice('')
    setVat('E')
    setUnit('cope')
    setKind(hasModule(type, 'stock') ? 'product' : 'service')
    setCategory('')
    setAtk(DEFAULT_CATEGORY[type] ?? 'TT')
    setBarcode(initialBarcode ?? '')
    setError(null)
  }, [open, initialBarcode, type])

  const save = useMutation({
    mutationFn: () =>
      saveProduct({
        kind,
        name: name.trim(),
        barcode: withBarcode && !service && barcode.trim() ? barcode.trim() : null,
        unit,
        sale_price: Number(price.replace(',', '.')),
        vat_code: vatRegistered ? vat : 'A',
        category_id: category || null,
        atk_type: atk,
        show_in_pos: true,
      }),
    onSuccess: (id) => onSaved(id),
    onError: (e) => setError((e as Error).message),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = Number(price.replace(',', '.'))
    if (!name.trim()) return setError('Shkruaj emrin')
    if (!Number.isFinite(value) || value <= 0) return setError('Shkruaj çmimin')
    setError(null)
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={() => !save.isPending && onClose()}
      title={info.terms.newItem}
      width="md:max-w-[460px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            Anulo
          </Button>
          <Button type="submit" form="quick-product" loading={save.isPending}>
            Shto
          </Button>
        </div>
      }
    >
      <form id="quick-product" onSubmit={submit} className="grid gap-3">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Lloji i artikullit</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Lloji i artikullit">
            {(
              [
                ['product', 'Artikull'],
                ['service', 'Shërbim'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'h-11 rounded-ctl border text-[15px] font-semibold transition-colors',
                  kind === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-field bg-white text-ink hover:bg-bg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Input label="Emri" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className={vatRegistered ? 'grid grid-cols-2 gap-3' : 'grid gap-3'}>
          <Input label={vatRegistered ? 'Çmimi me TVSH (€)' : 'Çmimi (€)'} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          {vatRegistered && <Select label="TVSH" value={vat} onChange={(e) => setVat(e.target.value as VatCode)} options={VAT_OPTIONS} />}
        </div>
        <div className={withBarcode && !service ? 'grid grid-cols-2 gap-3' : 'grid gap-3'}>
          {withBarcode && !service && <Input label="Barkodi (opsional)" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />}
          <Select label="Njësia matëse" value={unit} onChange={(e) => setUnit(e.target.value as UnitCode)} options={UNIT_OPTIONS} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Kategoria" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: 'Pa kategori' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Kategoria ATK" value={atk} onChange={(e) => setAtk(e.target.value)} options={categoryOptions()} />
        </div>
        {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
      </form>
    </Dialog>
  )
}
