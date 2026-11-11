import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Boxes, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, PackagePlus, Plus, Search, Trash2, Undo2, Upload, Warehouse as WarehouseIcon } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, formatDay, monthName, monthStart } from '@/features/accounting/api'
import { addDays } from '@/features/reports/api'
import type { VatCode } from '@/lib/vat'
import type { Client } from './api'
import {
  addMove,
  countStocktake,
  createStocktake,
  deleteItem,
  deleteMove,
  deleteStocktake,
  fetchDocLines,
  fetchItems,
  fetchMoves,
  fetchStockDocs,
  fetchStocktake,
  fetchStocktakes,
  fetchWarehouses,
  importItems,
  MOVE_LABELS,
  postDoc,
  postStocktake,
  qtyFmt,
  saveItem,
  saveWarehouse,
  transfer,
  UNITS,
  unpostDoc,
  type Item,
  type StockDoc,
  type StockStatus,
} from './inventory'
import { downloadSheets } from './xls'

type View = 'artikujt' | 'levizjet' | 'faturat' | 'transferet' | 'inventarizimi'
const STATUS: Record<StockStatus, { label: string; tone: 'success' | 'amber' | 'warn' | 'neutral' }> = {
  ok: { label: 'Në rregull', tone: 'success' },
  low: { label: 'I ulët', tone: 'amber' },
  critical: { label: 'Kritik', tone: 'warn' },
  negative: { label: 'Negativ', tone: 'warn' },
}

/** Inventari: for clients that keep stock without the Kasa till. */
export function InventoryTab({ client, kasaLinked }: { client: Client; kasaLinked: boolean }) {
  const [view, setView] = useState<View>('artikujt')
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {kasaLinked && (
        <p className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
          Ky klient përdor arkën Kasa: stoku i vërtetë del te “Stoku” (nga arka). Inventarin këtu përdore vetëm për depo që nuk janë në Kasa.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['artikujt', 'Artikujt dhe stoku', Boxes],
            ['levizjet', 'Lëvizjet', ClipboardList],
            ['faturat', 'Nga faturat', PackagePlus],
            ['transferet', 'Transferet', ArrowLeftRight],
            ['inventarizimi', 'Inventarizimi', CheckCircle2],
          ] as const
        ).map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={cn('flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold', view === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
            <Icon className="h-4 w-4" /> {l}
          </button>
        ))}
      </div>
      {view === 'artikujt' && <ItemsView client={client} />}
      {view === 'levizjet' && <MovesView client={client} />}
      {view === 'faturat' && <DocsView client={client} />}
      {view === 'transferet' && <TransferView client={client} />}
      {view === 'inventarizimi' && <StocktakeView client={client} />}
    </div>
  )
}

const useWarehouses = (clientId: string) => useQuery({ queryKey: ['client', clientId, 'warehouses'], queryFn: () => fetchWarehouses(clientId) })
const useItems = (clientId: string) => useQuery({ queryKey: ['client', clientId, 'items'], queryFn: () => fetchItems(clientId) })
const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.')) || 0

