import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Monitor, Plus, Smartphone } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { device } from '@/lib/device'
import { fetchPeople } from '@/features/stock/api'
import { fetchDevices, fetchRegisters, saveRegister, SettingsNotMigrated, updateDevice, type DeviceRow, type Register } from './api'

const dtFmt = new Intl.DateTimeFormat('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function seen(iso: string): { text: string; online: boolean } {
  const min = (Date.now() - new Date(iso).getTime()) / 60000
  if (min < 5) return { text: 'tani', online: true }
  if (min < 60) return { text: `para ${Math.round(min)} min`, online: false }
  return { text: dtFmt.format(new Date(iso)), online: false }
}

export function RegistersSection() {
  const qc = useQueryClient()
  const registers = useQuery({ queryKey: ['registers'], queryFn: fetchRegisters })
  const devices = useQuery({ queryKey: ['devices'], queryFn: fetchDevices })
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, staleTime: 5 * 60_000 })
  const thisDevice = useQuery({ queryKey: ['this-device-id'], queryFn: () => device.getDeviceId(), staleTime: Infinity })
  const [editReg, setEditReg] = useState<Register | 'new' | null>(null)
  const [editDev, setEditDev] = useState<DeviceRow | null>(null)
  const regName = new Map((registers.data ?? []).map((r) => [r.id, r.name]))

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="text-[17px] font-semibold">Arkat</h2>
            <p className="text-sm text-muted">Çdo arkë merr më vonë POS ID nga ATK (Faza 9).</p>
          </div>
          <Button size="sm" onClick={() => setEditReg('new')}>
            <Plus className="h-4 w-4" /> Arkë e re
          </Button>
        </div>
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {(registers.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-sm text-muted">
                  {(devices.data ?? []).filter((d) => d.register_id === r.id && d.active).length} pajisje · POS ID: {r.atk_pos_id ?? '—'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!r.active && <Badge tone="warn">Joaktive</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setEditReg(r)}>
                  Ndrysho
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-[17px] font-semibold">Pajisjet e lidhura</h2>
          <p className="text-sm text-muted">Një pajisje lidhet kur pronari ose menaxheri hyn në të me email. Në to punëtorët hyjnë me PIN.</p>
        </div>
        {devices.error instanceof SettingsNotMigrated ? (
          <EmptyState title="Pajisjet aktivizohen pas migrimit 0005" />
        ) : (devices.data ?? []).length === 0 ? (
          <EmptyState title="Ende asnjë pajisje" text="Kjo pajisje lidhet automatikisht pas hyrjes së parë me email." />
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {(devices.data ?? []).map((d) => {
              const s = seen(d.last_seen_at)
              const Icon = d.platform === 'capacitor' || /Android|iPhone/.test(d.user_agent ?? '') ? Smartphone : Monitor
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Icon className="h-5 w-5 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      {d.name}
                      {d.id === thisDevice.data && <Badge tone="info">Kjo pajisje</Badge>}
                      {!d.active && <Badge tone="warn">E bllokuar</Badge>}
                    </div>
                    <div className="text-sm text-muted">
                      {[d.register_id ? regName.get(d.register_id) : 'pa arkë', d.app_version ? `v${d.app_version}` : null, `parë ${s.text}`, d.last_user_id ? people.data?.get(d.last_user_id) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${s.online && d.active ? 'bg-brand-400' : 'bg-field'}`} />
                  <Button size="sm" variant="secondary" onClick={() => setEditDev(d)}>
                    Ndrysho
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <RegisterDialog reg={editReg} onClose={() => setEditReg(null)} onSaved={() => { setEditReg(null); void qc.invalidateQueries({ queryKey: ['registers'] }) }} />
      <DeviceDialog dev={editDev} registers={registers.data ?? []} onClose={() => setEditDev(null)} onSaved={() => { setEditDev(null); void qc.invalidateQueries({ queryKey: ['devices'] }) }} />
    </div>
  )
}

function RegisterDialog({ reg, onClose, onSaved }: { reg: Register | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const r = reg === 'new' ? null : reg
  useEffect(() => {
    setName(r?.name ?? '')
    setError(null)
  }, [reg, r?.name])
  const save = useMutation({ mutationFn: (active?: boolean) => saveRegister({ id: r?.id, name, active }), onSuccess: onSaved, onError: (e: Error) => setError(e.message) })
  return (
    <Dialog
      open={reg !== null}
      onClose={onClose}
      title={r ? 'Ndrysho arkën' : 'Arkë e re'}
      width="md:max-w-[420px]"
      footer={
        <div className="flex justify-end gap-2.5">
          {r && (
            <Button variant={r.active ? 'danger' : 'secondary'} className="mr-auto" onClick={() => save.mutate(!r.active)}>
              {r.active ? 'Çaktivizo' : 'Aktivizo'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Ruaj
          </Button>
        </div>
      }
    >
      <Input label="Emri" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="p.sh. Arka 2" />
      {error && <p className="mt-3 text-sm text-warn-700">{error}</p>}
    </Dialog>
  )
}

function DeviceDialog({ dev, registers, onClose, onSaved }: { dev: DeviceRow | null; registers: Register[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [reg, setReg] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setName(dev?.name ?? '')
    setReg(dev?.register_id ?? '')
    setError(null)
  }, [dev])
  const save = useMutation({
    mutationFn: (active?: boolean) => updateDevice({ device_id: dev!.id, name, register_id: reg || null, ...(active === undefined ? {} : { active }) }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog
      open={Boolean(dev)}
      onClose={onClose}
      title="Pajisja"
      subtitle={dev?.user_agent ?? undefined}
      width="md:max-w-[460px]"
      footer={
        <div className="flex flex-wrap justify-end gap-2.5">
          {dev && (
            <Button variant={dev.active ? 'danger' : 'secondary'} className="mr-auto" onClick={() => save.mutate(!dev.active)}>
              {dev.active ? 'Blloko' : 'Zhblloko'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Emri" value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Arka" value={reg} onChange={(e) => setReg(e.target.value)} options={[{ value: '', label: '— Pa arkë —' }, ...registers.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))]} />
        <p className="text-sm text-muted">Pajisja e bllokuar nuk lejon më hyrje me PIN. Për ta lidhur përsëri, menaxheri hyn në të me email.</p>
        {error && <p className="text-sm text-warn-700">{error}</p>}
      </div>
    </Dialog>
  )
}
