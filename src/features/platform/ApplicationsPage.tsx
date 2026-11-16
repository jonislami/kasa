import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, EmptyState, StatCard } from '@/components/ui'
import { businessType } from '@/lib/business'
import { formatKosovoDateTime } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { LICENSE_LABELS, STATUS_LABELS, type BusinessStatus } from '@/features/onboarding/api'
import { decide, fetchOnboardingList, type OnboardingRow } from './onboardingApi'
import { PlatformShell } from './PlatformPage'

type Filter = 'waiting' | BusinessStatus | 'all'
const FILTERS: [Filter, string][] = [
  ['waiting', 'Presin vendim'],
  ['pending', 'Në shqyrtim'],
  ['needs_info', 'Kërkohen të dhëna'],
  ['active', 'Aktive'],
  ['suspended', 'Pezulluar'],
  ['rejected', 'Refuzuar'],
  ['all', 'Të gjitha'],
]

export const statusTone = (s: BusinessStatus) => (s === 'active' ? 'success' : s === 'rejected' || s === 'suspended' ? 'warn' : s === 'approved' ? 'info' : 'amber')
const licenseTone = (s: string) => (s === 'active' ? 'success' : s === 'expiring' || s === 'grace' ? 'amber' : 'warn')
const day = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')

/** /platforma/aplikimet – registrations of new businesses; the admin only approves (0036). */
export function ApplicationsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('waiting')
  const [q, setQ] = useState('')
  const qc = useQueryClient()
  const approve = useMutation({
    mutationFn: (id: string) => decide(id, 'approve'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-onboarding'] })
      void qc.invalidateQueries({ queryKey: ['platform-businesses'] })
    },
  })
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
        eyebrow="Regjistrimet e bizneseve të reja"
        title="Aplikimet"
      />
      <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-4">
        <StatCard label="Presin vendim" value={counts.waiting ?? 0} />
        <StatCard label="Në shqyrtim" value={counts.pending ?? 0} />
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
                <li key={r.id} className="flex items-center gap-2 pr-4 hover:bg-bg">
                  <button type="button" onClick={() => navigate(`/platforma/biznes/${r.id}`)} className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-5 py-3.5 text-left">
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
                  {(r.status === 'pending' || r.status === 'needs_info') && (
                    <Button size="sm" loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>
                      <Check className="h-4 w-4" /> Aprovo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {approve.error && <p className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700 shadow">{(approve.error as Error).message}</p>}
    </PlatformShell>
  )
}