// ---------------------------------------------------------------------------
// Items and stock
// ---------------------------------------------------------------------------
function ItemsView({ client }: { client: Client }) {
  const qc = useQueryClient()
  const items = useItems(client.id)
  const whs = useWarehouses(client.id)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'active' | 'low' | 'negative' | 'inactive'>('active')
  const [wh, setWh] = useState('')
  const [edit, setEdit] = useState<Partial<Item> | null>(null)
  const [move, setMove] = useState<Item | null>(null)
  const [imp, setImp] = useState(false)
  const [whOpen, setWhOpen] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id] })
  const del = useMutation({ mutationFn: deleteItem, onSuccess: refresh })

  const all = items.data ?? []
  const s = q.trim().toLowerCase()
  const list = all.filter(
    (i) =>
      (filter === 'inactive' ? !i.active : i.active) &&
      (filter !== 'low' || i.status === 'low' || i.status === 'critical') &&
      (filter !== 'negative' || i.status === 'negative') &&
      (!s || [i.name, i.sku, i.barcode, i.category].some((x) => x?.toLowerCase().includes(s))),
  )
  const stockOf = (i: Item) => (wh ? i.by_wh[wh] ?? 0 : i.stock)
  const value = list.reduce((a, i) => a + stockOf(i) * i.avg_cost, 0)
  const low = all.filter((i) => i.active && (i.status === 'low' || i.status === 'critical')).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-sm text-muted">Artikuj aktivë</div>
          <div className="mt-1 text-[20px] font-bold tabular-nums">{all.filter((i) => i.active).length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted">Vlera e stokut (kosto mesatare)</div>
          <div className="mt-1 text-[20px] font-bold tabular-nums">{formatEUR(value)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted">Stok i ulët</div>
          <div className={cn('mt-1 text-[20px] font-bold tabular-nums', low > 0 && 'text-amber-700')}>{low}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between text-sm text-muted">
            Depot{' '}
            <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setWhOpen(true)}>
              Menaxho
            </button>
          </div>
          <div className="mt-1 text-[20px] font-bold tabular-nums">{whs.data?.filter((w) => w.active).length ?? '…'}</div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko emrin, SKU, barkodin…" className="h-10 w-full rounded-ctl border border-field pl-9 pr-3 focus:border-brand-600 focus:outline-none" />
          </div>
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            options={[
              { value: 'active', label: 'Aktivët' },
              { value: 'low', label: `Stok i ulët (${low})` },
              { value: 'negative', label: 'Stok negativ' },
              { value: 'inactive', label: 'Joaktivët' },
            ]}
          />
          {(whs.data?.length ?? 0) > 1 && (
            <Select value={wh} onChange={(e) => setWh(e.target.value)} options={[{ value: '', label: 'Të gjitha depot' }, ...(whs.data ?? []).map((w) => ({ value: w.id, label: w.name }))]} />
          )}
          <Button variant="secondary" onClick={() => setImp(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button
            variant="secondary"
            disabled={!list.length}
            onClick={() =>
              void downloadSheets(`stoku-${client.name.replace(/\W+/g, '-').toLowerCase()}-${kosovoDateISO()}.xlsx`, [
                {
                  name: 'Stoku',
                  columns: ['SKU', 'Barkodi', 'Artikulli', 'Njësia', 'TVSH', 'Stoku', 'Stoku min.', 'Kosto mesatare', 'Vlera', 'Çmimi i shitjes', 'Statusi'],
                  rows: list.map((i) => [i.sku ?? '', i.barcode ?? '', i.name, i.unit, i.vat_code, stockOf(i), i.min_stock, i.avg_cost, Math.round(stockOf(i) * i.avg_cost * 100) / 100, i.sale_price, STATUS[i.status].label]),
                },
              ])
            }
          >
            <FileSpreadsheet className="h-4 w-4" />
          </Button>
          <Button onClick={() => setEdit({ unit: 'copë', vat_code: 'E', purchase_price: 0, sale_price: 0, min_stock: 0, active: true })}>
            <Plus className="h-4 w-4" /> Artikull
          </Button>
        </div>
        {items.isLoading ? (
          <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
        ) : items.error ? (
          <p className="px-5 pb-5 text-sm text-warn-700">{(items.error as Error).message}</p>
        ) : list.length === 0 ? (
          <EmptyState icon={<Boxes className="h-6 w-6" />} title="Asnjë artikull" text="Shto artikujt, importoji nga Excel, ose krijoji vetë nga rreshtat e faturave te “Nga faturat”." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(i)}>
                  <div className="truncate font-semibold text-brand-600 hover:underline">{i.name}</div>
                  <div className="truncate text-xs text-muted">
                    {[i.sku && `SKU ${i.sku}`, i.barcode, i.category, `kosto ${formatEUR(i.avg_cost)}`, i.sale_price ? `shitje ${formatEUR(i.sale_price)}` : null, i.min_stock ? `min. ${qtyFmt(i.min_stock)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </button>
                <div className="text-right">
                  <div className={cn('text-[17px] font-bold tabular-nums', stockOf(i) < 0 && 'text-warn-700')}>
                    {qtyFmt(stockOf(i))} <span className="text-sm font-normal text-muted">{i.unit}</span>
                  </div>
                  <div className="text-xs text-muted tabular-nums">{formatEUR(stockOf(i) * i.avg_cost)}</div>
                </div>
                {i.status !== 'ok' && <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setMove(i)}>
                  ± Lëvizje
                </Button>
                <button type="button" aria-label="Fshi" onClick={() => confirm(`Ta fshij "${i.name}"? (Me lëvizje vetëm çaktivizohet.)`) && del.mutate(i.id)} className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ItemDialog clientId={client.id} value={edit} onClose={() => setEdit(null)} onSaved={refresh} />
      <MoveDialog clientId={client.id} item={move} warehouses={whs.data ?? []} onClose={() => setMove(null)} onSaved={refresh} />
      <ImportItemsDialog clientId={client.id} open={imp} onClose={() => setImp(false)} onSaved={refresh} />
      <WarehousesDialog clientId={client.id} open={whOpen} onClose={() => setWhOpen(false)} />
    </>
  )
}

function ItemDialog({ clientId, value, onClose, onSaved }: { clientId: string; value: Partial<Item> | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Item>>({})
  useEffect(() => {
    if (value) setF(value)
  }, [value])
  const save = useMutation({
    mutationFn: () => saveItem(clientId, f),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const set = (k: keyof Item) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const margin = f.sale_price && f.purchase_price ? ((f.sale_price / (1 + (f.vat_code === 'E' ? 0.18 : f.vat_code === 'D' ? 0.08 : 0)) - f.purchase_price) / (f.sale_price / (1 + (f.vat_code === 'E' ? 0.18 : f.vat_code === 'D' ? 0.08 : 0)))) * 100 : null
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={f.id ? f.name ?? 'Artikulli' : 'Artikull i ri'}
      width="md:max-w-[640px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input label="Emri" value={f.name ?? ''} onChange={set('name')} />
        </div>
        <Input label="SKU / kodi" value={f.sku ?? ''} onChange={set('sku')} />
        <Input label="Barkodi" value={f.barcode ?? ''} onChange={set('barcode')} />
        <div>
          <Input label="Njësia" list="inv-units" value={f.unit ?? ''} onChange={set('unit')} />
          <datalist id="inv-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <Select label="TVSH" value={f.vat_code ?? 'E'} onChange={(e) => setF({ ...f, vat_code: e.target.value as VatCode })} options={[{ value: 'E', label: 'E – 18%' }, { value: 'D', label: 'D – 8%' }, { value: 'C', label: 'C – 0%' }, { value: 'A', label: 'A – e liruar' }]} />
        <Input label="Çmimi i blerjes pa TVSH (€)" inputMode="decimal" value={f.purchase_price ? String(f.purchase_price) : ''} onChange={(e) => setF({ ...f, purchase_price: num(e.target.value) })} />
        <Input label="Çmimi i shitjes me TVSH (€)" inputMode="decimal" value={f.sale_price ? String(f.sale_price) : ''} onChange={(e) => setF({ ...f, sale_price: num(e.target.value) })} />
        <Input label="Stoku minimal" inputMode="decimal" value={f.min_stock ? String(f.min_stock) : ''} onChange={(e) => setF({ ...f, min_stock: num(e.target.value) })} />
        <Input label="Kategoria" value={f.category ?? ''} onChange={set('category')} />
        <div className="sm:col-span-2">
          <Input label="Shënim" value={f.note ?? ''} onChange={set('note')} />
        </div>
        {f.id && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktiv
          </label>
        )}
        {margin != null && <p className="self-center text-sm text-muted">Marzha {margin.toFixed(1)}%</p>}
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

function MoveDialog({ clientId, item, warehouses, onClose, onSaved }: { clientId: string; item: Item | null; warehouses: { id: string; name: string; active: boolean }[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: 'in' as 'opening' | 'in' | 'out' | 'adjust', qty: '', unit_cost: '', warehouse_id: '', move_date: kosovoDateISO(), note: '' })
  useEffect(() => {
    if (item) setF({ kind: item.stock === 0 && !item.last_move ? 'opening' : 'in', qty: '', unit_cost: item.purchase_price ? String(item.purchase_price) : '', warehouse_id: '', move_date: kosovoDateISO(), note: '' })
  }, [item])
  const save = useMutation({
    mutationFn: () => addMove({ client_id: clientId, item_id: item!.id, kind: f.kind, qty: num(f.qty), unit_cost: f.unit_cost ? num(f.unit_cost) : null, warehouse_id: f.warehouse_id || null, move_date: f.move_date, note: f.note }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(item)}
      onClose={onClose}
      title={`Lëvizje – ${item?.name ?? ''}`}
      subtitle={item ? `Stoku tani ${qtyFmt(item.stock)} ${item.unit}` : undefined}
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} disabled={!num(f.qty)} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Lloji"
          value={f.kind}
          onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}
          options={[
            { value: 'opening', label: 'Gjendje fillestare' },
            { value: 'in', label: 'Hyrje (pa faturë)' },
            { value: 'out', label: 'Dalje (humbje, përdorim, dëm)' },
            { value: 'adjust', label: 'Korrigjim (+/−)' },
          ]}
        />
        <Input label={f.kind === 'adjust' ? 'Ndryshimi (p.sh. −2)' : 'Sasia'} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        {(f.kind === 'opening' || f.kind === 'in') && <Input label="Kosto për njësi pa TVSH (€)" inputMode="decimal" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: e.target.value })} />}
        <Input label="Data" type="date" value={f.move_date} onChange={(e) => setF({ ...f, move_date: e.target.value })} />
        {warehouses.length > 1 && <Select label="Depoja" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })} options={[{ value: '', label: 'Depoja kryesore' }, ...warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: w.name }))]} />}
        <div className="sm:col-span-2">
          <Input label="Shënim" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

const IMPORT_COLUMNS: [string, string][] = [
  ['sku', 'SKU'],
  ['barcode', 'Barkodi'],
  ['name', 'Emri'],
  ['unit', 'Njësia'],
  ['vat_code', 'TVSH (E/D/C/A)'],
  ['purchase_price', 'Çmimi i blerjes pa TVSH'],
  ['sale_price', 'Çmimi i shitjes me TVSH'],
  ['min_stock', 'Stoku minimal'],
  ['category', 'Kategoria'],
  ['opening_qty', 'Gjendja fillestare'],
]

function ImportItemsDialog({ clientId, open, onClose, onSaved }: { clientId: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [date, setDate] = useState(kosovoDateISO())
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ new: number; updated: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setRows([])
      setErr(null)
      setDone(null)
    }
  }, [open])
  const read = async (file: File) => {
    setErr(null)
    try {
      const { readSheet } = await import('read-excel-file/browser')
      const data = (await readSheet(file)) as unknown[][]
      const head = (data[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase())
      const idx = (key: string, label: string) => head.findIndex((h) => h === key || h === label.toLowerCase() || h.startsWith(label.toLowerCase().split(' ')[0]))
      const map = IMPORT_COLUMNS.map(([k, l]) => [k, idx(k, l)] as const)
      if (map.find(([k]) => k === 'name')![1] < 0) throw new Error('Mungon kolona “Emri”. Shkarko shabllonin.')
      setRows(
        data
          .slice(1)
          .map((r) => Object.fromEntries(map.filter(([, i]) => i >= 0).map(([k, i]) => [k, r[i] == null ? '' : String(r[i]).trim()])))
          .filter((r) => r.name),
      )
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const save = useMutation({ mutationFn: () => importItems(clientId, rows, date), onSuccess: (r) => (setDone(r), onSaved()) })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import i artikujve nga Excel"
      subtitle="Ekzistuesit gjenden sipas SKU-së ose emrit dhe përditësohen"
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => void downloadSheets('shablloni-artikujt.xlsx', [{ name: 'Artikujt', columns: IMPORT_COLUMNS.map(([, l]) => l), rows: [['CC05', '3800000000000', 'Coca Cola 0.5L', 'copë', 'E', 0.5, 0.9, 24, 'Pije', 48]] }])}>
            Shablloni
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {done ? 'Mbyll' : 'Anulo'}
            </Button>
            {!done && (
              <Button loading={save.isPending} disabled={!rows.length} onClick={() => save.mutate()}>
                Importo {rows.length || ''}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {done ? (
        <p className="text-[15px]">
          U shtuan <b>{done.new}</b> artikuj të rinj dhe u përditësuan <b>{done.updated}</b>.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => input.current?.click()} className="flex items-center justify-center gap-2 rounded-card border-2 border-dashed border-field px-4 py-6 text-sm font-semibold text-muted hover:border-brand-600">
            <Upload className="h-4 w-4" /> {rows.length ? `${rows.length} artikuj të lexuar` : 'Zgjidh skedarin Excel (.xlsx)'}
          </button>
          <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
          <Input label="Data e gjendjes fillestare" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="text-xs text-muted">Kolonat: {IMPORT_COLUMNS.map(([, l]) => l).join(', ')}. “Gjendja fillestare” vlen vetëm për artikujt e rinj.</p>
          {err && <p className="text-sm text-warn-700">{err}</p>}
        </div>
      )}
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

function WarehousesDialog({ clientId, open, onClose }: { clientId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const whs = useWarehouses(clientId)
  const [name, setName] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', clientId, 'warehouses'] })
  const add = useMutation({ mutationFn: () => saveWarehouse({ client_id: clientId, name }), onSuccess: () => (setName(''), refresh()) })
  const upd = useMutation({ mutationFn: saveWarehouse, onSuccess: refresh })
  return (
    <Dialog open={open} onClose={onClose} title="Depot dhe dyqanet" width="md:max-w-[480px]" footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Mbyll</Button></div>}>
      <ul className="divide-y divide-line rounded-card border border-line">
        {(whs.data ?? []).map((w) => (
          <li key={w.id} className={cn('flex items-center gap-2 px-3 py-2.5', !w.active && 'opacity-50')}>
            <WarehouseIcon className="h-4 w-4 text-muted" />
            <span className="flex-1 font-medium">{w.name}</span>
            {w.is_default ? (
              <Badge tone="success">Kryesore</Badge>
            ) : (
              <>
                <button type="button" className="text-sm text-brand-600 hover:underline" onClick={() => upd.mutate({ id: w.id, client_id: clientId, name: w.name, is_default: true })}>
                  Bëje kryesore
                </button>
                <button type="button" className="text-sm text-muted hover:underline" onClick={() => upd.mutate({ id: w.id, client_id: clientId, name: w.name, active: !w.active })}>
                  {w.active ? 'Çaktivizo' : 'Aktivizo'}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <Input label="Depo / dyqan i ri" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button className="h-[46px]" loading={add.isPending} disabled={!name.trim()} onClick={() => add.mutate()}>
          Shto
        </Button>
      </div>
      {(add.error || upd.error) && <p className="mt-2 text-sm text-warn-700">{((add.error ?? upd.error) as Error).message}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------
function MovesView({ client }: { client: Client }) {
  const qc = useQueryClient()
  const items = useItems(client.id)
  const [item, setItem] = useState('')
  const [from, setFrom] = useState(() => addMonths(monthStart(), -2))
  const [to, setTo] = useState(() => kosovoDateISO())
  const moves = useQuery({ queryKey: ['client', client.id, 'moves', item, from, to], queryFn: () => fetchMoves(client.id, item || null, from, to) })
  const del = useMutation({ mutationFn: deleteMove, onSuccess: () => void qc.invalidateQueries({ queryKey: ['client', client.id] }) })
  const list = moves.data ?? []
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-5 py-4">
        <Select label="Artikulli" value={item} onChange={(e) => setItem(e.target.value)} options={[{ value: '', label: 'Të gjithë' }, ...(items.data ?? []).map((i) => ({ value: i.id, label: i.name }))]} />
        <Input label="Nga" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Deri" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button
          variant="secondary"
          className="ml-auto h-[46px]"
          disabled={!list.length}
          onClick={() =>
            void downloadSheets(`levizjet-${from}-${to}.xlsx`, [
              { name: 'Lëvizjet', columns: ['Data', 'Artikulli', 'Lloji', 'Sasia', 'Njësia', 'Kosto', 'Depoja', 'Fatura', 'Shënim'], rows: list.map((m) => [m.move_date, m.item_name, MOVE_LABELS[m.kind], m.qty, m.unit, m.unit_cost ?? '', m.warehouse_name, m.doc_no ?? '', m.note ?? '']) },
            ])
          }
        >
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </Button>
      </div>
      {moves.isLoading ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : moves.error ? (
        <p className="px-5 pb-5 text-sm text-warn-700">{(moves.error as Error).message}</p>
      ) : list.length === 0 ? (
        <EmptyState title="Asnjë lëvizje në këtë periudhë" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="w-[86px] text-sm text-muted">{formatDay(m.move_date)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.item_name}</div>
                <div className="truncate text-xs text-muted">
                  {[MOVE_LABELS[m.kind], m.warehouse_name, m.doc_no && `fatura ${m.doc_no}`, m.note, m.created_by_name].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className={cn('font-semibold tabular-nums', m.qty < 0 ? 'text-warn-700' : 'text-brand-600')}>
                {m.qty > 0 ? '+' : ''}
                {qtyFmt(m.qty)} {m.unit}
              </span>
              {!m.stocktake_id && !m.doc_id && (
                <button type="button" aria-label="Fshi" onClick={() => confirm(m.transfer_id ? 'Ta fshij transferin (të dyja anët)?' : 'Ta fshij lëvizjen?') && del.mutate(m.id)} className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {del.error && <p className="px-5 pb-3 text-sm text-warn-700">{(del.error as Error).message}</p>}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Stock from invoices
// ---------------------------------------------------------------------------
function DocsView({ client }: { client: Client }) {
  const [month, setMonth] = useState(() => monthStart())
  const docs = useQuery({ queryKey: ['client', client.id, 'stock-docs', month], queryFn: () => fetchStockDocs(client.id, month, addDays(addMonths(month, 1), -1)) })
  const [open, setOpen] = useState<StockDoc | null>(null)
  const list = docs.data ?? []
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
          <button type="button" aria-label="Muaji i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] px-2 text-center font-semibold">{monthName(month)}</span>
          <button type="button" aria-label="Muaji tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <p className="hidden text-sm text-muted md:block">Faturat e blerjes së mallit hyjnë në stok, të shitjes dalin – rresht për rresht, një herë.</p>
      </div>
      <Card className="overflow-hidden">
        {docs.isLoading ? (
          <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
        ) : docs.error ? (
          <p className="p-5 text-sm text-warn-700">{(docs.error as Error).message}</p>
        ) : list.length === 0 ? (
          <EmptyState icon={<PackagePlus className="h-6 w-6" />} title="Asnjë faturë me artikuj këtë muaj" text="Vlen për faturat e regjistruara “Me artikuj” (blerje malli ose shitje)." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((d) => {
              const full = d.posted >= d.lines
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Badge tone={d.kind === 'purchase' ? 'info' : 'neutral'}>{d.kind === 'purchase' ? 'Blerje' : 'Shitje'}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {d.partner_name ?? '—'} {d.doc_no && <span className="font-normal text-muted">· {d.doc_no}</span>}
                    </div>
                    <div className="text-xs text-muted">
                      {formatDay(d.doc_date)} · {d.lines} rreshta · {formatEUR(d.total)}
                      {d.doc_type === 'credit_note' && ' · kreditore'}
                    </div>
                  </div>
                  {d.posted > 0 && <Badge tone={full ? 'success' : 'amber'}>{full ? 'Në stok' : `${d.posted}/${d.lines} në stok`}</Badge>}
                  <Button size="sm" variant={full ? 'secondary' : 'primary'} onClick={() => setOpen(d)}>
                    {full ? 'Shiko' : d.kind === 'purchase' ? 'Fute në stok' : 'Nxirre nga stoku'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <DocStockDialog client={client} doc={open} onClose={() => setOpen(null)} />
    </>
  )
}

function DocStockDialog({ client, doc, onClose }: { client: Client; doc: StockDoc | null; onClose: () => void }) {
  const qc = useQueryClient()
  const lines = useQuery({ queryKey: ['client', client.id, 'doc-lines', doc?.id], queryFn: () => fetchDocLines(doc!.id), enabled: Boolean(doc) })
  const items = useItems(client.id)
  const whs = useWarehouses(client.id)
  const [map, setMap] = useState<Record<string, string>>({}) // line → item id | 'new' | 'skip'
  const [wh, setWh] = useState('')
  useEffect(() => {
    if (!lines.data) return
    setMap(Object.fromEntries(lines.data.lines.filter((l) => !l.posted).map((l) => [l.id, l.item_id ?? 'new'])))
  }, [lines.data])
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id] })
  const post = useMutation({
    mutationFn: () =>
      postDoc({
        doc_id: doc!.id,
        warehouse_id: wh || null,
        lines: Object.entries(map)
          .filter(([, v]) => v !== 'skip')
          .map(([line_id, v]) => (v === 'new' ? { line_id, new_item: { name: lines.data!.lines.find((l) => l.id === line_id)!.description } } : { line_id, item_id: v })),
      }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })
  const unpost = useMutation({ mutationFn: () => unpostDoc(doc!.id), onSuccess: () => (refresh(), onClose()) })
  const open = (lines.data?.lines ?? []).filter((l) => !l.posted)
  const posted = (lines.data?.lines ?? []).filter((l) => l.posted)
  const itemOptions = useMemo(() => (items.data ?? []).filter((i) => i.active).map((i) => ({ value: i.id, label: i.name + (i.sku ? ` · ${i.sku}` : '') })), [items.data])
  const purchase = doc?.kind === 'purchase'
  return (
    <Dialog
      open={Boolean(doc)}
      onClose={onClose}
      title={`${purchase ? 'Hyrje në stok' : 'Dalje nga stoku'} – ${doc?.doc_no ?? ''}`}
      subtitle={doc ? `${doc.partner_name ?? ''} · ${formatDay(doc.doc_date)}` : undefined}
      width="md:max-w-[760px]"
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {posted.length > 0 && (
              <Button variant="secondary" loading={unpost.isPending} onClick={() => confirm('Ta heq këtë faturë nga stoku?') && unpost.mutate()}>
                <Undo2 className="h-4 w-4" /> Hiqe nga stoku
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Mbyll
            </Button>
            {open.length > 0 && (
              <Button loading={post.isPending} onClick={() => post.mutate()}>
                {purchase ? 'Fute në stok' : 'Nxirre nga stoku'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {lines.isLoading ? (
        <p className="text-muted">Duke ngarkuar…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {open.length > 0 && (whs.data?.length ?? 0) > 1 && (
            <Select label="Depoja" value={wh} onChange={(e) => setWh(e.target.value)} options={[{ value: '', label: 'Depoja kryesore' }, ...(whs.data ?? []).filter((w) => w.active).map((w) => ({ value: w.id, label: w.name }))]} />
          )}
          {open.map((l) => (
            <div key={l.id} className="grid gap-2 rounded-card border border-line p-3 sm:grid-cols-[1fr_260px] sm:items-center">
              <div>
                <div className="font-medium">{l.description}</div>
                <div className="text-xs text-muted">
                  {qtyFmt(l.quantity)} {l.unit} · {formatEUR(l.net)} pa TVSH{purchase && l.quantity ? ` · ${formatEUR(l.net / l.quantity)}/njësi` : ''}
                </div>
              </div>
              <Select
                value={map[l.id] ?? 'new'}
                onChange={(e) => setMap({ ...map, [l.id]: e.target.value })}
                options={[{ value: 'new', label: '+ Artikull i ri me këtë emër' }, { value: 'skip', label: '— mos e fut (shërbim, transport…)' }, ...itemOptions]}
              />
            </div>
          ))}
          {posted.length > 0 && (
            <div className="rounded-card bg-[#F4F6F3] p-3 text-sm">
              <div className="mb-1 font-semibold">Tashmë në stok</div>
              {posted.map((l) => (
                <div key={l.id} className="flex justify-between gap-2 text-muted">
                  <span className="truncate">{l.description}</span>
                  <span className="tabular-nums">
                    {qtyFmt(l.quantity)} {l.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {(post.error || unpost.error || lines.error) && <p className="mt-3 text-sm text-warn-700">{((post.error ?? unpost.error ?? lines.error) as Error).message}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------
function TransferView({ client }: { client: Client }) {
  const qc = useQueryClient()
  const whs = useWarehouses(client.id)
  const items = useItems(client.id)
  const active = (whs.data ?? []).filter((w) => w.active)
  const [f, setF] = useState({ from: '', to: '', date: kosovoDateISO(), note: '' })
  const [lines, setLines] = useState<{ item_id: string; qty: string }[]>([{ item_id: '', qty: '' }])
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (active.length >= 2 && !f.from) setF((x) => ({ ...x, from: active[0].id, to: active[1].id }))
  }, [active, f.from])
  const save = useMutation({
    mutationFn: () => transfer({ client_id: client.id, from_warehouse: f.from, to_warehouse: f.to, move_date: f.date, note: f.note, lines: lines.filter((l) => l.item_id && num(l.qty) > 0).map((l) => ({ item_id: l.item_id, qty: num(l.qty) })) }),
    onSuccess: () => {
      setOk(true)
      setLines([{ item_id: '', qty: '' }])
      void qc.invalidateQueries({ queryKey: ['client', client.id] })
    },
  })
  if (whs.isLoading) return <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
  if (active.length < 2)
    return (
      <Card>
        <EmptyState icon={<WarehouseIcon className="h-6 w-6" />} title="Duhen të paktën dy depo" text="Shto depon ose dyqanin e dytë te Artikujt → Depot → Menaxho." />
      </Card>
    )
  const stockIn = (itemId: string, whId: string) => (items.data ?? []).find((i) => i.id === itemId)?.by_wh[whId] ?? 0
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Transfer mes depove</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Select label="Nga" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} options={active.map((w) => ({ value: w.id, label: w.name }))} />
        <Select label="Te" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} options={active.map((w) => ({ value: w.id, label: w.name }))} />
        <Input label="Data" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Input label="Shënim" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <Select
                label={i === 0 ? 'Artikulli' : undefined}
                value={l.item_id}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)))}
                options={[{ value: '', label: 'Zgjidh artikullin' }, ...(items.data ?? []).filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.name} (në depo: ${qtyFmt(stockIn(x.id, f.from))})` }))]}
              />
            </div>
            <div className="w-[120px]">
              <Input label={i === 0 ? 'Sasia' : undefined} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            </div>
            <button type="button" aria-label="Hiqe" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ item_id: '', qty: '' }])} className="flex h-[46px] w-10 items-center justify-center text-muted hover:text-warn-700">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" className="self-start text-sm font-semibold text-brand-600 hover:underline" onClick={() => setLines([...lines, { item_id: '', qty: '' }])}>
          + Artikull tjetër
        </button>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button loading={save.isPending} disabled={f.from === f.to} onClick={() => (setOk(false), save.mutate())}>
          <ArrowLeftRight className="h-4 w-4" /> Bëje transferin
        </Button>
        {ok && <span className="text-sm text-brand-600">Transferi u regjistrua (shihet te Lëvizjet).</span>}
        {save.error && <span className="text-sm text-warn-700">{(save.error as Error).message}</span>}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Stocktaking
