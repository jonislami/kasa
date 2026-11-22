import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Search } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Dialog, Input, Select, Tabs } from '@/components/ui'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { isManagerRole } from '@/lib/business'
import { KOSOVO_TZ } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { t as tr, useLang } from '@/lib/i18n'
import { formatEUR, formatInvoiceNo } from '@/lib/money'
import { printPage, printReceipt } from '@/lib/printer'
import { formatSq } from '@/lib/sqDate'
import { supabase } from '@/lib/supabase'
import { addDays, formatRange, today } from '@/features/reports/api'
import { fetchReceiptSettings } from '@/features/settings/api'
import { getSale, PAYMENT_KIND_LABELS, type PaymentKind, type PaymentMethod, type Sale, type SaleKind } from './api'
import { tillRegisterId } from '@/features/fiscal/TillFiscalCard'
import { discardQueued, syncQueue, useOfflineQueue } from './offline'
import { SalesDialog } from './SalesDialog'
import { usePrintProblem } from './PrintProblem'
import { PrintArea } from './Receipt'

// "Kuponët e lëshuar" (SEF app): every coupon kept in the database, not only today's – by period, number and worker,
// with the coupon itself (items, quantity, price, VAT, total) to open, print again or save as PDF. Workers see only
// their own coupons, the owner / manager all of them (RLS on sales). Issuing coupons is not touched here.

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

interface CouponRow {
  id: string
  kind: SaleKind
  invoice_no: number
  offline_no: string | null
  total: number
  payment_method: PaymentMethod
  payment_kind: PaymentKind | null
  items_count: number
  created_at: string
  client_created_at: string | null
  worker_id: string
  fiscal_status: string | null
}

