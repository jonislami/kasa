import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Search } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { PageHeader, Shell } from '@/app/layout/AppLayout'
import type { NavItem } from '@/app/nav'
import { LogoMark } from '@/components/Logo'
import { Badge, Button, Card, Dialog, EmptyState, StatCard, Table, Td, Th } from '@/components/ui'
import { BUSINESS_TYPE_LIST, businessType, type BusinessType } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { fetchPlatformBusinesses, generatePassword, resetOwnerPassword, setBusinessActive, type PlatformBusiness } from './api'
import { CredentialsDialog, type Credentials } from './CredentialsDialog'
import { NewBusinessDialog } from './NewBusinessDialog'

const PAGE_SIZE = 10
const platformNav: NavItem[] = [{ to: '/platforma', label: 'Bizneset', icon: Building2 }]

type Confirm = { kind: 'password' | 'toggle'; business: PlatformBusiness } | null

function StatusBadge({ b }: { b: PlatformBusiness }) {
  if (!b.active) return <Badge tone="warn">Çaktivizuar</Badge>
  if (!b.has_logged_in) return <Badge tone="amber">Pa hyrë ende</Badge>
  return <Badge tone="success">Aktiv</Badge>
}

export function PlatformPage() {
  const { ctx, session } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<BusinessType | 'all'>('all')
  const [page, setPage] = useState(0)
  const [newOpen, setNewOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['platform-businesses'], queryFn: fetchPlatformBusinesses })
  const all = list.data ?? []

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length }
    for (const b of all) c[b.type] = (c[b.type] ?? 0) + 1
    return c
  }, [all])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(
      (b) =>
        (filter === 'all' || b.type === filter) &&
        (!q || [b.name, b.owner_name, b.owner_email, b.city].some((v) => v?.toLowerCase().includes(q))),
    )
  }, [all, filter, search])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  const stats = {
    active: all.filter((b) => b.active).length,
    users: all.reduce((s, b) => s + b.users_count, 0),
    sales: all.reduce((s, b) => s + b.sales_today, 0),
    pending: all.filter((b) => b.active && !b.has_logged_in).length,
    inactive: all.filter((b) => !b.active).length,
  }

  const toggle = useMutation({
    mutationFn: (b: PlatformBusiness) => setBusinessActive(b.id, !b.active),
    onSuccess: () => {
      setConfirm(null)
      void qc.invalidateQueries({ queryKey: ['platform-businesses'] })
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const reset = useMutation({
    mutationFn: async (b: PlatformBusiness) => {
      const password = generatePassword()
      const res = await resetOwnerPassword(b.id, password)
      return { b, password, email: res.email }
    },
    onSuccess: ({ b, password, email }) => {
      setConfirm(null)
      setCredentials({ title: `Fjalëkalim i ri për ${b.name}`, ownerName: b.owner_name ?? 'pronari', email, password })
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const adminName = (session?.user.user_metadata?.full_name as string | undefined) ?? session?.user.email ?? 'Admin'

  return (
    <Shell
      brand={
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <div className="text-[16px] font-bold leading-tight">Kasa</div>
            <div className="text-xs font-semibold text-brand-400">Platforma · Admin</div>
          </div>
        </div>
      }
      main={platformNav}
      bottom={[]}
      userName={adminName}
      userSub={ctx?.profile ? 'Admin + biznes' : 'Administrator'}
    >
      <PageHeader
        eyebrow="Të gjitha bizneset që përdorin Kasa"
        title="Bizneset"
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> Biznes i ri
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-4">
        <StatCard label="Biznese aktive" value={stats.active} />
        <StatCard label="Përdorues gjithsej" value={stats.users} />
        <StatCard label="Shitjet sot (të gjitha)" value={formatEUR(stats.sales)} />
        <StatCard label="Në pritje / të çaktivizuara" value={`${stats.pending} / ${stats.inactive}`} />
      </div>

      <div className="px-4 pb-8 md:px-8 md:py-5">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
            <div className="relative lg:w-[420px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(0)
                }}
                placeholder="Kërko sipas emrit, pronarit ose email-it"
                className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
              {[{ code: 'all' as const, shortLabel: 'Të gjitha' }, ...BUSINESS_TYPE_LIST].map((t) => (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => {
                    setFilter(t.code)
                    setPage(0)
                  }}
                  className={cn(
                    'flex h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium',
                    filter === t.code ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-bg',
                  )}
                >
                  {t.code === 'restaurant' ? 'Kafiterie / Restorant' : t.shortLabel}
                  <span className={cn('text-xs', filter === t.code ? 'text-white/70' : 'text-muted')}>{counts[t.code] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          {actionError && (
            <div className="border-b border-line bg-warn-100 px-5 py-3 text-sm text-warn-700">
              {actionError}{' '}
              <button className="ml-2 font-semibold underline" onClick={() => setActionError(null)}>
                Mbyll
              </button>
            </div>
          )}

          {list.isLoading ? (
            <div className="px-6 py-12 text-center text-muted">Duke ngarkuar…</div>
          ) : list.isError ? (
            <EmptyState title="Bizneset nuk u ngarkuan" text={(list.error as Error).message} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-6 w-6" />}
              title={all.length === 0 ? 'Ende pa biznese' : 'Asnjë biznes nuk përputhet'}
              text={all.length === 0 ? 'Krijo biznesin e parë me butonin "Biznes i ri".' : undefined}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <thead className="bg-[#F8FAF8]">
                    <tr>
                      <Th className="pl-4">Biznesi</Th>
                      <Th>Lloji</Th>
                      <Th>Pronari · email i hyrjes</Th>
                      <Th className="text-right">Përdorues</Th>
                      <Th className="text-right">Shitjet sot</Th>
                      <Th>Statusi</Th>
                      <Th>Veprimet</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => {
                      const Icon = businessType(b.type).icon
                      return (
                        <tr key={b.id} className={cn(!b.active && 'text-muted')}>
                          <Td className="pl-4">
                            <div className="flex items-center gap-3">
                              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', b.active ? 'bg-brand-100 text-brand-600' : 'bg-bg text-muted')}>
                                <Icon className="h-[18px] w-[18px]" />
                              </div>
                              <div>
                                <div className="font-semibold text-ink">{b.name}</div>
                                <div className="text-xs text-muted">
                                  {[b.city, `${b.registers_count} ${b.registers_count === 1 ? 'arkë' : 'arka'}`].filter(Boolean).join(' · ')}
                                </div>
                              </div>
                            </div>
                          </Td>
                          <Td>{businessType(b.type).shortLabel}</Td>
                          <Td>
                            <div className="text-ink">{b.owner_name ?? '—'}</div>
                            <div className="text-xs text-muted">{b.owner_email}</div>
                          </Td>
                          <Td className="text-right">{b.users_count}</Td>
                          <Td className="text-right font-semibold">{b.sales_today > 0 ? formatEUR(b.sales_today) : '—'}</Td>
                          <Td>
                            <StatusBadge b={b} />
                          </Td>
                          <Td>
                            <div className="flex gap-2">
                              <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'password', business: b })}>
                                Fjalëkalim i ri
                              </Button>
                              {b.active ? (
                                <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'toggle', business: b })}>
                                  Çaktivizo
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="border-brand-600/40 text-brand-600"
                                  onClick={() => setConfirm({ kind: 'toggle', business: b })}
                                >
                                  Aktivizo
                                </Button>
                              )}
                            </div>
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>

              {/* Phone cards */}
              <ul className="divide-y divide-line md:hidden">
                {rows.map((b) => (
                  <li key={b.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{b.name}</div>
                        <div className="text-sm text-muted">
                          {businessType(b.type).shortLabel}
                          {b.city ? ` · ${b.city}` : ''}
                        </div>
                        <div className="mt-1 truncate text-sm">{b.owner_email}</div>
                      </div>
                      <StatusBadge b={b} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button variant="secondary" onClick={() => setConfirm({ kind: 'password', business: b })}>
                        Fjalëkalim i ri
                      </Button>
                      <Button variant={b.active ? 'danger' : 'secondary'} onClick={() => setConfirm({ kind: 'toggle', business: b })}>
                        {b.active ? 'Çaktivizo' : 'Aktivizo'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
                <span>
                  Duke shfaqur {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + rows.length} nga {filtered.length}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
                    ‹ Para
                  </Button>
                  <Button size="sm" variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                    Pas ›
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <NewBusinessDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(c) => {
          setNewOpen(false)
          setCredentials(c)
          void qc.invalidateQueries({ queryKey: ['platform-businesses'] })
        }}
      />
      <CredentialsDialog data={credentials} onClose={() => setCredentials(null)} />

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        width="md:max-w-[460px]"
        title={
          confirm?.kind === 'password'
            ? 'Fjalëkalim i ri?'
            : confirm?.business.active
              ? `Çaktivizo ${confirm?.business.name}?`
              : `Aktivizo ${confirm?.business.name}?`
        }
        footer={
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Anulo
            </Button>
            {confirm?.kind === 'password' ? (
              <Button loading={reset.isPending} onClick={() => confirm && reset.mutate(confirm.business)}>
                Krijo fjalëkalimin
              </Button>
            ) : (
              <Button
                variant={confirm?.business.active ? 'danger' : 'primary'}
                loading={toggle.isPending}
                onClick={() => confirm && toggle.mutate(confirm.business)}
              >
                {confirm?.business.active ? 'Çaktivizo' : 'Aktivizo'}
              </Button>
            )}
          </div>
        }
      >
        <p className="text-[15px] text-muted">
          {confirm?.kind === 'password'
            ? `Fjalëkalimi i vjetër i pronarit (${confirm.business.owner_email}) nuk do të punojë më. Fjalëkalimi i ri shfaqet vetëm një herë.`
            : confirm?.business.active
              ? 'Askush nga ky biznes nuk mund të hyjë derisa ta aktivizosh përsëri. Të dhënat ruhen.'
              : 'Përdoruesit e këtij biznesi mund të hyjnë përsëri.'}
        </p>
      </Dialog>
    </Shell>
  )
}
