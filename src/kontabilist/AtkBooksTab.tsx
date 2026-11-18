import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, XCircle } from 'lucide-react'
import { Button, Card, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { addMonths, monthName, monthStart } from '@/features/accounting/api'
import type { Client } from './api'
import { BOOK_LABELS, buildRows, checkBooks, ddmmyyyy, type BookKind } from './atkBooks'
import { downloadBook, fetchBookDocs } from './atkBooksApi'

type PeriodKind = 'month' | 'quarter' | 'year' | 'custom'

function lastDay(monthFirst: string): string {
  const d = new Date(`${addMonths(monthFirst, 1)}T00:00:00Z`)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

function periodOf(kind: PeriodKind, anchor: string, from: string, to: string): { from: string; to: string; label: string } {
  const y = Number(anchor.slice(0, 4))
  const m = Number(anchor.slice(5, 7))
  if (kind === 'month') return { from: anchor, to: lastDay(anchor), label: monthName(anchor) }
  if (kind === 'quarter') {
    const q = Math.floor((m - 1) / 3)
    const start = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`
    return { from: start, to: lastDay(addMonths(start, 2)), label: `Tremujori ${q + 1} ${y}` }
  }
  if (kind === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Viti ${y}` }
  return { from, to, label: `${ddmmyyyy(from)} – ${ddmmyyyy(to)}` }
}

/**
 * Libri i shitjes dhe i blerjes: only the download. The ATK file itself (public/atk) is filled with the documents
 * of the chosen tax period – "me TVSH" when the business is registered for VAT, otherwise "jo TVSH".
 */
export function AtkBooksTab({ client }: { client: Client }) {
  const today = kosovoDateISO()
  const [pk, setPk] = useState<PeriodKind>('month')
  const [anchor, setAnchor] = useState(() => addMonths(monthStart(), -1))
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [showAll, setShowAll] = useState(false)
  const period = periodOf(pk, anchor, from, to)
  const books = useMemo<BookKind[]>(() => (client.vat_registered ? ['sales_vat', 'purchase_vat'] : ['sales_novat', 'purchase_novat']), [client.vat_registered])

  const docs = useQuery({ queryKey: ['client', client.id, 'atk-books', period.from, period.to], queryFn: () => fetchBookDocs(client.id, period.from, period.to) })
  const rowsOf = useMemo(() => Object.fromEntries(books.map((b) => [b, buildRows(b, docs.data ?? [])])) as Record<BookKind, ReturnType<typeof buildRows>>, [books, docs.data])
  const issues = useMemo(() => checkBooks(docs.data ?? [], client.vat_registered, period.from, period.to), [docs.data, client.vat_registered, period.from, period.to])
  const errors = issues.filter((i) => i.level === 'error')

  const fileName = (b: BookKind) => `${BOOK_LABELS[b]} - ${client.name.replace(/[\\/:*?"<>|]+/g, ' ')} - ${period.from}_${period.to}.xlsx`
  const download = useMutation({ mutationFn: (b: BookKind) => downloadBook(fileName(b), b, rowsOf[b]) })
  const step = (dir: number) => setAnchor(addMonths(anchor, pk === 'year' ? 12 * dir : pk === 'quarter' ? 3 * dir : dir))

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1.6fr]">
          <Select
            label="Periudha tatimore"
            value={pk}
            onChange={(e) => setPk(e.target.value as PeriodKind)}
            options={[
              { value: 'month', label: 'Muaji' },
              { value: 'quarter', label: 'Tremujori' },
              { value: 'year', label: 'Viti' },
              { value: 'custom', label: 'Nga – deri' },
            ]}
          />
          {pk === 'custom' ? (
            <div className="grid grid-cols-2 gap-2">
              <Input label="Nga" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input label="Deri" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
          ) : (
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-muted">&nbsp;</span>
              <div className="flex h-11 items-center overflow-hidden rounded-ctl border border-field bg-white">
                <button type="button" aria-label="Periudha e kaluar" className="h-full w-11 text-lg hover:bg-bg" onClick={() => step(-1)}>
                  ‹
                </button>
                <span className="flex-1 text-center font-semibold">{period.label}</span>
                <button type="button" aria-label="Periudha tjetër" className="h-full w-11 text-lg hover:bg-bg disabled:text-[#B5BCC7]" disabled={period.to >= today} onClick={() => step(1)}>
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="mt-3 text-sm text-muted">
          {client.name} {client.vat_registered ? 'është në TVSH – shkarkohen librat "me TVSH".' : 'nuk është në TVSH – shkarkohen librat "jo TVSH".'} Skedari është modeli zyrtar i ATK-së, i mbushur me dokumentet e periudhës.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {books.map((b) => (
            <Button key={b} className="h-14 justify-start text-left" disabled={!docs.data} loading={download.isPending && download.variables === b} onClick={() => download.mutate(b)}>
              <Download className="h-5 w-5" />
              <span>
                {BOOK_LABELS[b]}
                <span className="block text-xs font-normal opacity-80">{docs.isLoading ? 'Duke ngarkuar…' : `${rowsOf[b].length} dokumente · Excel`}</span>
              </span>
            </Button>
          ))}
        </div>
        {download.error && <p className="mt-2 text-sm text-warn-700">{(download.error as Error).message}</p>}
        {docs.error && <p className="mt-2 text-sm text-warn-700">{(docs.error as Error).message}</p>}
      </Card>

      {!docs.isLoading && !docs.error && (
        <Card className="p-5">
          <div className="flex items-center gap-2 font-semibold">
            {issues.length === 0 ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-brand-600" /> Kontrolli: asnjë mungesë apo gabim
              </>
            ) : (
              <>
                {errors.length ? <XCircle className="h-5 w-5 text-warn-700" /> : <AlertTriangle className="h-5 w-5 text-amber-700" />}
                Kontrolli: {errors.length} gabime, {issues.length - errors.length} paralajmërime
              </>
            )}
          </div>
          {issues.length > 0 && (
            <>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {(showAll ? issues : issues.slice(0, 8)).map((i, k) => (
                  <li key={k} className={cn('rounded-lg px-3 py-1.5', i.level === 'error' ? 'bg-warn-100 text-warn-700' : 'bg-amber-100 text-amber-700')}>
                    {i.text}
                  </li>
                ))}
              </ul>
              {issues.length > 8 && (
                <button type="button" className="mt-2 text-sm font-semibold text-brand-600" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Më pak' : `Shfaqi të gjitha (${issues.length})`}
                </button>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  )
}