const KIND_LABEL: Record<SaleKind, string | null> = { sale: null, void: 'Anulim', refund: 'Kthim' }
const PAY_LABEL: Record<PaymentMethod, string> = { cash: 'Kesh', card: 'Kartelë', mixed: 'Kesh + Kartelë' }
const when = (iso: string) => formatSq(iso, { timeZone: KOSOVO_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function rangeOf(p: Period, custom: { from: string; to: string }): { from: string; to: string } {
  const t = today()
  if (p === 'today') return { from: t, to: t }
  if (p === 'yesterday') return { from: addDays(t, -1), to: addDays(t, -1) }
  if (p === 'week') {
    const dow = (new Date(t + 'T12:00:00').getDay() + 6) % 7 // Monday = 0
    return { from: addDays(t, -dow), to: t }
  }
  if (p === 'month') return { from: t.slice(0, 8) + '01', to: t }
  return custom
}

const COLS = 'id, kind, invoice_no, offline_no, total, payment_method, payment_kind, items_count, created_at, client_created_at, worker_id, fiscal_status'
const PAGE = 1000
const MAX = 10_000

/** Every coupon of the period (paged), newest first. RLS: a worker gets only their own. */
async function fetchCoupons(from: string, to: string, workerId: string | null): Promise<CouponRow[]> {
  const out: CouponRow[] = []
  for (let start = 0; start < MAX; start += PAGE) {
    let q = supabase.from('sales').select(COLS).gte('sale_date', from).lte('sale_date', to)
    if (workerId) q = q.eq('worker_id', workerId)
    const { data, error } = await q.order('created_at', { ascending: false }).order('invoice_no', { ascending: false }).range(start, start + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as CouponRow[]
    for (const r of rows) out.push({ ...r, invoice_no: Number(r.invoice_no), total: Number(r.total), items_count: Number(r.items_count) })
    if (rows.length < PAGE) break
  }
  return out
}

async function fetchWorkers(): Promise<{ id: string; full_name: string; worker_no: number | null }[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name, worker_no').order('full_name')
  if (error) {
    // before 0044 there is no worker_no
    const r = await supabase.from('profiles').select('id, full_name').order('full_name')
    return ((r.data ?? []) as { id: string; full_name: string }[]).map((p) => ({ ...p, worker_no: null }))
  }
  return (data ?? []) as { id: string; full_name: string; worker_no: number | null }[]
}

export function CouponsPage() {
  const { business, profile } = useBusiness()
  const lang = useLang()
  const manager = isManagerRole(profile.actual_role ?? profile.role)
  const navigate = useNavigate()
  // coupons sold without internet that have not reached the server yet
  const queue = useOfflineQueue()
  const [period, setPeriod] = useState<Period>('today')
  const [custom, setCustom] = useState({ from: today(), to: today() })
  const [customOpen, setCustomOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [workerId, setWorkerId] = useState<string>('')
  const range = rangeOf(period, custom)

  const list = useQuery({
    queryKey: ['coupons', range.from, range.to, workerId],
    queryFn: () => fetchCoupons(range.from, range.to, workerId || null),
  })
  const workers = useQuery({ queryKey: ['coupon-workers'], queryFn: fetchWorkers, enabled: manager, staleTime: 5 * 60_000 })
  const names = useMemo(() => new Map((workers.data ?? []).map((w) => [w.id, w.full_name])), [workers.data])

  // search by the coupon number (#00487, 487) or the offline number (OFF-…)
  const rows = useMemo(() => {
    const all = list.data ?? []
    const q = search.trim().toUpperCase().replace(/^#/, '')
    if (!q) return all
    const n = /^\d+$/.test(q) ? Number(q) : null
    return all.filter((r) => (n !== null && r.invoice_no === n) || String(r.invoice_no).includes(q) || (r.offline_no ?? '').toUpperCase().includes(q))
  }, [list.data, search])

  const sums = useMemo(() => {
    let sales = 0
    let back = 0
    let count = 0
    for (const r of list.data ?? []) {
      if (r.kind === 'sale') {
        sales += r.total
        count++
      } else back += r.total // cancel / return coupons carry negative totals
    }
    return { sales, back, net: sales + back, count }
  }, [list.data])

  // ---- one coupon ----
  const [opened, setOpened] = useState<Sale | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const open1 = async (r: CouponRow) => {
    setOpeningId(r.id)
    setOpenError(null)
    try {
      const s = await getSale(r.id)
      if (!s) throw new Error('Kuponi nuk u gjet')
      setOpened(s)
    } catch (e) {
      setOpenError((e as Error).message)
    } finally {
      setOpeningId(null)
    }
  }

  // ---- print again / save as PDF (a reprint is marked "KOPJE E KUPONIT") ----
  const settings = useQuery({ queryKey: ['receipt-settings'], queryFn: fetchReceiptSettings, retry: false, staleTime: 5 * 60_000, networkMode: 'always' })
  const [printSale, setPrintSale] = useState<Sale | null>(null)
  const [printProblem, showPrintProblem] = usePrintProblem()
  const viaDialog = (s: Sale, fileName?: string) => {
    setPrintSale(s)
    setTimeout(() => {
      const title = document.title
      if (fileName) document.title = fileName // the name the PDF gets when saved
      const done = () => {
        document.title = title
        setPrintSale(null)
      }
      if (fileName) {
        window.print()
        done()
      } else void printPage().finally(done)
    }, 80)
  }
  const printAgain = async (s: Sale) => {
    const st = settings.data
    if (!st) return viaDialog(s)
    const attempt = async () => {
      const how = await printReceipt(s, business, st, { copy: true })
      if (how === 'browser') viaDialog(s)
    }
    try {
      await attempt()
    } catch (e) {
      showPrintProblem(e, attempt, () => viaDialog(s))
    }
  }
  const savePdf = (s: Sale) => viaDialog(s, `kupon-fiskal-${s.fiscal?.verification_no ?? formatInvoiceNo(s.invoice_no).replace('#', '')}`)

  const periods: [Period, string][] = [
    ['today', 'Sot'],
    ['yesterday', 'Dje'],
    ['week', 'Këtë javë'],
    ['month', 'Këtë muaj'],
    ['custom', period === 'custom' ? formatRange(custom.from, custom.to) : 'Periudhë…'],
  ]

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.015em] md:text-[28px]">{tr('Kuponët e lëshuar', lang)}</h1>
          <p className="text-sm text-muted">
            {formatRange(range.from, range.to)} · {manager ? tr('Të gjithë punëtorët', lang) : tr('Vetëm kuponët e tu', lang)}
          </p>
        </div>
        <Tabs
          value={period}
          onChange={(v) => {
            if (v === 'custom') setCustomOpen(true)
            setPeriod(v)
          }}
          className="max-w-full overflow-x-auto"
          options={periods.map(([value, label]) => ({ value, label }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Shitjet" value={formatEUR(sums.sales)} />
        <Stat label="Anulime dhe kthime" value={formatEUR(sums.back)} tone={sums.back < 0 ? 'warn' : undefined} />
        <Stat label="Totali i periudhës" value={formatEUR(sums.net)} strong />
        <Stat label="Kuponë shitjeje" value={String(sums.count)} />
      </div>

      <div className={cn('grid gap-3', manager ? 'md:grid-cols-[1fr_280px]' : '')}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            inputMode="search"
            placeholder="Kërko me numrin e kuponit (p.sh. 487)"
            className="h-12 w-full rounded-ctl border border-field bg-white pl-10 pr-3 text-[16px] outline-none focus:border-brand-600 md:text-[15px]"
          />
        </div>
        {manager && (
          <Select
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            aria-label="Punëtori"
            options={[
              { value: '', label: tr('Të gjithë punëtorët', lang) },
              ...(workers.data ?? []).map((w) => ({ value: w.id, label: `${w.full_name}${w.worker_no ? ` (ID ${String(w.worker_no).padStart(3, '0')})` : ''}` })),
            ]}
          />
        )}
      </div>

      {queue.pending.length > 0 && (
        <div className="rounded-card border border-[#F5D98B] bg-amber-100/60 p-3">
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className="text-[15px] font-semibold text-amber-700">Pa dërguar ende ({queue.pending.length})</span>
            <Button size="sm" variant="secondary" onClick={() => void syncQueue()}>
              <RefreshCw className="h-4 w-4" /> Provo tani
            </Button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {queue.pending.map((q) => (
              <li key={q.input.client_id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-[15px]">
                <div className="min-w-0">
                  <div className="font-semibold">{q.input.offline_no ?? 'Offline'}</div>
                  <div className="truncate text-sm text-muted">
                    {when(q.queued_at)} · {q.input.items.length} artikuj{q.last_error ? ` · ${q.last_error}` : ''}
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

      {openError && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{openError}</p>}

      {loadState(list) === 'offline' ? (
        <OfflineEmpty />
      ) : loadState(list) === 'loading' ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : loadState(list) === 'error' ? (
        <p className="py-10 text-center text-warn-700">Lista nuk u ngarkua: {(list.error as Error)?.message}</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white">
          {rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-muted">{search.trim() ? 'Asnjë kupon me këtë numër në këtë periudhë.' : 'Asnjë kupon në këtë periudhë.'}</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => void open1(r)} disabled={openingId === r.id} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg disabled:opacity-60">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold tabular-nums">{r.invoice_no ? formatInvoiceNo(r.invoice_no) : (r.offline_no ?? '—')}</span>
                        {KIND_LABEL[r.kind] && <Badge tone="warn">{KIND_LABEL[r.kind]}</Badge>}
                        {r.fiscal_status === 'non_fiscal' && <Badge>Jo-fiskal</Badge>}
                      </div>
                      <div className="truncate text-sm text-muted">
                        {when(r.client_created_at ?? r.created_at)} · {r.payment_kind && r.payment_method !== 'cash' ? PAYMENT_KIND_LABELS[r.payment_kind] : PAY_LABEL[r.payment_method]} · {r.items_count} artikuj
                        {manager && names.get(r.worker_id) ? ` · ${names.get(r.worker_id)}` : ''}
                      </div>
                    </div>
                    <span className={cn('shrink-0 text-[16px] font-semibold tabular-nums', r.total < 0 && 'text-warn-700')}>{openingId === r.id ? '…' : formatEUR(r.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(list.data?.length ?? 0) >= MAX && <p className="border-t border-line px-4 py-2 text-sm text-muted">U shfaqën {MAX} kuponët më të fundit – zgjidh një periudhë më të shkurtër.</p>}
        </div>
      )}

      <Dialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Zgjidh periudhën"
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setCustomOpen(false)}>Shfaq</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Nga" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <Input label="Deri" type="date" value={custom.to} min={custom.from} max={today()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      </Dialog>

      <SalesDialog
        open={Boolean(opened)}
        sale={opened}
        onClose={() => setOpened(null)}
        pending={[]}
        registerId={tillRegisterId(business.id)}
        onPrint={(s) => void printAgain(s)}
        onPdf={savePdf}
        onRefund={(nr) => navigate(`/arka/kthim?nr=${nr}`)}
      />

      {printProblem}
      <PrintArea sale={printSale} business={business} copy settings={settings.data} />
    </div>
  )
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'warn' }) {
  return (
    <div className={cn('rounded-card border px-4 py-3', strong ? 'border-brand-600 bg-brand-100/50' : 'border-line bg-white')}>
      <div className="text-sm font-medium uppercase tracking-[0.04em] text-muted">{label}</div>
      <div className={cn('mt-1 text-[20px] font-semibold tracking-[-0.015em] tabular-nums', tone === 'warn' && 'text-warn-700')}>{value}</div>
    </div>
  )
}
