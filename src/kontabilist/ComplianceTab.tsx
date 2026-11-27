import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Download, Info, XCircle } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, monthName, monthStart } from '@/features/accounting/api'
import { downloadWorkbook } from '@/features/accounting/export'
import type { Client } from './api'
import { buildRows, checkBooks, totals } from './atkBooks'
import { fetchBookDocs } from './atkBooksApi'
import { buildRb500, checkPayroll, legalKind, quarterlyForm, rbRequired, regimeIssues, vatVsBooks, type Issue } from './compliance'
import { fetchPayroll } from './payroll'
import { fetchTaxOverview, fetchVatForm, REGIME_LABELS } from './vat'

const lastDay = (m: string) => {
  const d = new Date(`${addMonths(m, 1)}T00:00:00Z`)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

interface Section {
  key: string
  title: string
  sub: string
  issues: Issue[]
  loading: boolean
  error?: string | null
}

/**
 * Kontrolli para dorëzimit: everything that is filed with ATK for one month, checked in one place –
 * the sales / purchase books, the VAT return against the books, the payroll (WM/CM) and the tax regime.
 * Each finding opens the page where it is fixed.
 */
export function ComplianceTab({ client, onGo }: { client: Client; onGo: (tab: string) => void }) {
  const today = kosovoDateISO()
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1))
  const to = lastDay(month)
  const year = Number(month.slice(0, 4))

  const docs = useQuery({ queryKey: ['client', client.id, 'atk-books', month, to], queryFn: () => fetchBookDocs(client.id, month, to) })
  const tax = useQuery({ queryKey: ['client', client.id, 'taxes', year], queryFn: () => fetchTaxOverview(client.id, year) })
  const vat = useQuery({ queryKey: ['client', client.id, 'vat-form', month], queryFn: () => fetchVatForm(client.id, month), enabled: client.vat_registered })
  const pay = useQuery({ queryKey: ['client', client.id, 'payroll', month], queryFn: () => fetchPayroll(client.id, month) })

  const sections = useMemo<Section[]>(() => {
    const d = docs.data ?? []
    const bookIssues: Issue[] = checkBooks(d, client.vat_registered, month, to).map((i) => ({ level: i.level, text: i.text, tab: i.doc?.kind === 'sale' ? 'shitjet' : 'blerjet' }))
    const out: Section[] = [
      {
        key: 'books',
        title: client.vat_registered ? 'Libri i shitjes dhe i blerjes (LSH / LB)' : 'Libri i shitjes dhe i blerjes – jo TVSH',
        sub: `${d.length} dokumente · ${client.vat_registered ? 'afati 20 i muajit pasues' : 'dorëzohet për tremujor, deri më 15'}`,
        issues: bookIssues,
        loading: docs.isLoading,
        error: docs.error ? (docs.error as Error).message : null,
      },
    ]
    if (client.vat_registered) {
      const out30 = totals(buildRows('sales_vat', d)).at(-1) ?? 0
      const in67 = totals(buildRows('purchase_vat', d)).at(-1) ?? 0
      const saved = vat.data?.saved ?? null
      out.push({
        key: 'vat',
        title: 'Deklarata e TVSH-së (TV)',
        sub: saved ? `${saved.status === 'filed' ? 'E deklaruar' : 'Draft'} · [30] ${formatEUR(saved.boxes['30'] ?? 0)} · [67] ${formatEUR(saved.boxes['67'] ?? 0)}` : 'E papërgatitur',
        issues: vat.data ? vatVsBooks(saved, out30, in67, monthName(month)) : [],
        loading: vat.isLoading || docs.isLoading,
        error: vat.error ? (vat.error as Error).message : null,
      })
    }
    const lines = pay.data?.lines ?? []
    out.push({
      key: 'payroll',
      title: 'Pagat dhe kontributet (WM / CM)',
      sub: pay.data ? `${lines.length} punonjës · ${pay.data.status === 'filed' ? 'e deklaruar' : pay.data.status === 'confirmed' ? 'e konfirmuar' : 'draft'} · afati 15 i muajit pasues` : 'Pa listë pagash për këtë muaj',
      issues: checkPayroll(lines),
      loading: pay.isLoading,
      error: pay.error ? (pay.error as Error).message : null,
    })
    const t = tax.data
    const regime: Issue[] = t ? regimeIssues({ regime: t.regime, legal_form: client.legal_form, vat_registered: client.vat_registered, sales_12m: t.sales_12m }) : []
    if (t && Number(month.slice(5, 7)) <= 3) {
      const rb = rbRequired(t.regime, client.vat_registered)
      if (rb.required) regime.push({ level: 'info', tab: 'rb', text: `Raporti i blerjeve mbi 500 € për vitin ${year - 1} dorëzohet deri më 31 mars ${year}. ${rb.note}` })
    }
    const qf = t ? quarterlyForm(t.regime, legalKind(client.legal_form)) : null
    out.push({
      key: 'regime',
      title: 'Regjimi tatimor dhe deklaratat periodike',
      sub: t ? `${REGIME_LABELS[t.regime]} · tremujori: ${qf!.code} – ${qf!.label}` : '',
      issues: regime,
      loading: tax.isLoading,
      error: tax.error ? (tax.error as Error).message : null,
    })
    return out
  }, [docs.data, docs.isLoading, docs.error, vat.data, vat.isLoading, vat.error, pay.data, pay.isLoading, pay.error, tax.data, tax.isLoading, tax.error, client, month, to, year])

  const all = sections.flatMap((s) => s.issues)
  const errors = all.filter((i) => i.level === 'error').length
  const warns = all.filter((i) => i.level === 'warn').length
  const loading = sections.some((s) => s.loading)

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex h-11 items-center overflow-hidden rounded-ctl border border-field bg-white">
          <button type="button" aria-label="Muaji i kaluar" className="flex h-full w-11 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] px-2 text-center font-semibold">{monthName(month)}</span>
          <button type="button" aria-label="Muaji tjetër" className="flex h-full w-11 items-center justify-center hover:bg-bg disabled:text-[#B5BCC7]" disabled={addMonths(month, 1) > today} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {loading ? (
            <span className="text-muted">Duke kontrolluar…</span>
          ) : errors ? (
            <>
              <XCircle className="h-6 w-6 shrink-0 text-warn-700" />
              <span>
                <b>{errors} gabime</b> duhen rregulluar para dorëzimit{warns ? `, ${warns} paralajmërime` : ''}.
              </span>
            </>
          ) : warns ? (
            <>
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-700" />
              <span>
                Pa gabime; <b>{warns} paralajmërime</b> për t'u parë.
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-600" />
              <span>Gati për dorëzim – asnjë gabim apo paralajmërim.</span>
            </>
          )}
        </div>
      </Card>

      {sections.map((s) => (
        <SectionCard key={s.key} s={s} onGo={onGo} />
      ))}

      <p className="text-xs text-muted">
        Normat, pragjet dhe afatet: ATK, "Informata të përgjithshme për tatimet në Kosovë" (Ligji 05/L-028 i ndryshuar me 08/L-142, 06/L-105, 05/L-037, 04/L-101). Kontrolli nuk e zëvendëson
        verifikimin në EDI.
      </p>
    </div>
  )
}

