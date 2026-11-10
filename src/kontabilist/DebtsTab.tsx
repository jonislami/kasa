import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, HandCoins } from 'lucide-react'
import { Card, EmptyState, Input, Tabs } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { fetchDebts, type Client } from './api'
import { DocDetailDialog } from './DocDetail'
import { downloadSheets } from './xls'

const BUCKETS: { key: 'current' | 'd30' | 'd60' | 'd90' | 'older'; label: string }[] = [
  { key: 'current', label: 'Pa skaduar' },
  { key: 'd30', label: '1–30 ditë' },
  { key: 'd60', label: '31–60 ditë' },
  { key: 'd90', label: '61–90 ditë' },
  { key: 'older', label: 'Mbi 90 ditë' },
]

/** What customers owe the client and what the client owes suppliers, by partner and age. */
export function DebtsTab({ client, onChanged }: { client: Client; onChanged: () => void }) {
  const [side, setSide] = useState<'receivable' | 'payable'>('receivable')
  const [asOf, setAsOf] = useState(kosovoDateISO())
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const debts = useQuery({ queryKey: ['client', client.id, 'debts', side, asOf], queryFn: () => fetchDebts(client.id, side, asOf) })
  const d = debts.data

  const xlsx = () =>
    d &&
    downloadSheets(`borxhet-${side === 'receivable' ? 'kliente' : 'furnitore'}-${asOf}.xlsx`, [
      {
        name: side === 'receivable' ? 'Na detyrohen' : 'I detyrohemi',
        columns: ['Partneri', 'NUI', 'Fatura', 'Data', 'Afati', 'Totali', 'Mbetet', 'Ditë vonesë'],
        rows: d.partners.flatMap((p) => p.docs.map((x) => [p.name, p.nui, x.doc_no, x.doc_date, x.due_date, x.total, x.open, x.days || null])),
      },
    ])

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={side}
          onChange={setSide}
          options={[
            { value: 'receivable', label: 'Na detyrohen (klientët)' },
            { value: 'payable', label: 'I detyrohemi (furnitorët)' },
          ]}
        />
        <div className="flex items-end gap-2">
          <Input label="Gjendja më" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || kosovoDateISO())} />
          <button type="button" onClick={() => void xlsx()} className="mb-0.5 h-[46px] rounded-ctl border border-field px-4 text-[15px] font-medium hover:bg-bg" disabled={!d}>
            Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Card className="col-span-2 p-4 md:col-span-1">
          <div className="text-sm text-muted">Gjithsej</div>
          <div className="text-[22px] font-bold tabular-nums">{d ? formatEUR(d.total) : '…'}</div>
        </Card>
        {BUCKETS.map((b) => (
          <Card key={b.key} className={cn('p-4', b.key !== 'current' && d && d.buckets[b.key] > 0 && 'border-[#F3C5A8] bg-warn-100/40')}>
            <div className="text-sm text-muted">{b.label}</div>
            <div className={cn('text-[18px] font-semibold tabular-nums', b.key !== 'current' && d && d.buckets[b.key] > 0 && 'text-warn-700')}>{d ? formatEUR(d.buckets[b.key]) : '…'}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        {!d ? (
          <p className={debts.error ? 'px-5 py-8 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{debts.error ? (debts.error as Error).message : 'Duke ngarkuar…'}</p>
        ) : d.partners.length === 0 ? (
          <EmptyState icon={<HandCoins className="h-6 w-6" />} title="Asnjë borxh" text={side === 'receivable' ? 'Të gjitha faturat e shitjes janë paguar.' : 'Të gjitha faturat e furnitorëve janë paguar.'} />
        ) : (
          <ul className="divide-y divide-line">
            {d.partners.map((p) => {
              const key = p.partner_id ?? p.name
              const open = openRow === key
              return (
                <li key={key}>
                  <button type="button" onClick={() => setOpenRow(open ? null : key)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[#F8FAF8]">
                    {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted">
                        {p.docs.length} fatura{p.nui && ` · NUI ${p.nui}`}
                        {p.max_days > 0 && <span className="text-warn-700"> · më e vjetra {p.max_days} ditë</span>}
                      </div>
                    </div>
                    {p.overdue > 0 && <span className="hidden text-sm text-warn-700 md:inline">me vonesë {formatEUR(p.overdue)}</span>}
                    <span className="w-28 text-right font-semibold tabular-nums">{formatEUR(p.open)}</span>
                  </button>
                  {open && (
                    <table className="mb-2 w-full text-sm">
                      <tbody>
                        {p.docs.map((x) => (
                          <tr key={x.id} className="cursor-pointer border-t border-line hover:bg-[#F8FAF8]" onClick={() => setDocId(x.id)}>
                            <td className="py-2 pl-12">{x.doc_no ?? '—'}</td>
                            <td>{formatDay(x.doc_date)}</td>
                            <td>afati {formatDay(x.due_date)}</td>
                            <td className={x.days ? 'text-warn-700' : 'text-muted'}>{x.days ? `${x.days} ditë vonesë` : 'pa skaduar'}</td>
                            <td className="text-right text-muted tabular-nums">{formatEUR(x.total)}</td>
                            <td className="pr-5 text-right font-medium tabular-nums">{formatEUR(x.open)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <DocDetailDialog
        docId={docId}
        client={client}
        onClose={() => setDocId(null)}
        onEdit={() => setDocId(null)}
        onChanged={() => {
          void debts.refetch()
          onChanged()
        }}
      />
    </div>
  )
}
