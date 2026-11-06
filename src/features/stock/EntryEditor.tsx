import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Plus, X } from 'lucide-react'
import { Badge, Button, Card, Input, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatQty, UNITS, type UnitCode } from '@/lib/units'
import { vatBreakdown, VAT_RATES, type VatCode } from '@/lib/vat'
import { stockLevel, type Product } from '@/features/products/api'
import { confirmEntry, deleteEntryDraft, lineTotal, saveEntryDraft, todayISO, type EntryInput, type EntryPayment, type Supplier } from './api'
import { ProductPicker } from './ProductPicker'
import { SupplierDialog } from './SuppliersTab'

export interface DraftLine {
  product_id: string
  name: string
  unit: string
  vat_code: VatCode
  quantity: string
  unit_cost: string
  lot_no?: string
  expires_on?: string
}

export interface EntryDraft {
  id?: string
  supplier_id: string | null
  invoice_no: string
  entry_date: string
  payment: EntryPayment
  due_days: number | null
  note: string
  lines: DraftLine[]
}

export function emptyDraft(today: string): EntryDraft {
  return { supplier_id: null, invoice_no: '', entry_date: today, payment: 'cash', due_days: null, note: '', lines: [] }
}

export function lineFromProduct(p: Product, quantity = 1): DraftLine {
  return {
    product_id: p.id,
    name: p.name,
    unit: p.unit,
    vat_code: p.vat_code,
    quantity: String(quantity),
    unit_cost: p.purchase_price ? String(p.purchase_price) : '',
  }
}

/** Adds a product (or 1 more of it) to the draft. */
export function addLine(d: EntryDraft, p: Product, quantity?: number): EntryDraft {
  const i = d.lines.findIndex((l) => l.product_id === p.id)
  if (i >= 0) {
    if (quantity !== undefined) return d
    const lines = [...d.lines]
    lines[i] = { ...lines[i], quantity: String(num(lines[i].quantity) + 1) }
    return { ...d, lines }
  }
  return { ...d, lines: [...d.lines, lineFromProduct(p, quantity ?? 1)] }
}

