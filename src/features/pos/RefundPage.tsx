import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Minus, Plus } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Button, Card, Dialog, Input, Select } from '@/components/ui'
import { hasModule, isManagerRole } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR, formatInvoiceNo, round2 } from '@/lib/money'
import { unitLabel } from '@/lib/units'
import { VAT_RATES } from '@/lib/vat'
import { APPROVAL_MESSAGES, lookupSale, refundSale, type Sale, type SaleItem } from './api'
import { ApprovalDialog } from './dialogs'
import { formatDateTime, PrintArea, Receipt } from './Receipt'
import { printReceipt } from '@/lib/printer'
import { fetchReceiptSettings } from '@/features/settings/api'

const REASONS = ['Produkt i dëmtuar', 'Afati ka skaduar', 'Gabim në arkë', 'Klienti ndërroi mendje', 'Tjetër']

const left = (i: SaleItem) => round2(i.quantity - i.refunded)

/** Same rule as refund_sale on the server: the whole remaining quantity returns exactly what is left. */
function refundLineTotal(i: SaleItem, qty: number): number {
  if (qty <= 0) return 0
  if (qty === left(i)) {
    const refundedTotal = i.refunded ? round2((i.total * i.refunded) / i.quantity) : 0
    return round2(i.total - refundedTotal)
  }
  return round2((i.total * qty) / i.quantity)
}

