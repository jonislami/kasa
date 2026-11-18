import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, KeyRound, MonitorSmartphone, Plus } from 'lucide-react'
import { Badge, Button, Card, Dialog } from '@/components/ui'
import { formatKosovoDateTime } from '@/lib/clock'
import { addOwnerRegister, createOwnerKey, fetchOwnerRegisters, OwnerKeysNotMigrated, type OwnerRegister } from './api'

const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')

/**
 * The owner's tills with the activation key of each (0036): "Merr çelësin" shows a one-time key for the installed
 * program; a new key cancels the unused earlier one of that till.
 */
export function TillKeysCard({ className }: { className?: string }) {
  const qc = useQueryClient()
  const regs = useQuery({ queryKey: ['owner-registers'], queryFn: fetchOwnerRegisters, retry: false })
  const [shown, setShown] = useState<{ register: string; key: string; expires: string } | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['owner-registers'] })
  const key = useMutation({
    mutationFn: async (r: OwnerRegister) => ({ r, k: await createOwnerKey(r.id) }),
    onSuccess: ({ r, k }) => {
      setShown({ register: r.name, key: k.key, expires: k.expires_at })
      refresh()
    },
  })
  const add = useMutation({ mutationFn: () => addOwnerRegister(), onSuccess: refresh })

  if (regs.error instanceof OwnerKeysNotMigrated) return null
  const list = regs.data?.registers ?? []
  const canAdd = regs.data ? list.length < regs.data.max_devices : false

  return (
    <Card className={className ?? 'p-5 md:p-6'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[19px] font-semibold tracking-[-0.015em]">Arkat dhe çelësat</h2>
            <p className="text-sm text-muted">Instalo KontoSef në pajisjen e arkës dhe shkruaj çelësin njëherë. Një çelës vlen për një pajisje.</p>
          </div>
        </div>
        {canAdd && (
          <Button variant="secondary" loading={add.isPending} onClick={() => add.mutate()}>
            <Plus className="h-4 w-4" /> Shto arkë
          </Button>
        )}
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
              {r.device && <Badge tone="success">E lidhur</Badge>}
              <Button size="sm" variant={r.device ? 'secondary' : 'primary'} loading={key.isPending && key.variables?.id === r.id} onClick={() => key.mutate(r)}>
                <KeyRound className="h-4 w-4" /> {r.device || r.key_hint ? 'Çelës i ri' : 'Merr çelësin'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(key.error || add.error) && <p className="mt-3 text-sm text-warn-700">{((key.error || add.error) as Error).message}</p>}
      <KeyDialog data={shown} onClose={() => setShown(null)} />
    </Card>
  )
}

function KeyDialog({ data, onClose }: { data: { register: string; key: string; expires: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data!.key)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* the key stays on screen to copy by hand */
    }
  }
  return (
    <Dialog
      open={Boolean(data)}
      onClose={onClose}
      dismissable={false}
      title={`Çelësi për ${data?.register ?? ''}`}
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>Mbyll</Button>
        </div>
      }
    >
      <div className="flex items-center gap-2 rounded-xl border border-brand-600 bg-[#F2F6FC] py-2 pl-4 pr-2">
        <span className="min-w-0 flex-1 select-all break-all font-mono text-[22px] font-semibold tracking-[-0.015em] tracking-wide">{data?.key}</span>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="h-4 w-4 text-brand-600" /> : 'Kopjo'}
        </Button>
      </div>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-[15px]">
        <li>Shkarko dhe instalo KontoSef në pajisjen e arkës.</li>
        <li>Hape programin dhe shkruaj këtë çelës.</li>
        <li>Punëtorët hyjnë me PIN-in e tyre.</li>
      </ol>
      <p className="mt-4 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">
        Çelësi shfaqet vetëm tani dhe vlen deri më {day(data?.expires)}. Nëse humbet, merr një të ri – i vjetri nuk vlen më.
      </p>
    </Dialog>
  )
}