function num(s: string): number {
  const n = Number(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const PAYMENT_OPTIONS = [
  { value: 'cash', label: 'Kesh' },
  { value: 'bank', label: 'Bankë (e paguar)' },
  { value: 'due:7', label: 'Me afat (7 ditë)' },
  { value: 'due:15', label: 'Me afat (15 ditë)' },
  { value: 'due:30', label: 'Me afat (30 ditë)' },
  { value: 'due:60', label: 'Me afat (60 ditë)' },
]

function paymentValue(d: EntryDraft): string {
  return d.payment === 'due' ? `due:${d.due_days ?? 30}` : d.payment
}

export function toInput(d: EntryDraft): EntryInput {
  return {
    id: d.id,
    supplier_id: d.supplier_id,
    invoice_no: d.invoice_no,
    entry_date: d.entry_date,
    payment: d.payment,
    due_days: d.payment === 'due' ? d.due_days : null,
    note: d.note,
    items: d.lines.map((l) => ({
      product_id: l.product_id,
      quantity: num(l.quantity),
      unit_cost: num(l.unit_cost),
      ...(l.lot_no?.trim() ? { lot_no: l.lot_no.trim() } : {}),
      ...(l.expires_on ? { expires_on: l.expires_on } : {}),
    })),
  }
}

export function EntryEditor({
  draft,
  setDraft,
  products,
  suppliers,
  onSuppliersChanged,
  onDone,
  lots = false,
}: {
  draft: EntryDraft
  setDraft: (fn: (d: EntryDraft) => EntryDraft) => void
  products: Product[]
  suppliers: Supplier[]
  onSuppliersChanged: () => void
  onDone: (message: string) => void
  /** Pharmacy: every line has a lot number and an expiry date. */
  lots?: boolean
}) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const totals = useMemo(() => {
    const lines = draft.lines.map((l) => ({ code: l.vat_code, gross: lineTotal(num(l.quantity), num(l.unit_cost)) }))
    const vat = vatBreakdown(lines)
    return {
      units: draft.lines.reduce((s, l) => s + num(l.quantity), 0),
      gross: vat.reduce((s, v) => s + v.gross, 0),
      net: vat.reduce((s, v) => s + v.net, 0),
      vat,
    }
  }, [draft.lines])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['stock'] })
  }

  const validate = (): string | null => {
    if (draft.lines.length === 0) return 'Shto të paktën një produkt'
    for (const l of draft.lines) {
      if (num(l.quantity) <= 0) return `Shkruaj sasinë për "${l.name}"`
      if (l.unit_cost.trim() === '' || num(l.unit_cost) < 0) return `Shkruaj koston për "${l.name}"`
      if (lots && !l.expires_on) return `Shkruaj afatin e skadimit për "${l.name}"`
      if (lots && l.expires_on && l.expires_on < todayISO()) return `"${l.name}" ka afat që ka kaluar – kontrollo datën`
    }
    return null
  }

  const save = useMutation({
    mutationFn: () => saveEntryDraft(toInput(draft)),
    onSuccess: (id) => {
      setDraft((d) => ({ ...d, id }))
      setError(null)
      invalidate()
      onDone('Drafti u ruajt')
    },
    onError: (e: Error) => setError(e.message),
  })

  const confirm = useMutation({
    mutationFn: () => confirmEntry(toInput(draft)),
    onSuccess: () => {
      setError(null)
      invalidate()
      onDone(`Hyrja u konfirmua: ${draft.lines.length} produkte u shtuan në stok`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const discard = useMutation({
    mutationFn: async () => {
      if (draft.id) await deleteEntryDraft(draft.id)
    },
    onSuccess: () => {
      invalidate()
      onDone(draft.id ? 'Drafti u fshi' : '')
    },
    onError: (e: Error) => setError(e.message),
  })

  const busy = save.isPending || confirm.isPending || discard.isPending
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))
  const removeLine = (i: number) => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))
  // Same product in another lot (different batch / expiry).
  const splitLine = (i: number) =>
    setDraft((d) => {
      const lines = [...d.lines]
      lines.splice(i + 1, 0, { ...d.lines[i], quantity: '1', lot_no: '', expires_on: '' })
      return { ...d, lines }
    })
  const lotInputs = (l: DraftLine, i: number, phone = false) => [
      <input
        key="lot"
        aria-label={`Seria ${l.name}`}
        value={l.lot_no ?? ''}
        placeholder="Seria / LOT"
        onChange={(e) => setLine(i, { lot_no: e.target.value })}
        className={phone ? 'mt-1 h-12 w-full rounded-ctl border border-field px-3 text-[16px] text-ink' : 'h-11 w-[110px] rounded-ctl border border-field px-3 focus:border-brand-600 focus:outline-none'}
      />,
      <input
        key="exp"
        aria-label={`Afati ${l.name}`}
        type="date"
        value={l.expires_on ?? ''}
        onChange={(e) => setLine(i, { expires_on: e.target.value })}
        className={cn(
          phone ? 'mt-1 h-12 w-full rounded-ctl border px-3 text-[16px] text-ink' : 'h-11 w-[150px] rounded-ctl border px-2 focus:border-brand-600 focus:outline-none',
          l.expires_on ? 'border-field' : 'border-amber-700/50',
        )}
      />,
  ]

  const stockCell = (l: DraftLine) => {
    const p = byId.get(l.product_id)
    if (!p) return '—'
    const level = stockLevel(p)
    const text = formatQty(p.stock, p.unit).replace(/ .*/, '')
    if (level === 'critical') return <Badge tone="warn">{text}</Badge>
    if (level === 'low') return <Badge tone="amber">{text}</Badge>
    return <span className="text-muted">{text}</span>
  }
  const step = (unit: string) => (UNITS[unit as UnitCode]?.decimals ? '0.001' : '1')

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-[19px] font-semibold">{draft.id ? 'Draft i hyrjes' : 'Hyrje malli nga furnitori'}</h2>
        {draft.id && <Badge tone="amber">Draft</Badge>}
      </div>

      <div className="grid gap-3 px-5 pb-5 pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Furnitori</span>
            <button type="button" onClick={() => setSupplierOpen(true)} className="flex items-center gap-1 text-sm font-medium text-brand-600">
              <Plus className="h-3.5 w-3.5" /> I ri
            </button>
          </div>
          <Select
            aria-label="Furnitori"
            value={draft.supplier_id ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, supplier_id: e.target.value || null }))}
            options={[{ value: '', label: '— Pa furnitor —' }, ...suppliers.filter((s) => s.active || s.id === draft.supplier_id).map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>
        <Input label="Nr. i faturës" value={draft.invoice_no} placeholder="p.sh. F-2026/1184" onChange={(e) => setDraft((d) => ({ ...d, invoice_no: e.target.value }))} />
        <Input label="Data" type="date" value={draft.entry_date} onChange={(e) => setDraft((d) => ({ ...d, entry_date: e.target.value }))} />
        <Select
          label="Pagesa"
          value={paymentValue(draft)}
          onChange={(e) => {
            const v = e.target.value
            setDraft((d) => (v.startsWith('due:') ? { ...d, payment: 'due', due_days: Number(v.slice(4)) } : { ...d, payment: v as EntryPayment, due_days: null }))
          }}
          options={PAYMENT_OPTIONS}
        />
      </div>

      <div className="border-y border-line bg-[#FAFBFA] px-5 py-4">
        <ProductPicker products={products} onPick={(p) => setDraft((d) => addLine(d, p))} />
      </div>

      {draft.lines.length === 0 ? (
        <p className="px-5 py-10 text-center text-muted">Skano ose kërko produktet e faturës. Kosto merret nga çmimi i fundit i blerjes.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr className="text-left text-[13px] text-muted">
                  <th className="border-b border-line px-5 py-3 font-semibold">Produkti</th>
                  <th className="border-b border-line px-3 py-3 text-right font-semibold">Stoku aktual</th>
                  <th className="border-b border-line px-3 py-3 text-right font-semibold">Sasia hyrëse</th>
                  <th className="border-b border-line px-3 py-3 text-right font-semibold">Kosto / njësi</th>
                  {lots && <th className="border-b border-line px-3 py-3 font-semibold">Seria · Skadon</th>}
                  <th className="border-b border-line px-3 py-3 font-semibold">TVSH</th>
                  <th className="border-b border-line px-3 py-3 text-right font-semibold">Vlera</th>
                  <th className="w-12 border-b border-line" />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="border-b border-line px-5 py-2.5 font-semibold">
                      {l.name}
                      {lots && (
                        <button type="button" onClick={() => splitLine(i)} className="block text-xs font-medium text-brand-600">
                          + seri tjetër
                        </button>
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums">{stockCell(l)}</td>
                    <td className="border-b border-line px-3 py-2.5 text-right">
                      <input
                        aria-label={`Sasia ${l.name}`}
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step={step(l.unit)}
                        value={l.quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value })}
                        className="h-11 w-[96px] rounded-ctl border border-field px-3 text-right tabular-nums focus:border-brand-600 focus:outline-none"
                      />
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right">
                      <input
                        aria-label={`Kosto ${l.name}`}
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.unit_cost}
                        placeholder="0.00"
                        onChange={(e) => setLine(i, { unit_cost: e.target.value })}
                        className="h-11 w-[96px] rounded-ctl border border-field px-3 text-right tabular-nums focus:border-brand-600 focus:outline-none"
                      />
                    </td>
                    {lots && (
                      <td className="border-b border-line px-3 py-2.5">
                        <div className="flex gap-2">{lotInputs(l, i)}</div>
                      </td>
                    )}
                    <td className="border-b border-line px-3 py-2.5 tabular-nums">{Math.round(VAT_RATES[l.vat_code] * 100)}%</td>
                    <td className="border-b border-line px-3 py-2.5 text-right font-semibold tabular-nums">{formatEUR(lineTotal(num(l.quantity), num(l.unit_cost)))}</td>
                    <td className="border-b border-line pr-3 text-right">
                      <button type="button" aria-label={`Hiq ${l.name}`} onClick={() => removeLine(i)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink">
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone cards */}
          <ul className="flex flex-col gap-3 bg-bg p-3 md:hidden">
            {draft.lines.map((l, i) => (
              <li key={i} className="rounded-card border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[17px] font-semibold">{l.name}</div>
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-muted">Stoku:</span> {stockCell(l)}
                    <button type="button" aria-label={`Hiq ${l.name}`} onClick={() => removeLine(i)} className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                  <label className="text-sm text-muted">
                    Sasia
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step={step(l.unit)}
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: e.target.value })}
                      className="mt-1 h-12 w-full rounded-ctl border border-field px-3 text-[16px] text-ink tabular-nums"
                    />
                  </label>
                  <label className="text-sm text-muted">
                    Kosto / njësi
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.unit_cost}
                      placeholder="0.00"
                      onChange={(e) => setLine(i, { unit_cost: e.target.value })}
                      className="mt-1 h-12 w-full rounded-ctl border border-field px-3 text-[16px] text-ink tabular-nums"
                    />
                  </label>
                  <div className="pb-3 text-right text-[17px] font-bold tabular-nums">{formatEUR(lineTotal(num(l.quantity), num(l.unit_cost)))}</div>
                </div>
                {lots && (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-muted">
                      <label>
                        Seria
                        {lotInputs(l, i, true)[0]}
                      </label>
                      <label>
                        Skadon
                        {lotInputs(l, i, true)[1]}
                      </label>
                    </div>
                    <button type="button" onClick={() => splitLine(i)} className="mt-2 text-sm font-medium text-brand-600">
                      + seri tjetër
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="grid gap-5 px-5 py-5 md:grid-cols-[1fr_300px] md:items-end">
        <Input label="Shënim" value={draft.note} placeholder="p.sh. malli erdhi i plotë" onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
        <div className="flex flex-col gap-1 text-[15px]">
          <div className="text-muted">
            {draft.lines.length} produkte · {Number(totals.units.toFixed(3))} njësi
          </div>
          <div className="flex justify-between text-muted">
            <span>Vlera pa TVSH</span>
            <span className="tabular-nums">{formatEUR(totals.net)}</span>
          </div>
          {totals.vat
            .filter((v) => v.vat > 0)
            .map((v) => (
              <div key={v.code} className="flex justify-between text-muted">
                <span>TVSH {Math.round(VAT_RATES[v.code] * 100)}%</span>
                <span className="tabular-nums">{formatEUR(v.vat)}</span>
              </div>
            ))}
          <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-line pt-2">
            <span className="font-semibold">Totali i faturës</span>
            <span className="text-[26px] font-bold tabular-nums">{formatEUR(totals.gross)}</span>
          </div>
        </div>
      </div>

      {error && <p className="px-5 pb-3 text-sm text-warn-700">{error}</p>}

      <div className={cn('flex flex-wrap items-center justify-end gap-2.5 border-t border-line px-5 py-4', 'sticky bottom-[calc(76px+env(safe-area-inset-bottom))] bg-white md:static')}>
        {(draft.id || draft.lines.length > 0) && (
          <Button variant="ghost" className="mr-auto text-warn-700" disabled={busy} onClick={() => discard.mutate()}>
            {draft.id ? 'Fshi draftin' : 'Pastro'}
          </Button>
        )}
        <Button variant="secondary" loading={save.isPending} disabled={busy || draft.lines.length === 0} onClick={() => save.mutate()}>
          Ruaj si draft
        </Button>
        <Button
          loading={confirm.isPending}
          disabled={busy}
          onClick={() => {
            const v = validate()
            if (v) return setError(v)
            confirm.mutate()
          }}
        >
          <CheckCircle2 className="h-4 w-4" /> Konfirmo hyrjen në stok
        </Button>
      </div>

      <SupplierDialog
        open={supplierOpen}
        supplier={null}
        onClose={() => setSupplierOpen(false)}
        onSaved={(s) => {
          setSupplierOpen(false)
          onSuppliersChanged()
          setDraft((d) => ({ ...d, supplier_id: s.id }))
        }}
      />
    </Card>
  )
}
