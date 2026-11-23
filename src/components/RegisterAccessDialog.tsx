import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { Badge, Button, Dialog } from '@/components/ui'
import { cn } from '@/lib/cn'
import { fetchRegisterAccess, openRegisterAccess, setRegisterAccess } from '@/lib/registerAccess'

/**
 * The workers of a till: each one has access or not. Several workers may share one till, each with their own PIN,
 * so every coupon shows who issued it; the business pays per till, not per worker.
 */
export function RegisterAccessDialog({ registerId, onClose }: { registerId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const access = useQuery({ queryKey: ['register-access', registerId], queryFn: () => fetchRegisterAccess(registerId!), enabled: Boolean(registerId) })
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['register-access', registerId] })
    void qc.invalidateQueries({ queryKey: ['platform-tills'] })
  }
  const toggle = useMutation({ mutationFn: (p: { id: string; allowed: boolean }) => setRegisterAccess(registerId!, p.id, p.allowed), onSuccess: done })
  const open = useMutation({ mutationFn: () => openRegisterAccess(registerId!), onSuccess: done })
  const a = access.data
  const allowed = a?.workers.filter((w) => w.allowed).length ?? 0

  return (
    <Dialog
      open={Boolean(registerId)}
      onClose={onClose}
      title={a ? `Punëtorët e arkës: ${a.register.name}` : 'Punëtorët e arkës'}
      subtitle={a?.register.unit ? `Njësia: ${a.register.unit}` : undefined}
      width="md:max-w-[520px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {a?.restricted ? (
            <Button variant="ghost" loading={open.isPending} onClick={() => open.mutate()}>
              Lejo të gjithë punëtorët
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>Mbyll</Button>
        </div>
      }
    >
      {access.isLoading ? (
        <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
      ) : access.error ? (
        <p className="text-sm text-warn-700">{(access.error as Error).message}</p>
      ) : a ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-ctl bg-bg px-4 py-3 text-sm text-muted">
            {a.restricted
              ? `${allowed} nga ${a.workers.length} punëtorë kanë qasje. Vetëm ata dalin te hyrja me PIN në pajisjen e kësaj arke.`
              : 'Të gjithë punëtorët kanë qasje. Hiq qasjen e atyre që nuk punojnë në këtë arkë.'}{' '}
            Pronari dhe menaxherët hyjnë në çdo arkë.
          </p>
          {a.workers.length === 0 ? (
            <p className="py-4 text-center text-muted">Biznesi nuk ka ende punëtorë. Shtoji te Cilësimet → Përdoruesit.</p>
          ) : (
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {a.workers.map((w) => {
                const busy = toggle.isPending && toggle.variables?.id === w.id
                return (
                  <li key={w.id}>
                    <label className={cn('flex min-h-[52px] cursor-pointer items-center gap-3 px-4 py-2', busy && 'opacity-60')}>
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-brand-600"
                        checked={w.allowed}
                        disabled={toggle.isPending || open.isPending}
                        onChange={(e) => toggle.mutate({ id: w.id, allowed: e.target.checked })}
                      />
                      <Users className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{w.full_name}</span>
                        {w.worker_no != null && <span className="ml-1.5 text-sm text-muted tabular-nums">ID {String(w.worker_no).padStart(3, '0')}</span>}
                      </span>
                      {!w.has_pin && <Badge tone="amber">Pa PIN</Badge>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {(toggle.error || open.error) && <p className="text-sm text-warn-700">{((toggle.error ?? open.error) as Error).message}</p>}
        </div>
      ) : null}
    </Dialog>
  )
}
