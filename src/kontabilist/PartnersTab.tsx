import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Pencil, Plus, Printer, Search, Users } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { downloadSheets as downloadWorkbook } from './xls'
import { deletePartner, fetchPartners, fetchStatement, ROLE_LABEL, savePartner, type Partner, type PartnerInput, type PartnerRole, type StatementRow } from './api'

export const EMPTY_PARTNER: PartnerInput = { role: 'customer', name: '', nui: '', fiscal_number: '', vat_number: '', address: '', city: '', country: 'Kosovë', phone: '', email: '', note: '' }

/** Customers and suppliers of one client, with what they owe / what is owed to them. */
export function PartnersTab({ clientId, clientName, from, to }: { clientId: string; clientName: string; from: string; to: string }) {
  const qc = useQueryClient()
  const partners = useQuery({ queryKey: ['client', clientId, 'partners'], queryFn: () => fetchPartners(clientId) })
  const [q, setQ] = useState('')
  const [role, setRole] = useState<'all' | 'customer' | 'supplier'>('all')
  const [edit, setEdit] = useState<PartnerInput | null>(null)
  const [statement, setStatement] = useState<Partner | null>(null)
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (params.get('new') !== '1') return
    setEdit({ ...EMPTY_PARTNER })
    params.delete('new')
    setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (partners.data ?? []).filter(
      (p) =>
        (role === 'all' || p.role === role || p.role === 'both') &&
        (!s || [p.name, p.nui, p.vat_number, p.city, p.email].some((v) => v?.toLowerCase().includes(s))),
    )
  }, [partners.data, q, role])
  const sum = list.reduce((a, p) => ({ r: a.r + p.receivable, p: a.p + p.payable, o: a.o + p.overdue }), { r: 0, p: 0, o: 0 })

  const exportList = () =>
    downloadWorkbook(`partneret-${clientName.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.xlsx`, [
      {
        name: 'Partnerët',
        columns: ['Emri', 'Roli', 'NUI', 'Nr. fiskal', 'Nr. TVSH', 'Adresa', 'Qyteti', 'Shteti', 'Telefoni', 'Email', 'Na detyrohet', 'I detyrohemi', 'Me vonesë', 'Dokumente'],
        rows: list.map((p) => [p.name, ROLE_LABEL[p.role], p.nui, p.fiscal_number, p.vat_number, p.address, p.city, p.country, p.phone, p.email, p.receivable, p.payable, p.overdue, p.docs]),
      },
    ])

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold">Klientët dhe furnitorët</h2>
          <p className="text-sm text-muted">
            Na detyrohen {formatEUR(sum.r)} · I detyrohemi {formatEUR(sum.p)}
            {sum.o > 0 && <span className="text-warn-700"> · me vonesë {formatEUR(sum.o)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative md:w-[240px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Emri, NUI, qyteti" className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none" />
          </div>
          <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)} options={[{ value: 'all', label: 'Të gjithë' }, { value: 'customer', label: 'Blerësit' }, { value: 'supplier', label: 'Furnitorët' }]} />
          <Button variant="secondary" onClick={() => void exportList()} disabled={!list.length}>
            Excel
          </Button>
          <Button onClick={() => setEdit({ ...EMPTY_PARTNER })}>
            <Plus className="h-4 w-4" /> Partner i ri
          </Button>
        </div>
      </div>

      {!partners.data ? (
        <p className={partners.error ? 'px-5 py-8 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{partners.error ? (partners.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : list.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={partners.data.length ? 'Asnjë partner me këtë kërkim' : 'Asnjë partner ende'} text="Shto blerësit dhe furnitorët e këtij biznesi; zgjidhen te faturat dhe ruhen me historikun e tyre." />
      ) : (
        <Table>
          <thead className="bg-[#F8FAF8]">
            <tr>
              <Th className="pl-5">Partneri</Th>
              <Th className="hidden md:table-cell">NUI / TVSH</Th>
              <Th className="text-right">Na detyrohet</Th>
              <Th className="hidden text-right md:table-cell">I detyrohemi</Th>
              <Th className="hidden text-right lg:table-cell">Dokumente</Th>
              <Th className="pr-5" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'opacity-60'}>
                <Td className="pl-5">
                  <button type="button" className="text-left" onClick={() => setStatement(p)}>
                    <div className="font-medium text-brand-600 hover:underline">{p.name}</div>
                    <div className="text-xs text-muted">
                      {ROLE_LABEL[p.role]}
                      {p.city && ` · ${p.city}`}
                      {!p.active && ' · arkivuar'}
                    </div>
                  </button>
                </Td>
                <Td className="hidden text-sm md:table-cell">{[p.nui, p.vat_number].filter(Boolean).join(' · ') || '—'}</Td>
                <Td className="text-right">
                  {p.receivable ? formatEUR(p.receivable) : '—'}
                  {p.overdue > 0 && <div className="text-xs text-warn-700">me vonesë {formatEUR(p.overdue)}</div>}
                </Td>
                <Td className="hidden text-right md:table-cell">{p.payable ? formatEUR(p.payable) : '—'}</Td>
                <Td className="hidden text-right lg:table-cell">{p.docs}</Td>
                <Td className="whitespace-nowrap pr-5 text-right">
                  <button type="button" title="Kartela" onClick={() => setStatement(p)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink">
                    <FileText className="h-4 w-4" />
                  </button>
                  <button type="button" title="Ndrysho" onClick={() => setEdit({ ...p })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink">
                    <Pencil className="h-4 w-4" />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <PartnerDialog
        clientId={clientId}
        value={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null)
          void qc.invalidateQueries({ queryKey: ['client', clientId, 'partners'] })
        }}
      />
      <StatementDialog partner={statement} clientName={clientName} from={from} to={to} onClose={() => setStatement(null)} />
    </Card>
  )
}

export function PartnerDialog({
  clientId,
  value,
  onClose,
  onSaved,
}: {
  clientId: string
  value: PartnerInput | null
  onClose: () => void
  onSaved: (id: string, name: string) => void
}) {
  const [f, setF] = useState<PartnerInput>(EMPTY_PARTNER)
  useEffect(() => {
    if (value) setF({ ...EMPTY_PARTNER, ...value })
  }, [value])
  const save = useMutation({ mutationFn: () => savePartner(clientId, f), onSuccess: (id) => onSaved(id, f.name) })
  const remove = useMutation({ mutationFn: () => deletePartner(value!.id!), onSuccess: () => onSaved(value!.id!, f.name) })
  const set = (k: keyof PartnerInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={value?.id ? 'Ndrysho partnerin' : 'Partner i ri'}
      width="md:max-w-[620px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {value?.id && (
              <Button variant="ghost" className="text-warn-700" loading={remove.isPending} onClick={() => remove.mutate()}>
                Fshi / arkivo
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Anulo
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Ruaj
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Input label="Emri i partnerit" value={f.name} onChange={set('name')} autoFocus />
        </div>
        <Select label="Roli" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as PartnerRole })} options={(Object.keys(ROLE_LABEL) as PartnerRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        <Input label="NUI" inputMode="numeric" maxLength={9} value={f.nui ?? ''} onChange={(e) => setF({ ...f, nui: e.target.value.replace(/\D/g, '') })} />
        <Input label="Nr. fiskal" value={f.fiscal_number ?? ''} onChange={set('fiscal_number')} />
        <Input label="Nr. i TVSH-së" value={f.vat_number ?? ''} onChange={set('vat_number')} />
        <Input label="Adresa" value={f.address ?? ''} onChange={set('address')} />
        <Input label="Qyteti" value={f.city ?? ''} onChange={set('city')} />
        <Input label="Shteti" value={f.country} onChange={set('country')} />
        <Input label="Telefoni" value={f.phone ?? ''} onChange={set('phone')} />
        <div className="md:col-span-2">
          <Input label="Email" type="email" value={f.email ?? ''} onChange={set('email')} />
        </div>
        <div className="md:col-span-2">
          <Input label="Shënim" value={f.note ?? ''} onChange={set('note')} />
        </div>
      </div>
      {(save.error || remove.error) && <p className="mt-3 text-sm text-warn-700">{((save.error ?? remove.error) as Error).message}</p>}
      {remove.data === 'archived' && <p className="mt-3 text-sm text-muted">Partneri ka dokumente, prandaj u arkivua.</p>}
    </Dialog>
  )
}

