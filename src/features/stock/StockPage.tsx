import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, Equal, Truck } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Button, Card, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatQty, unitLabel } from '@/lib/units'
import { CatalogNotMigrated, fetchCategories, fetchProducts, stockLevel, type Product } from '@/features/products/api'
import {
  fetchEntries,
  fetchInventoryCounts,
  fetchMovements,
  fetchPeople,
  fetchSuppliers,
  formatDateTime,
  REASON_LABELS,
  StockNotMigrated,
  todayISO,
  type StockEntry,
  type StockEntryItem,
} from './api'
import { addLine, emptyDraft, EntryEditor, type EntryDraft } from './EntryEditor'
import { EntriesTab } from './EntriesTab'
import { InventoryTab } from './InventoryTab'
import { MovementsTab } from './MovementsTab'
import { SuppliersTab } from './SuppliersTab'

type Tab = 'hyrje' | 'historiku' | 'levizjet' | 'inventarizimi' | 'furnitoret'

const TABS: { value: Tab; label: string }[] = [
  { value: 'hyrje', label: 'Hyrje e re' },
  { value: 'historiku', label: 'Historiku i hyrjeve' },
  { value: 'levizjet', label: 'Lëvizjet e stokut' },
  { value: 'inventarizimi', label: 'Inventarizimi' },
  { value: 'furnitoret', label: 'Furnitorët' },
]

const DRAFT_KEY = 'kasa.entryDraft'

function loadDraft(): EntryDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) return JSON.parse(raw) as EntryDraft
  } catch {
    /* storage unavailable */
  }
  return emptyDraft(todayISO())
}

/** Suggested quantity for a low product: back up to twice the minimum. */
function suggestedQty(p: Product): number {
  const q = Math.max(p.min_stock * 2 - p.stock, 1)
  return p.unit === 'kg' ? Math.round(q * 1000) / 1000 : Math.ceil(q)
}

