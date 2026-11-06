import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Search } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Table, Tabs, Td, Th } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { formatQty } from '@/lib/units'
import { VAT_RATES } from '@/lib/vat'
import { dueDate, fetchEntryItems, formatDate, formatDateTime, type StockEntry, type StockEntryItem, type Supplier } from './api'

type Filter = 'all' | 'draft' | 'confirmed'

export function paymentLabel(e: Pick<StockEntry, 'payment' | 'due_days' | 'entry_date'>): string {
  if (e.payment === 'cash') return 'Kesh'
  if (e.payment === 'bank') return 'Bankë'
  const d = dueDate(e.entry_date, e.due_days)
  return `Me afat ${e.due_days} ditë${d ? ` (deri ${formatDate(d)})` : ''}`
}

export function EntriesTab({
  entries,
  suppliers,
  people,
  onOpenDraft,
}: {
  entries: StockEntry[]
  suppliers: Supplier[]
  people: Map<string, string>
  onOpenDraft: (entry: StockEntry, items: StockEntryItem[]) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<StockEntry | null>(null)
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return entries.filter((e) => {
      if (filter !== 'all' && e.status !== filter) return false
      if (!s) return true
      return (
        (e.invoice_no ?? '').toLowerCase().includes(s) ||
        (e.supplier_id ? (supplierName.get(e.supplier_id) ?? '').toLowerCase().includes(s) : false) ||
        String(e.entry_no ?? '') === s
      )
    })
  }, [entries, filter, q, supplierName])

  const drafts = entries.filter((e) => e.status === 'draft').length

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kërko sipas nr. të faturës ose furnitorit"
            className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none"
          />
        </div>
        <Tabs
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Të gjitha' },
            { value: 'confirmed', label: 'Të konfirmuara' },
            { value: 'draft', label: `Drafte${drafts ? ` (${drafts})` : ''}` },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<FileText className="h-6 w-6" />} title={entries.length === 0 ? 'Ende pa hyrje malli' : 'Asgjë nuk përputhet'} />
      ) : (
        <Table>
          <thead className="bg-[#F8FAF8]">
            <tr>
              <Th className="pl-5">Nr.</Th>
              <Th>Data</Th>
              <Th>Furnitori</Th>
              <Th className="hidden md:table-cell">Fatura</Th>
              <Th className="hidden text-right md:table-cell">Produkte</Th>
              <Th className="hidden lg:table-cell">Pagesa</Th>
              <Th className="text-right">Totali</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} onClick={() => setOpen(e)} className="cursor-pointer hover:bg-[#F8FAF8]">
                <Td className="pl-5 font-semibold">{e.status === 'draft' ? <Badge tone="amber">Draft</Badge> : `H-${String(e.entry_no).padStart(4, '0')}`}</Td>
                <Td>{formatDate(e.entry_date)}</Td>
                <Td>
                  <div className="font-medium">{e.supplier_id ? supplierName.get(e.supplier_id) ?? '—' : '—'}</div>
                  <div className="text-xs text-muted md:hidden">{e.invoice_no ?? ''}</div>
                </Td>
                <Td className="hidden text-muted md:table-cell">{e.invoice_no ?? '—'}</Td>
                <Td className="hidden text-right md:table-cell">{e.items_count}</Td>
                <Td className="hidden text-muted lg:table-cell">{paymentLabel(e)}</Td>
                <Td className="text-right font-semibold">{formatEUR(e.total)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <EntryDialog
        entry={open}
        supplier={open?.supplier_id ? supplierName.get(open.supplier_id) ?? null : null}
        people={people}
        onClose={() => setOpen(null)}
        onOpenDraft={(items) => {
          if (open) onOpenDraft(open, items)
          setOpen(null)
        }}
      />
    </Card>
  )
}

function EntryDialog({
  entry,
  supplier,
  people,
  onClose,
  onOpenDraft,
}: {
  entry: StockEntry | null
  supplier: string | null
  people: Map<string, string>
  onClose: () => void
  onOpenDraft: (items: StockEntryItem[]) => void
}) {
  const items = useQuery({
    queryKey: ['stock', 'entry-items', entry?.id],
    queryFn: () => fetchEntryItems(entry!.id),
    enabled: Boolean(entry),
  })
  if (!entry) return null
  const title = entry.status === 'draft' ? 'Draft i hyrjes' : `Hyrja H-${String(entry.entry_no).padStart(4, '0')}`
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      subtitle={[supplier, entry.invoice_no ? `Fatura ${entry.invoice_no}` : null, formatDate(entry.entry_date)].filter(Boolean).join(' · ')}
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Mbyll
          </Button>
          {entry.status === 'draft' && (
            <Button disabled={!items.data} onClick={() => items.data && onOpenDraft(items.data)}>
              Vazhdo draftin
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <div className="text-muted">Pagesa</div>
          <div className="font-medium">{paymentLabel(entry)}</div>
        </div>
        <div>
          <div className="text-muted">Regjistroi</div>
          <div className="font-medium">{entry.created_by ? people.get(entry.created_by) ?? '—' : '—'}</div>
        </div>
        <div>
          <div className="text-muted">{entry.confirmed_at ? 'Konfirmuar' : 'Krijuar'}</div>
          <div className="font-medium">{formatDateTime(entry.confirmed_at ?? entry.created_at)}</div>
        </div>
      </div>
      {items.isLoading ? (
        <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
      ) : items.isError ? (
        <p className="text-sm text-warn-700">{(items.error as Error).message}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="pl-0">Produkti</Th>
              <Th className="text-right">Sasia</Th>
              <Th className="text-right">Kosto</Th>
              <Th>TVSH</Th>
              <Th className="pr-0 text-right">Vlera</Th>
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).map((i) => (
              <tr key={i.id}>
                <Td className="pl-0 font-medium">{i.name}</Td>
                <Td className="text-right">{formatQty(i.quantity, i.unit)}</Td>
                <Td className="text-right">{formatEUR(i.unit_cost)}</Td>
                <Td>{Math.round(VAT_RATES[i.vat_code] * 100)}%</Td>
                <Td className="pr-0 text-right font-semibold">{formatEUR(i.total)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="ml-auto mt-4 flex max-w-[280px] flex-col gap-1 text-[15px]">
        <div className="flex justify-between text-muted">
          <span>Vlera pa TVSH</span>
          <span className="tabular-nums">{formatEUR(entry.net_total)}</span>
        </div>
        {entry.vat_lines
          .filter((v) => v.vat > 0)
          .map((v) => (
            <div key={v.code} className="flex justify-between text-muted">
              <span>TVSH {Math.round(v.rate * 100)}%</span>
              <span className="tabular-nums">{formatEUR(v.vat)}</span>
            </div>
          ))}
        <div className="flex justify-between border-t border-dashed border-line pt-2 font-semibold">
          <span>Totali</span>
          <span className="text-lg tabular-nums">{formatEUR(entry.total)}</span>
        </div>
      </div>
      {entry.note && <p className="mt-4 rounded-ctl bg-bg px-3 py-2 text-sm">{entry.note}</p>}
    </Dialog>
  )
}
