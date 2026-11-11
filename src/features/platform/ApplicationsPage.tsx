import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Settings2 } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Input, StatCard } from '@/components/ui'
import { businessType } from '@/lib/business'
import { formatKosovoDateTime } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { LICENSE_LABELS, STATUS_LABELS, type BusinessStatus } from '@/features/onboarding/api'
import { fetchOnboardingList, fetchPlatformSettings, savePlatformSettings, type OnboardingRow } from './onboardingApi'
import { PlatformShell } from './PlatformPage'

type Filter = 'waiting' | BusinessStatus | 'all'
const FILTERS: [Filter, string][] = [
  ['waiting', 'Presin vendim'],
  ['pending', 'Në shqyrtim'],
  ['needs_info', 'Kërkohen të dhëna'],
  ['approved', 'Presin pagesën'],
  ['active', 'Aktive'],
  ['suspended', 'Pezulluar'],
  ['rejected', 'Refuzuar'],
  ['all', 'Të gjitha'],
]

export const statusTone = (s: BusinessStatus) => (s === 'active' ? 'success' : s === 'rejected' || s === 'suspended' ? 'warn' : s === 'approved' ? 'info' : 'amber')
const licenseTone = (s: string) => (s === 'active' ? 'success' : s === 'expiring' || s === 'grace' ? 'amber' : 'warn')
const day = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')

/** /platforma/aplikimet – registrations, payments and licenses of all businesses. */
export function ApplicationsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('waiting')
  const [q, setQ] = useState('')
  const [settings, setSettings] = useState(false)
  const all = useQuery({ queryKey: ['platform-onboarding', 'all'], queryFn: () => fetchOnboardingList(null) })
  const rows = all.data ?? []
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, waiting: rows.filter((r) => r.waiting).length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])
  const s = q.trim().toLowerCase()
  const list = rows.filter(
    (r) =>
      (filter === 'all' || (filter === 'waiting' ? r.waiting : r.status === filter)) &&
      (!s || [r.name, r.nui, r.owner_name, r.owner_email, r.city, r.phone].some((v) => v?.toLowerCase().includes(s))),
  )
  const expiring = rows.filter((r) => r.status === 'active' && ['expiring', 'grace', 'expired'].includes(r.license.state)).length

  return (
    <PlatformShell>
      <PageHeader
        eyebrow="Regjistrimet, pagesat dhe licencat"
        title="Aplikimet"
        actions={
          <Button variant="secondary" onClick={() => setSettings(true)}>
            <Settings2 className="h-4 w-4" /> Pagesa dhe çmimet
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-4">
        <StatCard label="Presin vendim" value={counts.waiting ?? 0} />
        <StatCard label="Presin pagesën" value={counts.approved ?? 0} />
        <StatCard label="Aktive" value={counts.active ?? 0} />
        <StatCard label="Licenca që skadojnë / kanë skaduar" value={expiring} />
      </div>
      <div className="px-4 pb-8 md:px-8 md:py-5">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
            <div className="relative lg:w-[380px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Kërko emrin, NUI, pronarin, telefonin…"
                className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
              {FILTERS.map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={cn('flex h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium', filter === k ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-bg')}
                >
                  {l}
                  <span className={cn('text-xs', filter === k ? 'text-white/70' : 'text-muted')}>{counts[k] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          {all.isLoading ? (
            <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
          ) : all.error ? (
            <p className="p-5 text-sm text-warn-700">{(all.error as Error).message}</p>
          ) : list.length === 0 ? (
            <EmptyState title={filter === 'waiting' ? 'Asgjë nuk pret vendim' : 'Asnjë biznes'} />
          ) : (
            <ul className="divide-y divide-line">
              {list.map((r: OnboardingRow) => (
                <li key={r.id}>
                  <button type="button" onClick={() => navigate(`/platforma/biznes/${r.id}`)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-bg">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        {r.name} <span className="font-normal text-muted">· {businessType(r.type).shortLabel}</span>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[r.nui && `NUI ${r.nui}`, r.city, r.owner_name, r.phone, r.owner_email, r.applied_at ? `regjistruar ${formatKosovoDateTime(r.applied_at)}` : 'krijuar nga admini'].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {r.register_pending > 0 && <Badge tone="amber">{r.register_pending} aplikim për arkë</Badge>}
                    {r.status === 'active' && (
                      <Badge tone={licenseTone(r.license.state)}>
                        {LICENSE_LABELS[r.license.state]}
                        {r.license.expires_on ? ` · ${day(r.license.expires_on)}` : ''}
                      </Badge>
                    )}
                    <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status]}</Badge>
                    <span className="hidden w-[90px] text-right text-sm text-muted md:inline">{r.devices} pajisje</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </PlatformShell>
  )
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const data = useQuery({ queryKey: ['platform-settings'], queryFn: fetchPlatformSettings, enabled: open })
  const [f, setF] = useState({ bank_name: '', iban: '', account_holder: '', monthly_price: '', yearly_price: '', payment_note: '', grace_days: '7' })
  useEffect(() => {
    const d = data.data
    if (d) setF({ bank_name: d.bank_name ?? '', iban: d.iban ?? '', account_holder: d.account_holder ?? '', monthly_price: String(d.monthly_price || ''), yearly_price: String(d.yearly_price || ''), payment_note: d.payment_note ?? '', grace_days: String(d.grace_days) })
  }, [data.data])
  const save = useMutation({
    mutationFn: () => savePlatformSettings({ ...f, monthly_price: f.monthly_price.replace(',', '.'), yearly_price: f.yearly_price.replace(',', '.') }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-settings'] })
      onClose()
    },
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pagesa dhe çmimet"
      subtitle="U shfaqen klientëve te paneli i tyre pas aprovimit"
      width="md:max-w-[560px]"
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
      {data.error ? (
        <p className="text-sm text-warn-700">{(data.error as Error).message}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Mbajtësi i llogarisë" value={f.account_holder} onChange={set('account_holder')} />
          <Input label="Banka" value={f.bank_name} onChange={set('bank_name')} />
          <div className="sm:col-span-2">
            <Input label="IBAN" value={f.iban} onChange={set('iban')} />
          </div>
          <Input label="Çmimi mujor (€)" inputMode="decimal" value={f.monthly_price} onChange={set('monthly_price')} />
          <Input label="Çmimi vjetor (€)" inputMode="decimal" value={f.yearly_price} onChange={set('yearly_price')} />
          <Input label="Ditët e tolerancës pas skadimit" inputMode="numeric" value={f.grace_days} onChange={set('grace_days')} />
          <div className="sm:col-span-2">
            <Input label="Shënim për pagesën" value={f.payment_note} onChange={set('payment_note')} placeholder="p.sh. Pagesa në kesh në zyrë: Rr. …, çdo ditë 9–17" />
          </div>
          <p className="text-xs text-muted sm:col-span-2">Për një biznes mund të vendosësh çmim tjetër te licenca e tij.</p>
        </div>
      )}
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}