export function StockPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'hyrje') as Tab
  const setTab = (t: Tab) => setParams(t === 'hyrje' ? {} : { tab: t }, { replace: true })

  const products = useQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true) })
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories })
  const suppliers = useQuery({ queryKey: ['stock', 'suppliers'], queryFn: fetchSuppliers })
  const entries = useQuery({ queryKey: ['stock', 'entries'], queryFn: () => fetchEntries() })
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, staleTime: 5 * 60_000 })

  const [draft, setDraftState] = useState<EntryDraft>(loadDraft)
  const [notice, setNotice] = useState<string | null>(null)
  const setDraft = useCallback((fn: (d: EntryDraft) => EntryDraft) => setDraftState((d) => fn(d)), [])
  useEffect(() => {
    try {
      if (draft.lines.length || draft.id || draft.invoice_no) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* storage unavailable */
    }
  }, [draft])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const all = products.data ?? []
  const stockProducts = useMemo(() => all.filter((p) => p.active && p.kind === 'product'), [all])
  const stockValue = useMemo(() => stockProducts.reduce((s, p) => s + Math.max(p.stock, 0) * (p.purchase_price ?? 0), 0), [stockProducts])
  const low = useMemo(
    () =>
      stockProducts
        .filter((p) => ['low', 'critical'].includes(stockLevel(p)))
        .sort((a, b) => a.stock / a.min_stock - b.stock / b.min_stock),
    [stockProducts],
  )

  const peopleMap = people.data ?? new Map<string, string>()
  const notMigrated = [suppliers.error, entries.error].some((e) => e instanceof StockNotMigrated)
  const catalogMissing = [products.error, categories.error].some((e) => e instanceof CatalogNotMigrated)

  const exportReport = async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const cat = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
    const header = ['Barkodi', 'Emri', 'Kategoria', 'Njësia', 'Stoku', 'Min.', 'Ç. blerjes', 'Vlera', 'Statusi'].map((v) => ({ value: v, fontWeight: 'bold' as const }))
    const rows = stockProducts.map((p) => {
      const level = stockLevel(p)
      return [
        { value: p.barcode ?? '', type: String },
        { value: p.name, type: String },
        { value: p.category_id ? cat.get(p.category_id) ?? '' : '', type: String },
        { value: unitLabel(p.unit), type: String },
        { value: p.stock, type: Number },
        { value: p.min_stock, type: Number },
        { value: p.purchase_price ?? 0, type: Number, format: '0.00' },
        { value: Math.round(Math.max(p.stock, 0) * (p.purchase_price ?? 0) * 100) / 100, type: Number, format: '0.00' },
        { value: level === 'critical' ? 'Kritik' : level === 'low' ? 'I ulët' : p.stock <= 0 ? 'Pa stok' : 'Në rregull', type: String },
      ]
    })
    await writeXlsxFile([header, ...rows], {
      columns: [{ width: 16 }, { width: 34 }, { width: 18 }, { width: 8 }, { width: 10 }, { width: 8 }, { width: 11 }, { width: 12 }, { width: 12 }],
    }).toFile(`stoku-${todayISO()}.xlsx`)
  }

  const openDraft = (entry: StockEntry, items: StockEntryItem[]) => {
    setDraftState({
      id: entry.id,
      supplier_id: entry.supplier_id,
      invoice_no: entry.invoice_no ?? '',
      entry_date: entry.entry_date,
      payment: entry.payment,
      due_days: entry.due_days,
      note: entry.note ?? '',
      lines: items.map((i) => ({ product_id: i.product_id, name: i.name, unit: i.unit, vat_code: i.vat_code, quantity: String(i.quantity), unit_cost: String(i.unit_cost) })),
    })
    setTab('hyrje')
  }

  const addLowToEntry = () => {
    setDraft((d) => low.reduce((acc, p) => addLine(acc, p, suggestedQty(p)), d))
    setTab('hyrje')
  }

  if (notMigrated || catalogMissing) {
    return (
      <>
        <PageHeader title="Stoku & Hyrjet" />
        <div className="px-4 py-5 md:px-8 md:py-0">
          <Card>
            <EmptyState
              icon={<Truck className="h-6 w-6" />}
              title="Stoku nuk është aktivizuar ende"
              text={`Administratori duhet të ekzekutojë migrimin supabase/migrations/${catalogMissing ? '0001_catalog.sql' : '0003_stock.sql'} në Supabase.`}
            />
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={<span className="md:hidden">Vlera e stokut: {formatEUR(stockValue)}</span>}
        title="Stoku & Hyrjet"
        actions={
          <Button variant="secondary" className="hidden md:inline-flex" onClick={() => void exportReport()} disabled={!products.data}>
            Eksporto raportin
          </Button>
        }
      />
      <p className="-mt-5 hidden px-8 pb-4 text-muted md:block">
        Vlera e stokut: <b className="text-ink tabular-nums">{formatEUR(stockValue)}</b> (me çmim blerjeje)
      </p>

      <div className="sticky top-[env(safe-area-inset-top)] z-20 border-b border-line bg-bg md:static md:mx-8">
        <nav className="-mb-px flex gap-1 overflow-x-auto px-4 md:px-0" aria-label="Skedat e stokut">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                'h-12 shrink-0 whitespace-nowrap border-b-2 px-4 text-[15px] font-medium',
                tab === t.value ? 'border-brand-600 font-semibold text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
              {t.value === 'hyrje' && draft.lines.length > 0 && <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 text-xs text-white">{draft.lines.length}</span>}
            </button>
          ))}
        </nav>
      </div>

      {notice && <div className="mx-4 mt-4 rounded-card border border-brand-600/30 bg-brand-100 px-4 py-3 font-medium text-brand-600 md:mx-8">{notice}</div>}

      <div className="flex flex-col gap-5 px-4 pb-28 pt-5 md:px-8 md:pb-8 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          {loadState(products) === 'offline' ? (
              <OfflineEmpty />
            ) : loadState(products) === 'loading' ? (
            <Card>
              <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
            </Card>
          ) : tab === 'hyrje' ? (
            <EntryEditor
              draft={draft}
              setDraft={setDraft}
              products={all}
              suppliers={suppliers.data ?? []}
              onSuppliersChanged={() => void qc.invalidateQueries({ queryKey: ['stock', 'suppliers'] })}
              onDone={(msg) => {
                if (msg !== 'Drafti u ruajt') setDraftState(emptyDraft(todayISO()))
                if (msg) setNotice(msg)
              }}
            />
          ) : tab === 'historiku' ? (
            <EntriesTab entries={entries.data ?? []} suppliers={suppliers.data ?? []} people={peopleMap} onOpenDraft={openDraft} />
          ) : tab === 'levizjet' ? (
            <MovementsTab products={all} people={peopleMap} />
          ) : tab === 'inventarizimi' ? (
            <InventoryTab products={all} categories={categories.data ?? []} people={peopleMap} />
          ) : (
            <SuppliersTab suppliers={suppliers.data ?? []} entries={entries.data ?? []} onChanged={() => void qc.invalidateQueries({ queryKey: ['stock', 'suppliers'] })} />
          )}
        </div>

        <aside className="flex flex-col gap-5 xl:w-[320px] xl:shrink-0">
          <LowStockCard low={low} onAdd={addLowToEntry} />
          <RecentCard entries={entries.data ?? []} />
        </aside>
      </div>
    </>
  )
}

