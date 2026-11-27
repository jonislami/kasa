import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Paperclip, Plus } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { categoryLabel, docNet, docVat, DOC_TYPE_LABELS, fetchDocs, PAY_STATUS_LABELS, type AnyDocKind, type Client, type Doc, type InvoiceInput } from './api'
import { DataTable, Segments, ToolButton, type Column } from './DataTable'
import { DocDetailDialog, statusTone } from './DocDetail'
import { ImportDialog } from './ImportDialog'
import { InvoiceEditor, newInvoice } from './InvoiceEditor'
import { useHotkey } from './shortcuts'

const TITLES: Record<AnyDocKind, { partner: string; empty: string; add: string }> = {
  sale: { partner: 'Blerësi', empty: 'Asnjë faturë shitjeje në këtë periudhë. Krijoje me “Faturë shitjeje” (N) ose importo nga Excel.', add: 'Faturë shitjeje' },
  purchase: { partner: 'Furnitori', empty: 'Asnjë blerje apo shpenzim në këtë periudhë. Regjistroje me “Faturë blerjeje” (N) ose importo nga Excel.', add: 'Faturë blerjeje' },
  proforma: { partner: 'Blerësi', empty: 'Asnjë proformë në këtë periudhë. Proforma nuk hyn në libra; kur paguhet, kthehet në faturë.', add: 'Proformë' },
}

type StatusFilter = 'all' | 'open' | 'overdue' | 'paid'