export function RefundPage() {
  const { business, profile } = useBusiness()
  const manager = isManagerRole(profile.role)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [number, setNumber] = useState(params.get('nr') ?? '')
  const [sale, setSale] = useState<Sale | null>(null)
  const [finding, setFinding] = useState(false)
  const [findError, setFindError] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const [restock, setRestock] = useState(hasModule(business.type, 'stock'))
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  // Exchange: the refund stays in the drawer as credit for the new sale (cash refund + cash tender).
  const [exchange, setExchange] = useState(false)
  const [approve, setApprove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Sale | null>(null)
  const [printing, setPrinting] = useState(false)
  const receiptSettings = useQuery({ queryKey: ['receipt-settings'], queryFn: fetchReceiptSettings, retry: false, staleTime: 5 * 60_000, networkMode: 'always' })

  const find = async (raw = number) => {
    const n = Number(raw.replace(/\D/g, ''))
    if (!n) return
    setFinding(true)
    setFindError(null)
    setSale(null)
    setQty({})
    try {
      const s = await lookupSale(n)
      if (!s) setFindError(`Fatura ${formatInvoiceNo(n)} nuk u gjet`)
      else if (s.kind !== 'sale') setFindError(`${formatInvoiceNo(n)} është vetë anulim/kthim, jo shitje`)
      else if (s.voided) setFindError(`Fatura ${formatInvoiceNo(n)} është anuluar`)
      else {
        setSale(s)
        setMethod(s.card_amount > 0 && s.cash_amount === 0 ? 'card' : 'cash')
      }
    } catch (e) {
      setFindError((e as Error).message)
    } finally {
      setFinding(false)
    }
  }

  useEffect(() => {
    if (params.get('nr')) void find(params.get('nr')!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chosen = useMemo(() => (sale ? sale.items.filter((i) => (qty[i.id] ?? 0) > 0) : []), [sale, qty])
  const summary = useMemo(() => {
    let total = 0
    let vat = 0
    let count = 0
    const byRate = new Map<string, number>()
    for (const i of chosen) {
      const t = refundLineTotal(i, qty[i.id])
      total += t
      count += qty[i.id]
      byRate.set(i.vat_code, (byRate.get(i.vat_code) ?? 0) + t)
    }
    for (const [code, gross] of byRate) vat += round2(gross - round2(gross / (1 + VAT_RATES[code as keyof typeof VAT_RATES])))
    return { total: round2(total), vat: round2(vat), count }
  }, [chosen, qty])

  const setItemQty = (i: SaleItem, q: number) => {
    const max = left(i)
    const v = Math.max(0, Math.min(max, i.unit === 'kg' ? round2(q) : Math.round(q)))
    setQty((prev) => ({ ...prev, [i.id]: v }))
  }

  const submit = async (approverId?: string, pin?: string) => {
    if (!sale || chosen.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const r = await refundSale({
        client_id: crypto.randomUUID(),
        sale_id: sale.id,
        items: chosen.map((i) => ({ sale_item_id: i.id, quantity: qty[i.id] })),
        reason: reason === 'Tjetër' && note.trim() ? note.trim() : reason,
        note: note.trim() || undefined,
        restock,
        method: exchange ? 'cash' : method,
        approver_id: approverId,
        pin,
      })
      if (!r.ok) {
        setError(APPROVAL_MESSAGES[r.error])
        if (!manager) setApprove(true)
        return
      }
      setApprove(false)
      setDone(r.sale)
      void qc.invalidateQueries({ queryKey: ['today-sales'] })
      void qc.invalidateQueries({ queryKey: ['pos-products'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
    } catch (e) {
      setError((e as Error).message)
      setApprove(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 pb-8 pt-5 md:px-8 md:pt-8">
      <Link to="/arka" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
        <ChevronLeft className="h-4 w-4" /> Kthehu te arka
      </Link>
      <h1 className="mt-1 text-[26px] font-bold md:text-[30px]">Kthim malli</h1>

      <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">1. Gjej faturën</h2>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void find()
              }}
            >
              <input
                autoFocus
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                inputMode="numeric"
                placeholder="Numri i faturës, p.sh. 487"
                className="h-[52px] min-w-0 flex-1 rounded-xl border-2 border-field px-4 text-lg focus:border-brand-600 focus:outline-none"
              />
              <Button type="submit" size="lg" variant="secondary" loading={finding}>
                Gjej
              </Button>
            </form>
            {findError && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{findError}</p>}
            {sale && (
              <div className="mt-3 flex flex-wrap justify-between gap-2 rounded-ctl bg-bg px-4 py-2.5 text-sm">
                <span>
                  <strong>{formatInvoiceNo(sale.invoice_no)}</strong> · {formatDateTime(sale.client_created_at ?? sale.created_at)}
                  {sale.worker_name && ` · ${sale.worker_name}`}
                </span>
                <span className="text-muted">
                  Totali {formatEUR(sale.total)} · {sale.payment_method === 'cash' ? 'Kesh' : sale.payment_method === 'card' ? 'Kartelë' : 'Kesh + Kartelë'}
                </span>
              </div>
            )}
          </Card>

          {sale && (
            <>
              <Card className="p-5">
                <h2 className="text-[17px] font-semibold">2. Zgjidh artikujt që kthehen</h2>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {sale.items.map((i) => {
                    const q = qty[i.id] ?? 0
                    const max = left(i)
                    const on = q > 0
                    return (
                      <li
                        key={i.id}
                        className={cn('flex items-center gap-3 rounded-xl border px-4 py-3', on ? 'border-2 border-brand-600 bg-[#F0F7F3] px-[15px] py-[11px]' : 'border-line', max <= 0 && 'opacity-50')}
                      >
                        <button
                          type="button"
                          disabled={max <= 0}
                          onClick={() => setItemQty(i, on ? 0 : max)}
                          aria-label={on ? 'Hiqe' : 'Zgjidhe'}
                          className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-field')}
                        >
                          {on && <Check className="h-4 w-4" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{i.name}</div>
                          <div className="text-xs text-muted">
                            Blerë {i.quantity} · {formatEUR(i.unit_price)} / {unitLabel(i.unit)}
                            {i.refunded > 0 && ` · kthyer ${i.refunded}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" disabled={q <= 0} onClick={() => setItemQty(i, q - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-field disabled:opacity-40">
                            <Minus className="h-4 w-4" />
                          </button>
                          {i.unit === 'kg' ? (
                            <input
                              value={q || ''}
                              onChange={(e) => setItemQty(i, Number(e.target.value.replace(',', '.')) || 0)}
                              inputMode="decimal"
                              className="h-9 w-16 rounded-lg border border-field text-center tabular-nums"
                            />
                          ) : (
                            <span className="w-8 text-center font-semibold tabular-nums">{q}</span>
                          )}
                          <button type="button" disabled={q >= max} onClick={() => setItemQty(i, q + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-field disabled:opacity-40">
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="hidden w-20 text-right font-semibold tabular-nums sm:block">{on ? `−${formatEUR(refundLineTotal(i, q))}` : '—'}</div>
                      </li>
                    )
                  })}
                </ul>
              </Card>

              <Card className="p-5">
                <h2 className="text-[17px] font-semibold">3. Arsyeja</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className={cn('h-10 rounded-full border px-4 text-sm font-medium', reason === r ? 'border-ink bg-ink text-white' : 'border-field bg-white')}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  <Input label="Shënim (opsional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="p.sh. shishja ishte e çarë" />
                </div>
                {hasModule(business.type, 'stock') && (
                  <label className="mt-4 flex cursor-pointer items-center gap-3 text-[15px]">
                    <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
                    Ktheje mallin në stok
                  </label>
                )}
              </Card>
            </>
          )}
        </div>

        {sale && (
          <Card className="p-5 lg:sticky lg:top-6 lg:w-[320px]">
            <h2 className="text-[17px] font-semibold">Përmbledhje e kthimit</h2>
            <div className="mt-3 flex justify-between text-sm text-muted">
              <span>Artikuj</span>
              <span className="tabular-nums">{summary.count}</span>
            </div>
            <div className="flex justify-between border-b border-dashed border-field pb-3 text-sm text-muted">
              <span>TVSH që kthehet</span>
              <span className="tabular-nums">{formatEUR(summary.vat)}</span>
            </div>
            <div className="flex items-end justify-between py-3">
              <span className="font-semibold">Kthehen klientit</span>
              <span className="text-[30px] font-bold tabular-nums">{formatEUR(summary.total)}</span>
            </div>
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-ctl border border-line px-3 py-2.5 text-[15px]">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={exchange} onChange={(e) => setExchange(e.target.checked)} />
              <span>
                <span className="font-semibold">Ndërrim</span>
                <span className="block text-xs text-muted">Klienti merr artikull tjetër; shuma kalon si kredi në faturën e re.</span>
              </span>
            </label>
            {!exchange && (
            <Select
              label="Mënyra e kthimit"
              value={method}
              onChange={(e) => setMethod(e.target.value as 'cash' | 'card')}
              options={[
                { value: 'cash', label: 'Kesh' },
                { value: 'card', label: 'Kartelë' },
              ]}
            />
            )}
            <p className="mt-3 text-xs text-muted">Kthimi lëshon kupon me shuma negative, i lidhur me faturën {formatInvoiceNo(sale.invoice_no)}.</p>
            {error && !approve && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{error}</p>}
            <Button
              size="lg"
              block
              className="mt-4"
              disabled={chosen.length === 0}
              loading={busy && !approve}
              onClick={() => (manager ? void submit() : setApprove(true))}
            >
              {exchange ? `Konfirmo ndërrimin · ${formatEUR(summary.total)}` : `Konfirmo kthimin · ${formatEUR(summary.total)}`}
            </Button>
            <Button variant="secondary" size="lg" block className="mt-2" onClick={() => navigate('/arka')}>
              Anulo
            </Button>
          </Card>
        )}
      </div>

      <ApprovalDialog
        request={
          approve && sale
            ? {
                action: exchange ? 'Ndërrim artikulli' : 'Kthim malli',
                details: [
                  { label: 'Fatura', value: formatInvoiceNo(sale.invoice_no) },
                  { label: 'Kthehen', value: formatEUR(summary.total) },
                  { label: 'Arsyeja', value: reason },
                ],
              }
            : null
        }
        requester={profile.full_name || 'Punëtori'}
        busy={busy}
        error={approve ? error : null}
        onApprove={(id, pin) => void submit(id, pin)}
        onCancel={() => {
          setApprove(false)
          setError(null)
        }}
      />

      <Dialog open={Boolean(done)} onClose={() => navigate('/arka')} width="md:max-w-[440px]">
        {done && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <div className="text-sm text-muted">{exchange ? 'Artikulli u kthye' : 'Kthimi u krye'}</div>
              <div className="mt-1 text-[28px] font-bold">
                {exchange ? 'Kredi për ndërrim ' : 'Jepi klientit '}
                <span className={exchange ? 'text-brand-600' : 'text-warn-700'}>{formatEUR(Math.abs(done.total))}</span>
              </div>
            </div>
            <div className="max-h-[50dvh] overflow-y-auto rounded-xl border border-line py-2">
              <Receipt sale={done} business={business} settings={receiptSettings.data} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                variant="secondary"
                size="lg"
                onClick={async () => {
                  if (receiptSettings.data && done) {
                    try {
                      if ((await printReceipt(done, business, receiptSettings.data)) === 'printer') return
                    } catch {
                      /* fall back to the browser */
                    }
                  }
                  setPrinting(true)
                  setTimeout(() => window.print(), 50)
                }}
              >
                Printo
              </Button>
              <Button
                size="lg"
                onClick={() =>
                  navigate(exchange ? `/arka?kredit=${Math.abs(done.total).toFixed(2)}&nga=${sale?.invoice_no ?? ''}` : '/arka')
                }
              >
                {exchange ? 'Zgjidh artikullin e ri' : 'Te arka'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      {printing && <PrintArea sale={done} business={business} settings={receiptSettings.data} />}
    </div>
  )
}
