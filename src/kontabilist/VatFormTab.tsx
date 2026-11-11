import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Printer, Save } from 'lucide-react'
import { Badge, Button, Card, Dialog, Input } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, formatDay, monthName, monthStart } from '@/features/accounting/api'
import type { Client } from './api'
import { downloadSheets } from './xls'
import {
  fetchVatBook,
  fetchVatForm,
  finalBoxes,
  INPUTS,
  OUTPUTS,
  PURCHASE_BOOK_COLUMNS,
  purchaseBookRow,
  SALES_BOOK_COLUMNS,
  salesBookRow,
  saveVatReturn,
  type Boxes,
  type FormLine,
} from './vat'

const n2 = (v: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

/** VAT return of a month as the ATK form TV-A7: computed from the documents, adjustable, filed, printed, books for EDI. */
export function VatFormTab({ client }: { client: Client }) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => addMonths(monthStart(), -1))
  const form = useQuery({ queryKey: ['client', client.id, 'vat-form', month], queryFn: () => fetchVatForm(client.id, month) })
  const d = form.data
  const [manual, setManual] = useState<Boxes>({})
  const [carry, setCarry] = useState<number>(0)
  const [refund, setRefund] = useState<number>(0)
  const [fileOpen, setFileOpen] = useState(false)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!d) return
    setManual(d.saved?.manual ?? {})
    setCarry(d.saved ? d.saved.boxes['68'] ?? d.carry_prev : d.carry_prev)
    setRefund(d.saved?.boxes['70'] ?? 0)
  }, [d])
  useEffect(() => {
    if (!printing) return
    const t = setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 80)
    return () => clearTimeout(t)
  }, [printing])

  const boxes = useMemo(() => (d ? finalBoxes(d.computed, manual, carry, refund) : {}), [d, manual, carry, refund])
  const filed = d?.saved?.status === 'filed'

  const save = useMutation({
    mutationFn: (p: { status: 'draft' | 'filed'; filed_at?: string; reference?: string; paid_at?: string | null; paid_amount?: number | null }) =>
      saveVatReturn({ client_id: client.id, month, computed: d!.computed, manual, boxes, ...p }),
    onSuccess: () => {
      setFileOpen(false)
      void qc.invalidateQueries({ queryKey: ['client', client.id] })
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  const books = async () => {
    const [sales, purchases] = await Promise.all([fetchVatBook(client.id, month, 'sale'), fetchVatBook(client.id, month, 'purchase')])
    await downloadSheets(`librat-tvsh-${client.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${month.slice(0, 7)}.xlsx`, [
      { name: 'Libri i shitjeve', columns: SALES_BOOK_COLUMNS, rows: sales.length ? sales.map(salesBookRow) : [['', '', '', '0', '']] },
      { name: 'Libri i blerjeve', columns: PURCHASE_BOOK_COLUMNS, rows: purchases.filter((r) => r.doc_type !== 'credit_note').map(purchaseBookRow) },
    ])
  }

  const line = (l: FormLine) => {
    const computed = d?.computed[l.box] ?? 0
    return (
      <div key={l.box} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line py-2 md:grid-cols-[1fr_150px_120px_150px]">
        <div className="text-[14px]">
          <span className="mr-1.5 font-semibold text-muted">[{l.box}]</span>
          {l.label}
        </div>
        <div className="hidden text-right text-sm text-muted md:block" title="Nga dokumentet e muajit">
          {computed ? n2(computed) : '—'}
        </div>
        <input
          inputMode="decimal"
          disabled={filed}
          placeholder="+ rregullim"
          value={manual[l.box] ? String(manual[l.box]) : ''}
          onChange={(e) => {
            const v = Number(e.target.value.replace(',', '.'))
            setManual({ ...manual, [l.box]: Number.isFinite(v) ? v : 0 })
          }}
          className="hidden h-9 rounded-lg border border-field px-2 text-right text-sm disabled:bg-bg md:block"
        />
        <div className="text-right font-semibold tabular-nums">
          {n2(boxes[l.box] ?? 0)}
          {l.vat && (
            <div className="text-xs font-normal text-muted">
              [{l.vat}] TVSH {n2(boxes[l.vat] ?? 0)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
          <button type="button" aria-label="Muaji i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[140px] px-2 text-center font-semibold">{monthName(month)}</span>
          <button type="button" aria-label="Muaji tjetër" className="flex h-10 w-10 items-center justify-center hover:bg-bg disabled:text-[#B8C2BC]" disabled={month >= monthStart()} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void books()} disabled={!d}>
            <FileSpreadsheet className="h-4 w-4" /> Librat për EDI
          </Button>
          <Button variant="secondary" onClick={() => setPrinting(true)} disabled={!d}>
            <Printer className="h-4 w-4" /> Printo / PDF
          </Button>
          {!filed && (
            <Button variant="secondary" loading={save.isPending && !fileOpen} onClick={() => save.mutate({ status: 'draft' })} disabled={!d}>
              <Save className="h-4 w-4" /> Ruaj
            </Button>
          )}
          {filed ? (
            <Button variant="secondary" onClick={() => save.mutate({ status: 'draft' })} loading={save.isPending}>
              Rihape
            </Button>
          ) : (
            <Button onClick={() => setFileOpen(true)} disabled={!d}>
              <CheckCircle2 className="h-4 w-4" /> Shëno si të dorëzuar
            </Button>
          )}
        </div>
      </div>

      {!client.vat_registered && <p className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">Kjo kompani nuk është në sistemin e TVSH-së (Të dhënat e kompanisë). Formulari mbetet vetëm për informim.</p>}
      {save.error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{(save.error as Error).message}</p>}

      {!d ? (
        <p className={form.error ? 'text-sm text-warn-700' : 'py-10 text-center text-muted'}>{form.error ? (form.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Sum label="[30] TVSH e llogaritur" value={boxes['30']} />
            <Sum label="[67] TVSH e zbritshme" value={boxes['67']} />
            <Sum label={boxes['72'] > 0 ? '[72] TVSH për pagesë' : '[71] Kredi për muajin pasues'} value={boxes['72'] > 0 ? boxes['72'] : boxes['71']} tone={boxes['72'] > 0 ? 'warn' : 'good'} />
            <Card className="flex flex-col justify-center p-4">
              <div className="text-sm text-muted">Statusi</div>
              {filed ? (
                <div className="mt-1">
                  <Badge tone="success">Dorëzuar {d.saved?.filed_at ? formatDay(d.saved.filed_at) : ''}</Badge>
                  {d.saved?.reference && <div className="mt-1 text-xs text-muted">Nr. {d.saved.reference}</div>}
                  {d.saved?.paid_at && <div className="text-xs text-muted">Paguar {formatDay(d.saved.paid_at)}</div>}
                </div>
              ) : (
                <div className="mt-1">
                  <Badge tone={kosovoDateISO() > `${addMonths(month, 1).slice(0, 8)}20` ? 'warn' : 'amber'}>Afati {formatDay(`${addMonths(month, 1).slice(0, 8)}20`)}</Badge>
                  {d.saved && <div className="mt-1 text-xs text-muted">Draft i ruajtur</div>}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="mb-2 hidden grid-cols-[1fr_150px_120px_150px] gap-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
              <span>Furnizimet (shitjet)</span>
              <span className="text-right">Nga dokumentet</span>
              <span className="text-right">Rregullim</span>
              <span className="text-right">Në deklaratë</span>
            </div>
            <div className="md:hidden text-xs font-semibold uppercase tracking-wide text-muted">Furnizimet (shitjet)</div>
            {OUTPUTS.map(line)}
            <div className="flex justify-between py-2.5 font-semibold">
              <span>[30] Totali i TVSH-së së llogaritur</span>
              <span className="tabular-nums">{n2(boxes['30'])}</span>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Blerjet dhe importet</div>
            {INPUTS.map(line)}
            <div className="flex justify-between py-2.5 font-semibold">
              <span>[67] Totali i TVSH-së së zbritshme</span>
              <span className="tabular-nums">{n2(boxes['67'])}</span>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Kalkulimi</div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line py-2">
              <span className="text-[14px]">
                <span className="mr-1.5 font-semibold text-muted">[68]</span>Teprica e TVSH-së e bartur nga muaji i kaluar
                {d.prev_status && <span className="ml-2 text-xs text-muted">(nga deklarata e muajit të kaluar: {n2(d.carry_prev)})</span>}
              </span>
              <input inputMode="decimal" disabled={filed} value={carry ? String(carry) : ''} placeholder="0,00" onChange={(e) => setCarry(Number(e.target.value.replace(',', '.')) || 0)} className="h-9 w-[150px] rounded-lg border border-field px-2 text-right disabled:bg-bg" />
            </div>
            <Row box="69" label="Balanca kreditore e mbetur ((67+68)−30) > 0" value={boxes['69']} />
            <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line py-2">
              <span className="text-[14px]">
                <span className="mr-1.5 font-semibold text-muted">[70]</span>Kërkesa për rimbursim
              </span>
              <input inputMode="decimal" disabled={filed || boxes['69'] <= 0} value={refund ? String(refund) : ''} placeholder="0,00" onChange={(e) => setRefund(Number(e.target.value.replace(',', '.')) || 0)} className="h-9 w-[150px] rounded-lg border border-field px-2 text-right disabled:bg-bg" />
            </div>
            <Row box="71" label="Kreditimi i TVSH-së për muajin pasues (69−70)" value={boxes['71']} />
            <div className={cn('mt-2 flex justify-between rounded-ctl px-3 py-3 text-[17px] font-bold', boxes['72'] > 0 ? 'bg-warn-100 text-warn-700' : 'bg-brand-100 text-brand-600')}>
              <span>[72] TVSH që duhet të paguhet (30−67−68) &gt; 0</span>
              <span className="tabular-nums">{formatEUR(boxes['72'])}</span>
            </div>
            {d.kasa && <p className="mt-3 text-xs text-muted">Përfshihen edhe shitjet e arkës Kasa të këtij biznesi.</p>}
          </Card>
        </>
      )}

      <FileDialog open={fileOpen} toPay={boxes['72'] ?? 0} loading={save.isPending} onClose={() => setFileOpen(false)} onSave={(p) => save.mutate({ status: 'filed', ...p })} />
      {printing && d && createPortal(<PrintForm data={d} boxes={boxes} month={month} />, document.body)}
    </div>
  )
}

function Row({ box, label, value }: { box: string; label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line py-2 text-[14px]">
      <span>
        <span className="mr-1.5 font-semibold text-muted">[{box}]</span>
        {label}
      </span>
      <span className="font-semibold tabular-nums">{n2(value)}</span>
    </div>
  )
}

function Sum({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'good' }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={cn('mt-1 text-[22px] font-bold tabular-nums', tone === 'warn' && 'text-warn-700', tone === 'good' && 'text-brand-600')}>{formatEUR(value ?? 0)}</div>
    </Card>
  )
}

function FileDialog({ open, toPay, loading, onClose, onSave }: { open: boolean; toPay: number; loading: boolean; onClose: () => void; onSave: (p: { filed_at: string; reference?: string; paid_at?: string | null; paid_amount?: number | null }) => void }) {
  const [f, setF] = useState({ filed_at: kosovoDateISO(), reference: '', paid: false, paid_at: kosovoDateISO() })
  useEffect(() => {
    if (open) setF({ filed_at: kosovoDateISO(), reference: '', paid: false, paid_at: kosovoDateISO() })
  }, [open])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Deklarata u dorëzua në EDI"
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={loading} onClick={() => onSave({ filed_at: f.filed_at, reference: f.reference || undefined, paid_at: f.paid ? f.paid_at : null, paid_amount: f.paid ? toPay : null })}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Data e dorëzimit" type="date" value={f.filed_at} onChange={(e) => setF({ ...f, filed_at: e.target.value })} />
        <Input label="Nr. i konfirmimit (EDI)" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        {toPay > 0 && (
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> E paguar {formatEUR(toPay)}
          </label>
        )}
        {f.paid && <Input label="Data e pagesës" type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} />}
      </div>
      <p className="mt-3 text-sm text-muted">Kredia e mbetur [71] bartet vetë te muaji pasues [68].</p>
    </Dialog>
  )
}

/** A4 print in the layout of the ATK form. */
function PrintForm({ data, boxes, month }: { data: NonNullable<ReturnType<typeof fetchVatForm> extends Promise<infer T> ? T : never>; boxes: Boxes; month: string }) {
  const row = (l: FormLine) => (
    <tr key={l.box} className="border-b border-black/20">
      <td className="py-0.5 pr-2">
        <b>[{l.box}]</b> {l.label}
      </td>
      <td className="w-[90px] border border-black/40 px-1 text-right">{n2(boxes[l.box] ?? 0)}</td>
      <td className="w-[34px] text-center text-[10px]">{l.vat ? `[${l.vat}]` : ''}</td>
      <td className="w-[90px] border border-black/40 px-1 text-right">{l.vat ? n2(boxes[l.vat] ?? 0) : ''}</td>
    </tr>
  )
  return (
    <div className="print-root print-a4 hidden bg-white text-[10.5px] leading-tight text-black">
      <div className="mb-2 flex items-center gap-3">
        <div className="rounded bg-black px-2 py-1 text-[16px] font-bold text-white">TV</div>
        <div className="text-[15px] font-bold">FORMULARI I DEKLARIMIT TË TVSH</div>
      </div>
      <table className="mb-2 w-full">
        <tbody>
          <tr>
            <td className="w-[180px]">[1] Periudha e deklarimit:</td>
            <td className="border border-black/40 px-1">{monthName(month)}</td>
          </tr>
          <tr>
            <td>[3] Numri fiskal:</td>
            <td className="border border-black/40 px-1">{data.client.fiscal_number ?? data.client.nui ?? ''}</td>
          </tr>
          <tr>
            <td>[4] Emri i biznesit:</td>
            <td className="border border-black/40 px-1">{data.client.name}</td>
          </tr>
          <tr>
            <td>[5] Adresa e biznesit:</td>
            <td className="border border-black/40 px-1">{data.client.address}</td>
          </tr>
          <tr>
            <td>[6] Telefoni:</td>
            <td className="border border-black/40 px-1">{data.client.phone ?? ''}</td>
          </tr>
        </tbody>
      </table>
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left">Furnizimet</th>
            <th />
            <th />
            <th className="text-right">TVSH e llogaritur</th>
          </tr>
        </thead>
        <tbody>
          {OUTPUTS.map(row)}
          <tr>
            <td className="py-1 text-right font-bold" colSpan={2}>
              Totali i TVSH-së së llogaritur
            </td>
            <td className="text-center text-[10px]">[30]</td>
            <td className="border border-black px-1 text-right font-bold">{n2(boxes['30'])}</td>
          </tr>
        </tbody>
      </table>
      <table className="mt-2 w-full">
        <thead>
          <tr>
            <th className="text-left">Blerjet</th>
            <th />
            <th />
            <th className="text-right">TVSH e zbritshme</th>
          </tr>
        </thead>
        <tbody>
          {INPUTS.map(row)}
          <tr>
            <td className="py-1 text-right font-bold" colSpan={2}>
              Totali i TVSH-së së zbritshme
            </td>
            <td className="text-center text-[10px]">[67]</td>
            <td className="border border-black px-1 text-right font-bold">{n2(boxes['67'])}</td>
          </tr>
        </tbody>
      </table>
      <table className="mt-2 w-[70%]">
        <tbody>
          {[
            ['68', 'Teprica e TVSH-së e bartur nga muaji i kaluar'],
            ['69', 'Balanca kreditore e mbetur 69 = ((67+68)−30) > 0'],
            ['70', 'Kërkesa për rimbursim'],
            ['71', 'Kreditimi i TVSH-së për muajin pasues 71 = (69−70)'],
            ['72', 'TVSH që duhet të paguhet 72 = (30−67−68) > 0'],
          ].map(([b, l]) => (
            <tr key={b}>
              <td className={cn('py-0.5', b === '72' && 'font-bold')}>
                <b>[{b}]</b> {l}
              </td>
              <td className={cn('w-[100px] border border-black/40 px-1 text-right', b === '72' && 'font-bold')}>{n2(boxes[b] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[9px]">Përgatitur në Kasa Kontabilist · Nr. Formës TV-A7 · plotësohet dhe dorëzohet në EDI të ATK-së.</p>
    </div>
  )
}
