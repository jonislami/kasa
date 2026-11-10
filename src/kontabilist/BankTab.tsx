import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, CheckCircle2, FileUp, Landmark, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { kosovoDateISO, monthLabel } from './dates'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import {
  bookBankLine,
  deleteAccount,
  deleteLoan,
  deleteTransaction,
  fetchAccounts,
  fetchBankLines,
  fetchCashFlow,
  fetchLedger,
  fetchLoans,
  loanSchedule,
  matchBankLine,
  PURCHASE_CATEGORIES,
  saveAccount,
  saveLoan,
  saveTransaction,
  setBankLine,
  TX_LABELS,
  type Client,
  type DocCategory,
  type Loan,
  type MoneyAccount,
  type TxCategory,
} from './api'
import { BankImportDialog } from './BankImport'
import { downloadSheets } from './xls'

const IN_CATS: TxCategory[] = ['income', 'owner', 'loan', 'interest', 'other']
const OUT_CATS: TxCategory[] = ['wages', 'taxes', 'vat', 'contributions', 'loan', 'interest', 'owner', 'bank_fee', 'other']

/** Arka & banka: accounts and balances, ledger, movements, statement import + reconciliation, loans, cash flow. */
export function BankTab({ client, from, to, onChanged }: { client: Client; from: string; to: string; onChanged: () => void }) {
  const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ['client', client.id, 'accounts'], queryFn: () => fetchAccounts(client.id) })
  const list = (accounts.data ?? []).filter((a) => a.active)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    if (list.length && !list.some((a) => a.id === sel)) setSel(list[0].id)
  }, [list, sel])
  const account = list.find((a) => a.id === sel) ?? null

  const [editAcc, setEditAcc] = useState<Partial<MoneyAccount> | null>(null)
  const [move, setMove] = useState<'in' | 'out' | 'transfer' | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [reconcile, setReconcile] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['client', client.id] })
    onChanged()
  }

  if (accounts.isLoading) return <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
  if (!list.length) {
    return (
      <Card>
        <EmptyState
          icon={<Landmark className="h-6 w-6" />}
          title="Asnjë arkë apo llogari bankare"
          text="Shto arkën dhe llogaritë bankare të kompanisë me gjendjen fillestare. Pastaj pagesat e faturave, ekstraktet bankare dhe lëvizjet e tjera dalin këtu."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => setEditAcc({ kind: 'cash', name: 'Arka', opening_balance: 0 })}>
                <Banknote className="h-4 w-4" /> Shto arkën
              </Button>
              <Button onClick={() => setEditAcc({ kind: 'bank', name: '', bank_name: '', opening_balance: 0 })}>
                <Landmark className="h-4 w-4" /> Llogari bankare
              </Button>
            </div>
          }
        />
        <AccountDialog clientId={client.id} value={editAcc} onClose={() => setEditAcc(null)} onSaved={refresh} />
      </Card>
    )
  }

  const total = list.reduce((s, a) => s + a.balance, 0)

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSel(a.id)}
            className={cn('rounded-card border bg-white p-4 text-left transition-shadow hover:shadow-md', a.id === sel ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-line')}
          >
            <div className="flex items-center gap-2 text-sm text-muted">
              {a.kind === 'cash' ? <Banknote className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
              <span className="truncate">{a.name}</span>
              {a.to_match > 0 && <Badge tone="amber">{a.to_match} pa rakorduar</Badge>}
            </div>
            <div className={cn('mt-1 text-[22px] font-bold tabular-nums', a.balance < 0 && 'text-warn-700')}>{formatEUR(a.balance)}</div>
            {a.iban && <div className="truncate text-xs text-muted">{a.iban}</div>}
          </button>
        ))}
        <div className="flex flex-col justify-between gap-2 rounded-card border border-dashed border-field p-4">
          <div className="text-sm text-muted">Gjithsej sot</div>
          <div className="text-[22px] font-bold tabular-nums">{formatEUR(total)}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditAcc({ kind: 'bank', name: '', opening_balance: 0 })}>
              <Plus className="h-4 w-4" /> Llogari
            </Button>
            {!list.some((a) => a.kind === 'cash') && (
              <Button size="sm" variant="secondary" onClick={() => setEditAcc({ kind: 'cash', name: 'Arka', opening_balance: 0 })}>
                Arkë
              </Button>
            )}
          </div>
        </div>
      </div>

      {notice && <p className="rounded-ctl bg-brand-100 px-4 py-3 text-sm font-medium text-brand-600">{notice}</p>}

      {account && (
        <Ledger
          key={account.id}
          account={account}
          from={from}
          to={to}
          onIn={() => setMove('in')}
          onOut={() => setMove('out')}
          onTransfer={() => setMove('transfer')}
          onImport={() => setImportOpen(true)}
          onReconcile={() => setReconcile(true)}
          onEdit={() => setEditAcc(account)}
          onChanged={refresh}
        />
      )}

      <div className="grid gap-4 md:gap-5 xl:grid-cols-2">
        <CashFlowCard clientId={client.id} from={from} to={to} />
        <LoansCard clientId={client.id} accounts={list} onChanged={refresh} />
      </div>

      <AccountDialog clientId={client.id} value={editAcc} onClose={() => setEditAcc(null)} onSaved={refresh} />
      {account && <MoveDialog mode={move} account={account} accounts={list} clientId={client.id} onClose={() => setMove(null)} onSaved={refresh} />}
      {account && (
        <BankImportDialog
          accountId={account.id}
          accountName={account.name}
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onDone={(r) => {
            setImportOpen(false)
            setNotice(`U importuan ${r.added} lëvizje${r.skipped ? ` (${r.skipped} ishin importuar më parë)` : ''}.`)
            refresh()
            if (r.added) setReconcile(true)
          }}
        />
      )}
      {account && <ReconcileDialog open={reconcile} account={account} onClose={() => setReconcile(false)} onChanged={refresh} />}
    </div>
  )
}

