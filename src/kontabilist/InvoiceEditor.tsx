import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Trash2, UserPlus } from 'lucide-react'
import { Button, Dialog, Input, Select, Tabs } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import type { VatCode } from '@/lib/vat'
import {
  computeInvoice,
  DOC_TYPE_LABELS,
  DuplicateInvoice,
  fetchDocs,
  fetchPartners,
  PURCHASE_CATEGORIES,
  SALE_CATEGORIES,
  saveInvoice,
  type DocCategory,
  type DocLine,
  type DocType,
  type InvoiceInput,
} from './api'
import { EMPTY_PARTNER, PartnerDialog } from './PartnersTab'
import { VAT_FLAG_LABELS, type VatFlag } from './vat'

const UNITS = ['copë', 'orë', 'ditë', 'muaj', 'kg', 'litër', 'm', 'm²', 'm³', 'pako', 'shërbim']
const VAT_OPTIONS: { value: VatCode; label: string }[] = [
  { value: 'E', label: '18%' },
  { value: 'D', label: '8%' },
  { value: 'C', label: '0%' },
  { value: 'A', label: 'E liruar' },
]
const emptyLine = (code: VatCode = 'E'): DocLine => ({ description: '', unit: 'copë', quantity: 1, unit_price: 0, discount_pct: 0, vat_code: code })
const num = (s: string) => {
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function newInvoice(kind: InvoiceInput['kind'], date?: string, over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    kind,
    doc_type: 'invoice',
    category: 'goods',
    doc_date: date ?? kosovoDateISO(),
    due_date: null,
    doc_no: '',
    partner_id: null,
    description: '',
    note: '',
    export: false,
    vat_deductible: true,
    lines: kind === 'purchase' ? [] : [emptyLine()],
    net_e: 0,
    vat_e: 0,
    net_d: 0,
    vat_d: 0,
    amt_c: 0,
    amt_a: 0,
    paid_now: null,
    ...over,
  }
}

/**
 * New / edit invoice: sale, purchase or proforma; invoice, credit or debit note.
 * Amounts come from the lines (price without VAT, discount, rate) – or, mostly for supplier invoices,
 * straight from the paper: base and VAT per rate. The server recomputes everything the same way.
 */