function SectionCard({ s, onGo }: { s: Section; onGo: (tab: string) => void }) {
  const [all, setAll] = useState(false)
  const errors = s.issues.filter((i) => i.level === 'error').length
  const warns = s.issues.filter((i) => i.level === 'warn').length
  const shown = all ? s.issues : s.issues.slice(0, 6)
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        {s.loading ? (
          <span className="mt-1 h-4 w-4 animate-pulse rounded-full bg-line" />
        ) : s.error ? (
          <XCircle className="mt-0.5 h-5 w-5 text-muted" />
        ) : errors ? (
          <XCircle className="mt-0.5 h-5 w-5 text-warn-700" />
        ) : warns ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-brand-600" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{s.title}</h2>
          <p className="text-sm text-muted">{s.sub}</p>
        </div>
        {!s.loading && !s.error && (
          <span className="shrink-0 text-sm tabular-nums text-muted">{s.issues.length ? `${errors} gabime · ${warns} paralajmërime` : 'Në rregull'}</span>
        )}
      </div>
      {s.error && <p className="px-5 py-3 text-sm text-muted">{s.error}</p>}
      {s.issues.length > 0 && (
        <ul className="divide-y divide-line">
          {shown.map((i, k) => (
            <li key={k} className="flex items-start gap-3 px-5 py-2.5 text-sm">
              {i.level === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn-700" /> : i.level === 'warn' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
              <span className={cn('flex-1', i.level === 'error' && 'text-warn-700')}>{i.text}</span>
              {i.tab && (
                <button type="button" onClick={() => onGo(i.tab!)} className="flex shrink-0 items-center gap-1 font-semibold text-brand-600 hover:underline">
                  Rregullo <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.issues.length > 6 && (
        <button type="button" className="w-full border-t border-line px-5 py-2.5 text-left text-sm font-semibold text-brand-600 hover:bg-bg" onClick={() => setAll(!all)}>
          {all ? 'Më pak' : `Shfaqi të gjitha (${s.issues.length})`}
        </button>
      )}
    </Card>
  )
}

/** RB – purchases of 500 € or more from one supplier within the year (reported online at ATK by 31 March). */
export function Rb500Tab({ client, onGo }: { client: Client; onGo: (tab: string) => void }) {
  const today = kosovoDateISO()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) <= 3 ? 1 : 0))
  const docs = useQuery({ queryKey: ['client', client.id, 'atk-books', `${year}-01-01`, `${year}-12-31`], queryFn: () => fetchBookDocs(client.id, `${year}-01-01`, `${year}-12-31`) })
  const tax = useQuery({ queryKey: ['client', client.id, 'taxes', year], queryFn: () => fetchTaxOverview(client.id, year) })
  const rb = useMemo(() => buildRb500(docs.data ?? [], year), [docs.data, year])
  const req = tax.data ? rbRequired(tax.data.regime, client.vat_registered) : null
  const total = rb.rows.reduce((s, r) => s + r.total, 0)
  const errors = rb.issues.filter((i) => i.level === 'error').length

  const download = useMutation({
    mutationFn: () =>
      downloadWorkbook(`Blerjet mbi 500 euro - ${client.name.replace(/[\\/:*?"<>|]+/g, ' ')} - ${year}.xlsx`, [
        {
          name: `RB ${year}`,
          widths: [6, 18, 44, 12, 16],
          rows: [
            [{ value: 'Nr.', fontWeight: 'bold' }, { value: 'Numri fiskal / NUI', fontWeight: 'bold' }, { value: 'Emri i furnitorit', fontWeight: 'bold' }, { value: 'Fatura', fontWeight: 'bold' }, { value: 'Vlera (€)', fontWeight: 'bold' }],
            ...rb.rows.map((r, i) => [
              { value: i + 1, type: Number },
              { value: r.nui, type: String },
              { value: r.name, type: String },
              { value: r.docs, type: Number },
              { value: r.total, type: Number, format: '0.00' },
            ]),
            [null, null, { value: 'Gjithsej', fontWeight: 'bold' }, null, { value: Math.round(total * 100) / 100, type: Number, format: '0.00', fontWeight: 'bold' }],
          ],
        },
      ]),
  })

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-11 items-center overflow-hidden rounded-ctl border border-field bg-white">
            <button type="button" aria-label="Viti i kaluar" className="flex h-full w-11 items-center justify-center hover:bg-bg" onClick={() => setYear(year - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-4 font-semibold tabular-nums">{year}</span>
            <button type="button" aria-label="Viti tjetër" className="flex h-full w-11 items-center justify-center hover:bg-bg disabled:text-[#B5BCC7]" disabled={year >= Number(today.slice(0, 4))} onClick={() => setYear(year + 1)}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1 text-sm text-muted">
            Furnitorët nga të cilët blerjet e vitit arrijnë 500 € ose më shumë (notat kreditore zbriten; importet dhe ngarkesa e kundërt nga jashtë nuk hyjnë). Raporti dorëzohet online në ATK deri më 31 mars {year + 1}.
          </div>
          <Button variant="secondary" disabled={!rb.rows.length} loading={download.isPending} onClick={() => download.mutate()}>
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
        {req && <p className={cn('mt-3 rounded-ctl px-4 py-3 text-sm', req.required ? 'bg-brand-100 text-brand-700' : 'bg-bg text-muted')}>{req.note}</p>}
        {errors > 0 && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{errors} furnitorë pa numër fiskal të saktë – plotësoje te partnerët para dorëzimit.</p>}
      </Card>

      {rb.issues.length > 0 && <SectionCard s={{ key: 'rb', title: 'Kontrolli', sub: 'Furnitorët që ATK nuk i identifikon', issues: rb.issues, loading: false }} onGo={onGo} />}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="px-5 py-3 font-semibold">Nr.</th>
              <th className="py-3 font-semibold">Numri fiskal / NUI</th>
              <th className="py-3 font-semibold">Furnitori</th>
              <th className="py-3 text-right font-semibold">Fatura</th>
              <th className="px-5 py-3 text-right font-semibold">Vlera</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {docs.isLoading ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted">
                  Duke ngarkuar…
                </td>
              </tr>
            ) : rb.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted">
                  Asnjë furnitor me blerje mbi 500 € në {year}.
                </td>
              </tr>
            ) : (
              rb.rows.map((r, i) => (
                <tr key={r.nui + r.name}>
                  <td className="px-5 py-2.5 tabular-nums text-muted">{i + 1}</td>
                  <td className={cn('py-2.5 tabular-nums', !/^\d{9,10}$/.test(r.nui) && 'font-semibold text-warn-700')}>{r.nui || 'mungon'}</td>
                  <td className="py-2.5">{r.name}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.docs}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{formatEUR(r.total)}</td>
                </tr>
              ))
            )}
          </tbody>
          {rb.rows.length > 0 && (
            <tfoot className="border-t border-line font-semibold">
              <tr>
                <td className="px-5 py-3" colSpan={3}>
                  {rb.rows.length} furnitorë
                </td>
                <td />
                <td className="px-5 py-3 text-right tabular-nums">{formatEUR(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>
      {docs.error && <p className="text-sm text-warn-700">{(docs.error as Error).message}</p>}
    </div>
  )
}
