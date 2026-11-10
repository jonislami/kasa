import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Paperclip, Plus, Search } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Select, Table, Td, Th } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { categoryLabel, docNet, docVat, DOC_TYPE_LABELS, fetchDocs, PAY_STATUS_LABELS, type AnyDocKind, type Client, type InvoiceInput } from './api'
import { DocDetailDialog, statusTone } from './DocDetail'
import { ImportDialog } from './ImportDialog'
import { InvoiceEditor, newInvoice } from './InvoiceEditor'

const SHOWN = 300
const TITLES: Record<AnyDocKind, { list: string; partner: string; empty: string; add: string }> = {
  sale: { list: 'Faturat e shitjes', partner: 'Blerësi', empty: 'Krijo faturat e këtij biznesi këtu, ose regjistro ato që i lëshon vetë (me dorë ose nga Excel).', add: 'Faturë shitjeje' },
  purchase: { list: 'Faturat e blerjes dhe shpenzimet', partner: 'Furnitori', empty: 'Regjistro faturat e furnitorëve, qiranë, rrymën, karburantin, pagat dhe shpenzimet e tjera.', add: 'Faturë blerjeje' },
  proforma: { list: 'Faturat proformë', partner: 'Blerësi', empty: 'Proforma nuk hyn në libra; kur klienti paguan, ktheje në faturë me një klikim.', add: 'Proformë' },
}

type StatusFilter = 'all' | 'open' | 'overdue' | 'paid'

