import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Download } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { cn } from '@/lib/cn'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { VAT_RATES, type VatCode } from '@/lib/vat'
import { BarChart, BarLabels } from '@/features/reports/charts'
import {
  AccountingNotMigrated,
  EXPENSE_LABELS,
  fetchExpenses,
  fetchPurchases,
  fetchSaleDocs,
  fetchStockList,
  fetchSummary,
  formatDay,
  mergeVat,
  monthName,
  monthStart,
  periodLabel,
  periodOf,
  periodRange,
  profitAndLoss,
  setPeriodStatus,
  shiftPeriod,
  sumVat,
  vatDueDate,
  type Period,
  type PeriodKind,
  type Summary,
  type VatRow,
  type VatStatus,
} from './api'
import { cashSheet, downloadWorkbook, expensesSheet, profitSheet, purchasesSheet, salesDailySheet, salesDocsSheet, stockSheet, vatSheet } from './export'
import { ExpensesTab, PurchasesTab, SalesTab, StockTab } from './BooksTabs'

type TabKey = 'pasqyra' | 'shitjet' | 'blerjet' | 'tvsh' | 'shpenzimet' | 'fitimi' | 'arka' | 'stoku'

const TABS: { key: TabKey; label: string; title: string }[] = [
  { key: 'pasqyra', label: 'Pasqyra', title: 'Kontabiliteti' },
  { key: 'shitjet', label: 'Shitjet', title: 'Libri i shitjeve' },
  { key: 'blerjet', label: 'Blerjet', title: 'Libri i blerjeve' },
  { key: 'tvsh', label: 'TVSH', title: 'Deklarata e TVSH-së' },
  { key: 'shpenzimet', label: 'Shpenzimet', title: 'Shpenzimet' },
  { key: 'fitimi', label: 'Fitimi', title: 'Fitimi dhe humbja' },
  { key: 'arka', label: 'Arka', title: 'Barazimi i arkës' },
  { key: 'stoku', label: 'Stoku', title: 'Stoku dhe çmimet' },
]

const PERIOD_KEY = 'kasa.acc.period'

/**
 * Where the shared book screens live: one client in the Kasa Kontabilist program (the owner's
 * /kontabiliteti page in Kasa is not used any more; AccountingPage stays for a later return). Decides links, how the VAT status is saved and what is refreshed.
 */
export interface BooksScope {
  link: (tab: string) => string
  setStatus: (month: string, status: VatStatus) => Promise<void>
  invalidate: () => void
  /** false for a client that does not use Kasa: no till, shifts or stock. */
  kasa: boolean
}
const ScopeContext = createContext<BooksScope | null>(null)
export const BooksScopeProvider = ScopeContext.Provider
function useScope(): BooksScope {
  const s = useContext(ScopeContext)
  if (!s) throw new Error('BooksScope missing')
  return s
}

function initialPeriod(accountant: boolean): Period {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PERIOD_KEY) ?? 'null') as Period | null
    if (saved && ['month', 'quarter', 'year'].includes(saved.kind) && /^\d{4}-\d{2}-01$/.test(saved.start)) return saved
  } catch {
    /* fall through */
  }
  // An accountant usually works on the month that has just closed.
  const p = periodOf('month')
  return accountant ? shiftPeriod(p, -1) : p
}