/** The client's documents of one kind for the period: table, filters, several at once, detail, new invoice. */
export function DocumentsTab({ client, kind, from, to, onChanged }: { client: Client; kind: AnyDocKind; from: string; to: string; onChanged: () => void }) {
  const clientId = client.id
  const [status, setStatus] = useState<StatusFilter>('all')
  const [category, setCategory] = useState<string>('')
  const [edit, setEdit] = useState<InvoiceInput | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const docs = useQuery({ queryKey: ['client', clientId, 'docs', kind, from, to], queryFn: () => fetchDocs(clientId, kind, from, to) })
  const t = TITLES[kind]
  const all = docs.data ?? []

  const counts = useMemo(
    () => ({
      open: all.filter((d) => Math.abs(d.open) >= 0.005).length,
      overdue: all.filter((d) => (d.overdue_days ?? 0) > 0).length,
      paid: all.filter((d) => d.pay_status === 'paid' || d.pay_status === 'applied').length,
    }),
    [all],
  )
  const categories = useMemo(() => [...new Set(all.map((d) => d.category))].sort(), [all])

  const list = useMemo(
    () =>
      all.filter(
        (d) =>
          (status === 'all' ||
            (status === 'open' && Math.abs(d.open) >= 0.005) ||
            (status === 'overdue' && (d.overdue_days ?? 0) > 0) ||
            (status === 'paid' && (d.pay_status === 'paid' || d.pay_status === 'applied'))) &&
          (!category || d.category === category),
      ),
    [all, status, category],
  )

  const changed = () => {
    void docs.refetch()
    onChanged()
  }
  const today = kosovoDateISO()
  const start = () => setEdit(newInvoice(kind, today >= from && today <= to ? today : to))
  useHotkey('n', start)

  // "?new=1" from the dashboard, "?doc=<id>" from the global search
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const doc = params.get('doc')
    if (params.get('new') !== '1' && !doc) return
    if (doc) setOpenId(doc)
    else setEdit(newInvoice(kind, today))
    params.delete('new')
    params.delete('doc')
    setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const columns: Column<Doc>[] = [
    { id: 'date', label: 'Data', width: 96, sort: (d) => d.doc_date, text: (d) => formatDay(d.doc_date), render: (d) => <span className="tabular-nums">{formatDay(d.doc_date)}</span> },
    {
      id: 'no',
      label: 'Nr.',
      width: 110,
      sort: (d) => d.doc_no ?? '',
      text: (d) => d.doc_no ?? '',
      render: (d) => (
        <span className="tabular-nums">
          {d.doc_no || '—'}
          {d.files > 0 && <Paperclip className="ml-1 inline h-3 w-3 text-muted" />}
        </span>
      ),
    },
    {
      id: 'partner',
      label: t.partner,
      fixed: true,
      width: 240,
      text: (d) => `${d.partner_name ?? ''} ${d.description ?? ''}`,
      sort: (d) => (d.partner_name ?? '').toLowerCase(),
      render: (d) => (
        <span className="block truncate">
          <span className="font-medium">{d.partner_name || '—'}</span>
          {d.doc_type !== 'invoice' && (
            <span className="ml-1.5 text-[12px] text-amber-700">
              {DOC_TYPE_LABELS[d.doc_type]}
              {d.ref_doc_no ? ` për ${d.ref_doc_no}` : ''}
            </span>
          )}
        </span>
      ),
    },
    { id: 'nui', label: 'NUI', width: 104, text: (d) => d.partner_nui ?? '', render: (d) => <span className="tabular-nums">{d.partner_nui || '—'}</span> },
    { id: 'desc', label: 'Përshkrimi', hidden: true, width: 200, text: (d) => d.description ?? '', render: (d) => <span className="text-muted">{d.description || '—'}</span> },
    { id: 'cat', label: 'Kategoria', width: 130, text: (d) => categoryLabel(kind, d.category), render: (d) => categoryLabel(kind, d.category) },
    { id: 'net', label: 'Baza', width: 110, money: docNet, render: (d) => formatEUR(docNet(d)) },
    { id: 'vat', label: 'TVSH', width: 100, money: docVat, render: (d) => (docVat(d) ? formatEUR(docVat(d)) : '—') },
    { id: 'total', label: 'Totali', width: 116, money: (d) => d.total, render: (d) => <span className="font-semibold">{formatEUR(d.total)}</span> },
    ...(kind !== 'proforma'
      ? ([
          { id: 'open', label: 'Mbetet', width: 110, money: (d) => d.open, render: (d) => (Math.abs(d.open) >= 0.005 ? formatEUR(d.open) : '—') },
          { id: 'due', label: 'Afati', width: 96, hidden: true, sort: (d) => d.due_date ?? '', text: (d) => (d.due_date ? formatDay(d.due_date) : ''), render: (d) => (d.due_date ? <span className="tabular-nums">{formatDay(d.due_date)}</span> : '—') },
          {
            id: 'status',
            label: 'Statusi',
            width: 150,
            sort: (d) => (d.overdue_days ?? 0) * 1000 + (d.pay_status === 'unpaid' ? 2 : d.pay_status === 'partial' ? 1 : 0),
            text: (d) => (d.pay_status ? PAY_STATUS_LABELS[d.pay_status] : ''),
            render: (d) =>
              d.pay_status ? (
                <span className="flex items-center gap-1.5">
                  <Badge tone={statusTone(d.pay_status)}>{PAY_STATUS_LABELS[d.pay_status]}</Badge>
                  {d.overdue_days ? <span className="text-[12px] text-warn-700">{d.overdue_days} ditë</span> : null}
                </span>
              ) : null,
          },
        ] as Column<Doc>[])
      : ([{ id: 'conv', label: 'Statusi', width: 110, text: (d) => (d.converted_to ? 'Faturuar' : 'E hapur'), render: (d) => (d.converted_to ? <Badge tone="success">Faturuar</Badge> : <Badge>E hapur</Badge>) }] as Column<Doc>[])),
  ]

  return (
    <>
      <DataTable
        id={`docs-${kind}`}
        rows={list}
        columns={columns}
        rowKey={(d) => d.id}
        onOpen={(d) => setOpenId(d.id)}
        selectable
        loading={docs.isLoading}
        error={docs.error ? (docs.error as Error).message : null}
        empty={t.empty}
        exportName={`${client.name} ${kind === 'sale' ? 'shitjet' : kind === 'purchase' ? 'blerjet' : 'proformat'} ${from}_${to}`}
        filters={
          <>
            {kind !== 'proforma' && (
              <Segments
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'Të gjitha', count: all.length },
                  { value: 'open', label: kind === 'sale' ? 'Pa arkëtuar' : 'Pa paguar', count: counts.open },
                  { value: 'overdue', label: 'Me vonesë', count: counts.overdue },
                  { value: 'paid', label: 'Të paguara', count: counts.paid },
                ]}
              />
            )}
            {categories.length > 1 && (
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-[44px] rounded-ctl border border-field bg-white px-2 text-[16px] md:h-8 md:text-[13px]" aria-label="Kategoria">
                <option value="">Të gjitha kategoritë</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(kind, c)}
                  </option>
                ))}
              </select>
            )}
          </>
        }
        actions={
          <>
            {kind !== 'proforma' && (
              <ToolButton onClick={() => setImportOpen(true)}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Nga Excel
              </ToolButton>
            )}
            <Button size="sm" onClick={start} title="Dokument i ri (N)">
              <Plus className="h-4 w-4" /> {t.add}
            </Button>
          </>
        }
      />

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
    </>
  )
}
