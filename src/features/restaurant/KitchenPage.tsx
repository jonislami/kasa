import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Printer } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Button, Card, EmptyState, Tabs, Toggle } from '@/components/ui'
import { serverNow } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { printTicket } from '@/lib/printer'
import { fetchReceiptSettings } from '@/features/settings/api'
import { fetchTickets, setTicket, STATION_LABELS, type Station, type Ticket } from './api'

const STATION_KEY = 'kasa.kitchen.station'
const AUTO_KEY = 'kasa.kitchen.autoPrint'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch {
    /* private mode */
  }
}

/** Stations whose tickets this device prints itself when a waiter sends from here. */
export function ticketStationsHere(): Station[] {
  return read(AUTO_KEY) === 'on' ? [(read(STATION_KEY) as Station) || 'kitchen'] : []
}

function age(iso: string) {
  const m = Math.max(0, Math.round((serverNow() - Date.parse(iso)) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} orë`
}

/**
 * Kitchen / bar screen: the tickets sent by the waiters. The device of this station
 * (with its own printer) can print every new ticket automatically.
 */
export function KitchenPage() {
  const qc = useQueryClient()
  const [station, setStation] = useState<Station>(((read(STATION_KEY) as Station) || 'kitchen'))
  const [auto, setAuto] = useState(read(AUTO_KEY) === 'on')
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tickets = useQuery({ queryKey: ['tickets', station], queryFn: () => fetchTickets(station), refetchInterval: 5000 })
  const settings = useQuery({ queryKey: ['receipt-settings'], queryFn: fetchReceiptSettings, retry: false, staleTime: 5 * 60_000 })
  const printing = useRef(new Set<string>())

  useEffect(() => write(STATION_KEY, station), [station])
  useEffect(() => write(AUTO_KEY, auto ? 'on' : null), [auto])

  const print = async (t: Ticket, reprint = false) => {
    if (!settings.data) return
    try {
      const r = await printTicket(t, settings.data, reprint)
      if (r === 'browser') {
        setError('Nuk ka printer të lidhur në këtë pajisje – lidhe te Cilësimet → Printeri.')
        return
      }
      setError(null)
      if (!t.printed_at) await setTicket(t.id, { printed: true })
      void qc.invalidateQueries({ queryKey: ['tickets', station] })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Auto-print new tickets on this station's printer.
  useEffect(() => {
    if (!auto || !settings.data) return
    for (const t of tickets.data ?? []) {
      if (t.printed_at || t.done_at || printing.current.has(t.id)) continue
      printing.current.add(t.id)
      void print(t)
    }
  }, [tickets.data, auto, settings.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const done = async (t: Ticket) => {
    try {
      await setTicket(t.id, { done: true })
      void qc.invalidateQueries({ queryKey: ['tickets', station] })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const list = (tickets.data ?? []).filter((t) => (showDone ? t.done_at : !t.done_at))
  if (showDone) list.reverse()

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/tavolinat" className="inline-flex items-center gap-1 font-semibold text-brand-600">
            <ChevronLeft className="h-4 w-4" /> Tavolinat
          </Link>
        }
        title={STATION_LABELS[station]}
        actions={
          <Tabs
            value={station}
            onChange={setStation}
            options={[
              { value: 'kitchen', label: 'Kuzhina' },
              { value: 'bar', label: 'Bari' },
            ]}
          />
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-28 pt-2 md:px-8 md:pb-8">
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <label className="flex items-center gap-3 text-[15px]">
            <Toggle checked={auto} onChange={setAuto} label="Printo automatikisht" />
            <span>
              <span className="font-semibold">Printo automatikisht në këtë pajisje</span>
              <span className="block text-xs text-muted">Pajisja e {STATION_LABELS[station].toLowerCase()}s me printerin e vet. Fletëporositë e reja dalin vetë.</span>
            </span>
          </label>
          <span className="ml-auto" />
          <Tabs
            size="sm"
            value={showDone ? 'done' : 'open'}
            onChange={(v) => setShowDone(v === 'done')}
            options={[
              { value: 'open', label: `Në punë (${(tickets.data ?? []).filter((t) => !t.done_at).length})` },
              { value: 'done', label: 'Gati' },
            ]}
          />
        </Card>
        {error && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{error}</p>}

        {tickets.isLoading ? (
          <Card>
            <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
          </Card>
        ) : list.length === 0 ? (
          <Card>
            <EmptyState title={showDone ? 'Asgjë e gatshme ende' : 'Asnjë porosi në pritje'} text={showDone ? undefined : 'Fletëporositë shfaqen këtu sapo kamarieri i dërgon.'} />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {list.map((t) => {
              const mins = Math.round((serverNow() - Date.parse(t.created_at)) / 60000)
              return (
                <Card key={t.id} className={cn('flex flex-col overflow-hidden', !t.done_at && mins >= 15 && 'border-2 border-warn-700')}>
                  <div className={cn('flex items-start justify-between px-4 py-3 text-white', t.done_at ? 'bg-muted' : mins >= 15 ? 'bg-warn-700' : 'bg-brand-900')}>
                    <div>
                      <div className="text-xl font-bold">{t.table_name ? `Tavolina ${t.table_name}` : `Për të marrë #${t.order_no}`}</div>
                      <div className="text-xs opacity-80">
                        #{t.order_no}
                        {t.waiter_name && ` · ${t.waiter_name}`}
                      </div>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{age(t.created_at)}</span>
                  </div>
                  <ul className="flex-1 divide-y divide-line px-4">
                    {t.items.map((i, k) => (
                      <li key={k} className="py-2">
                        <div className="text-[17px] font-semibold">
                          <span className="tabular-nums">{Number(i.quantity)}</span> × {i.name}
                        </div>
                        {i.modifiers?.length > 0 && <div className="text-sm text-muted">{i.modifiers.join(', ')}</div>}
                        {i.note && <div className="text-sm font-semibold text-amber-700">! {i.note}</div>}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 border-t border-line p-3">
                    <Button variant="secondary" onClick={() => void print(t, Boolean(t.printed_at))} title="Printo">
                      <Printer className="h-4 w-4" />
                      {t.printed_at ? '' : ' Printo'}
                    </Button>
                    {!t.done_at && (
                      <Button className="flex-1" onClick={() => void done(t)}>
                        Gati
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
