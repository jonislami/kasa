import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Card, EmptyState, StatCard } from '@/components/ui'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
import { fetchWork, formatMinutes, PAY_LABEL, ReportsNotMigrated, type WorkEvent } from './api'
import { InvoiceDialog } from './InvoiceDialog'

const timeFmt = new Intl.DateTimeFormat('sq-AL', { hour: '2-digit', minute: '2-digit' })

/** "Puna ime sot" – the signed-in worker's own work today (no prices of purchase, no others). */
export function MyWork({ showCommission }: { showCommission: boolean }) {
  const work = useQuery({ queryKey: ['work', 'mine'], queryFn: () => fetchWork(null), refetchInterval: 60_000 })
  const [open, setOpen] = useState<string | null>(null)

  if (work.error instanceof ReportsNotMigrated) {
    return (
      <Card>
        <EmptyState title="Puna e sotme shfaqet këtu" text="Aktivizohet kur administratori të ekzekutojë migrimin 0004_reports.sql." />
      </Card>
    )
  }
  const w = work.data
  const t = w?.totals
  const docs = (w?.events ?? []).filter((e) => e.type === 'sale' || e.type === 'void' || e.type === 'refund')

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Fatura" value={t ? String(t.invoices) : '—'} sub={t && t.invoices ? `mesatarja ${formatEUR(t.total / t.invoices)}` : undefined} />
        <StatCard label="Totali i shitjeve" value={t ? formatEUR(t.total) : '—'} sub={t ? `kesh ${formatEUR(t.cash)} · kartelë ${formatEUR(t.card)}` : undefined} />
        {showCommission ? (
          <StatCard label={`Komisioni (${w?.worker.commission_pct ?? 0}%)`} value={w ? formatEUR(w.commission) : '—'} />
        ) : (
          <StatCard
            label="Kthime / anulime"
            value={t ? `${t.refunds} / ${t.voids}` : '—'}
            sub={t && (t.refund_total || t.void_total) ? formatEUR(t.refund_total + t.void_total) : undefined}
          />
        )}
        <StatCard
          label="Orët e punës"
          value={w ? formatMinutes(w.minutes) : '—'}
          sub={w?.first_start ? `nga ${timeFmt.format(new Date(w.first_start))}` : 'pa ndërrim të hapur'}
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        <h2 className="px-5 pt-5 text-[17px] font-semibold">Faturat e mia të sotme</h2>
        {work.isLoading ? (
          <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
        ) : docs.length === 0 ? (
          <EmptyState title="Ende pa shitje sot" />
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {docs.slice(0, 50).map((e) => (
              <DocRow key={e.sale_id} e={e} onOpen={() => setOpen(e.sale_id)} />
            ))}
          </ul>
        )}
      </Card>
      <InvoiceDialog saleId={open} onClose={() => setOpen(null)} />
    </>
  )
}

export function DocRow({ e, onOpen }: { e: WorkEvent; onOpen: () => void }) {
  const label = e.type === 'sale' ? formatInvoiceNo(e.invoice_no ?? 0) : e.type === 'refund' ? 'Kthim' : 'Anulim'
  const detail =
    e.type === 'sale'
      ? `${e.payment_method ? PAY_LABEL[e.payment_method] : ''} · ${Number(e.items_count ?? 0)} artikuj`
      : `nga ${formatInvoiceNo(e.ref_invoice_no ?? 0)}${e.reason ? ` · ${e.reason}` : ''}`
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-[#F8FAF8]">
        <span className="w-[72px] shrink-0 font-semibold">{label}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">
          {timeFmt.format(new Date(e.at))} · {detail}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{formatEUR(e.total ?? 0)}</span>
        {e.offline ? <Badge tone="warn">Offline</Badge> : e.type !== 'sale' ? <Badge tone="amber">Miratuar</Badge> : <Badge>Jo-fiskal</Badge>}
      </button>
    </li>
  )
}
