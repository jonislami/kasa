import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MonitorSmartphone, Plus, Trash2, Users } from 'lucide-react'
import { Badge, Button, Card, Dialog } from '@/components/ui'
import { RegisterAccessDialog } from '@/components/RegisterAccessDialog'
import { addPlatformRegister, fetchPlatformTills, removePlatformRegister } from './onboardingApi'

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
  // remove a till: deleted when it never sold, deactivated when it has coupons (they stay); the licence follows
  const [removing, setRemoving] = useState<{ id: string; name: string; devices: number } | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => removePlatformRegister(id),
    onSuccess: (result) => {
      setRemoved(result === 'deleted' ? `"${removing?.name}" u hoq.` : `"${removing?.name}" ka kuponë, prandaj u çaktivizua (kuponët mbeten).`)
      setRemoving(null)
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
                      <Button size="sm" variant="danger" aria-label={`Hiq ${r.name}`} onClick={() => setRemoving({ id: r.id, name: r.name, devices: r.devices })}>
                        <Trash2 className="h-4 w-4" /> Hiq
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
      {removed && <p className="mt-2 rounded-ctl bg-brand-100 px-4 py-2.5 text-sm text-brand-600">{removed}</p>}
      <Dialog
        open={Boolean(removing)}
        onClose={() => !remove.isPending && setRemoving(null)}
        title={`Ta heq arkën "${removing?.name ?? ''}"?`}
        width="md:max-w-[460px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={remove.isPending} onClick={() => setRemoving(null)}>
              Anulo
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              <Trash2 className="h-4 w-4" /> Hiq arkën
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2 text-[15px]">
          <p>Arka që s'ka shitur kurrë fshihet. Arka me kuponë çaktivizohet: kuponët e saj mbeten (ATK i kërkon 10 vjet).</p>
          {removing && removing.devices > 0 && (
            <p className="rounded-ctl bg-amber-100 px-3 py-2 text-sm text-amber-700">
              {removing.devices} pajisje mbeten pa arkë: nuk shesin derisa t'u caktohet një arkë tjetër.
            </p>
          )}
          <p className="text-sm text-muted">Licenca ulet te numri i arkave aktive. Çelësat e papërdorur të kësaj arke anulohen.</p>
          {remove.error && <p className="rounded-ctl bg-warn-100 px-3 py-2 text-sm text-warn-700">{(remove.error as Error).message}</p>}
        </div>
      </Dialog>
      <RegisterAccessDialog registerId={access} onClose={() => setAccess(null)} />
    </Card>
  )
}
