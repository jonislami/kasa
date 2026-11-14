import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Dialog, Input, Select } from '@/components/ui'
import { businessType, hasModule, type BusinessType } from '@/lib/business'
import { UNIT_OPTIONS, type UnitCode } from '@/lib/units'
import { VAT_LABELS, type VatCode } from '@/lib/vat'
import { saveProduct } from '@/features/products/api'

const VAT_OPTIONS = (Object.keys(VAT_LABELS) as VatCode[]).map((value) => ({ value, label: VAT_LABELS[value] }))

/**
 * The till's "+": the owner / manager adds a product (salon: a service) without leaving the sale.
 * Only what selling needs; everything else (category, purchase price, stock) stays in the web app.
 */
export function QuickProductDialog({
  open,
  type,
  barcode: initialBarcode,
  onClose,
  onSaved,
}: {
  open: boolean
  type: BusinessType
  /** A scanned code that was not found, put into the form. */
  barcode?: string | null
  onClose: () => void
  onSaved: (productId: string) => void
}) {
  const info = businessType(type)
  const withBarcode = hasModule(type, 'barcode')
  const withUnit = hasModule(type, 'weight')
  const service = !hasModule(type, 'stock')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [vat, setVat] = useState<VatCode>('E')
  const [barcode, setBarcode] = useState('')
  const [unit, setUnit] = useState<UnitCode>('cope')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setPrice('')
    setVat('E')
    setUnit('cope')
    setBarcode(initialBarcode ?? '')
    setError(null)
  }, [open, initialBarcode])

  const save = useMutation({
    mutationFn: () =>
      saveProduct({
        kind: service ? 'service' : 'product',
        name: name.trim(),
        barcode: withBarcode && barcode.trim() ? barcode.trim() : null,
        unit: withUnit ? unit : 'cope',
        sale_price: Number(price.replace(',', '.')),
        vat_code: vat,
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
        <Input label="Emri" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Çmimi me TVSH (€)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          <Select label="TVSH" value={vat} onChange={(e) => setVat(e.target.value as VatCode)} options={VAT_OPTIONS} />
        </div>
        {(withBarcode || withUnit) && (
          <div className="grid grid-cols-2 gap-3">
            {withBarcode && <Input label="Barkodi (opsional)" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />}
            {withUnit && <Select label="Njësia" value={unit} onChange={(e) => setUnit(e.target.value as UnitCode)} options={UNIT_OPTIONS} />}
          </div>
        )}
        {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
      </form>
    </Dialog>
  )
}