function Ledger({
  account,
  from,
  to,
  onIn,
  onOut,
  onTransfer,
  onImport,
  onReconcile,
  onEdit,
  onChanged,
}: {
  account: MoneyAccount
  from: string
  to: string
  onIn: () => void
  onOut: () => void
  onTransfer: () => void
  onImport: () => void
  onReconcile: () => void
  onEdit: () => void
  onChanged: () => void
}) {
  const led = useQuery({ queryKey: ['client', 'ledger', account.id, from, to], queryFn: () => fetchLedger(account.id, from, to) })
  const del = useMutation({ mutationFn: deleteTransaction, onSuccess: onChanged })
  let bal = led.data?.opening ?? 0
  const rows = (led.data?.rows ?? []).map((r) => {
    bal = Math.round((bal + r.amount) * 100) / 100
    return { ...r, balance: bal }
  })
  const xlsx = () =>
    downloadSheets(`${account.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${from}-${to}.xlsx`, [
      {
        name: account.kind === 'cash' ? 'Libri i arkës' : 'Libri bankar',
        columns: ['Data', 'Përshkrimi', 'Kategoria', 'Referenca', 'Hyrje', 'Dalje', 'Saldo'],
        rows: [[from, 'Saldo fillestare', '', '', null, null, led.data?.opening ?? 0], ...rows.map((r) => [r.date, r.text || r.partner || '', TX_LABELS[r.category], r.reference, r.amount > 0 ? r.amount : null, r.amount < 0 ? -r.amount : null, r.balance])],
      },
    ])

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-semibold">
            {account.kind === 'cash' ? 'Libri i arkës' : 'Libri bankar'} · {account.name}
            <button type="button" aria-label="Ndrysho llogarinë" onClick={onEdit} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg">
              <Pencil className="h-4 w-4" />
            </button>
          </h2>
          {led.data && (
            <p className="text-sm text-muted">
              Fillimi {formatEUR(led.data.opening)} · fundi {formatEUR(led.data.closing)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onIn}>
            <ArrowDownLeft className="h-4 w-4" /> Hyrje
          </Button>
          <Button variant="secondary" onClick={onOut}>
            <ArrowUpRight className="h-4 w-4" /> Dalje
          </Button>
          <Button variant="secondary" onClick={onTransfer}>
            <ArrowLeftRight className="h-4 w-4" /> Transfer
          </Button>
          {account.kind === 'bank' && (
            <Button variant="secondary" onClick={onImport}>
              <FileUp className="h-4 w-4" /> Ekstrakti
            </Button>
          )}
          {account.kind === 'bank' && (
            <Button onClick={onReconcile}>
              <Wand2 className="h-4 w-4" /> Rakordo{account.to_match ? ` (${account.to_match})` : ''}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void xlsx()} disabled={!led.data}>
            Excel
          </Button>
        </div>
      </div>
      {!led.data ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Asnjë lëvizje në këtë periudhë" text="Pagesat e faturave me këtë llogari, ekstraktet dhe lëvizjet e tjera dalin këtu." />
      ) : (
        <Table>
          <thead className="bg-[#F8FAF8]">
            <tr>
              <Th className="pl-5">Data</Th>
              <Th>Përshkrimi</Th>
              <Th className="text-right">Hyrje</Th>
              <Th className="text-right">Dalje</Th>
              <Th className="hidden text-right md:table-cell">Saldo</Th>
              <Th className="pr-5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source + r.id}>
                <Td className="whitespace-nowrap pl-5">{formatDay(r.date)}</Td>
                <Td>
                  <div className="font-medium">{r.text || r.partner || TX_LABELS[r.category]}</div>
                  <div className="text-xs text-muted">{[TX_LABELS[r.category], r.partner, r.reference].filter(Boolean).join(' · ')}</div>
                </Td>
                <Td className="text-right text-brand-600">{r.amount > 0 ? formatEUR(r.amount) : ''}</Td>
                <Td className="text-right">{r.amount < 0 ? formatEUR(-r.amount) : ''}</Td>
                <Td className="hidden text-right font-medium md:table-cell">{formatEUR(r.balance)}</Td>
                <Td className="pr-5 text-right">
                  {r.source === 'tx' && (
                    <button type="button" aria-label="Fshi" title="Fshi" onClick={() => del.mutate(r.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-warn-100 hover:text-warn-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

function AccountDialog({ clientId, value, onClose, onSaved }: { clientId: string; value: Partial<MoneyAccount> | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<MoneyAccount>>({})
  useEffect(() => {
    if (value) setF({ opening_date: `${kosovoDateISO().slice(0, 4)}-01-01`, ...value })
  }, [value])
  const save = useMutation({
    mutationFn: () => saveAccount(clientId, f),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteAccount(value!.id!),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={value?.id ? 'Ndrysho llogarinë' : f.kind === 'cash' ? 'Arka' : 'Llogari bankare'}
      width="md:max-w-[520px]"
      footer={
        <div className="flex justify-between gap-2">
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Lloji" value={f.kind ?? 'bank'} onChange={(e) => setF({ ...f, kind: e.target.value as MoneyAccount['kind'] })} options={[{ value: 'bank', label: 'Llogari bankare' }, { value: 'cash', label: 'Arka (kesh)' }]} />
        <Input label="Emri" value={f.name ?? ''} placeholder={f.kind === 'cash' ? 'Arka' : 'p.sh. ProCredit – rrjedhëse'} onChange={(e) => setF({ ...f, name: e.target.value })} />
        {f.kind !== 'cash' && (
          <>
            <Input label="Banka" value={f.bank_name ?? ''} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />
            <Input label="IBAN" value={f.iban ?? ''} onChange={(e) => setF({ ...f, iban: e.target.value.toUpperCase() })} />
          </>
        )}
        <Input label="Gjendja fillestare (€)" inputMode="decimal" value={f.opening_balance ? String(f.opening_balance) : ''} onChange={(e) => setF({ ...f, opening_balance: Number(e.target.value.replace(',', '.')) || 0 })} />
        <Input label="Më datën" type="date" value={f.opening_date ?? ''} onChange={(e) => setF({ ...f, opening_date: e.target.value })} />
      </div>
      {(save.error || remove.error) && <p className="mt-3 text-sm text-warn-700">{((save.error ?? remove.error) as Error).message}</p>}
    </Dialog>
  )
}

function MoveDialog({ mode, account, accounts, clientId, onClose, onSaved }: { mode: 'in' | 'out' | 'transfer' | null; account: MoneyAccount; accounts: MoneyAccount[]; clientId: string; onClose: () => void; onSaved: () => void }) {
  const loans = useQuery({ queryKey: ['client', clientId, 'loans'], queryFn: () => fetchLoans(clientId), enabled: Boolean(mode) })
  const [f, setF] = useState({ amount: '', date: kosovoDateISO(), category: 'other' as TxCategory, description: '', reference: '', to: '', loan: '' })
  useEffect(() => {
    if (mode) setF({ amount: '', date: kosovoDateISO(), category: mode === 'in' ? 'owner' : mode === 'out' ? 'wages' : 'transfer', description: '', reference: '', to: accounts.find((a) => a.id !== account.id)?.id ?? '', loan: '' })
  }, [mode, account.id, accounts])
  const save = useMutation({
    mutationFn: () => {
      const amt = Math.abs(Number(f.amount.replace(',', '.')))
      return saveTransaction({
        account_id: account.id,
        to_account_id: mode === 'transfer' ? f.to : undefined,
        tx_date: f.date,
        amount: mode === 'out' ? -amt : amt,
        category: mode === 'transfer' ? 'transfer' : f.category,
        description: f.description || undefined,
        reference: f.reference || undefined,
        loan_id: f.loan || null,
      })
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  const cats = mode === 'in' ? IN_CATS : OUT_CATS
  return (
    <Dialog
      open={Boolean(mode)}
      onClose={onClose}
      title={mode === 'in' ? `Hyrje në ${account.name}` : mode === 'out' ? `Dalje nga ${account.name}` : `Transfer nga ${account.name}`}
      subtitle={mode !== 'transfer' ? 'Pagesat e faturave regjistrohen te fatura; këtu janë lëvizjet pa faturë.' : undefined}
      width="md:max-w-[520px]"
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
        <Input label="Shuma (€)" inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input label="Data" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        {mode === 'transfer' ? (
          <div className="sm:col-span-2">
            <Select label="Në llogarinë" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} options={accounts.filter((a) => a.id !== account.id).map((a) => ({ value: a.id, label: a.name }))} />
          </div>
        ) : (
          <Select label="Kategoria" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as TxCategory })} options={cats.map((c) => ({ value: c, label: TX_LABELS[c] }))} />
        )}
        {(f.category === 'loan' || f.category === 'interest') && mode !== 'transfer' && (
          <Select label="Kredia" value={f.loan} onChange={(e) => setF({ ...f, loan: e.target.value })} options={[{ value: '', label: '—' }, ...(loans.data ?? []).map((l) => ({ value: l.id, label: `${l.lender} · ${formatEUR(l.principal)}` }))]} />
        )}
        <div className="sm:col-span-2">
          <Input label="Përshkrimi" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <Input label="Referenca" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

/** Bank lines waiting: link to an invoice (suggested), book as movement / expense, or ignore. */
function ReconcileDialog({ open, account, onClose, onChanged }: { open: boolean; account: MoneyAccount; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<'new' | 'matched' | 'ignored'>('new')
  const lines = useQuery({ queryKey: ['bank-lines', account.id, status], queryFn: () => fetchBankLines(account.id, status), enabled: open })
  const [book, setBook] = useState<Record<string, string>>({})
  const done = () => {
    void lines.refetch()
    onChanged()
  }
  const match = useMutation({ mutationFn: ({ line, doc }: { line: string; doc: string }) => matchBankLine(line, doc), onSuccess: done })
  const booked = useMutation({
    mutationFn: ({ line, choice }: { line: string; choice: string }) =>
      choice.startsWith('exp:') ? bookBankLine(line, { expense_category: choice.slice(4) as DocCategory }) : bookBankLine(line, { category: choice as TxCategory }),
    onSuccess: done,
  })
  const set = useMutation({ mutationFn: ({ line, s }: { line: string; s: 'ignored' | 'new' | 'delete' }) => setBankLine(line, s), onSuccess: done })
  const err = (match.error ?? booked.error ?? set.error) as Error | null

  return (
    <Dialog open={open} onClose={onClose} title={`Rakordimi – ${account.name}`} subtitle="Lidh çdo lëvizje të bankës me faturën, ose regjistroje si lëvizje / shpenzim." width="md:max-w-[1000px]">
      <div className="mb-3 flex gap-2">
        {(['new', 'matched', 'ignored'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn('h-9 rounded-full border px-4 text-sm font-medium', status === s ? 'border-ink bg-ink text-white' : 'border-line bg-white')}>
            {{ new: 'Pa rakorduar', matched: 'Të rakorduara', ignored: 'Të injoruara' }[s]}
          </button>
        ))}
      </div>
      {err && <p className="mb-3 rounded-ctl bg-warn-100 px-4 py-2 text-sm text-warn-700">{err.message}</p>}
      {!lines.data ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : lines.data.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title={status === 'new' ? 'Gjithçka është rakorduar' : 'Asgjë këtu'} />
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {lines.data.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">{formatDay(l.line_date)}</span>
                  <span className={cn('font-semibold tabular-nums', l.amount > 0 ? 'text-brand-600' : 'text-ink')}>{formatEUR(l.amount)}</span>
                  {l.doc_no && <Badge tone="success">{l.doc_no}</Badge>}
                </div>
                <div className="truncate text-sm">{[l.counterparty, l.description, l.reference].filter(Boolean).join(' · ')}</div>
              </div>
              {l.status === 'new' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {l.suggestions.map((s) => (
                    <Button key={s.doc_id} size="sm" loading={match.isPending && match.variables?.line === l.id} onClick={() => match.mutate({ line: l.id, doc: s.doc_id })} title={`${s.partner ?? ''} · mbetet ${formatEUR(s.open)}`}>
                      Lidh me {s.doc_no ?? 'faturën'}
                    </Button>
                  ))}
                  <select
                    className="h-9 rounded-lg border border-field bg-white px-2 text-sm"
                    value={book[l.id] ?? ''}
                    onChange={(e) => setBook({ ...book, [l.id]: e.target.value })}
                  >
                    <option value="">Regjistro si…</option>
                    <optgroup label="Lëvizje">
                      {(l.amount > 0 ? IN_CATS : OUT_CATS).map((c) => (
                        <option key={c} value={c}>
                          {TX_LABELS[c]}
                        </option>
                      ))}
                    </optgroup>
                    {l.amount < 0 && (
                      <optgroup label="Shpenzim (hyn në fitim)">
                        {PURCHASE_CATEGORIES.filter((c) => !['goods', 'assets'].includes(c.value)).map((c) => (
                          <option key={c.value} value={`exp:${c.value}`}>
                            {c.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <Button size="sm" variant="secondary" disabled={!book[l.id]} loading={booked.isPending && booked.variables?.line === l.id} onClick={() => booked.mutate({ line: l.id, choice: book[l.id] })}>
                    OK
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => set.mutate({ line: l.id, s: 'ignored' })}>
                    Injoro
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => set.mutate({ line: l.id, s: 'new' })}>
                  Zhbëje
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function CashFlowCard({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const cf = useQuery({ queryKey: ['client', clientId, 'cashflow', from, to], queryFn: () => fetchCashFlow(clientId, from, to) })
  const d = cf.data
  const groups = Object.entries(d?.groups ?? {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Rrjedha e parasë</h2>
      {!d ? (
        <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-ctl bg-[#F4F6F3] p-3">
              <div className="text-xs text-muted">Në fillim</div>
              <div className="font-semibold tabular-nums">{formatEUR(d.opening)}</div>
            </div>
            <div className="rounded-ctl bg-[#F4F6F3] p-3">
              <div className="text-xs text-muted">Ndryshimi</div>
              <div className={cn('font-semibold tabular-nums', d.closing - d.opening < 0 && 'text-warn-700')}>{formatEUR(d.closing - d.opening)}</div>
            </div>
            <div className="rounded-ctl bg-[#F4F6F3] p-3">
              <div className="text-xs text-muted">Në fund</div>
              <div className="font-semibold tabular-nums">{formatEUR(d.closing)}</div>
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-1.5 text-sm">
            {groups.map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span className="text-muted">{TX_LABELS[k as TxCategory] ?? (k === 'customers' ? 'Arkëtime nga klientët' : k === 'suppliers' ? 'Pagesa furnitorëve' : k)}</span>
                <span className={cn('tabular-nums', v < 0 ? 'text-ink' : 'text-brand-600')}>{formatEUR(v)}</span>
              </li>
            ))}
            {!groups.length && <li className="text-muted">Asnjë lëvizje në periudhë.</li>}
          </ul>
          {d.months.length > 1 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Muaji</th>
                  <th className="text-right">Hyrje</th>
                  <th className="text-right">Dalje</th>
                  <th className="text-right">Neto</th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.month} className="border-t border-line">
                    <td className="py-1.5">{monthLabel(m.month)}</td>
                    <td className="text-right tabular-nums">{formatEUR(m.in)}</td>
                    <td className="text-right tabular-nums">{formatEUR(m.out)}</td>
                    <td className="text-right font-medium tabular-nums">{formatEUR(m.in - m.out)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  )
}

function LoansCard({ clientId, accounts, onChanged }: { clientId: string; accounts: MoneyAccount[]; onChanged: () => void }) {
  const loans = useQuery({ queryKey: ['client', clientId, 'loans'], queryFn: () => fetchLoans(clientId) })
  const [edit, setEdit] = useState<Partial<Loan> | null>(null)
  const [plan, setPlan] = useState<Loan | null>(null)
  const del = useMutation({ mutationFn: deleteLoan, onSuccess: () => void loans.refetch() })
  const save = useMutation({
    mutationFn: () => saveLoan(clientId, edit!),
    onSuccess: () => {
      setEdit(null)
      void loans.refetch()
      onChanged()
    },
  })
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">Kreditë dhe këstet</h2>
        <Button size="sm" variant="secondary" onClick={() => setEdit({ lender: '', principal: 0, rate_pct: 0, months: 12, start_date: kosovoDateISO(), account_id: accounts.find((a) => a.kind === 'bank')?.id ?? null })}>
          <Plus className="h-4 w-4" /> Kredi
        </Button>
      </div>
      {!loans.data?.length ? (
        <p className="mt-3 text-sm text-muted">Asnjë kredi. Kur shton një kredi, shuma e marrë hyn në llogari; këstet i regjistron si "Dalje → Kredi".</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {loans.data.map((l) => {
            const pct = Math.min(100, Math.round((l.repaid / l.principal) * 100))
            return (
              <li key={l.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="text-left font-semibold text-brand-600 hover:underline" onClick={() => setPlan(l)}>
                    {l.lender} · {formatEUR(l.principal)}
                  </button>
                  <button type="button" aria-label="Fshi kredinë" onClick={() => del.mutate(l.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-warn-100 hover:text-warn-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-sm text-muted">
                  {l.rate_pct}% · {l.months} muaj nga {formatDay(l.start_date)} · paguar {formatEUR(l.repaid)} ({pct}%)
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#E9EEEA]">
                  <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title="Kredi e re"
        width="md:max-w-[520px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Anulo
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Ruaj
            </Button>
          </div>
        }
      >
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input label="Banka / huadhënësi" value={edit.lender ?? ''} onChange={(e) => setEdit({ ...edit, lender: e.target.value })} />
            </div>
            <Input label="Shuma (€)" inputMode="decimal" value={edit.principal ? String(edit.principal) : ''} onChange={(e) => setEdit({ ...edit, principal: Number(e.target.value.replace(',', '.')) || 0 })} />
            <Input label="Interesi vjetor (%)" inputMode="decimal" value={edit.rate_pct ? String(edit.rate_pct) : ''} onChange={(e) => setEdit({ ...edit, rate_pct: Number(e.target.value.replace(',', '.')) || 0 })} />
            <Input label="Muaj" inputMode="numeric" value={String(edit.months ?? '')} onChange={(e) => setEdit({ ...edit, months: Number(e.target.value) || 0 })} />
            <Input label="Data" type="date" value={edit.start_date ?? ''} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} />
            <div className="sm:col-span-2">
              <Select label="Paratë hyjnë në" value={edit.account_id ?? ''} onChange={(e) => setEdit({ ...edit, account_id: e.target.value || null })} options={[{ value: '', label: '— mos e regjistro hyrjen —' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
            </div>
            {edit.principal && edit.months ? (
              <p className="text-sm text-muted sm:col-span-2">Kësti mujor afërsisht {formatEUR(loanSchedule({ principal: edit.principal, rate_pct: edit.rate_pct ?? 0, months: edit.months, start_date: edit.start_date ?? kosovoDateISO() })[0]?.payment ?? 0)}</p>
            ) : null}
          </div>
        )}
        {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
      </Dialog>

      <Dialog open={Boolean(plan)} onClose={() => setPlan(null)} title={`Plani i kësteve – ${plan?.lender ?? ''}`} width="md:max-w-[640px]">
        {plan && (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-muted">
                <tr>
                  <th className="py-1.5">#</th>
                  <th>Data</th>
                  <th className="text-right">Kësti</th>
                  <th className="text-right">Kryegjëja</th>
                  <th className="text-right">Interesi</th>
                  <th className="text-right">Mbetet</th>
                </tr>
              </thead>
              <tbody>
                {loanSchedule(plan).map((r) => (
                  <tr key={r.no} className="border-t border-line">
                    <td className="py-1.5">{r.no}</td>
                    <td>{formatDay(r.date)}</td>
                    <td className="text-right tabular-nums">{formatEUR(r.payment)}</td>
                    <td className="text-right tabular-nums">{formatEUR(r.principal)}</td>
                    <td className="text-right tabular-nums">{formatEUR(r.interest)}</td>
                    <td className="text-right tabular-nums">{formatEUR(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Dialog>
    </Card>
  )
}
