import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSignature } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { deleteContract, fetchContracts, saveContract, type Contract, type ContractRow } from './work'
import { downloadSheets } from './xls'

/** Service contracts and monthly fees of all clients, with what each owes the office (admins). */
export function ContractsPanel() {
  const contracts = useQuery({ queryKey: ['acc-contracts'], queryFn: fetchContracts })
  const [edit, setEdit] = useState<{ clientId: string; name: string; contract: Contract | null } | null>(null)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const rows = (contracts.data ?? []).filter((r) => r.client_active && (!onlyMissing || !r.contract))
  const monthly = (contracts.data ?? []).reduce((a, r) => a + (r.contract?.active ? r.contract.monthly_fee : 0), 0)
  const open = (contracts.data ?? []).reduce((a, r) => a + r.open, 0)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm text-muted">Tarifat mujore (aktive)</div>
          <div className="mt-1 text-[20px] font-bold tabular-nums">{formatEUR(monthly)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted">Klientët i detyrohen zyrës</div>
          <div className="mt-1 text-[20px] font-bold tabular-nums">{formatEUR(open)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted">Pa kontratë</div>
          <div className="mt-1 text-[20px] font-bold tabular-nums">{(contracts.data ?? []).filter((r) => r.client_active && !r.contract).length}</div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Vetëm klientët pa kontratë
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={!rows.length}
            onClick={() =>
              void downloadSheets('kontratat.xlsx', [
                {
                  name: 'Kontratat',
                  columns: ['Klienti', 'NUI', 'Shërbimet', 'Tarifa mujore', 'TVSH %', 'Nga', 'Deri', 'Aktive', 'Detyrimi', 'Me afat të kaluar'],
                  rows: rows.map((r) => [r.client_name, r.client_nui ?? '', r.contract?.services ?? '', r.contract?.monthly_fee ?? '', r.contract?.vat_rate ?? '', r.contract?.start_date ?? '', r.contract?.end_date ?? '', r.contract ? (r.contract.active ? 'Po' : 'Jo') : '', r.open, r.overdue]),
                },
              ])
            }
          >
            Excel
          </Button>
        </div>
        {contracts.isLoading ? (
          <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
        ) : contracts.error ? (
          <p className="p-5 text-sm text-warn-700">{(contracts.error as Error).message}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<FileSignature className="h-6 w-6" />} title="Asnjë klient" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r: ContractRow) => (
              <li key={r.client_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{r.client_name}</div>
                  <div className="truncate text-xs text-muted">
                    {r.contract
                      ? [r.contract.services, `nga ${formatDay(r.contract.start_date)}`, r.contract.end_date && `deri ${formatDay(r.contract.end_date)}`, `faturohet më ${r.contract.billing_day} të muajit`].filter(Boolean).join(' · ')
                      : 'Pa kontratë'}
                  </div>
                </div>
                {r.contract && (
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{formatEUR(r.contract.monthly_fee)}/muaj</div>
                    {r.open > 0 && <div className={cn('text-xs', r.overdue > 0 ? 'font-semibold text-warn-700' : 'text-muted')}>detyrim {formatEUR(r.open)}</div>}
                  </div>
                )}
                {r.contract && !r.contract.active && <Badge tone="neutral">Joaktive</Badge>}
                <Button size="sm" variant={r.contract ? 'secondary' : 'primary'} onClick={() => setEdit({ clientId: r.client_id, name: r.client_name, contract: r.contract })}>
                  {r.contract ? 'Ndrysho' : 'Shto kontratë'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ContractDialog value={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

export function ContractDialog({ value, onClose }: { value: { clientId: string; name: string; contract: Contract | null } | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ start_date: '', end_date: '', monthly_fee: '', vat_rate: 0, services: '', billing_day: 1, payment_days: 15, active: true, note: '' })
  useEffect(() => {
    if (!value) return
    const c = value.contract
    setF({
      start_date: c?.start_date ?? kosovoDateISO().slice(0, 8) + '01',
      end_date: c?.end_date ?? '',
      monthly_fee: c ? String(c.monthly_fee) : '',
      vat_rate: c?.vat_rate ?? 0,
      services: c?.services ?? 'Kontabiliteti mujor, deklarimi i TVSH-së dhe i pagave',
      billing_day: c?.billing_day ?? 1,
      payment_days: c?.payment_days ?? 15,
      active: c?.active ?? true,
      note: c?.note ?? '',
    })
  }, [value])
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['acc-contracts'] })
    void qc.invalidateQueries({ queryKey: ['acc-client-contract'] })
  }
  const save = useMutation({
    mutationFn: () =>
      saveContract({
        client_id: value!.clientId,
        start_date: f.start_date,
        end_date: f.end_date || null,
        monthly_fee: Number(f.monthly_fee.replace(',', '.')) || 0,
        vat_rate: f.vat_rate,
        services: f.services,
        billing_day: f.billing_day,
        payment_days: f.payment_days,
        active: f.active,
        note: f.note,
      }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })
  const del = useMutation({ mutationFn: () => deleteContract(value!.clientId), onSuccess: () => (refresh(), onClose()) })
  return (
    <Dialog
      open={Boolean(value)}
      onClose={onClose}
      title={`Kontrata – ${value?.name ?? ''}`}
      width="md:max-w-[600px]"
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {value?.contract && (
              <Button variant="secondary" loading={del.isPending} onClick={() => confirm('Ta fshij kontratën? Faturat e lëshuara mbeten.') && del.mutate()}>
                Fshi
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
        <div className="sm:col-span-2">
          <Input label="Shërbimet" value={f.services} onChange={(e) => setF({ ...f, services: e.target.value })} />
        </div>
        <Input label="Tarifa mujore me TVSH (€)" inputMode="decimal" value={f.monthly_fee} onChange={(e) => setF({ ...f, monthly_fee: e.target.value })} />
        <Select label="TVSH" value={String(f.vat_rate)} onChange={(e) => setF({ ...f, vat_rate: Number(e.target.value) })} options={[{ value: '0', label: 'Pa TVSH (0%)' }, { value: '18', label: '18%' }, { value: '8', label: '8%' }]} />
        <Input label="Nga data" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        <Input label="Deri (bosh = pa afat)" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        <Input label="Faturohet më (dita e muajit)" inputMode="numeric" value={String(f.billing_day)} onChange={(e) => setF({ ...f, billing_day: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} />
        <Input label="Afati i pagesës (ditë)" inputMode="numeric" value={String(f.payment_days)} onChange={(e) => setF({ ...f, payment_days: Math.min(120, Math.max(0, Number(e.target.value) || 0)) })} />
        <div className="sm:col-span-2">
          <Input label="Shënim" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktive (faturohet çdo muaj)
        </label>
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}
