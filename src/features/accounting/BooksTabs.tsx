import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, StatCard, Table, Tabs, Td, Th } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
import { formatQty } from '@/lib/units'
import { VAT_LABELS, type VatCode } from '@/lib/vat'
import {
  deleteExpense,
  EXPENSE_LABELS,
  fetchExpenses,
  fetchPurchaseLines,
  fetchPurchases,
  fetchSaleDocs,
  fetchSaleLines,
  fetchStockList,
  formatDay,
  PAYMENT_LABELS,
  saveExpense,
  type Expense,
  type ExpenseCategory,
  type ExpenseInput,
  type PurchaseDoc,
  type SaleDoc,
  type Summary,
} from './api'
import { downloadCsv, salesDailySheet, salesDocsSheet } from './export'

const SHOWN = 300
const KIND_LABEL = { sale: 'Shitje', void: 'Anulim', refund: 'Kthim' } as const
const PAY_LABEL = { cash: 'Kesh', card: 'Kartelë', mixed: 'Kesh + Kartelë' } as const

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative md:w-[320px]">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none"
      />
    </div>
  )
}

function Loading({ error }: { error: unknown }) {
  return <p className={cn('px-5 py-10 text-center', error ? 'text-warn-700' : 'text-muted')}>{error ? (error as Error).message : 'Duke ngarkuar…'}</p>
}