export function AccountingPage() {
  const { business, profile } = useBusiness()
  const accountant = profile.role === 'accountant'
  const { tab: tabParam } = useParams()
  const tab = TABS.find((t) => t.key === (tabParam ?? 'pasqyra'))
  const qc = useQueryClient()
  const [period, setPeriod] = useState<Period>(() => initialPeriod(accountant))
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const range = periodRange(period)

  useEffect(() => {
    try {
      sessionStorage.setItem(PERIOD_KEY, JSON.stringify(period))
    } catch {
      /* storage unavailable */
    }
  }, [period])

  const summary = useQuery({
    queryKey: ['acc', business.id, 'summary', range.from, range.to],
    queryFn: () => fetchSummary(range.from, range.to),
    retry: (count, e) => !(e instanceof AccountingNotMigrated) && count < 1,
  })

  const scope = useMemo<BooksScope>(
    () => ({
      link: (t) => (t === 'pasqyra' ? '/kontabiliteti' : `/kontabiliteti/${t}`),
      setStatus: setPeriodStatus,
      invalidate: () => void qc.invalidateQueries({ queryKey: ['acc', business.id, 'summary'] }),
      kasa: true,
    }),
    [qc, business.id],
  )

  if (!tab) return <Navigate to="/kontabiliteti" replace />

  const s = summary.data
  const isCurrent = range.to >= kosovoDateISO()

  const exportAll = async () => {
    if (!s) return
    setExporting(true)
    setExportError(null)
    try {
      const [docs, purchases, expenses, stock] = await Promise.all([
        qc.fetchQuery({ queryKey: ['acc', business.id, 'sales', range.from, range.to], queryFn: () => fetchSaleDocs(business.id, range.from, range.to) }),
        qc.fetchQuery({ queryKey: ['acc', business.id, 'purchases', range.from, range.to], queryFn: () => fetchPurchases(business.id, range.from, range.to) }),
        qc.fetchQuery({ queryKey: ['acc', business.id, 'expenses', range.from, range.to], queryFn: () => fetchExpenses(business.id, range.from, range.to) }),
        qc.fetchQuery({ queryKey: ['acc', business.id, 'stock'], queryFn: () => fetchStockList(business.id) }),
      ])
      await downloadWorkbook(`kontabiliteti-${business.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${range.from}-${range.to}.xlsx`, [
        salesDailySheet(s),
        salesDocsSheet(s, docs),
        purchasesSheet(s, purchases),
        expensesSheet(s, expenses),
        vatSheet(s),
        profitSheet(s),
        cashSheet(s),
        stockSheet(s, stock),
      ])
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  if (summary.error instanceof AccountingNotMigrated) {
    return (
      <>
        <PageHeader title="Kontabiliteti" />
        <div className="px-4 py-5 md:px-8 md:py-0">
          <Card>
            <EmptyState icon={<Calculator className="h-6 w-6" />} title="Kontabiliteti nuk është aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0012_accountant.sql në Supabase." />
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={accountant ? `Klienti: ${business.name}` : 'Librat, TVSH-ja dhe fitimi'}
        title={tab.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker period={period} onChange={setPeriod} disableNext={isCurrent} />
            <Button variant="secondary" onClick={() => void exportAll()} disabled={!s} loading={exporting}>
              <Download className="h-4 w-4" /> Excel
            </Button>
          </div>
        }
      />
      <p className="-mt-5 hidden px-8 pb-4 text-muted md:block">
        {formatDay(range.from)} – {formatDay(range.to)}
        {s && !s.business.vat_registered && ' · biznesi nuk është në TVSH'}
      </p>

      {/* Sections: the accountant has them in the sidebar on desktop. */}
      <nav className={cn('flex gap-2 overflow-x-auto px-4 pb-1 pt-4 md:px-8 md:pt-0', accountant && 'md:hidden')} aria-label="Pjesët e kontabilitetit">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={t.key === 'pasqyra' ? '/kontabiliteti' : `/kontabiliteti/${t.key}`}
            end
            className={({ isActive }) =>
              cn('flex h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium', isActive ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted hover:text-ink')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {exportError && <p className="mx-4 mt-3 rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700 md:mx-8">{exportError}</p>}

      {loadState(summary) === 'offline' ? (
        <OfflineEmpty />
      ) : loadState(summary) === 'loading' ? (
        <p className="py-16 text-center text-muted">Duke ngarkuar…</p>
      ) : !s ? (
        <p className="px-4 py-10 text-warn-700 md:px-8">{(summary.error as Error)?.message}</p>
      ) : (
        <BooksScopeProvider value={scope}>
        <div className="flex flex-col gap-4 px-4 pb-8 pt-4 md:gap-5 md:px-8">
          {tab.key === 'pasqyra' && <OverviewTab s={s} period={period} />}
          {tab.key === 'shitjet' && <SalesTab s={s} />}
          {tab.key === 'blerjet' && <PurchasesTab s={s} />}
          {tab.key === 'tvsh' && <VatTab s={s} period={period} />}
          {tab.key === 'shpenzimet' && <ExpensesTab s={s} />}
          {tab.key === 'fitimi' && <ProfitTab s={s} />}
          {tab.key === 'arka' && <CashTab s={s} />}
          {tab.key === 'stoku' && <StockTab s={s} />}
        </div>
        </BooksScopeProvider>
      )}
    </>
  )
}

export function PeriodPicker({ period, onChange, disableNext }: { period: Period; onChange: (p: Period) => void; disableNext: boolean }) {
  const kinds: { value: PeriodKind; label: string }[] = [
    { value: 'month', label: 'Muaj' },
    { value: 'quarter', label: 'Tremujor' },
    { value: 'year', label: 'Vit' },
  ]
  const arrow = 'flex h-[44px] w-[40px] items-center justify-center text-ink hover:bg-bg disabled:text-[#B8C2BC] disabled:hover:bg-white'
  return (
    <div className="flex items-center gap-2 text-ink">
      <select
        aria-label="Lloji i periudhës"
        value={period.kind}
        onChange={(e) => onChange(periodOf(e.target.value as PeriodKind, period.start))}
        className="h-[44px] rounded-ctl border border-field bg-white px-3 text-[15px] font-medium focus:border-brand-600 focus:outline-none"
      >
        {kinds.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <div className="flex items-center overflow-hidden rounded-ctl border border-field bg-white">
        <button type="button" aria-label="Periudha e kaluar" className={arrow} onClick={() => onChange(shiftPeriod(period, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[132px] px-1 text-center text-[15px] font-semibold tabular-nums">{periodLabel(period)}</span>
        <button type="button" aria-label="Periudha tjetër" className={arrow} disabled={disableNext} onClick={() => onChange(shiftPeriod(period, 1))}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------
const CODES: VatCode[] = ['E', 'D', 'C', 'A']

export function rateLabel(code: VatCode): string {
  return code === 'A' ? 'E liruar' : `${Math.round(VAT_RATES[code] * 100)}%`
}

export function VatTable({ title, rows, vatLabel = 'TVSH', hint }: { title: string; rows: VatRow[]; vatLabel?: string; hint?: ReactNode }) {
  const sum = sumVat(rows)
  const shown = CODES.map((code) => rows.find((r) => r.code === code) ?? { code, gross: 0, net: 0, vat: 0 }).filter((r) => r.gross !== 0 || r.code === 'E' || r.code === 'D')
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      <Table className="mt-3">
        <thead>
          <tr>
            <Th className="pl-5">Norma</Th>
            <Th className="text-right">Baza</Th>
            <Th className="text-right">{vatLabel}</Th>
            <Th className="pr-5 text-right">Me TVSH</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((v) => (
            <tr key={v.code}>
              <Td className="pl-5">
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#EEF1EE] text-xs font-bold">{v.code}</span>
                {rateLabel(v.code)}
              </Td>
              <Td className="text-right">{formatEUR(v.net)}</Td>
              <Td className="text-right font-semibold">{v.code === 'A' || v.code === 'C' ? '—' : formatEUR(v.vat)}</Td>
              <Td className="pr-5 text-right">{formatEUR(v.gross)}</Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td className="border-b-0 pl-5">Gjithsej</Td>
            <Td className="border-b-0 text-right">{formatEUR(sum.net)}</Td>
            <Td className="border-b-0 text-right">{formatEUR(sum.vat)}</Td>
            <Td className="border-b-0 pr-5 text-right">{formatEUR(sum.gross)}</Td>
          </tr>
        </tbody>
      </Table>
    </Card>
  )
}

function vatFigures(s: Summary) {
  const input = mergeVat(s.vat_in, s.expense_vat)
  const out = sumVat(s.vat_out).vat
  const inn = sumVat(input).vat
  return { input, out, inn, due: out - inn }
}

/** VAT status of one month with the button that files / reopens it. */
function VatStatusRow({ s, month }: { s: Summary; month: string }) {
  const scope = useScope()
  const status: VatStatus = s.periods.find((p) => p.month === month)?.vat_status ?? 'open'
  const closedAt = s.periods.find((p) => p.month === month)?.closed_at
  const due = vatDueDate(month)
  const ended = monthStart() > month // the month is over, so it can be declared
  const late = status === 'open' && kosovoDateISO() > due
  const mut = useMutation({
    mutationFn: (next: VatStatus) => scope.setStatus(month, next),
    onSuccess: scope.invalidate,
  })
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', status === 'filed' ? 'bg-brand-100 text-brand-600' : late ? 'bg-warn-100 text-warn-700' : 'bg-amber-100 text-amber-700')}>
          {status === 'filed' ? <CheckCircle2 className="h-5 w-5" /> : <CircleAlert className="h-5 w-5" />}
        </div>
        <div>
          <div className="font-semibold">
            TVSH – {monthName(month)} <Badge tone={status === 'filed' ? 'success' : late ? 'warn' : 'amber'} className="ml-1">{status === 'filed' ? 'E dorëzuar' : "Për t'u bërë"}</Badge>
          </div>
          <div className="text-sm text-muted">
            {status === 'filed'
              ? `Shënuar më ${closedAt ? formatKosovoDateTime(closedAt) : '—'}`
              : !ended
                ? `Muaji është ende i hapur · afati ${formatDay(due)}`
                : late
                  ? `Afati ka kaluar më ${formatDay(due)}`
                  : `Afati i deklarimit dhe pagesës: ${formatDay(due)}`}
          </div>
          {mut.error && <div className="text-sm text-warn-700">{(mut.error as Error).message}</div>}
        </div>
      </div>
      {status === 'filed' ? (
        <Button variant="secondary" size="sm" loading={mut.isPending} onClick={() => mut.mutate('open')}>
          Rihape
        </Button>
      ) : (
        <Button size="sm" className="h-10" disabled={!ended} loading={mut.isPending} onClick={() => mut.mutate('filed')}>
          Shëno si të dorëzuar
        </Button>
      )}
    </div>
  )
}

/** Months of the period (1, 3 or 12), newest first, never in the future. */
export function monthsOf(period: Period): string[] {
  const count = period.kind === 'month' ? 1 : period.kind === 'quarter' ? 3 : 12
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const m = shiftPeriod({ kind: 'month', start: period.start }, i).start
    if (m <= monthStart()) out.push(m)
  }
  return out
}

function Line({ label, value, strong, tone, indent }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'warn' | 'good'; indent?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0', strong && 'font-semibold')}>
      <span className={cn(indent && 'pl-4 text-muted')}>{label}</span>
      <span className={cn('tabular-nums', tone === 'warn' && 'text-warn-700', tone === 'good' && 'text-brand-600')}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pasqyra
// ---------------------------------------------------------------------------
export function OverviewTab({ s, period }: { s: Summary; period: Period }) {
  const scope = useScope()
  const v = vatFigures(s)
  const p = profitAndLoss(s)
  const corrections = s.sales.voids + s.sales.refunds
  const shiftDiffs = s.shifts.filter((h) => h.counted != null && Math.abs(h.counted - (h.opening + h.cash_sales)) >= 0.01).length
  const due = s.purchases.due + s.expenses.due
  const bars = s.daily.map((d) => ({ key: d.date, label: String(Number(d.date.slice(8))), value: d.gross, title: `${formatDay(d.date)} – ${formatEUR(d.gross)}` }))

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Shitjet (me TVSH)" value={formatEUR(s.sales.gross)} sub={`${s.sales.docs} kuponë · pa TVSH ${formatEUR(s.sales.net)}`} />
        {s.business.vat_registered ? (
          <StatCard label={v.due >= 0 ? 'TVSH për pagesë' : 'TVSH e kreditueshme'} value={formatEUR(Math.abs(v.due))} sub={`E mbledhur ${formatEUR(v.out)} · e zbritshme ${formatEUR(v.inn)}`} />
        ) : (
          <StatCard label="TVSH" value="—" sub="Biznesi nuk është në TVSH" />
        )}
        <StatCard label="Blerjet dhe shpenzimet" value={formatEUR(s.purchases.gross + s.expenses.gross)} sub={`Mall ${formatEUR(s.purchases.gross)} · shpenzime ${formatEUR(s.expenses.gross)}`} />
        <StatCard label={p.result >= 0 ? 'Fitimi para tatimit' : 'Humbja'} value={formatEUR(p.result)} tone={p.result < 0 ? 'warn' : 'default'} sub={p.margin != null ? `Marzha bruto ${(p.margin * 100).toFixed(1)}%` : undefined} />
      </div>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Për t'u bërë</h2>
          <div className="mt-2 flex flex-col">
            {s.business.vat_registered &&
              monthsOf(period).map((m) => (
                <div key={m} className="border-b border-line py-3">
                  <VatStatusRow s={s} month={m} />
                </div>
              ))}
            <Line
              label={
                <NavLink to={scope.link('shitjet')} className="underline decoration-line underline-offset-4 hover:text-brand-600">
                  Anulime dhe kthime për kontroll
                </NavLink>
              }
              value={corrections ? `${corrections} · ${formatEUR(s.sales.void_total + s.sales.refund_total)}` : 'asnjë'}
              tone={corrections ? 'warn' : undefined}
            />
            {scope.kasa && <Line label="Shitje të bëra offline" value={s.sales.offline ? String(s.sales.offline) : 'asnjë'} />}
            <Line label="Blerje dhe shpenzime me afat pagese" value={due ? formatEUR(due) : 'asnjë'} />
            {scope.kasa && <Line
              label={
                <NavLink to={scope.link('arka')} className="underline decoration-line underline-offset-4 hover:text-brand-600">
                  Ndërrime me diferencë në arkë
                </NavLink>
              }
              value={shiftDiffs ? String(shiftDiffs) : 'asnjë'}
              tone={shiftDiffs ? 'warn' : undefined}
            />}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Shitjet ditore</h2>
          <div className="mt-6">
            <BarChart bars={bars} />
            <BarLabels bars={bars} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Të dhënat e tatimpaguesit</h2>
          <div className="mt-2">
            <Line label="Emri" value={s.business.name} />
            <Line label="NUI" value={s.business.nui || '—'} />
            <Line label="Nr. i TVSH-së" value={s.business.vat_number || 'jo në TVSH'} />
            <Line label="Nr. fiskal" value={s.business.fiscal_number || '—'} />
            <Line label="Adresa" value={[s.business.address, s.business.city].filter(Boolean).join(', ') || '—'} />
          </div>
        </Card>
        {scope.kasa && <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Arka dhe stoku</h2>
          <div className="mt-2">
            <Line label="Arkëtuar me kesh" value={formatEUR(s.sales.cash)} />
            <Line label="Arkëtuar me kartelë" value={formatEUR(s.sales.card)} />
            <Line label="Zbritjet e dhëna" value={formatEUR(s.sales.discounts)} />
            <Line label="Kuponët e periudhës" value={s.sales.first_no != null ? `#${String(s.sales.first_no).padStart(5, '0')} – #${String(s.sales.last_no).padStart(5, '0')}` : '—'} />
            <Line label="Vlera e stokut sot (çmim blerjeje)" value={formatEUR(s.stock.gross)} />
          </div>
        </Card>}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// TVSH
// ---------------------------------------------------------------------------
export function VatTab({ s, period }: { s: Summary; period: Period }) {
  const v = vatFigures(s)
  return (
    <>
      {!s.business.vat_registered && (
        <p className="rounded-card border border-[#F1DFA8] bg-amber-100 px-5 py-4 text-sm text-amber-700">
          Biznesi nuk ka numër të TVSH-së te Cilësimet, prandaj nuk deklaron TVSH. Ndarja sipas normës shfaqet vetëm për informim.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
        <StatCard label="TVSH e mbledhur (shitjet)" value={formatEUR(v.out)} sub={`Baza ${formatEUR(sumVat(s.vat_out).net)}`} />
        <StatCard label="TVSH e zbritshme (blerjet)" value={formatEUR(v.inn)} sub={`Baza ${formatEUR(sumVat(v.input).net)}`} />
        <StatCard label={v.due >= 0 ? 'TVSH për pagesë' : 'TVSH e kreditueshme'} value={formatEUR(Math.abs(v.due))} tone={v.due > 0 ? 'warn' : 'default'} sub={v.due >= 0 ? 'E mbledhur − e zbritshme' : 'Bartet në periudhën tjetër'} />
      </div>

      {s.business.vat_registered && (
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Statusi i deklaratës</h2>
          <div className="mt-2 flex flex-col">
            {monthsOf(period).map((m) => (
              <div key={m} className="border-b border-line py-3 last:border-b-0">
                <VatStatusRow s={s} month={m} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
        <VatTable title="Shitjet sipas normës" rows={s.vat_out} vatLabel="TVSH e mbledhur" hint="Nga kuponët e periudhës; anulimet dhe kthimet janë zbritur." />
        <VatTable title="Blerjet dhe shpenzimet sipas normës" rows={v.input} vatLabel="TVSH e zbritshme" hint="Hyrjet e konfirmuara të mallit dhe shpenzimet e regjistruara." />
      </div>
      <p className="text-sm text-muted">
        Shumat janë përgatitje për deklaratën në EDI. Kontrollo që çdo faturë blerjeje i plotëson kushtet për zbritje para se ta deklarosh.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// Fitimi dhe humbja
// ---------------------------------------------------------------------------
export function ProfitTab({ s }: { s: Summary }) {
  const p = profitAndLoss(s)
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Të hyrat" value={formatEUR(p.revenue)} sub={p.vat ? 'pa TVSH' : 'biznesi nuk është në TVSH'} />
        <StatCard label="Fitimi bruto" value={formatEUR(p.gross)} sub={p.margin != null ? `Marzha ${(p.margin * 100).toFixed(1)}%` : undefined} />
        <StatCard label="Shpenzimet" value={formatEUR(p.expenses)} sub={`${s.expenses.docs} të regjistruara`} />
        <StatCard label={p.result >= 0 ? 'Fitimi para tatimit' : 'Humbja'} value={formatEUR(p.result)} tone={p.result < 0 ? 'warn' : 'default'} />
      </div>
      <Card className="p-5 lg:max-w-[720px]">
        <h2 className="text-[17px] font-semibold">Pasqyra e të ardhurave</h2>
        <p className="mt-1 text-sm text-muted">{p.vat ? 'Shumat pa TVSH.' : 'Shumat siç janë paguar (biznesi nuk e zbret TVSH-në).'}</p>
        <div className="mt-2">
          <Line label="Të hyrat nga shitja" value={formatEUR(p.revenue)} />
          <Line label="Kosto e mallit të shitur" value={formatEUR(-p.cogs)} />
          <Line label="Fitimi bruto" value={formatEUR(p.gross)} strong />
          <Line label="Shkarkimet dhe dallimet e inventarit" value={formatEUR(-p.stockLoss)} />
          {p.categories.map((c) => (
            <Line key={c.category} label={EXPENSE_LABELS[c.category]} value={formatEUR(-c.amount)} indent />
          ))}
          <Line label="Shpenzimet gjithsej" value={formatEUR(-p.expenses)} strong />
          <Line label={p.result >= 0 ? 'Fitimi para tatimit' : 'Humbja'} value={formatEUR(p.result)} strong tone={p.result < 0 ? 'warn' : 'good'} />
        </div>
      </Card>
      <p className="text-sm text-muted">
        {useScope().kasa
          ? 'Kostoja merret nga çmimi i blerjes në çastin e shitjes. Shkarkimet llogariten me çmimin e sotëm të blerjes. Pagat, qiraja dhe shpenzimet e tjera hyjnë vetëm nëse regjistrohen te Shpenzimet.'
          : 'Blerjet e mallit llogariten si kosto në muajin kur regjistrohen (pa ndjekje të stokut). Mjetet themelore nuk hyjnë në shpenzime.'}
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// Barazimi i arkës
// ---------------------------------------------------------------------------
export function CashTab({ s }: { s: Summary }) {
  const showWorker = s.shifts.some((h) => h.worker)
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Kesh" value={formatEUR(s.sales.cash)} />
        <StatCard label="Kartelë" value={formatEUR(s.sales.card)} />
        <StatCard label="Gjithsej" value={formatEUR(s.sales.gross)} sub={`${s.sales.docs} kuponë`} />
        <StatCard label="Kthime dhe anulime" value={formatEUR(s.sales.refund_total + s.sales.void_total)} sub={`${s.sales.refunds} kthime · ${s.sales.voids} anulime`} />
      </div>

      <Card className="overflow-hidden">
        <h2 className="px-5 pt-5 text-[17px] font-semibold">Ndërrimet</h2>
        <p className="px-5 pt-1 text-sm text-muted">Pritet në arkë = kusuri në fillim + shitjet me kesh të ndërrimit. Kontroll i brendshëm, nuk dërgohet në ATK.</p>
        {s.shifts.length === 0 ? (
          <EmptyState title="Asnjë ndërrim në këtë periudhë" />
        ) : (
          <Table className="mt-3">
            <thead className="bg-[#F8FAF8]">
              <tr>
                <Th className="pl-5">Fillimi</Th>
                <Th>Mbyllja</Th>
                <Th className="hidden md:table-cell">Arka</Th>
                {showWorker && <Th className="hidden md:table-cell">Arkëtari</Th>}
                <Th className="text-right">Në fillim</Th>
                <Th className="text-right">Shitje kesh</Th>
                <Th className="text-right">Pritet</Th>
                <Th className="text-right">E numëruar</Th>
                <Th className="pr-5 text-right">Diferenca</Th>
              </tr>
            </thead>
            <tbody>
              {s.shifts.map((h) => {
                const expected = h.opening + h.cash_sales
                const diff = h.counted == null ? null : h.counted - expected
                return (
                  <tr key={h.id}>
                    <Td className="whitespace-nowrap pl-5">{formatKosovoDateTime(h.started_at)}</Td>
                    <Td className="whitespace-nowrap">{h.ended_at ? formatKosovoDateTime(h.ended_at) : <Badge tone="info">E hapur</Badge>}</Td>
                    <Td className="hidden md:table-cell">{h.register ?? '—'}</Td>
                    {showWorker && <Td className="hidden md:table-cell">{h.worker ?? '—'}</Td>}
                    <Td className="text-right">{formatEUR(h.opening)}</Td>
                    <Td className="text-right">{formatEUR(h.cash_sales)}</Td>
                    <Td className="text-right font-semibold">{formatEUR(expected)}</Td>
                    <Td className="text-right">{h.counted == null ? '—' : formatEUR(h.counted)}</Td>
                    <Td className={cn('pr-5 text-right font-semibold', diff != null && Math.abs(diff) >= 0.01 && 'text-warn-700')}>{diff == null ? '—' : formatEUR(diff)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-5 pt-5 text-[17px] font-semibold">Arkëtimet sipas ditës</h2>
        {s.daily.length === 0 ? (
          <EmptyState title="Asnjë shitje në këtë periudhë" />
        ) : (
          <Table className="mt-3">
            <thead className="bg-[#F8FAF8]">
              <tr>
                <Th className="pl-5">Data</Th>
                <Th className="text-right">Kuponë</Th>
                <Th className="text-right">Kesh</Th>
                <Th className="text-right">Kartelë</Th>
                <Th className="pr-5 text-right">Gjithsej</Th>
              </tr>
            </thead>
            <tbody>
              {s.daily.map((d) => (
                <tr key={d.date}>
                  <Td className="pl-5">{formatDay(d.date)}</Td>
                  <Td className="text-right">{d.docs}</Td>
                  <Td className="text-right">{formatEUR(d.cash)}</Td>
                  <Td className="text-right">{formatEUR(d.card)}</Td>
                  <Td className="pr-5 text-right font-semibold">{formatEUR(d.gross)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}
