import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Dialog, Input } from '@/components/ui'
import { isManagerRole } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
import { APPROVAL_MESSAGES, fetchTodaySales, getSale, localDate, voidSale, type Sale, type SaleRow } from './api'
import { ApprovalDialog } from './dialogs'
import { discardQueued, syncQueue, type QueuedSale } from './offline'
import { Receipt } from './Receipt'

const VOID_REASONS = ['Gabim në arkë', 'Klienti ndërroi mendje', 'Pagesa nuk u krye', 'Tjetër']
const KIND_LABEL = { sale: null, void: 'Anulim', refund: 'Kthim' } as const
const PAY_LABEL = { cash: 'Kesh', card: 'Kartelë', mixed: 'Kesh + Kartelë' } as const

const time = (iso: string) => new Date(iso).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })

export function SalesDialog({
  open,
  onClose,
  pending,
  registerId,
  onPrint,
  onRefund,
}: {
  open: boolean
  onClose: () => void
  pending: QueuedSale[]
  registerId: string | null
  onPrint: (s: Sale) => void
  onRefund: (invoiceNo: number) => void
}) {
  const { business, profile } = useBusiness()
  const qc = useQueryClient()
  const manager = isManagerRole(profile.role)
  const today = localDate()
  const list = useQuery({ queryKey: ['today-sales', today], queryFn: () => fetchTodaySales(today), enabled: open })
  const [selected, setSelected] = useState<Sale | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [voidStep, setVoidStep] = useState<'reason' | 'approve' | null>(null)
  const [reason, setReason] = useState(VOID_REASONS[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open1 = async (r: SaleRow) => {
    setLoadingId(r.id)
    setError(null)
    try {
      setSelected(await getSale(r.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingId(null)
    }
  }

  const close = () => {
    setSelected(null)
    setVoidStep(null)
    setError(null)
    onClose()
  }

  const doVoid = async (approverId?: string, pin?: string) => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const fullReason = reason === 'Tjetër' && note.trim() ? note.trim() : reason
      const r = await voidSale({
        client_id: crypto.randomUUID(),
        sale_id: selected.id,
        reason: fullReason,
        note: note.trim() || undefined,
        restock: true,
        approver_id: approverId,
        pin,
        register_id: registerId,
      })
      if (!r.ok) {
        setError(APPROVAL_MESSAGES[r.error])
        if (!manager) setVoidStep('approve')
        return
      }
      setVoidStep(null)
      setSelected(r.sale)
      void qc.invalidateQueries({ queryKey: ['today-sales'] })
      void qc.invalidateQueries({ queryKey: ['pos-products'] })
      void qc.invalidateQueries({ queryKey: ['products'] })
    } catch (e) {
      setError((e as Error).message)
      setVoidStep(manager ? 'reason' : null)
    } finally {
      setBusy(false)
    }
  }

  const rows = list.data ?? []
  const totalToday = rows.reduce((s, r) => s + r.total, 0)

  return (
    <>
      <Dialog open={open && voidStep !== 'approve'} onClose={close} title={selected ? undefined : 'Faturat e sotme'} subtitle={selected ? undefined : manager ? 'Të gjitha arkat' : 'Vetëm faturat e tua'} width="md:max-w-[560px]">
        {selected ? (
          <div className="flex flex-col gap-4">
            <button type="button" onClick={() => setSelected(null)} className="flex items-center gap-1 self-start text-sm font-semibold text-brand-600">
              <ChevronLeft className="h-4 w-4" /> Lista
            </button>
            <div className="max-h-[50dvh] overflow-y-auto rounded-xl border border-line py-2">
              <Receipt sale={selected} business={business} />
            </div>
            {error && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{error}</p>}
            {voidStep === 'reason' ? (
              <div className="flex flex-col gap-3 rounded-xl border border-[#F3C9AE] bg-[#FFF8F3] p-4">
                <div className="font-semibold">Anulo faturën {formatInvoiceNo(selected.invoice_no)}?</div>
                <div className="flex flex-wrap gap-2">
                  {VOID_REASONS.map((r) => (
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
                <Input label="Shënim (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <p className="text-sm text-muted">Lëshohet një kupon anulimi me shuma negative dhe malli kthehet në stok.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setVoidStep(null)}>
                    Mos e anulo
                  </Button>
                  <Button variant="danger" loading={busy} onClick={() => (manager ? void doVoid() : setVoidStep('approve'))}>
                    {manager ? 'Anulo faturën' : 'Kërko miratimin'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button variant="secondary" onClick={() => onPrint(selected)}>
                  Printo kopje
                </Button>
                <Button
                  variant="secondary"
                  disabled={selected.kind !== 'sale' || selected.voided}
                  onClick={() => {
                    close()
                    onRefund(selected.invoice_no)
                  }}
                >
                  Kthim
                </Button>
                <Button
                  variant="danger"
                  disabled={selected.kind !== 'sale' || selected.voided || selected.has_refunds}
                  onClick={() => {
                    setReason(VOID_REASONS[0])
                    setNote('')
                    setError(null)
                    setVoidStep('reason')
                  }}
                >
                  {selected.voided ? 'E anuluar' : 'Anulo'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.length > 0 && (
              <div className="rounded-xl border border-[#F5D98B] bg-amber-100/60 p-3">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <span className="text-sm font-semibold text-amber-700">Pa dërguar ende ({pending.length})</span>
                  <Button size="sm" variant="secondary" onClick={() => void syncQueue()}>
                    <RefreshCw className="h-4 w-4" /> Provo tani
                  </Button>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {pending.map((q) => (
                    <li key={q.input.client_id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-semibold">{q.input.offline_no ?? 'Offline'}</div>
                        <div className="truncate text-xs text-muted">
                          {time(q.queued_at)} · {q.input.items.length} artikuj{q.last_error ? ` · ${q.last_error}` : ''}
                        </div>
                      </div>
                      {q.rejected ? (
                        manager ? (
                          <Button size="sm" variant="danger" onClick={() => void discardQueued(q.input.client_id)}>
                            Hiqe
                          </Button>
                        ) : (
                          <Badge tone="warn">U refuzua</Badge>
                        )
                      ) : (
                        <Badge tone="amber">Në pritje · prova {q.attempts}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {list.isLoading ? (
              <div className="py-10 text-center text-muted">Duke ngarkuar…</div>
            ) : list.isError ? (
              <div className="py-10 text-center text-warn-700">Lista nuk u ngarkua (pa internet?)</div>
            ) : rows.length === 0 ? (
              <div className="py-10 text-center text-muted">Ende pa fatura sot</div>
            ) : (
              <>
                <div className="flex justify-between text-sm text-muted">
                  <span>{rows.filter((r) => r.kind === 'sale').length} shitje</span>
                  <span>
                    Gjithsej <strong className="text-ink">{formatEUR(totalToday)}</strong>
                  </span>
                </div>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => void open1(r)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-bg">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-semibold">
                            {formatInvoiceNo(r.invoice_no)}
                            {KIND_LABEL[r.kind] && <Badge tone="warn">{KIND_LABEL[r.kind]}</Badge>}
                            {r.offline && <Badge tone="amber">Offline</Badge>}
                          </div>
                          <div className="text-xs text-muted">
                            {time(r.created_at)} · {PAY_LABEL[r.payment_method]} · {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(r.items_count)} artikuj
                          </div>
                        </div>
                        <span className={cn('font-bold tabular-nums', r.total < 0 && 'text-warn-700')}>{loadingId === r.id ? '…' : formatEUR(r.total)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{error}</p>}
          </div>
        )}
      </Dialog>

      <ApprovalDialog
        request={
          voidStep === 'approve' && selected
            ? {
                action: 'Anulim i faturës',
                details: [
                  { label: 'Fatura', value: `${formatInvoiceNo(selected.invoice_no)} · ${formatEUR(selected.total)}` },
                  { label: 'Arsyeja', value: reason },
                  { label: 'Ora', value: time(selected.created_at) },
                ],
              }
            : null
        }
        requester={profile.full_name || 'Punëtori'}
        busy={busy}
        error={voidStep === 'approve' ? error : null}
        onApprove={(id, pin) => void doVoid(id, pin)}
        onCancel={() => {
          setVoidStep('reason')
          setError(null)
        }}
      />
    </>
  )
}