export function InvoiceEditor({ clientId, value, onClose, onSaved }: { clientId: string; value: InvoiceInput | null; onClose: () => void; onSaved: (id: string, docNo: string) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<InvoiceInput>(() => value ?? newInvoice('sale'))
  const [mode, setMode] = useState<'lines' | 'amounts'>('lines')
  const [partnerNew, setPartnerNew] = useState(false)
  const [dupe, setDupe] = useState<string | null>(null)
  useEffect(() => {
    if (!value) return
    setF({ ...value, lines: value.lines.length || value.kind === 'purchase' ? value.lines : [emptyLine()] })
    setMode(value.lines.length || (value.kind !== 'purchase' && !value.id) ? 'lines' : 'amounts')
    setDupe(null)
  }, [value])

  const kind = f.kind
  const purchase = kind === 'purchase'
  const partners = useQuery({ queryKey: ['client', clientId, 'partners'], queryFn: () => fetchPartners(clientId), enabled: Boolean(value) })
  const originals = useQuery({
    queryKey: ['client', clientId, 'originals', kind],
    queryFn: () => fetchDocs(clientId, kind, '2000-01-01', addDays(kosovoDateISO(), 366)),
    enabled: Boolean(value) && f.doc_type !== 'invoice' && kind !== 'proforma',
  })
  const partnerOptions = (partners.data ?? []).filter((p) => p.active || p.id === f.partner_id).filter((p) => (purchase ? p.role !== 'customer' : p.role !== 'supplier'))

  const calc = useMemo(() => computeInvoice(f.lines, Boolean(f.export)), [f.lines, f.export])
  const amounts = mode === 'lines' ? calc : (() => {
    const r = { net_e: f.net_e ?? 0, vat_e: f.vat_e ?? 0, net_d: f.net_d ?? 0, vat_d: f.vat_d ?? 0, amt_c: f.amt_c ?? 0, amt_a: f.amt_a ?? 0 }
    return { ...r, discount: 0, total: Math.round((r.net_e + r.vat_e + r.net_d + r.vat_d + r.amt_c + r.amt_a) * 100) / 100 }
  })()

  const save = useMutation({
    mutationFn: (force: boolean) =>
      saveInvoice(clientId, {
        ...f,
        lines: mode === 'lines' ? f.lines.filter((l) => l.description.trim() || l.unit_price) : [],
        ...(mode === 'lines' ? {} : { net_e: f.net_e, vat_e: f.vat_e, net_d: f.net_d, vat_d: f.vat_d, amt_c: f.amt_c, amt_a: f.amt_a }),
        force,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['client', clientId] })
      onSaved(r.id, r.doc_no)
    },
    onError: (e) => {
      if (e instanceof DuplicateInvoice) setDupe(e.message)
    },
  })

  const setLine = (i: number, patch: Partial<DocLine>) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const amountField = (k: 'net_e' | 'vat_e' | 'net_d' | 'vat_d' | 'amt_c' | 'amt_a', label: string, vatOf?: { key: 'vat_e' | 'vat_d'; rate: number }) => (
    <Input
      label={label}
      inputMode="decimal"
      value={f[k] ? String(f[k]) : ''}
      onChange={(e) => {
        const v = num(e.target.value)
        setF({ ...f, [k]: v, ...(vatOf ? { [vatOf.key]: Math.round(v * vatOf.rate * 100) / 100 } : {}) })
      }}
    />
  )

  const title = (f.id ? 'Ndrysho ' : '') + (kind === 'proforma' ? 'Proformë' : f.doc_type !== 'invoice' ? DOC_TYPE_LABELS[f.doc_type] : purchase ? 'Faturë blerjeje / shpenzim' : 'Faturë shitjeje')

  return (
    <>
      <Dialog
        open={Boolean(value)}
        onClose={onClose}
        title={title}
        subtitle={f.id ? f.doc_no ?? undefined : purchase ? 'Nga fatura e furnitorit' : 'Numri jepet vetë kur ruhet (mund ta shkruash edhe ti)'}
        width="md:max-w-[1040px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[15px]">
              Totali <span className="text-[22px] font-bold tabular-nums">{formatEUR(f.doc_type === 'credit_note' ? -amounts.total : amounts.total)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Anulo
              </Button>
              <Button loading={save.isPending && !dupe} onClick={() => save.mutate(false)}>
                Ruaj
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {/* --- header --- */}
          <div className="grid gap-3 md:grid-cols-4">
            {kind !== 'proforma' && !f.id && (
              <Select
                label="Lloji"
                value={f.doc_type}
                onChange={(e) => setF({ ...f, doc_type: e.target.value as DocType, ref_doc_id: null, paid_now: null })}
                options={(Object.keys(DOC_TYPE_LABELS) as DocType[]).map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] }))}
              />
            )}
            <Input label="Data" type="date" value={f.doc_date} onChange={(e) => setF({ ...f, doc_date: e.target.value })} />
            <div>
              <Input
                label="Afati i pagesës"
                type="date"
                value={f.due_date ?? ''}
                min={f.doc_date}
                onChange={(e) => setF({ ...f, due_date: e.target.value || null })}
              />
              <div className="mt-1 flex gap-1">
                {[0, 15, 30, 60].map((d) => (
                  <button key={d} type="button" onClick={() => setF({ ...f, due_date: d ? addDays(f.doc_date, d) : null })} className="rounded-md bg-bg px-2 py-0.5 text-xs text-muted hover:bg-brand-100 hover:text-brand-600">
                    {d ? `+${d} ditë` : 'pa afat'}
                  </button>
                ))}
              </div>
            </div>
            <Input label={purchase ? 'Nr. i faturës (furnitorit)' : 'Numri'} value={f.doc_no ?? ''} placeholder={purchase ? '' : 'automatik'} onChange={(e) => setF({ ...f, doc_no: e.target.value })} />
          </div>

          {f.doc_type !== 'invoice' && (
            <Select
              label="Fatura origjinale që korrigjohet"
              value={f.ref_doc_id ?? ''}
              onChange={(e) => {
                const o = originals.data?.find((d) => d.id === e.target.value)
                setF({ ...f, ref_doc_id: e.target.value || null, partner_id: o?.partner_id ?? f.partner_id, partner_name: o?.partner_name, partner_nui: o?.partner_nui })
              }}
              options={[
                { value: '', label: originals.isLoading ? 'Duke ngarkuar…' : 'Zgjidh faturën' },
                ...(originals.data ?? []).filter((d) => d.doc_type === 'invoice').map((d) => ({ value: d.id, label: `${d.doc_no ?? '—'} · ${d.doc_date} · ${d.partner_name ?? ''} · ${formatEUR(d.total)}` })),
              ]}
            />
          )}

          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    label={purchase ? 'Furnitori' : 'Blerësi'}
                    value={f.partner_id ?? ''}
                    onChange={(e) => setF({ ...f, partner_id: e.target.value || null })}
                    options={[{ value: '', label: '— pa partner të regjistruar —' }, ...partnerOptions.map((p) => ({ value: p.id, label: p.name + (p.nui ? ` · ${p.nui}` : '') }))]}
                  />
                </div>
                <Button variant="secondary" className="h-[46px]" title="Partner i ri" onClick={() => setPartnerNew(true)}>
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {!f.partner_id ? (
              <>
                <Input label="Emri (pa regjistruar)" value={f.partner_name ?? ''} onChange={(e) => setF({ ...f, partner_name: e.target.value })} />
                <Input label="NUI" inputMode="numeric" maxLength={9} value={f.partner_nui ?? ''} onChange={(e) => setF({ ...f, partner_nui: e.target.value.replace(/\D/g, '') })} />
              </>
            ) : (
              <Select
                label="Kategoria"
                value={f.category}
                onChange={(e) => setF({ ...f, category: e.target.value as DocCategory })}
                options={(purchase ? PURCHASE_CATEGORIES : SALE_CATEGORIES).map((c) => ({ value: c.value, label: c.label }))}
              />
            )}
            {!f.partner_id && (
              <div className="md:col-span-2">
                <Select
                  label="Kategoria"
                  value={f.category}
                  onChange={(e) => setF({ ...f, category: e.target.value as DocCategory })}
                  options={(purchase ? PURCHASE_CATEGORIES : SALE_CATEGORIES).map((c) => ({ value: c.value, label: c.label }))}
                />
              </div>
            )}
          </div>

          {/* --- amounts --- */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={mode}
              onChange={(m) => setMode(m)}
              options={[
                { value: 'lines', label: 'Me artikuj' },
                { value: 'amounts', label: 'Shumat sipas normave' },
              ]}
            />
            <div className="flex flex-wrap gap-4 text-[15px]">
              {!purchase && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={Boolean(f.export)} onChange={(e) => setF({ ...f, export: e.target.checked })} />
                  Eksport (0%)
                </label>
              )}
              {purchase && (
                <label className="flex items-center gap-2" title="TVSH-ja e pazbritshme shkon në shpenzim, jo në TVSH-në e zbritshme">
                  <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.vat_deductible !== false} onChange={(e) => setF({ ...f, vat_deductible: e.target.checked })} />
                  TVSH e zbritshme
                </label>
              )}
            </div>
          </div>

          {mode === 'lines' ? (
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-[#F8FAF8] text-left text-muted">
                  <tr>
                    <th className="px-3 py-2">Përshkrimi</th>
                    <th className="w-[110px] px-2">Njësia</th>
                    <th className="w-[90px] px-2 text-right">Sasia</th>
                    <th className="w-[120px] px-2 text-right">Çmimi pa TVSH</th>
                    <th className="w-[80px] px-2 text-right">Zbritje %</th>
                    <th className="w-[110px] px-2">TVSH</th>
                    <th className="w-[110px] px-2 text-right">Vlera</th>
                    <th className="w-[44px]" />
                  </tr>
                </thead>
                <tbody>
                  {f.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-2 py-1.5">
                        <input className="h-10 w-full rounded-lg border border-field px-2.5" value={l.description} placeholder="Produkti ose shërbimi" onChange={(e) => setLine(i, { description: e.target.value })} />
                      </td>
                      <td className="px-1">
                        <input list="acc-units" className="h-10 w-full rounded-lg border border-field px-2" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
                      </td>
                      <td className="px-1">
                        <input inputMode="decimal" className="h-10 w-full rounded-lg border border-field px-2 text-right" value={l.quantity || ''} onChange={(e) => setLine(i, { quantity: num(e.target.value) })} />
                      </td>
                      <td className="px-1">
                        <input inputMode="decimal" className="h-10 w-full rounded-lg border border-field px-2 text-right" value={l.unit_price || ''} onChange={(e) => setLine(i, { unit_price: num(e.target.value) })} />
                      </td>
                      <td className="px-1">
                        <input inputMode="decimal" className="h-10 w-full rounded-lg border border-field px-2 text-right" value={l.discount_pct || ''} onChange={(e) => setLine(i, { discount_pct: Math.min(100, num(e.target.value)) })} />
                      </td>
                      <td className="px-1">
                        <select className="h-10 w-full rounded-lg border border-field bg-white px-2" value={f.export ? 'C' : l.vat_code} disabled={Boolean(f.export)} onChange={(e) => setLine(i, { vat_code: e.target.value as VatCode })}>
                          {VAT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 text-right tabular-nums">{formatEUR(calc.nets[i] ?? 0)}</td>
                      <td className="px-1 text-right">
                        <button type="button" aria-label="Hiq rreshtin" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-warn-100 hover:text-warn-700">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="acc-units">
                {UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              <div className="border-t border-line p-2">
                <Button variant="ghost" size="sm" onClick={() => setF({ ...f, lines: [...f.lines, emptyLine(f.lines[f.lines.length - 1]?.vat_code ?? 'E')] })}>
                  <Plus className="h-4 w-4" /> Shto rresht
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {amountField('net_e', 'Baza 18%', { key: 'vat_e', rate: 0.18 })}
              {amountField('vat_e', 'TVSH 18%')}
              <div className="hidden md:block" />
              {amountField('net_d', 'Baza 8%', { key: 'vat_d', rate: 0.08 })}
              {amountField('vat_d', 'TVSH 8%')}
              <div className="hidden md:block" />
              {amountField('amt_c', '0% (eksport, të tjera)')}
              {amountField('amt_a', 'E liruar')}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-3">
              <Input label="Përshkrimi" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
              <Input label="Shënim në faturë" value={f.note ?? ''} placeholder="p.sh. kushtet e pagesës" onChange={(e) => setF({ ...f, note: e.target.value })} />
              {kind !== 'proforma' && (
                <Select
                  label="Lloji për TVSH (formulari i ATK-së)"
                  value={f.vat_flag ?? 'none'}
                  onChange={(e) => setF({ ...f, vat_flag: e.target.value as VatFlag })}
                  options={(Object.keys(VAT_FLAG_LABELS) as VatFlag[])
                    .filter((k) => (purchase ? ['none', 'reverse_charge', 'import', 'farmer'] : ['none', 'service_abroad', 'reverse_charge', 'exempt_credit']).includes(k))
                    .map((k) => ({ value: k, label: VAT_FLAG_LABELS[k] }))}
                />
              )}
              {!f.id && kind !== 'proforma' && f.doc_type !== 'credit_note' && (
                <Select
                  label="Pagesa"
                  value={f.paid_now?.method ?? ''}
                  onChange={(e) => setF({ ...f, paid_now: e.target.value ? { method: e.target.value as 'cash' | 'bank' } : null })}
                  options={[
                    { value: '', label: 'E papaguar (me afat)' },
                    { value: 'cash', label: 'E paguar me kesh' },
                    { value: 'bank', label: 'E paguar me bankë' },
                  ]}
                />
              )}
            </div>
            <div className="rounded-card bg-[#F4F6F3] p-4 text-[15px]">
              {[
                ['Baza 18%', amounts.net_e],
                ['TVSH 18%', amounts.vat_e],
                ['Baza 8%', amounts.net_d],
                ['TVSH 8%', amounts.vat_d],
                ['0%', amounts.amt_c],
                ['E liruar', amounts.amt_a],
              ]
                .filter(([, v]) => v)
                .map(([l, v]) => (
                  <div key={l as string} className="flex justify-between py-0.5">
                    <span className="text-muted">{l}</span>
                    <span className="tabular-nums">{formatEUR(v as number)}</span>
                  </div>
                ))}
              {amounts.discount > 0 && (
                <div className="flex justify-between py-0.5 text-muted">
                  <span>Zbritja</span>
                  <span className="tabular-nums">−{formatEUR(amounts.discount)}</span>
                </div>
              )}
              {purchase && f.vat_deductible === false && <div className="py-1 text-xs text-amber-700">TVSH-ja nuk zbritet: hyn në shpenzim.</div>}
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
                <span>Totali</span>
                <span className="tabular-nums">{formatEUR(amounts.total)}</span>
              </div>
            </div>
          </div>

          {dupe && (
            <div className="flex flex-wrap items-center gap-3 rounded-ctl bg-amber-100 px-4 py-3 text-amber-700">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span className="flex-1">{dupe}. E ruaj sidoqoftë?</span>
              <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate(true)}>
                Ruaje sidoqoftë
              </Button>
            </div>
          )}
          {save.error && !(save.error instanceof DuplicateInvoice) && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
        </div>
      </Dialog>

      <PartnerDialog
        clientId={clientId}
        value={partnerNew ? { ...EMPTY_PARTNER, role: purchase ? 'supplier' : 'customer', name: f.partner_name ?? '', nui: f.partner_nui ?? '' } : null}
        onClose={() => setPartnerNew(false)}
        onSaved={(id) => {
          setPartnerNew(false)
          void qc.invalidateQueries({ queryKey: ['client', clientId, 'partners'] }).then(() => setF((cur) => ({ ...cur, partner_id: id })))
        }}
      />
    </>
  )
}
