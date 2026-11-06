import { useEffect, useState } from 'react'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { KOSOVO_TZ } from '@/lib/clock'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, Plus, UserRound } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Card, Dialog, EmptyState, Input, Tabs } from '@/components/ui'
import { businessType, hasModule, ROLE_LABELS } from '@/lib/business'
import { cn } from '@/lib/cn'
import { createUser, fetchUsers, setUserPassword, setUserPin, SettingsNotMigrated, updateUser, type BusinessUser } from './api'

const dtFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: KOSOVO_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const WEAK = new Set(['0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '4321'])

function pinError(pin: string, pin2: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'PIN-i duhet të ketë 4 shifra'
  if (WEAK.has(pin)) return 'Ky PIN është shumë i thjeshtë'
  if (pin !== pin2) return 'PIN-et nuk përputhen'
  return null
}

export function UsersSection() {
  const { business, profile } = useBusiness()
  const qc = useQueryClient()
  const info = businessType(business.type)
  const commission = hasModule(business.type, 'commission')
  const users = useQuery({ queryKey: ['business-users'], queryFn: fetchUsers })
  const [editing, setEditing] = useState<BusinessUser | 'new' | null>(null)
  const [pinFor, setPinFor] = useState<BusinessUser | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['business-users'] })

  if (users.error instanceof SettingsNotMigrated) {
    return (
      <Card>
        <EmptyState icon={<UserRound className="h-6 w-6" />} title="Përdoruesit nuk janë aktivizuar ende" text={(users.error as Error).message} />
      </Card>
    )
  }
  const list = (users.data ?? []).filter((u) => showInactive || u.active)
  const inactive = (users.data ?? []).filter((u) => !u.active).length

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[17px] font-semibold">Përdoruesit & PIN-et</h2>
          <p className="text-sm text-muted">{info.terms.worker}ët hyjnë me PIN në pajisjet e lidhura; menaxherët edhe me email.</p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Shto {info.terms.worker.toLowerCase()}
        </Button>
      </div>

      {loadState(users) === 'offline' ? (
              <OfflineEmpty />
            ) : loadState(users) === 'loading' ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : loadState(users) === 'error' ? (
        <p className="px-5 py-6 text-sm text-warn-700">{(users.error as Error).message}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {list.map((u) => (
            <li key={u.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3.5', !u.active && 'opacity-60')}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-600">
                {u.full_name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((s) => s[0]?.toUpperCase())
                  .join('')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.full_name}</span>
                  {u.id === profile.id && <Badge>Ti</Badge>}
                  <Badge tone={u.role === 'admin' ? 'info' : u.role === 'manager' ? 'success' : 'neutral'}>{u.role === 'worker' ? info.terms.worker : ROLE_LABELS[u.role]}</Badge>
                  {!u.active && <Badge tone="warn">Çaktivizuar</Badge>}
                  {u.pin_locked && (
                    <Badge tone="warn">
                      <Lock className="mr-1 h-3 w-3" /> PIN i bllokuar
                    </Badge>
                  )}
                </div>
                <div className="truncate text-sm text-muted">
                  {[
                    u.login_kind === 'pin' ? 'Vetëm PIN' : u.email,
                    u.has_pin ? 'ka PIN' : 'pa PIN',
                    commission && u.role !== 'admin' ? `komision ${u.commission_pct}%` : null,
                    u.last_pin_login_at ? `hyri ${dtFmt.format(new Date(u.last_pin_login_at))}` : u.last_sign_in_at ? `hyri ${dtFmt.format(new Date(u.last_sign_in_at))}` : 'ende pa hyrë',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="flex gap-2">
                {(u.can_manage || u.id === profile.id) && (
                  <Button size="sm" variant="secondary" onClick={() => setPinFor(u)}>
                    <KeyRound className="h-4 w-4" /> {u.has_pin ? 'PIN i ri' : 'Vendos PIN'}
                  </Button>
                )}
                {u.can_manage && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>
                    Ndrysho
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {inactive > 0 && (
        <button type="button" onClick={() => setShowInactive((v) => !v)} className="w-full border-t border-line px-5 py-3 text-left text-sm font-medium text-brand-600">
          {showInactive ? 'Fshih të çaktivizuarit' : `Shfaq të çaktivizuarit (${inactive})`}
        </button>
      )}

      <UserDialog
        open={editing !== null}
        user={editing === 'new' ? null : editing}
        workerTerm={info.terms.worker}
        commission={commission}
        isOwner={profile.role === 'admin'}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          refresh()
        }}
      />
      <PinDialog
        user={pinFor}
        onClose={() => setPinFor(null)}
        onSaved={() => {
          setPinFor(null)
          refresh()
          void qc.invalidateQueries({ queryKey: ['my-pin'] })
        }}
      />
    </Card>
  )
}

function UserDialog({
  open,
  user,
  workerTerm,
  commission,
  isOwner,
  onClose,
  onSaved,
}: {
  open: boolean
  user: BusinessUser | null
  workerTerm: string
  commission: boolean
  isOwner: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<'worker' | 'manager'>('worker')
  const [phone, setPhone] = useState('')
  const [pct, setPct] = useState('0')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [withEmail, setWithEmail] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(user?.full_name ?? '')
    setRole(user?.role === 'manager' ? 'manager' : 'worker')
    setPhone(user?.phone ?? '')
    setPct(String(user?.commission_pct ?? 0))
    setPin('')
    setPin2('')
    setWithEmail(false)
    setEmail('')
    setPassword('')
    setNewPassword('')
    setError(null)
  }, [open, user])

  const needsEmail = !user && (role === 'manager' || withEmail)

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Shkruaj emrin')
      const commissionPct = Number(pct.replace(',', '.')) || 0
      if (user) {
        await updateUser({ id: user.id, full_name: name, role, phone: phone || null, commission_pct: commissionPct })
        if (newPassword) await setUserPassword(user.id, newPassword)
        return
      }
      if (!needsEmail || pin) {
        const pe = pinError(pin, pin2)
        if (pe) throw new Error(pe)
      }
      if (needsEmail && password.length < 8) throw new Error('Fjalëkalimi duhet të ketë të paktën 8 shenja')
      await createUser({
        full_name: name,
        role,
        pin: pin || undefined,
        email: needsEmail ? email : undefined,
        password: needsEmail ? password : undefined,
        commission_pct: commissionPct,
        phone: phone || undefined,
      })
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  })

  const toggle = useMutation({
    mutationFn: () => updateUser({ id: user!.id, active: !user!.active }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? `Ndrysho: ${user.full_name}` : `${workerTerm} i ri`}
      width="md:max-w-[520px]"
      footer={
        <div className="flex flex-wrap justify-end gap-2.5">
          {user && (
            <Button variant={user.active ? 'danger' : 'secondary'} className="mr-auto" loading={toggle.isPending} onClick={() => toggle.mutate()}>
              {user.active ? 'Çaktivizo' : 'Aktivizo'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {user ? 'Ruaj' : 'Shto'}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Input label="Emri dhe mbiemri" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="p.sh. Liridona Krasniqi" />
        {isOwner && (
          <Tabs
            value={role}
            onChange={setRole}
            options={[
              { value: 'worker', label: workerTerm },
              { value: 'manager', label: 'Menaxher' },
            ]}
          />
        )}
        <p className="-mt-2 text-sm text-muted">
          {role === 'worker'
            ? `${workerTerm}i shet në arkë dhe sheh vetëm punën e vet. Nuk ndryshon produkte, çmime apo stok.`
            : 'Menaxheri sheh gjithçka të biznesit, miraton anulimet dhe lidh pajisjet e reja me email.'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Telefoni" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="044 …" />
          {commission && <Input label="Komisioni (%)" inputMode="decimal" type="number" min="0" max="100" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} />}
        </div>

        {!user && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input label={needsEmail ? 'PIN (opsional)' : 'PIN (4 shifra)'} type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              <Input label="Përsërit PIN-in" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
            </div>
            {role === 'worker' && (
              <label className="flex cursor-pointer items-center gap-3 text-[15px]">
                <input type="checkbox" checked={withEmail} onChange={(e) => setWithEmail(e.target.checked)} className="h-5 w-5 rounded accent-brand-600" />
                Hyn edhe me email (p.sh. nga telefoni i vet)
              </label>
            )}
            {needsEmail && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="emri@biznesi.com" />
                <Input label="Fjalëkalimi" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="Të paktën 8 shenja" />
              </div>
            )}
          </>
        )}
        {user && isOwner && user.login_kind === 'email' && (
          <Input label="Fjalëkalim i ri (opsional)" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} hint="Lëre bosh që të mbetet i njëjti" />
        )}
        {user?.login_kind === 'email' && <p className="text-sm text-muted">Email: {user.email}</p>}
        <button type="submit" className="hidden" />
      </form>
      {error && <p className="mt-4 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
    </Dialog>
  )
}

function PinDialog({ user, onClose, onSaved }: { user: BusinessUser | null; onClose: () => void; onSaved: () => void }) {
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setPin('')
    setPin2('')
    setError(null)
  }, [user])
  const save = useMutation({
    mutationFn: async () => {
      const pe = pinError(pin, pin2)
      if (pe) throw new Error(pe)
      await setUserPin(user!.id, pin)
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  })
  return (
    <Dialog
      open={Boolean(user)}
      onClose={onClose}
      title={`PIN për ${user?.full_name ?? ''}`}
      subtitle={user?.pin_locked ? 'PIN-i i ri e zhbllokon hyrjen.' : 'PIN-i i vjetër nuk vlen më.'}
      width="md:max-w-[420px]"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj PIN-in
          </Button>
        </div>
      }
    >
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Input label="PIN (4 shifra)" type="password" inputMode="numeric" maxLength={4} autoFocus autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <Input label="Përsërit" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
        <button type="submit" className="hidden" />
      </form>
      {error && <p className="mt-3 text-sm text-warn-700">{error}</p>}
    </Dialog>
  )
}