/** Kartela e partnerit: documents and payments with the running balance; print / Excel. */
function StatementDialog({ partner, clientName, from, to, onClose }: { partner: Partner | null; clientName: string; from: string; to: string; onClose: () => void }) {
  const [range, setRange] = useState({ from, to })
  useEffect(() => setRange({ from, to }), [from, to, partner?.id])
  const st = useQuery({ queryKey: ['statement', partner?.id, range.from, range.to], queryFn: () => fetchStatement(partner!.id, range.from, range.to), enabled: Boolean(partner) })
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const t = setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 50)
    return () => clearTimeout(t)
  }, [printing])

  let bal = st.data?.opening ?? 0
  const rows = (st.data?.rows ?? []).map((r) => {
    bal = Math.round((bal + r.debit - r.credit) * 100) / 100
    return { ...r, balance: bal }
  })
  const label = (r: StatementRow) => (r.type === 'payment' ? 'Pagesë' : r.type === 'credit_note' ? 'Kreditore' : r.type === 'debit_note' ? 'Debitore' : r.kind === 'purchase' ? 'Faturë blerjeje' : 'Faturë')

  const xlsx = () =>
    downloadWorkbook(`kartela-${(partner?.name ?? '').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.xlsx`, [
      {
        name: 'Kartela',
        columns: ['Data', 'Dokumenti', 'Nr.', 'Përshkrimi', 'Debi', 'Kredi', 'Saldo'],
        rows: [[range.from, 'Saldo fillestare', '', '', '', '', st.data?.opening ?? 0], ...rows.map((r) => [r.date, label(r), r.doc_no, r.text, r.debit || null, r.credit || null, r.balance])],
      },
    ])

  const table = (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-muted">
          <th className="py-2">Data</th>
          <th>Dokumenti</th>
          <th className="text-right">Debi</th>
          <th className="text-right">Kredi</th>
          <th className="text-right">Saldo</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-line">
          <td className="py-2">{formatDay(range.from)}</td>
          <td>Saldo fillestare</td>
          <td />
          <td />
          <td className="text-right font-medium">{formatEUR(st.data?.opening ?? 0)}</td>
        </tr>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line">
            <td className="py-2 whitespace-nowrap">{formatDay(r.date)}</td>
            <td>
              {label(r)} {r.doc_no && <span className="text-muted">· {r.doc_no}</span>}
              {r.text && <div className="text-xs text-muted">{r.text}</div>}
            </td>
            <td className="text-right">{r.debit ? formatEUR(r.debit) : ''}</td>
            <td className="text-right">{r.credit ? formatEUR(r.credit) : ''}</td>
            <td className="text-right font-medium">{formatEUR(r.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <>
      <Dialog
        open={Boolean(partner)}
        onClose={onClose}
        title={`Kartela – ${partner?.name ?? ''}`}
        subtitle={[partner?.nui && `NUI ${partner.nui}`, partner && ROLE_LABEL[partner.role]].filter(Boolean).join(' · ')}
        width="md:max-w-[820px]"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => void xlsx()} disabled={!st.data}>
              Excel
            </Button>
            <Button variant="secondary" onClick={() => setPrinting(true)} disabled={!st.data}>
              <Printer className="h-4 w-4" /> Printo / PDF
            </Button>
            <Button onClick={onClose}>Mbyll</Button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Input label="Nga" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input label="Deri" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          {st.data && (
            <Badge tone={bal > 0 ? 'amber' : 'success'} className="mb-3">
              Saldo {formatEUR(bal)}
            </Badge>
          )}
        </div>
        {st.isLoading ? <p className="py-8 text-center text-muted">Duke ngarkuar…</p> : st.error ? <p className="text-sm text-warn-700">{(st.error as Error).message}</p> : table}
      </Dialog>
      {printing &&
        createPortal(
          <div className="print-root print-a4 hidden bg-white p-2 text-[12px] text-black">
            <div className="mb-1 text-[11px]">{clientName}</div>
            <h1 className="text-[18px] font-bold">Kartela e partnerit – {partner?.name}</h1>
            <div className="mb-3">
              {formatDay(range.from)} – {formatDay(range.to)}
              {partner?.nui && ` · NUI ${partner.nui}`}
            </div>
            {table}
            <div className="mt-3 text-right font-semibold">Saldo në fund: {formatEUR(bal)}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