// ---------------------------------------------------------------------------
// Libri i shitjeve
// ---------------------------------------------------------------------------
export function SalesTab({ s }: { s: Summary }) {
  const { business } = useBusiness()
  const [view, setView] = useState<'daily' | 'docs'>('daily')
  const [kind, setKind] = useState<'all' | 'sale' | 'corrections'>('all')
  const [register, setRegister] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<SaleDoc | null>(null)

  const docs = useQuery({
    queryKey: ['acc', business.id, 'sales', s.from, s.to],
    queryFn: () => fetchSaleDocs(business.id, s.from, s.to),
    enabled: view === 'docs',
  })
  const numbers = useMemo(() => new Map((docs.data ?? []).map((d) => [d.id, d.invoice_no])), [docs.data])
  const voided = useMemo(() => new Set((docs.data ?? []).filter((d) => d.kind === 'void' && d.ref_sale_id).map((d) => d.ref_sale_id!)), [docs.data])
  const registers = useMemo(() => new Map(s.registers.map((r) => [r.id, r.name])), [s.registers])

  const list = useMemo(() => {
    const text = q.trim().replace('#', '').replace(',', '.').replace(/^0+/, '')
    return (docs.data ?? [])
      .filter((d) => (kind === 'all' ? true : kind === 'sale' ? d.kind === 'sale' : d.kind !== 'sale'))
      .filter((d) => !register || d.register_id === register)
      .filter((d) => !text || String(d.invoice_no).includes(text) || d.total.toFixed(2).includes(text))
      .reverse()
  }, [docs.data, kind, register, q])

  const rate = (r: { gross: number; net: number; vat: number } | undefined, field: 'net' | 'vat' | 'gross') => (r && r[field] !== 0 ? formatEUR(r[field]) : '—')

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Shitjet (me TVSH)" value={formatEUR(s.sales.gross)} sub={`${s.sales.docs} kuponë`} />
        <StatCard label="Baza (pa TVSH)" value={formatEUR(s.sales.net)} />
        <StatCard label="TVSH e mbledhur" value={formatEUR(s.sales.vat)} />
        <StatCard
          label="Anulime dhe kthime"
          value={formatEUR(s.sales.void_total + s.sales.refund_total)}
          tone={s.sales.voids + s.sales.refunds > 0 ? 'warn' : 'default'}
          sub={`${s.sales.voids} anulime · ${s.sales.refunds} kthime`}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: 'daily', label: 'Sipas ditës' },
              { value: 'docs', label: 'Kuponët' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            {view === 'docs' && (
              <>
                <Select
                  aria-label="Lloji"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                  options={[
                    { value: 'all', label: 'Të gjitha' },
                    { value: 'sale', label: 'Vetëm shitjet' },
                    { value: 'corrections', label: 'Anulimet dhe kthimet' },
                  ]}
                />
                {s.registers.length > 1 && (
                  <Select aria-label="Arka" value={register} onChange={(e) => setRegister(e.target.value)} options={[{ value: '', label: 'Të gjitha arkat' }, ...s.registers.map((r) => ({ value: r.id, label: r.name }))]} />
                )}
                <SearchBox value={q} onChange={setQ} placeholder="Nr. i kuponit ose shuma" />
              </>
            )}
            <Button
              variant="secondary"
              disabled={view === 'docs' ? !docs.data : s.daily.length === 0}
              onClick={() => downloadCsv(`libri-i-shitjeve-${s.from}-${s.to}.csv`, view === 'docs' ? salesDocsSheet(s, docs.data ?? []) : salesDailySheet(s))}
            >
              CSV
            </Button>
          </div>
        </div>

        {view === 'daily' ? (
          s.daily.length === 0 ? (
            <EmptyState title="Asnjë shitje në këtë periudhë" />
          ) : (
            <Table>
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-5">Data</Th>
                  <Th>Kuponët</Th>
                  <Th className="text-right">Baza 18%</Th>
                  <Th className="text-right">TVSH 18%</Th>
                  <Th className="text-right">Baza 8%</Th>
                  <Th className="text-right">TVSH 8%</Th>
                  <Th className="text-right">0% / e liruar</Th>
                  <Th className="pr-5 text-right">Totali</Th>
                </tr>
              </thead>
              <tbody>
                {s.daily.map((d) => (
                  <tr key={d.date}>
                    <Td className="whitespace-nowrap pl-5">{formatDay(d.date)}</Td>
                    <Td className="whitespace-nowrap text-muted">
                      {formatInvoiceNo(d.first_no)}–{formatInvoiceNo(d.last_no)}
                      {d.corrections > 0 && <Badge tone="amber" className="ml-2">{d.corrections} korrigjime</Badge>}
                    </Td>
                    <Td className="text-right">{rate(d.rates.E, 'net')}</Td>
                    <Td className="text-right">{rate(d.rates.E, 'vat')}</Td>
                    <Td className="text-right">{rate(d.rates.D, 'net')}</Td>
                    <Td className="text-right">{rate(d.rates.D, 'vat')}</Td>
                    <Td className="text-right">{(d.rates.C?.gross ?? 0) + (d.rates.A?.gross ?? 0) !== 0 ? formatEUR((d.rates.C?.gross ?? 0) + (d.rates.A?.gross ?? 0)) : '—'}</Td>
                    <Td className="pr-5 text-right font-semibold">{formatEUR(d.gross)}</Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td className="border-b-0 pl-5">Gjithsej</Td>
                  <Td className="border-b-0" />
                  <Td className="border-b-0 text-right">{rate(s.vat_out.find((v) => v.code === 'E'), 'net')}</Td>
                  <Td className="border-b-0 text-right">{rate(s.vat_out.find((v) => v.code === 'E'), 'vat')}</Td>
                  <Td className="border-b-0 text-right">{rate(s.vat_out.find((v) => v.code === 'D'), 'net')}</Td>
                  <Td className="border-b-0 text-right">{rate(s.vat_out.find((v) => v.code === 'D'), 'vat')}</Td>
                  <Td className="border-b-0 text-right">{formatEUR(s.vat_out.filter((v) => v.code === 'C' || v.code === 'A').reduce((a, v) => a + v.gross, 0))}</Td>
                  <Td className="border-b-0 pr-5 text-right">{formatEUR(s.sales.gross)}</Td>
                </tr>
              </tbody>
            </Table>
          )
        ) : !docs.data ? (
          <Loading error={docs.error} />
        ) : list.length === 0 ? (
          <EmptyState title="Asnjë kupon" />
        ) : (
          <>
            <Table>
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-5">Nr.</Th>
                  <Th>Data / ora</Th>
                  <Th>Lloji</Th>
                  <Th className="hidden lg:table-cell">Arka</Th>
                  <Th className="hidden md:table-cell">Pagesa</Th>
                  <Th className="hidden text-right md:table-cell">Baza</Th>
                  <Th className="hidden text-right md:table-cell">TVSH</Th>
                  <Th className="text-right">Totali</Th>
                  <Th className="pr-5" />
                </tr>
              </thead>
              <tbody>
                {list.slice(0, SHOWN).map((d) => {
                  const isVoided = d.kind === 'sale' && voided.has(d.id)
                  return (
                    <tr key={d.id}>
                      <Td className={cn('pl-5 font-semibold', isVoided && 'text-muted line-through')}>{formatInvoiceNo(d.invoice_no)}</Td>
                      <Td className="whitespace-nowrap">{formatKosovoDateTime(d.created_at)}</Td>
                      <Td>
                        {d.kind === 'sale' ? (
                          isVoided ? (
                            <Badge tone="warn">Anuluar</Badge>
                          ) : d.offline ? (
                            <Badge tone="amber">Offline</Badge>
                          ) : (
                            <Badge>Shitje</Badge>
                          )
                        ) : (
                          <Badge tone={d.kind === 'void' ? 'warn' : 'amber'}>
                            {KIND_LABEL[d.kind]}
                            {d.ref_sale_id && numbers.has(d.ref_sale_id) ? ` i ${formatInvoiceNo(numbers.get(d.ref_sale_id)!)}` : ''}
                          </Badge>
                        )}
                      </Td>
                      <Td className="hidden lg:table-cell">{d.register_id ? registers.get(d.register_id) ?? '—' : '—'}</Td>
                      <Td className="hidden md:table-cell">{PAY_LABEL[d.payment_method]}</Td>
                      <Td className="hidden text-right md:table-cell">{formatEUR(d.net_total)}</Td>
                      <Td className="hidden text-right md:table-cell">{formatEUR(d.vat_total)}</Td>
                      <Td className={cn('text-right font-semibold', isVoided && 'text-muted')}>{formatEUR(d.total)}</Td>
                      <Td className="pr-5 text-right">
                        <button type="button" onClick={() => setOpen(d)} className="font-semibold text-brand-600 underline">
                          Shiko
                        </button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {list.length > SHOWN && <p className="px-5 py-3 text-sm text-muted">Shfaqen {SHOWN} nga {list.length}. Përdor kërkimin, filtrat ose eksportin për të gjitha.</p>}
          </>
        )}
      </Card>

      <SaleDialog doc={open} refNo={open?.ref_sale_id ? numbers.get(open.ref_sale_id) : undefined} register={open?.register_id ? registers.get(open.register_id) : undefined} onClose={() => setOpen(null)} />
    </>
  )
}

function SaleDialog({ doc, refNo, register, onClose }: { doc: SaleDoc | null; refNo?: number; register?: string; onClose: () => void }) {
  const lines = useQuery({ queryKey: ['acc', 'sale-lines', doc?.id], queryFn: () => fetchSaleLines(doc!.id), enabled: Boolean(doc) })
  if (!doc) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${KIND_LABEL[doc.kind]} ${formatInvoiceNo(doc.invoice_no)}`}
      subtitle={[formatKosovoDateTime(doc.created_at), register, PAY_LABEL[doc.payment_method], refNo ? `për kuponin ${formatInvoiceNo(refNo)}` : null].filter(Boolean).join(' · ')}
      width="md:max-w-[680px]"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Mbyll
          </Button>
        </div>
      }
    >
      {doc.reason && <p className="mb-3 rounded-ctl bg-amber-100 px-4 py-2.5 text-sm text-amber-700">Arsyeja: {doc.reason}</p>}
      {!lines.data ? (
        <Loading error={lines.error} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="pl-0">Artikulli</Th>
              <Th className="text-right">Sasia</Th>
              <Th className="text-right">Çmimi</Th>
              <Th className="text-right">Zbritja</Th>
              <Th>TVSH</Th>
              <Th className="pr-0 text-right">Totali</Th>
            </tr>
          </thead>
          <tbody>
            {lines.data.map((l) => (
              <tr key={l.id}>
                <Td className="pl-0">{l.name}</Td>
                <Td className="whitespace-nowrap text-right">{formatQty(l.quantity, l.unit)}</Td>
                <Td className="text-right">{formatEUR(l.unit_price)}</Td>
                <Td className="text-right">{l.line_discount + l.invoice_discount ? formatEUR(l.line_discount + l.invoice_discount) : '—'}</Td>
                <Td>{l.vat_code}</Td>
                <Td className="pr-0 text-right font-semibold">{formatEUR(l.total)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        {doc.vat_lines.map((v) => (
          <div key={v.code} className="text-muted">
            {VAT_LABELS[v.code]}: baza {formatEUR(v.net)} · TVSH {formatEUR(v.vat)}
          </div>
        ))}
        <div className="text-base font-semibold">Totali {formatEUR(doc.total)}</div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Libri i blerjeve
// ---------------------------------------------------------------------------
export function PurchasesTab({ s }: { s: Summary }) {
  const { business } = useBusiness()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<PurchaseDoc | null>(null)
  const docs = useQuery({ queryKey: ['acc', business.id, 'purchases', s.from, s.to], queryFn: () => fetchPurchases(business.id, s.from, s.to) })

  const list = useMemo(() => {
    const text = q.trim().toLowerCase()
    return (docs.data ?? []).filter((d) => !text || [d.supplier?.name, d.supplier?.nui, d.invoice_no].some((v) => v?.toLowerCase().includes(text))).reverse()
  }, [docs.data, q])

  const bySupplier = useMemo(() => {
    const map = new Map<string, { name: string; docs: number; total: number; vat: number }>()
    for (const d of docs.data ?? []) {
      const key = d.supplier?.name ?? 'Pa furnitor'
      const cur = map.get(key) ?? { name: key, docs: 0, total: 0, vat: 0 }
      map.set(key, { name: key, docs: cur.docs + 1, total: cur.total + d.total, vat: cur.vat + d.vat_total })
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [docs.data])

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Blerjet (me TVSH)" value={formatEUR(s.purchases.gross)} sub={`${s.purchases.docs} fatura`} />
        <StatCard label="Baza (pa TVSH)" value={formatEUR(s.purchases.net)} />
        <StatCard label="TVSH e zbritshme" value={formatEUR(s.purchases.vat)} />
        <StatCard label="Me afat pagese" value={formatEUR(s.purchases.due)} tone={s.purchases.due > 0 ? 'warn' : 'default'} sub={`Kesh ${formatEUR(s.purchases.cash)} · bankë ${formatEUR(s.purchases.bank)}`} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <h2 className="text-[17px] font-semibold">Faturat e blerjes</h2>
          <SearchBox value={q} onChange={setQ} placeholder="Furnitori, NUI ose nr. i faturës" />
        </div>
        {!docs.data ? (
          <Loading error={docs.error} />
        ) : list.length === 0 ? (
          <EmptyState title="Asnjë hyrje malli në këtë periudhë" text="Blerjet vijnë nga hyrjet e konfirmuara te Stoku & Hyrjet." />
        ) : (
          <>
            <Table>
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-5">Data</Th>
                  <Th>Furnitori</Th>
                  <Th className="hidden md:table-cell">Nr. i faturës</Th>
                  <Th className="hidden md:table-cell">Pagesa</Th>
                  <Th className="hidden text-right md:table-cell">Baza</Th>
                  <Th className="hidden text-right md:table-cell">TVSH</Th>
                  <Th className="text-right">Totali</Th>
                  <Th className="pr-5" />
                </tr>
              </thead>
              <tbody>
                {list.slice(0, SHOWN).map((d) => (
                  <tr key={d.id}>
                    <Td className="whitespace-nowrap pl-5">{formatDay(d.entry_date)}</Td>
                    <Td>
                      <div className="font-medium">{d.supplier?.name ?? 'Pa furnitor'}</div>
                      {d.supplier?.nui && <div className="text-xs text-muted">NUI {d.supplier.nui}</div>}
                    </Td>
                    <Td className="hidden md:table-cell">{d.invoice_no || '—'}</Td>
                    <Td className="hidden md:table-cell">{d.payment === 'due' ? <Badge tone="amber">Me afat{d.due_days ? ` ${d.due_days} ditë` : ''}</Badge> : PAYMENT_LABELS[d.payment]}</Td>
                    <Td className="hidden text-right md:table-cell">{formatEUR(d.net_total)}</Td>
                    <Td className="hidden text-right md:table-cell">{formatEUR(d.vat_total)}</Td>
                    <Td className="text-right font-semibold">{formatEUR(d.total)}</Td>
                    <Td className="pr-5 text-right">
                      <button type="button" onClick={() => setOpen(d)} className="font-semibold text-brand-600 underline">
                        Shiko
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.length > SHOWN && <p className="px-5 py-3 text-sm text-muted">Shfaqen {SHOWN} nga {list.length}. Eksporti i përmban të gjitha.</p>}
          </>
        )}
      </Card>

      {bySupplier.length > 0 && (
        <Card className="overflow-hidden lg:max-w-[720px]">
          <h2 className="px-5 pt-5 text-[17px] font-semibold">Sipas furnitorit</h2>
          <Table className="mt-3">
            <thead>
              <tr>
                <Th className="pl-5">Furnitori</Th>
                <Th className="text-right">Fatura</Th>
                <Th className="text-right">TVSH</Th>
                <Th className="pr-5 text-right">Totali</Th>
              </tr>
            </thead>
            <tbody>
              {bySupplier.map((r) => (
                <tr key={r.name}>
                  <Td className="pl-5">{r.name}</Td>
                  <Td className="text-right">{r.docs}</Td>
                  <Td className="text-right">{formatEUR(r.vat)}</Td>
                  <Td className="pr-5 text-right font-semibold">{formatEUR(r.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <PurchaseDialog doc={open} onClose={() => setOpen(null)} />
    </>
  )
}

function PurchaseDialog({ doc, onClose }: { doc: PurchaseDoc | null; onClose: () => void }) {
  const lines = useQuery({ queryKey: ['acc', 'purchase-lines', doc?.id], queryFn: () => fetchPurchaseLines(doc!.id), enabled: Boolean(doc) })
  if (!doc) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={doc.supplier?.name ?? 'Hyrje malli'}
      subtitle={[formatDay(doc.entry_date), doc.invoice_no ? `fatura ${doc.invoice_no}` : null, doc.entry_no ? `H-${String(doc.entry_no).padStart(4, '0')}` : null, PAYMENT_LABELS[doc.payment]].filter(Boolean).join(' · ')}
      width="md:max-w-[680px]"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Mbyll
          </Button>
        </div>
      }
    >
      {!lines.data ? (
        <Loading error={lines.error} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="pl-0">Artikulli</Th>
              <Th className="text-right">Sasia</Th>
              <Th className="text-right">Çmimi i blerjes</Th>
              <Th>TVSH</Th>
              <Th className="pr-0 text-right">Totali</Th>
            </tr>
          </thead>
          <tbody>
            {lines.data.map((l) => (
              <tr key={l.id}>
                <Td className="pl-0">{l.name}</Td>
                <Td className="whitespace-nowrap text-right">{formatQty(l.quantity, l.unit)}</Td>
                <Td className="text-right">{formatEUR(l.unit_cost)}</Td>
                <Td>{l.vat_code}</Td>
                <Td className="pr-0 text-right font-semibold">{formatEUR(l.total)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        {doc.vat_lines.map((v) => (
          <div key={v.code} className="text-muted">
            {VAT_LABELS[v.code]}: baza {formatEUR(v.net)} · TVSH {formatEUR(v.vat)}
          </div>
        ))}
        <div className="text-base font-semibold">Totali {formatEUR(doc.total)}</div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Shpenzimet
// ---------------------------------------------------------------------------
const CATEGORY_OPTIONS = (Object.keys(EXPENSE_LABELS) as ExpenseCategory[]).map((value) => ({ value, label: EXPENSE_LABELS[value] }))
const VAT_OPTIONS: { value: VatCode; label: string }[] = [
  { value: 'A', label: 'Pa TVSH' },
  { value: 'E', label: '18% (E)' },
  { value: 'D', label: '8% (D)' },
  { value: 'C', label: '0% (C)' },
]

export function ExpensesTab({ s }: { s: Summary }) {
  const { business } = useBusiness()
  const qc = useQueryClient()
  const [edit, setEdit] = useState<ExpenseInput | null>(null)
  const [remove, setRemove] = useState<Expense | null>(null)
  const list = useQuery({ queryKey: ['acc', business.id, 'expenses', s.from, s.to], queryFn: () => fetchExpenses(business.id, s.from, s.to) })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['acc', business.id, 'expenses'] })
    void qc.invalidateQueries({ queryKey: ['acc', business.id, 'summary'] })
    void qc.invalidateQueries({ queryKey: ['clients'] })
  }
  const del = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => {
      setRemove(null)
      refresh()
    },
  })

  const today = kosovoDateISO()
  const blank = (): ExpenseInput => ({
    expense_date: today >= s.from && today <= s.to ? today : s.to,
    category: 'rent',
    description: '',
    vendor: '',
    doc_no: '',
    vat_code: 'A',
    total: 0,
    payment: 'bank',
  })

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Shpenzimet (me TVSH)" value={formatEUR(s.expenses.gross)} sub={`${s.expenses.docs} të regjistruara`} />
        <StatCard label="Pa TVSH" value={formatEUR(s.expenses.net)} />
        <StatCard label="TVSH e zbritshme" value={formatEUR(s.expenses.vat)} />
        <StatCard label="Të papaguara (me afat)" value={formatEUR(s.expenses.due)} tone={s.expenses.due > 0 ? 'warn' : 'default'} />
      </div>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="text-[17px] font-semibold">Shpenzimet e periudhës</h2>
            <Button onClick={() => setEdit(blank())}>
              <Plus className="h-4 w-4" /> Shpenzim i ri
            </Button>
          </div>
          {!list.data ? (
            <Loading error={list.error} />
          ) : list.data.length === 0 ? (
            <EmptyState title="Asnjë shpenzim" text="Regjistro qiranë, rrymën, pagat dhe shpenzimet e tjera që të dalin te fitimi dhe te TVSH-ja e zbritshme." />
          ) : (
            <Table>
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-5">Data</Th>
                  <Th>Kategoria</Th>
                  <Th className="hidden md:table-cell">Furnitori / dokumenti</Th>
                  <Th className="hidden md:table-cell">Pagesa</Th>
                  <Th className="hidden text-right md:table-cell">TVSH</Th>
                  <Th className="text-right">Totali</Th>
                  <Th className="pr-5" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap pl-5">{formatDay(e.expense_date)}</Td>
                    <Td>
                      <div className="font-medium">{EXPENSE_LABELS[e.category]}</div>
                      {e.description && <div className="text-xs text-muted">{e.description}</div>}
                    </Td>
                    <Td className="hidden md:table-cell">{[e.vendor, e.doc_no].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td className="hidden md:table-cell">{e.payment === 'due' ? <Badge tone="amber">Me afat</Badge> : PAYMENT_LABELS[e.payment]}</Td>
                    <Td className="hidden text-right md:table-cell">{e.vat_total ? formatEUR(e.vat_total) : '—'}</Td>
                    <Td className="text-right font-semibold">{formatEUR(e.total)}</Td>
                    <Td className="whitespace-nowrap pr-5 text-right">
                      <button type="button" aria-label="Ndrysho" title="Ndrysho" onClick={() => setEdit({ ...e, description: e.description ?? '', vendor: e.vendor ?? '', doc_no: e.doc_no ?? '' })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label="Fshi" title="Fshi" onClick={() => setRemove(e)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-warn-100 hover:text-warn-700">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="overflow-hidden">
          <h2 className="px-5 pt-5 text-[17px] font-semibold">Sipas kategorisë</h2>
          {s.expense_categories.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Ende pa shpenzime.</p>
          ) : (
            <div className="px-5 pb-3 pt-2">
              {s.expense_categories.map((c) => (
                <div key={c.category} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 text-sm last:border-b-0">
                  <span>{EXPENSE_LABELS[c.category]}</span>
                  <span className="font-semibold tabular-nums">{formatEUR(c.gross)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ExpenseDialog
        value={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null)
          refresh()
        }}
      />

      <Dialog
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        title="Të fshihet shpenzimi?"
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Anulo
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => remove && del.mutate(remove.id)}>
              Fshije
            </Button>
          </div>
        }
      >
        {remove && (
          <p className="text-[15px]">
            {EXPENSE_LABELS[remove.category]} · {formatDay(remove.expense_date)} · <strong>{formatEUR(remove.total)}</strong>. Fshirja shënohet te regjistri i veprimeve.
          </p>
        )}
        {del.error && <p className="mt-3 text-sm text-warn-700">{(del.error as Error).message}</p>}
      </Dialog>
    </>
  )
}

function ExpenseDialog({ value, onClose, onSaved }: { value: ExpenseInput | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ExpenseInput | null>(null)
  const [amount, setAmount] = useState('')
  const [seed, setSeed] = useState<ExpenseInput | null>(null)
  if (value !== seed) {
    // A different expense was opened: load it into the form.
    setSeed(value)
    setForm(value)
    setAmount(value && value.total ? value.total.toFixed(2) : '')
  }
  const save = useMutation({
    mutationFn: async () => {
      const total = Number(amount.replace(',', '.'))
      if (!form) return
      if (!form.expense_date) throw new Error('Zgjidh datën')
      if (!Number.isFinite(total) || total <= 0) throw new Error('Shkruaj shumën')
      await saveExpense({ ...form, total })
    },
    onSuccess: onSaved,
  })
  if (!value || !form) return null
  const set = <K extends keyof ExpenseInput>(k: K, v: ExpenseInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const total = Number(amount.replace(',', '.'))
  const rate = form.vat_code === 'E' ? 0.18 : form.vat_code === 'D' ? 0.08 : 0
  const vat = Number.isFinite(total) && total > 0 ? total - total / (1 + rate) : 0

  return (
    <Dialog
      open
      onClose={() => {
        save.reset()
        onClose()
      }}
      title={form.id ? 'Ndrysho shpenzimin' : 'Shpenzim i ri'}
      width="md:max-w-[560px]"
      footer={
        <div className="flex items-center justify-end gap-3">
          {save.error && <span className="mr-auto text-sm text-warn-700">{(save.error as Error).message}</span>}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Input label="Data" type="date" value={form.expense_date} onChange={(e) => set('expense_date', e.target.value)} />
        <Select label="Kategoria" value={form.category} onChange={(e) => set('category', e.target.value as ExpenseCategory)} options={CATEGORY_OPTIONS} />
        <Input label="Shuma (me TVSH)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} hint={vat > 0 ? `Prej saj TVSH ${formatEUR(vat)}` : undefined} />
        <Select label="TVSH" value={form.vat_code} onChange={(e) => set('vat_code', e.target.value as VatCode)} options={VAT_OPTIONS} />
        <Input label="Furnitori" value={form.vendor ?? ''} onChange={(e) => set('vendor', e.target.value)} placeholder="p.sh. KESCO" />
        <Input label="Nr. i faturës / dokumentit" value={form.doc_no ?? ''} onChange={(e) => set('doc_no', e.target.value)} />
        <Select
          label="Pagesa"
          value={form.payment}
          onChange={(e) => set('payment', e.target.value as ExpenseInput['payment'])}
          options={[
            { value: 'bank', label: 'Bankë' },
            { value: 'cash', label: 'Kesh' },
            { value: 'due', label: 'Me afat (e papaguar)' },
          ]}
        />
        <Input label="Përshkrimi" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="p.sh. Qiraja e tetorit" />
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Stoku dhe çmimet
// ---------------------------------------------------------------------------
export function StockTab({ s }: { s: Summary }) {
  const { business } = useBusiness()
  const [q, setQ] = useState('')
  const [onlyStock, setOnlyStock] = useState(true)
  const list = useQuery({ queryKey: ['acc', business.id, 'stock'], queryFn: () => fetchStockList(business.id) })

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase()
    return (list.data ?? []).filter((r) => (!onlyStock || r.stock !== 0) && (!text || r.name.toLowerCase().includes(text) || r.barcode?.includes(text) || r.category?.toLowerCase().includes(text)))
  }, [list.data, q, onlyStock])

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Vlera e stokut (çmim blerjeje)" value={formatEUR(s.stock.gross)} sub={s.business.vat_registered ? `Pa TVSH ${formatEUR(s.stock.net)}` : undefined} />
        <StatCard label="Vlera me çmim shitjeje" value={formatEUR(s.stock.sale_value)} />
        <StatCard label="Artikuj me stok" value={String(s.stock.items)} />
        <StatCard label="Shkarkime dhe dallime inventari" value={formatEUR(s.adjustments.writeoffs + s.adjustments.inventory)} tone={s.adjustments.writeoffs + s.adjustments.inventory < 0 ? 'warn' : 'default'} sub="në periudhën e zgjedhur" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[17px] font-semibold">Gjendja e stokut sot</h2>
            <p className="text-sm text-muted">Sasia dhe çmimet janë të çastit, jo të fundit të periudhës.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Vetëm me stok
            </label>
            <SearchBox value={q} onChange={setQ} placeholder="Emri, barkodi ose kategoria" />
          </div>
        </div>
        {!list.data ? (
          <Loading error={list.error} />
        ) : rows.length === 0 ? (
          <EmptyState title="Asnjë artikull" />
        ) : (
          <>
            <Table>
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-5">Artikulli</Th>
                  <Th className="hidden md:table-cell">Kategoria</Th>
                  <Th className="text-right">Sasia</Th>
                  <Th className="text-right">Çmimi i blerjes</Th>
                  <Th className="text-right">Vlera</Th>
                  <Th className="hidden text-right md:table-cell">Çmimi i shitjes</Th>
                  <Th className="hidden pr-5 text-right md:table-cell">Marzha</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOWN).map((r) => {
                  const margin = r.sale_price > 0 && r.purchase_price > 0 ? (r.sale_price - r.purchase_price) / r.sale_price : null
                  return (
                    <tr key={r.id}>
                      <Td className="pl-5">
                        <div className="font-medium">{r.name}</div>
                        {r.barcode && <div className="text-xs text-muted">{r.barcode}</div>}
                      </Td>
                      <Td className="hidden md:table-cell">{r.category ?? '—'}</Td>
                      <Td className={cn('whitespace-nowrap text-right', r.stock < 0 && 'text-warn-700')}>
                        {formatQty(r.stock, r.unit)}
                      </Td>
                      <Td className="text-right">{r.purchase_price ? formatEUR(r.purchase_price) : '—'}</Td>
                      <Td className="text-right font-semibold">{formatEUR(r.stock * r.purchase_price)}</Td>
                      <Td className="hidden text-right md:table-cell">{formatEUR(r.sale_price)}</Td>
                      <Td className={cn('hidden pr-5 text-right md:table-cell', margin != null && margin < 0 && 'text-warn-700')}>{margin == null ? '—' : `${(margin * 100).toFixed(1)}%`}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {rows.length > SHOWN && <p className="px-5 py-3 text-sm text-muted">Shfaqen {SHOWN} nga {rows.length}. Eksporti në Excel i përmban të gjitha.</p>}
          </>
        )}
      </Card>
    </>
  )
}