// ---------------------------------------------------------------------------
function StocktakeView({ client }: { client: Client }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['client', client.id, 'stocktakes'], queryFn: () => fetchStocktakes(client.id) })
  const whs = useWarehouses(client.id)
  const [wh, setWh] = useState('')
  const [date, setDate] = useState(kosovoDateISO())
  const [open, setOpen] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => createStocktake(client.id, wh || null, date),
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ['client', client.id, 'stocktakes'] })
      setOpen(id)
    },
  })
  return (
    <>
      <Card className="p-5">
        <h2 className="text-[17px] font-semibold">Inventarizim i ri</h2>
        <p className="text-sm text-muted">Merr gjendjen e programit për çdo artikull aktiv; ti shkruan sasinë e numëruar. Diferencat regjistrohen si korrigjime kur e poston.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {(whs.data?.length ?? 0) > 1 && <Select label="Depoja" value={wh} onChange={(e) => setWh(e.target.value)} options={[{ value: '', label: 'Depoja kryesore' }, ...(whs.data ?? []).filter((w) => w.active).map((w) => ({ value: w.id, label: w.name }))]} />}
          <Input label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button className="h-[46px]" loading={create.isPending} onClick={() => create.mutate()}>
            Fillo
          </Button>
        </div>
        {create.error && <p className="mt-2 text-sm text-warn-700">{(create.error as Error).message}</p>}
      </Card>
      <Card className="overflow-hidden">
        {(list.data ?? []).length === 0 ? (
          <EmptyState title="Asnjë inventarizim" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {formatDay(s.take_date)} · {s.warehouse_name}
                  </div>
                  <div className="text-xs text-muted">
                    {s.counted}/{s.lines} të numëruar · {s.diffs} diferenca
                  </div>
                </div>
                <Badge tone={s.status === 'posted' ? 'success' : 'amber'}>{s.status === 'posted' ? 'E postuar' : 'Në punë'}</Badge>
                <Button size="sm" variant="secondary" onClick={() => setOpen(s.id)}>
                  {s.status === 'posted' ? 'Shiko' : 'Vazhdo'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <StocktakeDialog id={open} client={client} onClose={() => setOpen(null)} />
    </>
  )
}

function StocktakeDialog({ id, client, onClose }: { id: string | null; client: Client; onClose: () => void }) {
  const qc = useQueryClient()
  const st = useQuery({ queryKey: ['client', client.id, 'stocktake', id], queryFn: () => fetchStocktake(id!), enabled: Boolean(id) })
  const [q, setQ] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id] })
  const count = useMutation({ mutationFn: ({ item, v }: { item: string; v: number | null }) => countStocktake(id!, item, v), onSuccess: () => void qc.invalidateQueries({ queryKey: ['client', client.id, 'stocktake', id] }) })
  const post = useMutation({ mutationFn: () => postStocktake(id!), onSuccess: () => (refresh(), onClose()) })
  const del = useMutation({ mutationFn: () => deleteStocktake(id!), onSuccess: () => (refresh(), onClose()) })
  const d = st.data
  const draft = d?.status === 'draft'
  const s = q.trim().toLowerCase()
  const lines = (d?.lines ?? []).filter((l) => !s || [l.name, l.sku, l.barcode].some((x) => x?.toLowerCase().includes(s)))
  const diffValue = (d?.lines ?? []).reduce((a, l) => a + (l.counted == null ? 0 : (l.counted - l.expected) * l.avg_cost), 0)
  return (
    <Dialog
      open={Boolean(id)}
      onClose={onClose}
      title={d ? `Inventarizimi ${formatDay(d.take_date)} · ${d.warehouse_name}` : 'Inventarizimi'}
      subtitle={d ? `Diferenca në vlerë: ${formatEUR(diffValue)}` : undefined}
      width="md:max-w-[820px]"
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" loading={del.isPending} onClick={() => confirm(draft ? 'Ta fshij këtë inventarizim?' : 'Ta fshij? Korrigjimet e tij hiqen nga stoku.') && del.mutate()}>
              Fshi
            </Button>
            {d && (
              <Button
                variant="secondary"
                onClick={() =>
                  void downloadSheets(`inventarizimi-${d.take_date}.xlsx`, [
                    { name: 'Inventarizimi', columns: ['Artikulli', 'SKU', 'Njësia', 'Në program', 'Numëruar', 'Diferenca', 'Kosto', 'Vlera e diferencës'], rows: d.lines.map((l) => [l.name, l.sku ?? '', l.unit, l.expected, l.counted ?? '', l.counted == null ? '' : l.counted - l.expected, l.avg_cost, l.counted == null ? '' : Math.round((l.counted - l.expected) * l.avg_cost * 100) / 100]) },
                  ])
                }
              >
                <FileSpreadsheet className="h-4 w-4" /> Lista
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Mbyll
            </Button>
            {draft && (
              <Button loading={post.isPending} onClick={() => confirm('Ta postoj? Diferencat regjistrohen në stok.') && post.mutate()}>
                Posto
              </Button>
            )}
          </div>
        </div>
      }
    >
      {st.isLoading || !d ? (
        <p className="text-muted">Duke ngarkuar…</p>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko ose skano barkodin…" className="mb-3 h-10 w-full rounded-ctl border border-field px-3 focus:border-brand-600 focus:outline-none" />
          <div className="max-h-[55vh] overflow-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#F6F9F7] text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Artikulli</th>
                  <th className="px-2 py-2 text-right font-medium">Në program</th>
                  <th className="px-2 py-2 text-right font-medium">Numëruar</th>
                  <th className="px-3 py-2 text-right font-medium">Diferenca</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const diff = l.counted == null ? null : l.counted - l.expected
                  return (
                    <tr key={l.item_id} className="border-t border-line">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{l.name}</div>
                        <div className="text-xs text-muted">{[l.sku, l.unit].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyFmt(l.expected)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {draft ? (
                          <CountInput value={l.counted} onSave={(v) => count.mutate({ item: l.item_id, v })} />
                        ) : (
                          <span className="tabular-nums">{l.counted == null ? '—' : qtyFmt(l.counted)}</span>
                        )}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums', diff != null && diff < 0 && 'text-warn-700', diff != null && diff > 0 && 'text-brand-600')}>
                        {diff == null || diff === 0 ? '' : `${diff > 0 ? '+' : ''}${qtyFmt(diff)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(post.error || del.error || count.error) && <p className="mt-3 text-sm text-warn-700">{((post.error ?? del.error ?? count.error) as Error).message}</p>}
    </Dialog>
  )
}

function CountInput({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => setV(value == null ? '' : String(value)), [value])
  return (
    <input
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const next = v.trim() === '' ? null : num(v)
        if (next !== value) onSave(next)
      }}
      className="h-9 w-24 rounded-lg border border-field px-2 text-right"
    />
  )
}
