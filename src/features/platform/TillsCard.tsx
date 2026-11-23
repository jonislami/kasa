import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MonitorSmartphone, Plus, Users } from 'lucide-react'
import { Badge, Button, Card } from '@/components/ui'
import { RegisterAccessDialog } from '@/components/RegisterAccessDialog'
import { addPlatformRegister, fetchPlatformTills } from './onboardingApi'

/**
 * The units of a business with their tills (0052). The business pays per till linked with ATK: approval makes one
 * till per unit, "Shto arkë" activates one more in that unit (the licence grows with it). "Punëtorët" sets who may
 * work on a till; several workers share one till, each with their own PIN.
 */
export function TillsCard({ businessId, onChanged }: { businessId: string; onChanged: () => void }) {
  const qc = useQueryClient()
  const tills = useQuery({ queryKey: ['platform-tills', businessId], queryFn: () => fetchPlatformTills(businessId) })
  const [access, setAccess] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: (unitId: string | null) => addPlatformRegister(businessId, unitId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-tills', businessId] })
      onChanged()
    },
  })
  const t = tills.data
  if (tills.isLoading) return null
  const active = (t?.registers ?? []).filter((r) => r.active)
  const groups: { id: string | null; name: string; pending?: boolean }[] = [
    ...(t?.units ?? []).filter((u) => u.status !== 'rejected').map((u) => ({ id: u.id, name: u.name, pending: u.status === 'pending' })),
    ...(active.some((r) => !r.unit_id || !(t?.units ?? []).some((u) => u.id === r.unit_id)) ? [{ id: null, name: 'Pa njësi' }] : []),
  ]
  if (!groups.length) groups.push({ id: null, name: 'Arkat' })

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Njësitë dhe arkat</h2>
        {t && (
          <span className="text-sm text-muted">
            {active.length} arka aktive · licenca për {t.max_devices}
          </span>
        )}
      </div>
      {tills.error && <p className="mt-2 text-sm text-warn-700">{(tills.error as Error).message}</p>}
      <div className="mt-3 flex flex-col gap-3">
        {groups.map((g) => {
          const regs = active.filter((r) => (g.id ? r.unit_id === g.id : !r.unit_id || !(t?.units ?? []).some((u) => u.id === r.unit_id)))
          return (
            <div key={g.id ?? 'none'} className="rounded-ctl border border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line bg-bg px-4 py-2">
                <span className="font-semibold">
                  {g.name} {g.pending && <Badge tone="amber">Pret miratim</Badge>}
                </span>
                {!g.pending && (
                  <Button size="sm" variant="secondary" loading={add.isPending && add.variables === g.id} onClick={() => add.mutate(g.id)}>
                    <Plus className="h-4 w-4" /> Shto arkë
                  </Button>
                )}
              </div>
              {regs.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">Pa arkë.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {regs.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <MonitorSmartphone className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted">
                          {r.devices} pajisje · {r.restricted ? `${r.workers} punëtorë me qasje` : 'të gjithë punëtorët'}
                        </div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => setAccess(r.id)}>
                        <Users className="h-4 w-4" /> Punëtorët
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {add.error && <p className="mt-2 text-sm text-warn-700">{(add.error as Error).message}</p>}
      <RegisterAccessDialog registerId={access} onClose={() => setAccess(null)} />
    </Card>
  )
}