function LowStockCard({ low, onAdd }: { low: Product[]; onAdd: () => void }) {
  if (low.length === 0) {
    return (
      <Card className="p-5">
        <div className="font-semibold">Stoku në rregull</div>
        <p className="mt-1 text-sm text-muted">Asnjë produkt nën minimum.</p>
      </Card>
    )
  }
  return (
    <div className="rounded-card border border-[#F3C9AE] bg-[#FFF4EC] p-5">
      <div className="flex items-center gap-2 text-[17px] font-semibold text-warn-700">
        <AlertTriangle className="h-5 w-5" />
        {low.length} {low.length === 1 ? 'produkt' : 'produkte'} nën minimum
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-[15px]">
        {low.slice(0, 6).map((p) => (
          <li key={p.id} className="flex justify-between gap-3">
            <span className="truncate">{p.name}</span>
            <span className={cn('shrink-0 font-semibold tabular-nums', stockLevel(p) === 'critical' ? 'text-warn-700' : 'text-amber-700')}>
              {formatQty(p.stock, p.unit).replace(/ .*/, '')} / {formatQty(p.min_stock, p.unit).replace(/ .*/, '')}
            </span>
          </li>
        ))}
        {low.length > 6 && <li className="text-sm text-muted">+ {low.length - 6} të tjera</li>}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 h-11 w-full rounded-ctl border border-[#F3C9AE] bg-white font-semibold text-warn-700 hover:bg-warn-100"
      >
        Shto të gjitha në hyrje
      </button>
    </div>
  )
}

interface RecentItem {
  key: string
  at: string
  icon: 'in' | 'out' | 'inv'
  title: string
  sub: string
  value: number | null
}

function RecentCard({ entries }: { entries: StockEntry[] }) {
  const counts = useQuery({ queryKey: ['stock', 'inventory'], queryFn: fetchInventoryCounts })
  const adjustments = useQuery({ queryKey: ['stock', 'movements', 'recent-adjust'], queryFn: () => fetchMovements({ kind: 'adjustment', limit: 5 }) })
  const products = useQuery({ queryKey: ['products', 'admin'], queryFn: () => fetchProducts(true) })
  const names = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data])

  const items = useMemo(() => {
    const list: RecentItem[] = []
    for (const e of entries) {
      if (e.status !== 'confirmed' || !e.confirmed_at) continue
      list.push({ key: 'e' + e.id, at: e.confirmed_at, icon: 'in', title: `Hyrje · ${e.invoice_no ?? `H-${e.entry_no}`}`, sub: `${e.items_count} produkte`, value: e.total })
    }
    for (const c of counts.data ?? []) {
      list.push({ key: 'c' + c.id, at: c.created_at, icon: 'inv', title: `Inventarizim · ${c.title ?? '#' + c.count_no}`, sub: `${c.diff_count} dallime`, value: c.value_diff })
    }
    for (const m of adjustments.data ?? []) {
      const p = names.get(m.product_id)
      list.push({
        key: 'm' + m.id,
        at: m.created_at,
        icon: m.quantity < 0 ? 'out' : 'in',
        title: `Shkarkim · ${m.reason ? REASON_LABELS[m.reason].toLowerCase() : ''}`,
        sub: `${p?.name ?? ''} × ${Math.abs(m.quantity)}`,
        value: p?.purchase_price ? Math.round(m.quantity * p.purchase_price * 100) / 100 : null,
      })
    }
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  }, [entries, counts.data, adjustments.data, names])

  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Lëvizjet e fundit</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Ende asgjë.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-3 py-3">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  i.icon === 'in' ? 'bg-brand-100 text-brand-600' : i.icon === 'out' ? 'bg-warn-100 text-warn-700' : 'bg-[#EEF1EE] text-muted',
                )}
              >
                {i.icon === 'in' ? <ArrowDown className="h-4 w-4" /> : i.icon === 'out' ? <AlertTriangle className="h-4 w-4" /> : <Equal className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{i.title}</div>
                <div className="truncate text-xs text-muted">
                  {formatDateTime(i.at)} · {i.sub}
                </div>
              </div>
              {i.value !== null && (
                <span className={cn('shrink-0 font-semibold tabular-nums', i.value < 0 ? 'text-warn-700' : 'text-brand-600')}>
                  {i.value > 0 ? '+' : ''}
                  {formatEUR(i.value)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
