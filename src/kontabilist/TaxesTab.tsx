import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge, Button, Card, Dialog, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay, monthName } from '@/features/accounting/api'
import type { Client } from './api'
import { fetchCalendar, fetchTaxOverview, FILING_LABELS, quarterTax, REGIME_LABELS, saveFiling, setTaxRegime, type Deadline, type FilingKind, type TaxRegime } from './vat'

const VAT_THRESHOLD = 30000

/** Other taxes of a company: regime, rent tax 9%, quarterly / annual income tax, filings, deadlines. */
export function TaxesTab({ client, onGo }: { client: Client; onGo: (tab: string) => void }) {
  const qc = useQueryClient()
  const today = kosovoDateISO()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const ov = useQuery({ queryKey: ['client', client.id, 'taxes', year], queryFn: () => fetchTaxOverview(client.id, year) })
  const cal = useQuery({ queryKey: ['calendar', 'client', client.id, today], queryFn: async () => (await fetchCalendar(addDays(today, -60), addDays(today, 120))).filter((d) => d.client_id === client.id) })
  const [file, setFile] = useState<{ kind: FilingKind; period: string; amount: number; title: string } | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['client', client.id] })
    void qc.invalidateQueries({ queryKey: ['calendar'] })
  }
  const regime = useMutation({ mutationFn: (r: TaxRegime) => setTaxRegime(client.id, r), onSuccess: refresh })
  const d = ov.data
  const filing = (kind: FilingKind, period: string) => d?.filings.find((f) => f.kind === kind && f.period === period)

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
          <button type="button" aria-label="Viti i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setYear(year - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 font-semibold tabular-nums">{year}</span>
          <button type="button" aria-label="Viti tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg disabled:text-[#B8C2BC]" disabled={year >= Number(today.slice(0, 4))} onClick={() => setYear(year + 1)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="min-w-[280px] flex-1 md:max-w-[520px]">
          <Select
            label="Regjimi tatimor i kompanisë"
            value={d?.regime ?? 'corporate'}
            onChange={(e) => regime.mutate(e.target.value as TaxRegime)}
            options={(Object.keys(REGIME_LABELS) as TaxRegime[]).map((r) => ({ value: r, label: REGIME_LABELS[r] }))}
          />
        </div>
      </div>

      {d && !d.vat_registered && d.sales_12m >= VAT_THRESHOLD * 0.8 && (
        <p className={cn('flex items-start gap-2 rounded-ctl px-4 py-3 text-sm', d.sales_12m >= VAT_THRESHOLD ? 'bg-warn-100 text-warn-700' : 'bg-amber-100 text-amber-700')}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Qarkullimi i 12 muajve të fundit është {formatEUR(d.sales_12m)}. Mbi {formatEUR(VAT_THRESHOLD)} biznesi duhet të regjistrohet për TVSH.
        </p>
      )}

      {/* deadlines of this company */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <CalendarClock className="h-5 w-5 text-brand-600" />
          <h2 className="text-[17px] font-semibold">Afatet tatimore</h2>
        </div>
        {!cal.data ? (
          <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
        ) : cal.data.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Asnjë afat në 4 muajt e ardhshëm.</p>
        ) : (
          <ul className="divide-y divide-line">
            {cal.data.map((x) => (
              <DeadlineRow key={x.kind + x.period} d={x} today={today} onOpen={() => (x.kind === 'vat' ? onGo('tvsh') : setFile({ kind: x.kind as FilingKind, period: x.period, amount: x.amount ?? 0, title: FILING_LABELS[x.kind] }))} />
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:gap-5 xl:grid-cols-2">
        {/* income tax by quarter */}
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Tatimi në {d?.regime === 'corporate' ? 'fitim' : 'të ardhura'} – tremujorët {year}</h2>
          <p className="text-sm text-muted">{d ? REGIME_LABELS[d.regime] : ''}. Vlerësim nga faturat e regjistruara; pagesa bëhet deri më 15 të muajit pas tremujorit.</p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1.5">Tremujori</th>
                <th className="text-right">Qarkullimi</th>
                <th className="text-right">Kostot</th>
                <th className="text-right">Tatimi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(d?.quarters ?? []).map((q) => {
                const tax = quarterTax(d!.regime, q.turnover, q.costs)
                const period = `${year}-${String((q.q - 1) * 3 + 1).padStart(2, '0')}-01`
                const f = filing('income_q', period)
                return (
                  <tr key={q.q} className="border-t border-line">
                    <td className="py-2">TM{q.q}</td>
                    <td className="text-right tabular-nums">{formatEUR(q.turnover)}</td>
                    <td className="text-right tabular-nums">{formatEUR(q.costs)}</td>
                    <td className="text-right font-semibold tabular-nums">{formatEUR(f?.amount ?? tax)}</td>
                    <td className="pl-2 text-right">
                      {f ? (
                        <Badge tone="success">{f.status === 'paid' ? 'Paguar' : 'Deklaruar'}</Badge>
                      ) : (
                        <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" onClick={() => setFile({ kind: 'income_q', period, amount: tax, title: `Tatimi TM${q.q} ${year}` })}>
                          Shëno
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {d && (
                <tr className="border-t border-line font-semibold">
                  <td className="py-2">Viti</td>
                  <td className="text-right tabular-nums">{formatEUR(d.quarters.reduce((s, q) => s + q.turnover, 0))}</td>
                  <td className="text-right tabular-nums">{formatEUR(d.quarters.reduce((s, q) => s + q.costs, 0))}</td>
                  <td className="text-right tabular-nums">{formatEUR(d.quarters.reduce((s, q) => s + quarterTax(d.regime, q.turnover, q.costs), 0))}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* rent tax */}
        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Tatimi në qira (9%)</h2>
          <p className="text-sm text-muted">Mbahet nga qiraja që i paguhet pronarit (person fizik) dhe deklarohet deri më 15 të muajit pasues. Bazohet te faturat me kategorinë "Qiraja".</p>
          {!d?.rent.length ? (
            <p className="mt-3 text-sm text-muted">Asnjë qira e regjistruar në {year}.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1.5">Muaji</th>
                  <th className="text-right">Qiraja</th>
                  <th className="text-right">Tatimi 9%</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.rent.map((r) => {
                  const tax = Math.round(r.gross * 0.09 * 100) / 100
                  const f = filing('rent', r.month)
                  return (
                    <tr key={r.month} className="border-t border-line">
                      <td className="py-2">{monthName(r.month)}</td>
                      <td className="text-right tabular-nums">{formatEUR(r.gross)}</td>
                      <td className="text-right font-semibold tabular-nums">{formatEUR(f?.amount ?? tax)}</td>
                      <td className="pl-2 text-right">
                        {f ? (
                          <Badge tone="success">{f.status === 'paid' ? 'Paguar' : 'Deklaruar'}</Badge>
                        ) : (
                          <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" onClick={() => setFile({ kind: 'rent', period: r.month, amount: tax, title: `Tatimi në qira – ${monthName(r.month)}` })}>
                            Shëno
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* history */}
      <Card className="p-5">
        <h2 className="text-[17px] font-semibold">Historiku i deklaratave</h2>
        {!d?.filings.length ? (
          <p className="mt-2 text-sm text-muted">Deklaratat që shënon (qiraja, tremujorët, vjetore, pagat) dalin këtu. Deklaratat e TVSH-së janë te "Formulari i TVSH-së".</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-sm">
            {d.filings.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{FILING_LABELS[f.kind]}</strong> · {f.kind === 'income_annual' ? f.period.slice(0, 4) : f.kind === 'income_q' ? `TM${Math.floor(Number(f.period.slice(5, 7)) / 3) + 1} ${f.period.slice(0, 4)}` : monthName(f.period)}
                  {f.reference && <span className="text-muted"> · nr. {f.reference}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatEUR(f.amount)}</span>
                  <Badge tone={f.status === 'paid' ? 'success' : 'info'}>{f.status === 'paid' ? `Paguar ${f.paid_at ? formatDay(f.paid_at) : ''}` : `Deklaruar ${f.filed_at ? formatDay(f.filed_at) : ''}`}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button className="mt-3" variant="secondary" onClick={() => setFile({ kind: 'income_annual', period: `${year - 1}-01-01`, amount: 0, title: `Deklarata vjetore ${year - 1}` })}>
          <CheckCircle2 className="h-4 w-4" /> Shëno deklaratën vjetore {year - 1}
        </Button>
      </Card>

      <FilingDialog clientId={client.id} value={file} onClose={() => setFile(null)} onSaved={refresh} />
    </div>
  )
}

const addDays = (iso: string, n: number) => {
  const x = new Date(iso + 'T12:00:00')
  x.setDate(x.getDate() + n)
  return x.toISOString().slice(0, 10)
}

export function DeadlineRow({ d, today, onOpen, showClient }: { d: Deadline; today: string; onOpen: () => void; showClient?: boolean }) {
  const done = d.status === 'filed' || d.status === 'paid'
  const left = Math.round((Date.parse(d.due + 'T12:00:00') - Date.parse(today + 'T12:00:00')) / 86_400_000)
  const period = d.kind === 'income_annual' ? d.period.slice(0, 4) : d.kind === 'income_q' ? `TM${Math.floor(Number(d.period.slice(5, 7)) / 3) + 1} ${d.period.slice(0, 4)}` : monthName(d.period)
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-[#F6F9F7]">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', done ? 'bg-brand-400' : left < 0 ? 'bg-[#DC2626]' : left <= 5 ? 'bg-[#F59E0B]' : 'bg-[#94A3B8]')} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {showClient && <span className="text-muted">{d.client} · </span>}
            {FILING_LABELS[d.kind]} · {period}
          </span>
          {d.amount != null && <span className="block text-sm text-muted">{formatEUR(d.amount)}</span>}
        </span>
        <span className={cn('text-sm', !done && left < 0 ? 'font-semibold text-[#DC2626]' : 'text-muted')}>
          {formatDay(d.due)} · {done ? (d.status === 'paid' ? 'paguar' : 'dorëzuar') : left < 0 ? `${-left} ditë vonë` : left === 0 ? 'sot' : `pas ${left} ditësh`}
        </span>
      </button>
    </li>
  )
}

function FilingDialog({ clientId, value, onClose, onSaved }: { clientId: string; value: { kind: FilingKind; period: string; amount: number; title: string } | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: '', filed_at: kosovoDateISO(), reference: '', paid: false, paid_at: kosovoDateISO() })
  useEffect(() => {
    if (value) setF({ amount: value.amount ? String(value.amount) : '', filed_at: kosovoDateISO(), reference: '', paid: false, paid_at: kosovoDateISO() })
  }, [value])
  const save = useMutation({
    mutationFn: () =>
      saveFiling(clientId, {
        kind: value!.kind,
        period: value!.period,
        amount: Number(f.amount.replace(',', '.')) || 0,
        status: f.paid ? 'paid' : 'filed',
        filed_at: f.filed_at,
        paid_at: f.paid ? f.paid_at : null,
        reference: f.reference || null,
      }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={value?.title ?? ''}
      subtitle="Shëno që deklarata u dorëzua (dhe u pagua) në EDI."
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Shuma (€)" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input label="Data e dorëzimit" type="date" value={f.filed_at} onChange={(e) => setF({ ...f, filed_at: e.target.value })} />
        <div className="sm:col-span-2">
          <Input label="Nr. i konfirmimit" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> E paguar
        </label>
        {f.paid && <Input label="Data e pagesës" type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} />}
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}