/** The client's documents of one kind for the period: status, balance, detail, new invoice. */
export function DocumentsTab({ client, kind, from, to, onChanged }: { client: Client; kind: AnyDocKind; from: string; to: string; onChanged: () => void }) {
  const clientId = client.id
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [edit, setEdit] = useState<InvoiceInput | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const docs = useQuery({ queryKey: ['client', clientId, 'docs', kind, from, to], queryFn: () => fetchDocs(clientId, kind, from, to) })
  const t = TITLES[kind]

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (docs.data ?? []).filter(
      (d) =>
        (status === 'all' ||
          (status === 'open' && Math.abs(d.open) >= 0.005) ||
          (status === 'overdue' && (d.overdue_days ?? 0) > 0) ||
          (status === 'paid' && (d.pay_status === 'paid' || d.pay_status === 'applied'))) &&
        (!s || [d.partner_name, d.partner_nui, d.doc_no, d.description].some((v) => v?.toLowerCase().includes(s)) || d.total.toFixed(2).includes(s)),
    )
  }, [docs.data, q, status])
  const sum = list.reduce((a, d) => ({ net: a.net + docNet(d), vat: a.vat + docVat(d), total: a.total + d.total, open: a.open + d.open }), { net: 0, vat: 0, total: 0, open: 0 })

  const changed = () => {
    void docs.refetch()
    onChanged()
  }
  const today = kosovoDateISO()
  const start = () => setEdit(newInvoice(kind, today >= from && today <= to ? today : to))
  // "Shitje e re" / "Blerje e re" from the dashboard
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (params.get('new') !== '1') return
    setEdit(newInvoice(kind, today))
    params.delete('new')
    setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold">{t.list}</h2>
          {kind !== 'proforma' && docs.data && (
            <p className="text-sm text-muted">
              {kind === 'sale' ? 'Pa arkëtuar' : 'Pa paguar'}: <span className={sum.open > 0 ? 'font-semibold text-warn-700' : ''}>{formatEUR(sum.open)}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative md:w-[260px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Partneri, NUI, nr. ose shuma" className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none" />
          </div>
          {kind !== 'proforma' && (
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              options={[
                { value: 'all', label: 'Të gjitha' },
                { value: 'open', label: 'Të papaguara' },
                { value: 'overdue', label: 'Me vonesë' },
                { value: 'paid', label: 'Të paguara' },
              ]}
            />
          )}
          {kind !== 'proforma' && (
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4" /> Nga Excel
            </Button>
          )}
          <Button onClick={start}>
            <Plus className="h-4 w-4" /> {t.add}
          </Button>
        </div>
      </div>

      {!docs.data ? (
        <p className={docs.error ? 'px-5 py-8 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{docs.error ? (docs.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : list.length === 0 ? (
        <EmptyState title={docs.data.length ? 'Asnjë dokument me këtë kërkim' : 'Asnjë dokument në këtë periudhë'} text={docs.data.length ? undefined : t.empty} />
      ) : (
        <>
          <Table>
            <thead className="bg-[#F8FAF8]">
              <tr>
                <Th className="pl-5">Data</Th>
                <Th>{t.partner}</Th>
                <Th className="hidden md:table-cell">Nr.</Th>
                <Th className="hidden xl:table-cell">Kategoria</Th>
                <Th className="hidden text-right lg:table-cell">Baza</Th>
                <Th className="hidden text-right lg:table-cell">TVSH</Th>
                <Th className="text-right">Totali</Th>
                {kind !== 'proforma' && <Th className="hidden text-right md:table-cell">Mbetet</Th>}
                <Th className="pr-5">Statusi</Th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, SHOWN).map((d) => (
                <tr key={d.id} className="cursor-pointer hover:bg-[#F8FAF8]" onClick={() => setOpenId(d.id)}>
                  <Td className="whitespace-nowrap pl-5">{formatDay(d.doc_date)}</Td>
                  <Td>
                    <div className="font-medium">{d.partner_name || '—'}</div>
                    <div className="text-xs text-muted">
                      {[d.partner_nui && `NUI ${d.partner_nui}`, d.doc_type !== 'invoice' && `${DOC_TYPE_LABELS[d.doc_type]}${d.ref_doc_no ? ` për ${d.ref_doc_no}` : ''}`, d.description].filter(Boolean).join(' · ')}
                    </div>
                  </Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">
                    {d.doc_no || '—'}
                    {d.files > 0 && <Paperclip className="ml-1 inline h-3.5 w-3.5 text-muted" />}
                  </Td>
                  <Td className="hidden xl:table-cell">{categoryLabel(kind, d.category)}</Td>
                  <Td className="hidden text-right lg:table-cell">{formatEUR(docNet(d))}</Td>
                  <Td className="hidden text-right lg:table-cell">{docVat(d) ? formatEUR(docVat(d)) : '—'}</Td>
                  <Td className="text-right font-semibold">{formatEUR(d.total)}</Td>
                  {kind !== 'proforma' && <Td className="hidden text-right md:table-cell">{Math.abs(d.open) >= 0.005 ? formatEUR(d.open) : '—'}</Td>}
                  <Td className="pr-5">
                    {kind === 'proforma' ? (
                      d.converted_to ? <Badge tone="success">Faturuar</Badge> : <Badge>E hapur</Badge>
                    ) : (
                      d.pay_status && (
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={statusTone(d.pay_status)}>{PAY_STATUS_LABELS[d.pay_status]}</Badge>
                          {d.overdue_days ? <span className="text-xs text-warn-700">{d.overdue_days} ditë vonesë</span> : null}
                        </div>
                      )
                    )}
                  </Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td className="border-b-0 pl-5">Gjithsej ({list.length})</Td>
                <Td className="border-b-0" />
                <Td className="hidden border-b-0 md:table-cell" />
                <Td className="hidden border-b-0 xl:table-cell" />
                <Td className="hidden border-b-0 text-right lg:table-cell">{formatEUR(sum.net)}</Td>
                <Td className="hidden border-b-0 text-right lg:table-cell">{formatEUR(sum.vat)}</Td>
                <Td className="border-b-0 text-right">{formatEUR(sum.total)}</Td>
                {kind !== 'proforma' && <Td className="hidden border-b-0 text-right md:table-cell">{formatEUR(sum.open)}</Td>}
                <Td className="border-b-0" />
              </tr>
            </tbody>
          </Table>
          {list.length > SHOWN && <p className="px-5 py-3 text-sm text-muted">Shfaqen {SHOWN} nga {list.length}. Eksporti në Excel i përmban të gjitha.</p>}
        </>
      )}

      <InvoiceEditor
        clientId={clientId}
        value={edit}
        onClose={() => setEdit(null)}
        onSaved={(id) => {
          setEdit(null)
          changed()
          setOpenId(id)
        }}
      />
      <DocDetailDialog
        docId={openId}
        client={client}
        onClose={() => setOpenId(null)}
        onEdit={(inv) => {
          setOpenId(null)
          setEdit(inv)
        }}
        onChanged={changed}
      />
      {kind !== 'proforma' && (
        <ImportDialog
          clientId={clientId}
          kind={kind}
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false)
            changed()
          }}
        />
      )}
    </Card>
  )
}
