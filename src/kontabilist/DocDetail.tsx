import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, FilePlus2, Paperclip, Pencil, Printer, Trash2, Upload, Wallet } from 'lucide-react'
import { Badge, Button, Dialog, Input, Select } from '@/components/ui'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import {
  categoryLabel,
  convertProforma,
  deleteDoc,
  deleteDocFile,
  deletePayment,
  DOC_TYPE_LABELS,
  fetchAccounts,
  fetchDocDetail,
  openDocFile,
  PAY_STATUS_LABELS,
  savePayment,
  uploadDocFile,
  type Client,
  type DocDetail as Detail,
  type InvoiceInput,
} from './api'

const HISTORY: Record<string, string> = {
  create: 'U krijua',
  scan: 'U skanua me AI dhe u konfirmua',
  update: 'U ndryshua',
  payment: 'Pagesë',
  payment_deleted: 'Pagesa u fshi',
  converted: 'U kthye në faturë',
  file: 'Skedar i bashkëngjitur',
  correction_deleted: 'Fatura korrigjuese u fshi',
}

export const statusTone = (s: string | null) => (s === 'paid' || s === 'applied' ? 'success' : s === 'partial' ? 'amber' : 'warn') as 'success' | 'amber' | 'warn'

/** One document: lines, totals, payments, corrections, files, history; print / PDF. */
export function DocDetailDialog({
  docId,
  client,
  onClose,
  onEdit,
  onChanged,
}: {
  docId: string | null
  client: Client
  onClose: () => void
  onEdit: (inv: InvoiceInput) => void
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const doc = useQuery({ queryKey: ['doc', docId], queryFn: () => fetchDocDetail(docId!), enabled: Boolean(docId) })
  const d = doc.data
  const [pay, setPay] = useState<{ amount: string; date: string; method: 'cash' | 'bank'; account: string; reference: string } | null>(null)
  const accounts = useQuery({ queryKey: ['client', client.id, 'accounts'], queryFn: () => fetchAccounts(client.id), enabled: Boolean(docId) })
  const accList = (accounts.data ?? []).filter((a) => a.active)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [printing, setPrinting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPay(null)
    setConfirmDelete(false)
  }, [docId])
  useEffect(() => {
    if (!printing) return
    const t = setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 80)
    return () => clearTimeout(t)
  }, [printing])

  const refresh = () => {
    void doc.refetch()
    onChanged()
  }
  const addPay = useMutation({
    mutationFn: () =>
      savePayment({
        doc_id: d!.id,
        amount: Number(pay!.amount.replace(',', '.')),
        pay_date: pay!.date,
        method: pay!.method,
        account_id: pay!.account || null,
        reference: pay!.reference || undefined,
      }),
    onSuccess: () => {
      setPay(null)
      refresh()
    },
  })
  const delPay = useMutation({ mutationFn: deletePayment, onSuccess: refresh })
  const upload = useMutation({ mutationFn: (file: File) => uploadDocFile(client.id, d!.id, file), onSuccess: refresh })
  const delFile = useMutation({ mutationFn: deleteDocFile, onSuccess: refresh })
  const convert = useMutation({
    mutationFn: () => convertProforma(d!.id),
    onSuccess: () => {
      refresh()
      void qc.invalidateQueries({ queryKey: ['client', client.id] })
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteDoc(d!.id),
    onSuccess: () => {
      onChanged()
      onClose()
    },
  })

  const toInput = (x: Detail): InvoiceInput => ({
    id: x.id,
    kind: x.kind,
    doc_type: x.doc_type,
    ref_doc_id: x.ref_doc_id,
    category: x.category,
    doc_date: x.doc_date,
    due_date: x.due_date,
    doc_no: x.doc_no,
    partner_id: x.partner_id,
    partner_name: x.partner_name,
    partner_nui: x.partner_nui,
    partner_vat: x.partner_vat,
    description: x.description,
    note: x.note,
    export: x.export,
    vat_deductible: x.vat_nd === 0,
    vat_flag: x.vat_flag ?? 'none',
    lines: x.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, vat_code: l.vat_code })),
    // amounts are stored with the sign of the document; the editor works with positive numbers
    net_e: Math.abs(x.net_e),
    vat_e: Math.abs(x.vat_e) + (x.vat_nd && x.net_e ? Math.abs(x.vat_nd) : 0),
    net_d: Math.abs(x.net_d),
    vat_d: Math.abs(x.vat_d) + (x.vat_nd && !x.net_e ? Math.abs(x.vat_nd) : 0),
    amt_c: Math.abs(x.amt_c),
    amt_a: Math.abs(x.amt_a),
  })
  const correction = (type: 'credit_note' | 'debit_note') =>
    d &&
    onEdit({
      kind: d.kind,
      doc_type: type,
      ref_doc_id: d.id,
      category: d.category,
      doc_date: kosovoDateISO(),
      partner_id: d.partner_id,
      partner_name: d.partner_name,
      partner_nui: d.partner_nui,
      description: `${DOC_TYPE_LABELS[type]} për faturën ${d.doc_no ?? ''}`,
      lines: type === 'credit_note' ? d.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, vat_code: l.vat_code })) : [],
      net_e: 0,
      vat_e: 0,
      net_d: 0,
      vat_d: 0,
      amt_c: 0,
      amt_a: 0,
    })

  const open = d ? Math.round(d.open * 100) / 100 : 0
  const canPay = d && d.kind !== 'proforma' && !(d.doc_type === 'credit_note' && d.ref_doc_id) && Math.abs(open) >= 0.01

  return (
    <>
      <Dialog
        open={Boolean(docId)}
        onClose={onClose}
        title={d ? `${d.kind === 'proforma' ? 'Proformë' : DOC_TYPE_LABELS[d.doc_type]} ${d.doc_no ?? ''}` : 'Dokumenti'}
        subtitle={d ? [formatDay(d.doc_date), d.partner_name, categoryLabel(d.kind, d.category)].filter(Boolean).join(' · ') : undefined}
        width="md:max-w-[880px]"
        footer={
          d && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" className="text-warn-700" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" /> Fshi
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.kind === 'proforma' && !d.converted_to && (
                  <Button variant="secondary" loading={convert.isPending} onClick={() => convert.mutate()}>
                    <ArrowRightLeft className="h-4 w-4" /> Ktheje në faturë
                  </Button>
                )}
                {d.kind !== 'proforma' && d.doc_type === 'invoice' && (
                  <>
                    <Button variant="secondary" onClick={() => correction('credit_note')}>
                      <FilePlus2 className="h-4 w-4" /> Kreditore
                    </Button>
                    <Button variant="secondary" onClick={() => correction('debit_note')}>
                      Debitore
                    </Button>
                  </>
                )}
                <Button variant="secondary" onClick={() => onEdit(toInput(d))}>
                  <Pencil className="h-4 w-4" /> Ndrysho
                </Button>
                <Button onClick={() => setPrinting(true)}>
                  <Printer className="h-4 w-4" /> Printo / PDF
                </Button>
              </div>
            </div>
          )
        }
      >
        {!d ? (
          <p className={doc.error ? 'text-sm text-warn-700' : 'py-10 text-center text-muted'}>{doc.error ? (doc.error as Error).message : 'Duke ngarkuar…'}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              {d.pay_status && <Badge tone={statusTone(d.pay_status)}>{PAY_STATUS_LABELS[d.pay_status]}</Badge>}
              {d.overdue_days ? <Badge tone="warn">{d.overdue_days} ditë me vonesë</Badge> : null}
              {d.export && <Badge tone="info">Eksport</Badge>}
              {d.vat_nd !== 0 && <Badge tone="amber">TVSH e pazbritshme</Badge>}
              {d.ref_doc && <Badge>për {d.ref_doc.doc_no}</Badge>}
              {d.converted_doc_no && <Badge tone="success">Kthyer në {d.converted_doc_no}</Badge>}
              {d.due_date && <span className="text-sm text-muted">Afati {formatDay(d.due_date)}</span>}
            </div>

            {d.lines.length > 0 && (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-[#F8FAF8] text-left text-muted">
                    <tr>
                      <th className="px-3 py-2">Përshkrimi</th>
                      <th className="px-2 text-right">Sasia</th>
                      <th className="px-2 text-right">Çmimi</th>
                      <th className="px-2 text-right">Zbr.</th>
                      <th className="px-2">TVSH</th>
                      <th className="px-3 text-right">Vlera</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.id} className="border-t border-line">
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-2 text-right">
                          {l.quantity} {l.unit}
                        </td>
                        <td className="px-2 text-right">{formatEUR(l.unit_price)}</td>
                        <td className="px-2 text-right">{l.discount_pct ? `${l.discount_pct}%` : ''}</td>
                        <td className="px-2">{l.vat_code}</td>
                        <td className="px-3 text-right tabular-nums">{formatEUR(l.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-card bg-[#F4F6F3] p-4 text-[15px]">
                <Totals d={d} />
              </div>
              <div className="flex flex-col gap-2 text-[15px]">
                <Row l="Paguar" r={formatEUR(d.paid)} />
                {d.credited !== 0 && <Row l="Zbritur me kreditore" r={formatEUR(d.credited)} />}
                <Row l={<b>Mbetet</b>} r={<b className={open > 0 ? 'text-warn-700' : ''}>{formatEUR(open)}</b>} />
                {d.description && <p className="text-sm text-muted">{d.description}</p>}
                {d.note && <p className="text-sm text-muted">Shënim: {d.note}</p>}
              </div>
            </div>

            {/* payments */}
            {d.kind !== 'proforma' && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">Pagesat</h3>
                  {canPay && !pay && (
                    <Button size="sm" variant="secondary" onClick={() => {
                        const acc = accList.find((a) => a.kind === 'bank') ?? accList[0]
                        setPay({ amount: String(Math.abs(open)), date: kosovoDateISO(), method: acc?.kind ?? 'bank', account: acc?.id ?? '', reference: '' })
                      }}>
                      <Wallet className="h-4 w-4" /> Regjistro pagesë
                    </Button>
                  )}
                </div>
                {pay && (
                  <div className="mb-3 grid gap-2 rounded-card border border-line p-3 md:grid-cols-[1fr_1fr_1fr_1.5fr_auto] md:items-end">
                    <Input label="Shuma" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                    <Input label="Data" type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
                    {accList.length ? (
                      <Select
                        label="Llogaria"
                        value={pay.account}
                        onChange={(e) => {
                          const a = accList.find((x) => x.id === e.target.value)
                          setPay({ ...pay, account: e.target.value, method: a?.kind ?? pay.method })
                        }}
                        options={accList.map((a) => ({ value: a.id, label: a.name }))}
                      />
                    ) : (
                      <Select label="Mënyra" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as 'cash' | 'bank' })} options={[{ value: 'bank', label: 'Bankë' }, { value: 'cash', label: 'Kesh' }]} />
                    )}
                    <Input label="Referenca" value={pay.reference} placeholder="nr. i transferit" onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setPay(null)}>
                        Anulo
                      </Button>
                      <Button loading={addPay.isPending} onClick={() => addPay.mutate()}>
                        Ruaj
                      </Button>
                    </div>
                    {addPay.error && <p className="text-sm text-warn-700 md:col-span-5">{(addPay.error as Error).message}</p>}
                  </div>
                )}
                {d.payments.length === 0 ? (
                  <p className="text-sm text-muted">{d.payment !== 'due' ? `Shënuar si e paguar me ${d.payment === 'cash' ? 'kesh' : 'bankë'}.` : 'Asnjë pagesë.'}</p>
                ) : (
                  <ul className="divide-y divide-line rounded-card border border-line">
                    {d.payments.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="w-24">{formatDay(p.pay_date)}</span>
                        <span className="flex-1">
                          {p.method === 'cash' ? 'Kesh' : 'Bankë'}
                          {p.reference && <span className="text-muted"> · {p.reference}</span>}
                        </span>
                        <span className="font-medium tabular-nums">{formatEUR(p.amount)}</span>
                        <button type="button" aria-label="Fshi pagesën" onClick={() => delPay.mutate(p.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-warn-100 hover:text-warn-700">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {d.corrections.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold">Faturat korrigjuese</h3>
                <ul className="divide-y divide-line rounded-card border border-line text-sm">
                  {d.corrections.map((c) => (
                    <li key={c.id} className="flex justify-between px-3 py-2">
                      <span>
                        {DOC_TYPE_LABELS[c.doc_type]} {c.doc_no} · {formatDay(c.doc_date)}
                      </span>
                      <span className="tabular-nums">{formatEUR(c.total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* files */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Skedarët (PDF, foto)</h3>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) upload.mutate(file)
                    e.target.value = ''
                  }}
                />
                <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Ngarko
                </Button>
              </div>
              {upload.error && <p className="mb-2 text-sm text-warn-700">{(upload.error as Error).message}</p>}
              {d.files_list.length === 0 ? (
                <p className="text-sm text-muted">Bashkëngjit faturën origjinale ose dëshminë e shpenzimit.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {d.files_list.map((f) => (
                    <li key={f.id} className="flex items-center gap-1 rounded-ctl border border-line pl-3 text-sm">
                      <Paperclip className="h-4 w-4 text-muted" />
                      <button type="button" className="py-2 text-brand-600 hover:underline" onClick={() => void openDocFile(f.path).then((url) => window.open(url, '_blank', 'noopener'))}>
                        {f.file_name}
                      </button>
                      <button type="button" aria-label="Fshi skedarin" onClick={() => delFile.mutate(f.id)} className="inline-flex h-9 w-9 items-center justify-center text-muted hover:text-warn-700">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {d.history.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold">Historiku i ndryshimeve ({d.history.length})</summary>
                <ul className="mt-2 flex flex-col gap-1 text-muted">
                  {d.history.map((h, i) => (
                    <li key={i}>
                      {formatKosovoDateTime(h.created_at)} · {HISTORY[h.action] ?? h.action}
                      {h.details?.amount != null && ` ${formatEUR(Number(h.details.amount))}`}
                      {h.details?.total != null && h.action !== 'payment' && ` · ${formatEUR(Number(h.details.total))}`}
                      {h.details?.invoice != null && ` ${String(h.details.invoice)}`}
                      {h.user_name && ` · ${h.user_name}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Të fshihet dokumenti?"
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Anulo
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Fshije
            </Button>
          </div>
        }
      >
        <p className="text-[15px]">
          {d?.doc_no} · {d?.partner_name} · <strong>{d && formatEUR(d.total)}</strong>. Fshihen edhe pagesat dhe skedarët e lidhur. Për një faturë të dhënë klientit, përdor më mirë një faturë kreditore.
        </p>
        {remove.error && <p className="mt-3 text-sm text-warn-700">{(remove.error as Error).message}</p>}
      </Dialog>

      {printing && d && createPortal(<PrintInvoice d={d} client={client} />, document.body)}
    </>
  )
}

function Row({ l, r }: { l: React.ReactNode; r: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{l}</span>
      <span className="tabular-nums">{r}</span>
    </div>
  )
}

function Totals({ d }: { d: Detail }) {
  const rows: [string, number][] = [
    ['Baza 18%', d.net_e],
    ['TVSH 18%', d.vat_e],
    ['Baza 8%', d.net_d],
    ['TVSH 8%', d.vat_d],
    ['0%', d.amt_c],
    ['E liruar', d.amt_a],
    ['TVSH e pazbritshme', d.vat_nd],
  ]
  return (
    <>
      {rows
        .filter(([, v]) => v)
        .map(([l, v]) => (
          <div key={l} className="flex justify-between py-0.5">
            <span className="text-muted">{l}</span>
            <span className="tabular-nums">{formatEUR(v)}</span>
          </div>
        ))}
      {d.discount_total > 0 && (
        <div className="flex justify-between py-0.5 text-muted">
          <span>Zbritja e përfshirë</span>
          <span className="tabular-nums">{formatEUR(d.discount_total)}</span>
        </div>
      )}
      <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
        <span>Totali</span>
        <span className="tabular-nums">{formatEUR(d.total)}</span>
      </div>
    </>
  )
}

/** A4 invoice for printing / "Save as PDF" (the client is the seller on a sale, the buyer on a purchase). */
function PrintInvoice({ d, client }: { d: Detail; client: Client }) {
  const sale = d.kind !== 'purchase'
  const title = d.kind === 'proforma' ? 'FATURË PROFORMË' : d.doc_type === 'credit_note' ? 'FATURË KREDITORE' : d.doc_type === 'debit_note' ? 'FATURË DEBITORE' : 'FATURË'
  const me = (
    <div>
      <div className="font-bold">{client.name}</div>
      {client.legal_form && <div>{client.legal_form}</div>}
      {(client.address || client.city) && <div>{[client.address, client.city].filter(Boolean).join(', ')}</div>}
      {client.nui && <div>NUI: {client.nui}</div>}
      {client.fiscal_number && <div>Nr. fiskal: {client.fiscal_number}</div>}
      {client.vat_number && <div>Nr. TVSH: {client.vat_number}</div>}
      {[client.phone, client.email].filter(Boolean).length > 0 && <div>{[client.phone, client.email].filter(Boolean).join(' · ')}</div>}
    </div>
  )
  const them = (
    <div>
      <div className="font-bold">{d.partner_name ?? '—'}</div>
      {d.partner_address && <div>{d.partner_address}</div>}
      {d.partner_nui && <div>NUI: {d.partner_nui}</div>}
      {d.partner_vat && <div>Nr. TVSH: {d.partner_vat}</div>}
    </div>
  )
  return (
    <div className="print-root print-a4 hidden bg-white text-[12px] leading-snug text-black">
      <div className="flex items-start justify-between gap-6">
        <div className="max-w-[60%]">{sale ? me : them}</div>
        <div className="text-right">
          <div className="text-[20px] font-bold">{title}</div>
          <div className="text-[14px] font-semibold">Nr. {d.doc_no}</div>
          <div>Data: {formatDay(d.doc_date)}</div>
          {d.due_date && <div>Afati i pagesës: {formatDay(d.due_date)}</div>}
          {d.ref_doc && <div>Për faturën: {d.ref_doc.doc_no} ({formatDay(d.ref_doc.doc_date)})</div>}
        </div>
      </div>
      <div className="mt-5 rounded border border-black/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-black/60">{sale ? 'Blerësi' : 'Shitësi'}</div>
        {sale ? them : me}
      </div>

      {d.lines.length > 0 ? (
        <table className="mt-5 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1.5">#</th>
              <th>Përshkrimi</th>
              <th className="text-right">Sasia</th>
              <th>Njësia</th>
              <th className="text-right">Çmimi pa TVSH</th>
              <th className="text-right">Zbr. %</th>
              <th className="text-center">TVSH</th>
              <th className="text-right">Vlera pa TVSH</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-black/20">
                <td className="py-1.5">{i + 1}</td>
                <td>{l.description}</td>
                <td className="text-right">{l.quantity}</td>
                <td>{l.unit}</td>
                <td className="text-right">{l.unit_price.toFixed(2)}</td>
                <td className="text-right">{l.discount_pct ? l.discount_pct : ''}</td>
                <td className="text-center">{{ E: '18%', D: '8%', C: '0%', A: 'lir.' }[l.vat_code]}</td>
                <td className="text-right">{formatEUR(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        d.description && <p className="mt-5">{d.description}</p>
      )}

      <div className="mt-4 flex justify-end">
        <div className="w-[300px]">
          <Totals d={d} />
          {d.kind !== 'proforma' && d.paid > 0 && (
            <>
              <div className="flex justify-between py-0.5">
                <span>Paguar</span>
                <span>{formatEUR(d.paid)}</span>
              </div>
              <div className="flex justify-between py-0.5 font-semibold">
                <span>Për t'u paguar</span>
                <span>{formatEUR(d.open)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {d.export && <p className="mt-3">Eksport – i liruar nga TVSH-ja (norma 0%).</p>}
      {d.note && <p className="mt-3">{d.note}</p>}
      {sale && (client.iban || client.bank_name) && (
        <p className="mt-3">
          Pagesa në llogarinë: {client.bank_name && `${client.bank_name} · `}
          {client.iban}
        </p>
      )}
      <div className="mt-14 grid grid-cols-2 gap-16 text-center">
        <div className="border-t border-black pt-1">{sale ? 'Lëshoi' : 'Pranoi'}</div>
        <div className="border-t border-black pt-1">{sale ? 'Pranoi' : 'Lëshoi'}</div>
      </div>
    </div>
  )
}
