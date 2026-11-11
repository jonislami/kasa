import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, LockOpen, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay, monthName } from '@/features/accounting/api'
import type { Client } from './api'
import {
  ASSET_CATEGORIES,
  deleteAsset,
  deleteCoa,
  deleteManualEntry,
  fetchAssets,
  fetchCoa,
  fetchGeneralLedger,
  fetchJournal,
  fetchManualEntry,
  fetchPeriods,
  fetchStatements,
  fetchTrialBalance,
  lockMonth,
  saveAsset,
  saveCoa,
  saveManualEntry,
  SOURCE_LABELS,
  TYPE_LABELS,
  type AccountType,
  type Asset,
  type AssetCategory,
  type CoaAccount,
  type ManualEntry,
  type StatementLine,
} from './ledger'
import { downloadSheets } from './xls'

const n2 = (v: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()

// ---------------------------------------------------------------------------
// Plani kontabël
// ---------------------------------------------------------------------------
export function CoaTab({ client }: { client: Client }) {
  const qc = useQueryClient()
  const coa = useQuery({ queryKey: ['client', client.id, 'coa'], queryFn: () => fetchCoa(client.id) })
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<(Omit<CoaAccount, 'system'> & { old_code?: string; system?: boolean }) | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id, 'coa'] })
  const save = useMutation({
    mutationFn: () => saveCoa(client.id, edit!),
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const del = useMutation({
    mutationFn: (code: string) => deleteCoa(client.id, code),
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const list = (coa.data ?? []).filter((a) => !q || a.code.includes(q) || a.name.toLowerCase().includes(q.toLowerCase()))
  const classes = [
    ['1', 'Klasa 1 – Pasuritë afatshkurtra'],
    ['2', 'Klasa 2 – Pasuritë afatgjata'],
    ['3', 'Klasa 3 – Detyrimet'],
    ['4', 'Klasa 4 – Kapitali'],
    ['5', 'Klasa 5 – Të hyrat'],
    ['6', 'Klasa 6 – Shpenzimet'],
  ]
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold">Plani kontabël</h2>
          <p className="text-sm text-muted">Faturat, pagesat, banka, TVSH-ja dhe amortizimi kontohen vetë në këto konto.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative md:w-[240px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kodi ose emri" className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none" />
          </div>
          <Button onClick={() => setEdit({ code: '', name: '', type: 'expense', active: true })}>
            <Plus className="h-4 w-4" /> Konto e re
          </Button>
        </div>
      </div>
      {!coa.data ? (
        <p className={coa.error ? 'px-5 py-6 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{coa.error ? (coa.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : (
        classes.map(([c, label]) => {
          const rows = list.filter((a) => a.code.startsWith(c))
          if (!rows.length) return null
          return (
            <div key={c}>
              <div className="border-t border-line bg-[#F6F9F7] px-5 py-2 text-[13px] font-semibold text-muted">{label}</div>
              <ul className="divide-y divide-line">
                {rows.map((a) => (
                  <li key={a.code} className={cn('flex items-center gap-3 px-5 py-2.5', !a.active && 'opacity-50')}>
                    <span className="w-16 font-mono font-semibold">{a.code}</span>
                    <span className="flex-1">{a.name}</span>
                    <span className="hidden text-sm text-muted sm:block">{TYPE_LABELS[a.type]}</span>
                    {a.system && <Badge>bazë</Badge>}
                    <button type="button" aria-label="Ndrysho" onClick={() => setEdit({ ...a, old_code: a.code })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })
      )}
      <Dialog
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.old_code ? `Konto ${edit.old_code}` : 'Konto e re'}
        width="md:max-w-[480px]"
        footer={
          <div className="flex justify-between gap-2">
            <div>
              {edit?.old_code && !edit.system && (
                <Button variant="ghost" className="text-warn-700" loading={del.isPending} onClick={() => del.mutate(edit.old_code!)}>
                  Fshi
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Anulo
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Ruaj
              </Button>
            </div>
          </div>
        }
      >
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Kodi" inputMode="numeric" value={edit.code} disabled={Boolean(edit.old_code)} onChange={(e) => setEdit({ ...edit, code: e.target.value.replace(/\D/g, '') })} />
            <Select label="Lloji" value={edit.type} disabled={edit.system} onChange={(e) => setEdit({ ...edit, type: e.target.value as AccountType })} options={(Object.keys(TYPE_LABELS) as AccountType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] }))} />
            <div className="sm:col-span-2">
              <Input label="Emri" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Aktive
            </label>
          </div>
        )}
        {(save.error || del.error) && <p className="mt-3 text-sm text-warn-700">{((save.error ?? del.error) as Error).message}</p>}
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Ditari (automatic + manual entries)
// ---------------------------------------------------------------------------
export function JournalTab({ client, from, to }: { client: Client; from: string; to: string }) {
  const qc = useQueryClient()
  const journal = useQuery({ queryKey: ['client', client.id, 'journal', from, to], queryFn: () => fetchJournal(client.id, from, to) })
  const [source, setSource] = useState<'all' | 'journal' | 'auto'>('all')
  const [edit, setEdit] = useState<ManualEntry | null>(null)
  const list = (journal.data ?? []).filter((g) => source === 'all' || (source === 'journal' ? g.source === 'journal' : g.source !== 'journal'))
  const totals = list.reduce((a, g) => g.lines.reduce((b, l) => ({ dr: b.dr + l.debit, cr: b.cr + l.credit }), a), { dr: 0, cr: 0 })
  const open = async (id: string) => setEdit(await fetchManualEntry(id))
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id] })

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold">Ditari</h2>
          <p className="text-sm text-muted">
            Debi {formatEUR(totals.dr)} · Kredi {formatEUR(totals.cr)} {Math.abs(totals.dr - totals.cr) < 0.01 ? <Badge tone="success">Barazohet</Badge> : <Badge tone="warn">Nuk barazohet</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)} options={[{ value: 'all', label: 'Të gjitha' }, { value: 'auto', label: 'Automatike (nga dokumentet)' }, { value: 'journal', label: 'Manuale' }]} />
          <Button onClick={() => setEdit({ entry_date: to < kosovoDateISO() ? to : kosovoDateISO(), kind: 'manual', description: '', lines: [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }] })}>
            <Plus className="h-4 w-4" /> Regjistrim
          </Button>
        </div>
      </div>
      {!journal.data ? (
        <p className={journal.error ? 'px-5 py-6 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{journal.error ? (journal.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : list.length === 0 ? (
        <EmptyState title="Asnjë regjistrim në periudhë" />
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 400).map((g, i) => (
            <li key={i} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{formatDay(g.date)}</span>
                <Badge tone={g.source === 'journal' ? 'info' : undefined}>{SOURCE_LABELS[g.source]}</Badge>
                {g.ref && <span className="font-mono text-muted">{g.ref}</span>}
                <span className="text-muted">{g.text}</span>
                {g.source === 'journal' && g.source_id && (
                  <button type="button" onClick={() => void open(g.source_id!)} className="ml-auto text-sm font-semibold text-brand-600 hover:underline">
                    Ndrysho
                  </button>
                )}
              </div>
              <table className="mt-1 w-full text-sm">
                <tbody>
                  {g.lines.map((l, j) => (
                    <tr key={j}>
                      <td className={cn('w-[60%] py-0.5', l.credit > 0 && 'pl-8')}>
                        <span className="font-mono">{l.account}</span> <span className="text-muted">{l.name}</span>
                      </td>
                      <td className="text-right tabular-nums">{l.debit ? n2(l.debit) : ''}</td>
                      <td className="text-right tabular-nums">{l.credit ? n2(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
      <EntryDialog client={client} value={edit} onClose={() => setEdit(null)} onSaved={refresh} />
    </Card>
  )
}

function EntryDialog({ client, value, onClose, onSaved }: { client: Client; value: ManualEntry | null; onClose: () => void; onSaved: () => void }) {
  const coa = useQuery({ queryKey: ['client', client.id, 'coa'], queryFn: () => fetchCoa(client.id), enabled: Boolean(value) })
  const [e, setE] = useState<ManualEntry | null>(null)
  useEffect(() => setE(value), [value])
  const save = useMutation({
    mutationFn: () => saveManualEntry(client.id, { ...e!, lines: e!.lines.filter((l) => l.account && (l.debit || l.credit)) }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const del = useMutation({
    mutationFn: () => deleteManualEntry(e!.id!),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  if (!e) return null
  const dr = e.lines.reduce((s, l) => s + (l.debit || 0), 0)
  const cr = e.lines.reduce((s, l) => s + (l.credit || 0), 0)
  const set = (i: number, patch: Partial<ManualEntry['lines'][number]>) => setE({ ...e, lines: e.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const accounts = (coa.data ?? []).filter((a) => a.active)
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={e.id ? 'Ndrysho regjistrimin' : 'Regjistrim në ditar'}
      subtitle="P.sh. saldot fillestare, përllogaritjet, korrigjimet. Debia duhet të barazohet me kredinë."
      width="md:max-w-[820px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn('text-sm font-semibold', Math.abs(dr - cr) < 0.005 && dr > 0 ? 'text-brand-600' : 'text-warn-700')}>
            Debi {n2(dr)} · Kredi {n2(cr)} {Math.abs(dr - cr) >= 0.005 && `· diferenca ${n2(dr - cr)}`}
          </span>
          <div className="flex gap-2">
            {e.id && (
              <Button variant="ghost" className="text-warn-700" loading={del.isPending} onClick={() => del.mutate()}>
                Fshi
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Anulo
            </Button>
            <Button loading={save.isPending} disabled={Math.abs(dr - cr) >= 0.005 || dr === 0} onClick={() => save.mutate()}>
              Ruaj
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Data" type="date" value={e.entry_date} onChange={(x) => setE({ ...e, entry_date: x.target.value })} />
        <Select
          label="Lloji"
          value={e.kind}
          onChange={(x) => setE({ ...e, kind: x.target.value as ManualEntry['kind'] })}
          options={[
            { value: 'manual', label: 'Regjistrim' },
            { value: 'opening', label: 'Saldo fillestare' },
            { value: 'adjustment', label: 'Korrigjim / përllogaritje' },
            { value: 'closing', label: 'Mbyllje' },
          ]}
        />
        <Input label="Përshkrimi" value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} />
      </div>
      <datalist id="coa-list">
        {accounts.map((a) => (
          <option key={a.code} value={a.code}>
            {a.name}
          </option>
        ))}
      </datalist>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="pb-1">Konto</th>
            <th className="pb-1">Shënim</th>
            <th className="pb-1 text-right">Debi</th>
            <th className="pb-1 text-right">Kredi</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {e.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1 pr-1">
                <input list="coa-list" className="h-10 w-full rounded-lg border border-field px-2 font-mono" value={l.account} onChange={(x) => set(i, { account: x.target.value.replace(/\D/g, '') })} placeholder="kodi" />
                <div className="truncate text-xs text-muted">{accounts.find((a) => a.code === l.account)?.name ?? ''}</div>
              </td>
              <td className="pr-1 align-top">
                <input className="h-10 w-full rounded-lg border border-field px-2" value={l.memo ?? ''} onChange={(x) => set(i, { memo: x.target.value })} />
              </td>
              <td className="w-[130px] pr-1 align-top">
                <input inputMode="decimal" className="h-10 w-full rounded-lg border border-field px-2 text-right" value={l.debit || ''} onChange={(x) => set(i, { debit: Number(x.target.value.replace(',', '.')) || 0, credit: 0 })} />
              </td>
              <td className="w-[130px] pr-1 align-top">
                <input inputMode="decimal" className="h-10 w-full rounded-lg border border-field px-2 text-right" value={l.credit || ''} onChange={(x) => set(i, { credit: Number(x.target.value.replace(',', '.')) || 0, debit: 0 })} />
              </td>
              <td className="align-top">
                <button type="button" aria-label="Hiq" onClick={() => setE({ ...e, lines: e.lines.filter((_, j) => j !== i) })} className="inline-flex h-10 w-9 items-center justify-center text-muted hover:text-warn-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="ghost" size="sm" className="mt-1" onClick={() => setE({ ...e, lines: [...e.lines, { account: '', debit: Math.max(0, cr - dr), credit: Math.max(0, dr - cr) }] })}>
        <Plus className="h-4 w-4" /> Rresht
      </Button>
      {(save.error || del.error) && <p className="mt-3 text-sm text-warn-700">{((save.error ?? del.error) as Error).message}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Libri kryesor (one account)
// ---------------------------------------------------------------------------
export function LedgerTab({ client, from, to }: { client: Client; from: string; to: string }) {
  const coa = useQuery({ queryKey: ['client', client.id, 'coa'], queryFn: () => fetchCoa(client.id) })
  const [account, setAccount] = useState('1020')
  const gl = useQuery({ queryKey: ['client', client.id, 'gl', account, from, to], queryFn: () => fetchGeneralLedger(client.id, account, from, to), enabled: Boolean(account) })
  const name = coa.data?.find((a) => a.code === account)?.name ?? ''
  let bal = gl.data?.opening ?? 0
  const rows = (gl.data?.rows ?? []).map((r) => {
    bal = Math.round((bal + r.debit - r.credit) * 100) / 100
    return { ...r, balance: bal }
  })
  const xlsx = () =>
    downloadSheets(`libri-kryesor-${account}-${slug(client.name)}-${from}-${to}.xlsx`, [
      {
        name: `Konto ${account}`,
        columns: ['Data', 'Burimi', 'Nr.', 'Përshkrimi', 'Partneri', 'Debi', 'Kredi', 'Saldo'],
        rows: [[from, 'Saldo fillestare', '', '', '', null, null, gl.data?.opening ?? 0], ...rows.map((r) => [r.date, SOURCE_LABELS[r.source], r.ref, r.text, r.partner, r.debit || null, r.credit || null, r.balance])],
      },
    ])
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-[300px] flex-1 lg:max-w-[460px]">
          <Select label="Konto" value={account} onChange={(e) => setAccount(e.target.value)} options={(coa.data ?? []).map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }))} />
        </div>
        <div className="flex items-center gap-3">
          {gl.data && (
            <span className="text-sm text-muted">
              Fillimi {formatEUR(gl.data.opening)} · fundi <strong className="text-ink">{formatEUR(bal)}</strong>
            </span>
          )}
          <Button variant="secondary" onClick={() => void xlsx()} disabled={!gl.data}>
            Excel
          </Button>
        </div>
      </div>
      {!gl.data ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : rows.length === 0 ? (
        <EmptyState title={`Asnjë lëvizje në ${account} ${name}`} />
      ) : (
        <Table>
          <thead className="bg-[#F6F9F7]">
            <tr>
              <Th className="pl-5">Data</Th>
              <Th>Përshkrimi</Th>
              <Th className="text-right">Debi</Th>
              <Th className="text-right">Kredi</Th>
              <Th className="pr-5 text-right">Saldo</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap pl-5">{formatDay(r.date)}</Td>
                <Td>
                  <div>{r.text || r.partner || SOURCE_LABELS[r.source]}</div>
                  <div className="text-xs text-muted">{[SOURCE_LABELS[r.source], r.ref, r.partner].filter(Boolean).join(' · ')}</div>
                </Td>
                <Td className="text-right tabular-nums">{r.debit ? n2(r.debit) : ''}</Td>
                <Td className="text-right tabular-nums">{r.credit ? n2(r.credit) : ''}</Td>
                <Td className="pr-5 text-right font-medium tabular-nums">{n2(r.balance)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Bilanci provues + pasqyrat financiare
// ---------------------------------------------------------------------------
export function TrialBalanceTab({ client, from, to }: { client: Client; from: string; to: string }) {
  const tb = useQuery({ queryKey: ['client', client.id, 'tb', from, to], queryFn: () => fetchTrialBalance(client.id, from, to) })
  const rows = tb.data ?? []
  const t = rows.reduce((a, r) => ({ o: a.o + r.opening, d: a.d + r.debit, c: a.c + r.credit, cl: a.cl + r.closing }), { o: 0, d: 0, c: 0, cl: 0 })
  const xlsx = () =>
    downloadSheets(`bilanci-provues-${slug(client.name)}-${from}-${to}.xlsx`, [
      { name: 'Bilanci provues', columns: ['Konto', 'Emri', 'Saldo fillestare', 'Debi', 'Kredi', 'Saldo përfundimtare'], rows: [...rows.map((r) => [r.code, r.name, r.opening, r.debit, r.credit, r.closing]), ['', 'Gjithsej', t.o, t.d, t.c, t.cl]] },
    ])
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[17px] font-semibold">Bilanci provues</h2>
          <p className="text-sm text-muted">
            {formatDay(from)} – {formatDay(to)} · {Math.abs(t.d - t.c) < 0.01 && Math.abs(t.cl) < 0.01 ? <Badge tone="success">Debia = Kredia</Badge> : <Badge tone="warn">Nuk barazohet</Badge>}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void xlsx()} disabled={!rows.length}>
          Excel
        </Button>
      </div>
      {!tb.data ? (
        <p className={tb.error ? 'px-5 py-6 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{tb.error ? (tb.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : (
        <Table>
          <thead className="bg-[#F6F9F7]">
            <tr>
              <Th className="pl-5">Konto</Th>
              <Th className="text-right">Fillimi</Th>
              <Th className="text-right">Debi</Th>
              <Th className="text-right">Kredi</Th>
              <Th className="pr-5 text-right">Fundi</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <Td className="pl-5">
                  <span className="font-mono font-semibold">{r.code}</span> <span className="text-muted">{r.name}</span>
                </Td>
                <Td className="text-right tabular-nums">{n2(r.opening)}</Td>
                <Td className="text-right tabular-nums">{n2(r.debit)}</Td>
                <Td className="text-right tabular-nums">{n2(r.credit)}</Td>
                <Td className="pr-5 text-right font-semibold tabular-nums">{n2(r.closing)}</Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td className="border-b-0 pl-5">Gjithsej</Td>
              <Td className="border-b-0 text-right tabular-nums">{n2(t.o)}</Td>
              <Td className="border-b-0 text-right tabular-nums">{n2(t.d)}</Td>
              <Td className="border-b-0 text-right tabular-nums">{n2(t.c)}</Td>
              <Td className="border-b-0 pr-5 text-right tabular-nums">{n2(t.cl)}</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </Card>
  )
}

export function StatementsTab({ client, from, to }: { client: Client; from: string; to: string }) {
  const st = useQuery({ queryKey: ['client', client.id, 'statements', from, to], queryFn: () => fetchStatements(client.id, from, to) })
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const t = setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 80)
    return () => clearTimeout(t)
  }, [printing])
  const d = st.data
  const sum = (l: StatementLine[]) => l.reduce((s, x) => s + x.amount, 0)
  const view = useMemo(() => {
    if (!d) return null
    const assets = sum(d.assets)
    const liabilities = sum(d.liabilities)
    const equity = sum(d.equity) + d.result_to_date
    const income = sum(d.income)
    const expenses = sum(d.expenses)
    return { assets, liabilities, equity, income, expenses, result: income - expenses }
  }, [d])

  const xlsx = () =>
    d &&
    view &&
    downloadSheets(`pasqyrat-financiare-${slug(client.name)}-${to}.xlsx`, [
      {
        name: 'Bilanci i gjendjes',
        columns: ['Konto', 'Emri', 'Shuma'],
        rows: [
          ['', 'PASURITË', null],
          ...d.assets.map((x) => [x.code, x.name, x.amount]),
          ['', 'Gjithsej pasuritë', view.assets],
          ['', 'DETYRIMET', null],
          ...d.liabilities.map((x) => [x.code, x.name, x.amount]),
          ['', 'KAPITALI', null],
          ...d.equity.map((x) => [x.code, x.name, x.amount]),
          ['', 'Rezultati i periudhës', d.result_to_date],
          ['', 'Gjithsej detyrimet dhe kapitali', view.liabilities + view.equity],
        ],
      },
      {
        name: 'Pasqyra e të ardhurave',
        columns: ['Konto', 'Emri', 'Shuma'],
        rows: [...d.income.map((x) => [x.code, x.name, x.amount]), ['', 'Gjithsej të hyrat', view.income], ...d.expenses.map((x) => [x.code, x.name, x.amount]), ['', 'Gjithsej shpenzimet', view.expenses], ['', 'Fitimi / humbja', view.result]],
      },
    ])

  const block = (title: string, lines: StatementLine[], total: number, extra?: { label: string; amount: number }) => (
    <div className="mb-3">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{title}</div>
      {lines.map((x) => (
        <div key={x.code} className="flex justify-between py-0.5 text-[14px]">
          <span>
            <span className="font-mono text-muted">{x.code}</span> {x.name}
          </span>
          <span className="tabular-nums">{n2(x.amount)}</span>
        </div>
      ))}
      {extra && (
        <div className="flex justify-between py-0.5 text-[14px]">
          <span>{extra.label}</span>
          <span className="tabular-nums">{n2(extra.amount)}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
        <span>Gjithsej</span>
        <span className="tabular-nums">{n2(total)}</span>
      </div>
    </div>
  )

  const content = d && view && (
    <div className="grid gap-4 md:gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-3 text-[17px] font-semibold">Bilanci i gjendjes më {formatDay(d.as_of)}</h2>
        {block('Pasuritë', d.assets, view.assets)}
        {block('Detyrimet', d.liabilities, view.liabilities)}
        {block('Kapitali', d.equity, view.equity, { label: 'Rezultati (fitimi / humbja)', amount: d.result_to_date })}
        <div className={cn('mt-2 rounded-ctl px-3 py-2 text-sm font-semibold', Math.abs(view.assets - view.liabilities - view.equity) < 0.01 ? 'bg-brand-100 text-brand-600' : 'bg-warn-100 text-warn-700')}>
          Pasuritë {n2(view.assets)} = Detyrimet + Kapitali {n2(view.liabilities + view.equity)}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-[17px] font-semibold">
          Pasqyra e të ardhurave {formatDay(d.from)} – {formatDay(d.as_of)}
        </h2>
        {block('Të hyrat', d.income, view.income)}
        {block('Shpenzimet', d.expenses, view.expenses)}
        <div className={cn('mt-2 flex justify-between rounded-ctl px-3 py-3 text-[17px] font-bold', view.result >= 0 ? 'bg-brand-100 text-brand-600' : 'bg-warn-100 text-warn-700')}>
          <span>{view.result >= 0 ? 'Fitimi' : 'Humbja'}</span>
          <span className="tabular-nums">{formatEUR(view.result)}</span>
        </div>
      </Card>
    </div>
  )

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => void xlsx()} disabled={!d}>
          Excel
        </Button>
        <Button variant="secondary" onClick={() => setPrinting(true)} disabled={!d}>
          <Printer className="h-4 w-4" /> Printo / PDF
        </Button>
      </div>
      {!d ? <p className={st.error ? 'text-sm text-warn-700' : 'py-10 text-center text-muted'}>{st.error ? (st.error as Error).message : 'Duke ngarkuar…'}</p> : content}
      {printing &&
        content &&
        createPortal(
          <div className="print-root print-a4 hidden bg-white text-[11px] text-black">
            <div className="mb-2 text-[16px] font-bold">{client.name} – Pasqyrat financiare</div>
            {content}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mjetet themelore
// ---------------------------------------------------------------------------
export function AssetsTab({ client }: { client: Client }) {
  const qc = useQueryClient()
  const assets = useQuery({ queryKey: ['client', client.id, 'assets'], queryFn: () => fetchAssets(client.id) })
  const [edit, setEdit] = useState<Partial<Asset> | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id] })
  const save = useMutation({
    mutationFn: () => saveAsset(client.id, edit!),
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const del = useMutation({
    mutationFn: (id: string) => deleteAsset(id),
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const list = assets.data ?? []
  const t = list.reduce((a, x) => ({ cost: a.cost + x.cost, dep: a.dep + x.depreciated, year: a.year + x.year_dep }), { cost: 0, dep: 0, year: 0 })
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[17px] font-semibold">Mjetet themelore dhe amortizimi</h2>
          <p className="text-sm text-muted">
            Vlera blerëse {formatEUR(t.cost)} · e amortizuar {formatEUR(t.dep)} · vlera aktuale {formatEUR(t.cost - t.dep)} · amortizimi këtë vit {formatEUR(t.year)}
          </p>
        </div>
        <Button onClick={() => setEdit({ category: 'equipment', rate_pct: 20, acquired_on: kosovoDateISO(), cost: 0, salvage: 0 })}>
          <Plus className="h-4 w-4" /> Aset i ri
        </Button>
      </div>
      {!assets.data ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : list.length === 0 ? (
        <EmptyState title="Asnjë mjet themelor" text="Regjistro pajisjet, automjetet, mobiliet; amortizimi mujor kontohet vetë (6600 / 2290)." />
      ) : (
        <Table>
          <thead className="bg-[#F6F9F7]">
            <tr>
              <Th className="pl-5">Aseti</Th>
              <Th className="text-right">Vlera blerëse</Th>
              <Th className="hidden text-right md:table-cell">Norma</Th>
              <Th className="hidden text-right md:table-cell">Në muaj</Th>
              <Th className="text-right">E amortizuar</Th>
              <Th className="pr-5 text-right">Vlera aktuale</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-[#F6F9F7]" onClick={() => setEdit(a)}>
                <Td className="pl-5">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted">
                    {ASSET_CATEGORIES[a.category].label} · blerë {formatDay(a.acquired_on)}
                    {a.disposed_on && ` · shitur/nxjerrë ${formatDay(a.disposed_on)}`}
                  </div>
                </Td>
                <Td className="text-right tabular-nums">{n2(a.cost)}</Td>
                <Td className="hidden text-right md:table-cell">{a.rate_pct}%</Td>
                <Td className="hidden text-right tabular-nums md:table-cell">{n2(a.monthly)}</Td>
                <Td className="text-right tabular-nums">{n2(a.depreciated)}</Td>
                <Td className="pr-5 text-right font-semibold tabular-nums">{n2(a.cost - a.depreciated)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Aseti' : 'Aset i ri'}
        width="md:max-w-[560px]"
        footer={
          <div className="flex justify-between gap-2">
            <div>
              {edit?.id && (
                <Button variant="ghost" className="text-warn-700" loading={del.isPending} onClick={() => del.mutate(edit.id!)}>
                  Fshi
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Anulo
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Ruaj
              </Button>
            </div>
          </div>
        }
      >
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input label="Emri" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <Select
              label="Kategoria"
              value={edit.category ?? 'equipment'}
              onChange={(e) => {
                const c = e.target.value as AssetCategory
                setEdit({ ...edit, category: c, rate_pct: ASSET_CATEGORIES[c].rate })
              }}
              options={(Object.keys(ASSET_CATEGORIES) as AssetCategory[]).map((c) => ({ value: c, label: `${ASSET_CATEGORIES[c].label} (${ASSET_CATEGORIES[c].rate}%)` }))}
            />
            <Input label="Data e blerjes" type="date" value={edit.acquired_on ?? ''} onChange={(e) => setEdit({ ...edit, acquired_on: e.target.value })} />
            <Input label="Vlera blerëse pa TVSH (€)" inputMode="decimal" value={edit.cost ? String(edit.cost) : ''} onChange={(e) => setEdit({ ...edit, cost: Number(e.target.value.replace(',', '.')) || 0 })} />
            <Input label="Norma vjetore (%)" inputMode="decimal" value={edit.rate_pct ? String(edit.rate_pct) : ''} onChange={(e) => setEdit({ ...edit, rate_pct: Number(e.target.value.replace(',', '.')) || 0 })} />
            <Input label="Vlera e mbetur (€)" inputMode="decimal" value={edit.salvage ? String(edit.salvage) : ''} onChange={(e) => setEdit({ ...edit, salvage: Number(e.target.value.replace(',', '.')) || 0 })} />
            <Input label="Shitur / nxjerrë nga përdorimi" type="date" value={edit.disposed_on ?? ''} onChange={(e) => setEdit({ ...edit, disposed_on: e.target.value || null })} />
            <div className="sm:col-span-2">
              <Input label="Shënim" value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </div>
            {edit.cost && edit.rate_pct ? <p className="text-sm text-muted sm:col-span-2">Amortizimi mujor {formatEUR(((edit.cost - (edit.salvage ?? 0)) * edit.rate_pct) / 100 / 12)} (metoda lineare), nga muaji pas blerjes.</p> : null}
          </div>
        )}
        {(save.error || del.error) && <p className="mt-3 text-sm text-warn-700">{((save.error ?? del.error) as Error).message}</p>}
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Mbyllja e muajit
// ---------------------------------------------------------------------------
export function CloseTab({ client }: { client: Client }) {
  const qc = useQueryClient()
  const [year, setYear] = useState(() => Number(kosovoDateISO().slice(0, 4)))
  const periods = useQuery({ queryKey: ['client', client.id, 'periods', year], queryFn: () => fetchPeriods(client.id, year) })
  const lock = useMutation({ mutationFn: ({ m, l }: { m: string; l: boolean }) => lockMonth(client.id, m, l), onSuccess: () => void qc.invalidateQueries({ queryKey: ['client', client.id] }) })
  const thisMonth = kosovoDateISO().slice(0, 7)
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[17px] font-semibold">Mbyllja e muajit</h2>
          <p className="text-sm text-muted">Një muaj i mbyllur nuk ndryshohet më: asnjë faturë, pagesë, lëvizje ose regjistrim me datë në të.</p>
        </div>
        <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[0, 1, 2].map((i) => ({ value: String(Number(thisMonth.slice(0, 4)) - i), label: String(Number(thisMonth.slice(0, 4)) - i) }))} />
      </div>
      {lock.error && <p className="mx-5 mb-3 rounded-ctl bg-warn-100 px-4 py-2 text-sm text-warn-700">{(lock.error as Error).message}</p>}
      {!periods.data ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : (
        <ul className="divide-y divide-line">
          {periods.data.map((p) => {
            const future = p.month.slice(0, 7) > thisMonth
            const issues = [p.unmatched && `${p.unmatched} lëvizje bankare pa rakorduar`, p.no_partner && `${p.no_partner} dokumente pa partner`, client.vat_registered && p.vat_status !== 'filed' && p.docs && 'TVSH pa u dorëzuar'].filter(Boolean)
            return (
              <li key={p.month} className={cn('flex flex-wrap items-center gap-3 px-5 py-3', future && 'opacity-50')}>
                <span className="w-36 font-semibold">{monthName(p.month)}</span>
                <span className="text-sm text-muted">{p.docs} dokumente</span>
                <span className="flex-1 text-sm">
                  {issues.length ? <span className="text-amber-700">{issues.join(' · ')}</span> : p.docs ? <span className="text-brand-600">Gati për mbyllje</span> : null}
                </span>
                {p.locked ? <Badge tone="success">I mbyllur</Badge> : null}
                {!future && (
                  <Button size="sm" variant={p.locked ? 'secondary' : 'primary'} loading={lock.isPending && lock.variables?.m === p.month} onClick={() => lock.mutate({ m: p.month, l: !p.locked })}>
                    {p.locked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />} {p.locked ? 'Hape' : 'Mbyll'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
