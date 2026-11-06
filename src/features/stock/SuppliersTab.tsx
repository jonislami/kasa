import { useEffect, useMemo, useState } from 'react'
import { Plus, Truck } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Table, Td, Th } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { formatDate, saveSupplier, type StockEntry, type Supplier, type SupplierInput } from './api'

const EMPTY: SupplierInput = { name: '', nui: '', vat_number: '', phone: '', email: '', address: '', note: '' }

export function SupplierDialog({
  open,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean
  supplier: Supplier | null
  onClose: () => void
  onSaved: (s: Supplier) => void
}) {
  const [form, setForm] = useState<SupplierInput>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(supplier ? { ...supplier } : EMPTY)
      setError(null)
    }
  }, [open, supplier])

  const set = (k: keyof SupplierInput) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (active?: boolean) => {
    if (!form.name.trim()) return setError('Shkruaj emrin e furnitorit')
    setSaving(true)
    setError(null)
    try {
      onSaved(await saveSupplier({ ...form, id: supplier?.id, ...(active === undefined ? {} : { active }) }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={supplier ? 'Ndrysho furnitorin' : 'Furnitor i ri'}
      width="md:max-w-[520px]"
      footer={
        <div className="flex flex-wrap justify-end gap-2.5">
          {supplier && (
            <Button variant={supplier.active ? 'danger' : 'secondary'} className="mr-auto" disabled={saving} onClick={() => submit(!supplier.active)}>
              {supplier.active ? 'Arkivo' : 'Rikthe'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={saving} onClick={() => submit()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="sm:col-span-2">
          <Input label="Emri" autoFocus value={form.name} onChange={set('name')} placeholder="p.sh. Furnitori Demo SH.P.K." />
        </div>
        <Input label="NUI" value={form.nui ?? ''} onChange={set('nui')} inputMode="numeric" />
        <Input label="Nr. TVSH" value={form.vat_number ?? ''} onChange={set('vat_number')} />
        <Input label="Telefoni" value={form.phone ?? ''} onChange={set('phone')} inputMode="tel" />
        <Input label="Email" value={form.email ?? ''} onChange={set('email')} type="email" />
        <div className="sm:col-span-2">
          <Input label="Adresa" value={form.address ?? ''} onChange={set('address')} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Shënim" value={form.note ?? ''} onChange={set('note')} />
        </div>
        <button type="submit" className="hidden" />
      </form>
      {error && <p className="mt-3 text-sm text-warn-700">{error}</p>}
    </Dialog>
  )
}

export function SuppliersTab({ suppliers, entries, onChanged }: { suppliers: Supplier[]; entries: StockEntry[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Supplier | null | 'new'>(null)
  const [showArchived, setShowArchived] = useState(false)

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; total: number; last: string | null }>()
    for (const e of entries) {
      if (e.status !== 'confirmed' || !e.supplier_id) continue
      const s = m.get(e.supplier_id) ?? { count: 0, total: 0, last: null }
      s.count += 1
      s.total += e.total
      if (!s.last || e.entry_date > s.last) s.last = e.entry_date
      m.set(e.supplier_id, s)
    }
    return m
  }, [entries])

  const list = suppliers.filter((s) => (showArchived ? !s.active : s.active))

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="text-[17px] font-semibold">Furnitorët</h2>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Aktivët' : 'Të arkivuarit'}
          </Button>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Furnitor i ri
          </Button>
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<Truck className="h-6 w-6" />} title={showArchived ? 'Asnjë furnitor i arkivuar' : 'Ende pa furnitorë'} text="Furnitorët zgjidhen te hyrja e mallit." />
      ) : (
        <Table>
          <thead className="bg-[#F8FAF8]">
            <tr>
              <Th className="pl-5">Emri</Th>
              <Th className="hidden md:table-cell">NUI</Th>
              <Th className="hidden md:table-cell">Telefoni</Th>
              <Th className="text-right">Hyrje</Th>
              <Th className="text-right">Vlera</Th>
              <Th className="hidden text-right lg:table-cell">E fundit</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const st = stats.get(s.id)
              return (
                <tr key={s.id} onClick={() => setEditing(s)} className="cursor-pointer hover:bg-[#F8FAF8]">
                  <Td className="pl-5">
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-muted md:hidden">{[s.nui, s.phone].filter(Boolean).join(' · ')}</div>
                    {!s.active && <Badge>Arkivuar</Badge>}
                  </Td>
                  <Td className="hidden text-muted md:table-cell">{s.nui ?? '—'}</Td>
                  <Td className="hidden text-muted md:table-cell">{s.phone ?? '—'}</Td>
                  <Td className="text-right">{st?.count ?? 0}</Td>
                  <Td className="text-right font-semibold">{formatEUR(st?.total ?? 0)}</Td>
                  <Td className="hidden text-right text-muted lg:table-cell">{st?.last ? formatDate(st.last) : '—'}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      <SupplierDialog
        open={editing !== null}
        supplier={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          onChanged()
        }}
      />
    </Card>
  )
}
