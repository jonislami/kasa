import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, MonitorSmartphone, Plus } from 'lucide-react'
import { Badge, Button, Card, Dialog, Input, Select } from '@/components/ui'
import { useBusinessUnits } from '@/lib/businessUnits'
import { formatKosovoDateTime } from '@/lib/clock'
import { APP_STATUS, fetchOnboarding, fetchOwnerRegisters, OwnerKeysNotMigrated, submitRegisterApplication } from './api'

const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')

/**
 * The owner's tills and the device linked to each. The activation key of a device is made by the KontoSef
 * administrator only (0054); an extra till is asked for here.
 */
export function TillKeysCard({ className }: { className?: string }) {
  const qc = useQueryClient()
  const regs = useQuery({ queryKey: ['owner-registers'], queryFn: fetchOwnerRegisters, retry: false })
  // an extra till is asked for (in a unit) and activated by the KontoSef administrator: it is paid per till
  const [asking, setAsking] = useState(false)
  const onboarding = useQuery({ queryKey: ['onboarding'], queryFn: fetchOnboarding, staleTime: 30_000 })
  const asked = (onboarding.data?.register_applications ?? []).filter((a) => a.status === 'pending' || a.status === 'needs_info')

  if (regs.error instanceof OwnerKeysNotMigrated) return null
  const list = regs.data?.registers ?? []

  return (
    <Card className={className ?? 'p-5 md:p-6'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[19px] font-semibold tracking-[-0.015em]">Arkat dhe çelësat</h2>
            <p className="text-sm text-muted">Instalo KontoSef në pajisjen e arkës dhe shkruaj çelësin e aktivizimit që ta jep administratori i KontoSef. Një çelës vlen për një pajisje.</p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setAsking(true)}>
          <Plus className="h-4 w-4" /> Kërko arkë shtesë
        </Button>
      </div>
      {regs.isLoading ? (
        <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
      ) : regs.error ? (
        <p className="mt-3 text-sm text-warn-700">{(regs.error as Error).message}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <MonitorSmartphone className="h-5 w-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted">
                  {r.device
                    ? `${r.device}${r.device_seen ? ` · parë ${formatKosovoDateTime(r.device_seen)}` : ''}`
                    : r.key_hint
                      ? `Çelësi …${r.key_hint} pret të përdoret (deri ${day(r.key_expires)})`
                      : 'Ende pa pajisje'}
                </div>
              </div>
              {r.device ? <Badge tone="success">E lidhur</Badge> : <Badge tone="neutral">Pa pajisje</Badge>}
            </li>
          ))}
        </ul>
      )}
      {asked.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {asked.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-ctl bg-amber-100 px-4 py-2.5 text-sm text-amber-700">
              <span className="font-semibold">{a.name}</span>
              <Badge tone="amber">{APP_STATUS[a.status]}</Badge>
              {a.admin_note && <span>· {a.admin_note}</span>}
            </li>
          ))}
        </ul>
      )}
      <AskTillDialog
        open={asking}
        onClose={() => setAsking(false)}
        onSent={() => {
          setAsking(false)
          void qc.invalidateQueries({ queryKey: ['onboarding'] })
        }}
      />
    </Card>
  )
}

/** The owner asks for one more till in a unit; the administrator activates it and the licence grows by one till. */
function AskTillDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: () => void }) {
  const units = useBusinessUnits()
  const [unit, setUnit] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const many = (units.data?.length ?? 0) > 1
  const send = useMutation({
    mutationFn: () => {
      if (many && !unit) throw new Error('Zgjidh njësinë ku do të jetë arka')
      if (!name.trim()) throw new Error('Shkruaj emrin e arkës')
      return submitRegisterApplication({ name: name.trim(), unit_id: unit || units.data?.[0]?.id || null, note: note.trim() || null })
    },
    onSuccess: () => {
      setName('')
      setNote('')
      setUnit('')
      onSent()
    },
  })
  return (
    <Dialog
      open={open}
      onClose={() => !send.isPending && onClose()}
      title="Kërko arkë shtesë"
      subtitle="Administratori i KontoSef e aktivizon; pagesa është për çdo arkë të lidhur me ATK-në."
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={send.isPending} onClick={onClose}>
            Anulo
          </Button>
          <Button loading={send.isPending} onClick={() => send.mutate()}>
            Dërgo kërkesën
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {many && (
          <Select
            label="Njësia"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            options={[{ value: '', label: 'Zgjidh njësinë' }, ...(units.data ?? []).map((u) => ({ value: u.id, label: u.name }))]}
          />
        )}
        <Input label="Emri i arkës" value={name} onChange={(e) => setName(e.target.value)} placeholder="p.sh. Arka 002" />
        <Input label="Shënim (opsional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="p.sh. për banakun e dytë" />
        <p className="text-sm text-muted">Disa punëtorë mund të punojnë në të njëjtën arkë, secili me PIN-in e vet: për ta nuk kërkohet arkë e re.</p>
        {send.error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{(send.error as Error).message}</p>}
      </div>
    </Dialog>
  )
}
