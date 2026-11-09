import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Input, StatCard, Table, Td, Th } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatKosovoDateTime } from '@/lib/clock'
import {
  createAccountant,
  fetchPlatformAccountants,
  generatePassword,
  KONTABILIST_ADDRESS,
  resetAccountantPassword,
  setAccountantActive,
  type PlatformAccountant,
} from './api'
import { CredentialsDialog, type Credentials } from './CredentialsDialog'
import { PlatformShell } from './PlatformPage'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Confirm = { kind: 'password' | 'toggle'; a: PlatformAccountant } | null

/** /platforma/kontabilistet – accounts for the separate "Kasa Kontabilist" program. */
export function AccountantsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['platform-accountants'], queryFn: fetchPlatformAccountants })
  const all = list.data ?? []
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((a) => !q || [a.full_name, a.email, a.office_name, a.phone].some((v) => v?.toLowerCase().includes(q)))
  }, [all, search])

  const toggle = useMutation({
    mutationFn: (a: PlatformAccountant) => setAccountantActive(a.user_id, !a.active),
    onSuccess: () => {
      setConfirm(null)
      void qc.invalidateQueries({ queryKey: ['platform-accountants'] })
    },
    onError: (e: Error) => setActionError(e.message),
  })
  const reset = useMutation({
    mutationFn: async (a: PlatformAccountant) => {
      const password = generatePassword()
      const res = await resetAccountantPassword(a.user_id, password)
      return { a, password, email: res.email }
    },
    onSuccess: ({ a, password, email }) => {
      setConfirm(null)
      setCredentials({ title: `Fjalëkalim i ri për ${a.full_name}`, ownerName: a.full_name, email, password, recipient: 'kontabilistit', address: KONTABILIST_ADDRESS })
    },
    onError: (e: Error) => setActionError(e.message),
  })

  return (
    <PlatformShell>
      <PageHeader
        eyebrow="Llogaritë për programin Kasa Kontabilist"
        title="Kontabilistët"
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> Kontabilist i ri
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 px-4 py-5 md:gap-4 md:px-8 md:py-0 lg:grid-cols-3">
        <StatCard label="Kontabilistë aktivë" value={all.filter((a) => a.active).length} />
        <StatCard label="Klientë gjithsej" value={all.reduce((s, a) => s + a.clients, 0)} />
        <StatCard label="Të lidhur me Kasa" value={all.reduce((s, a) => s + a.kasa_clients, 0)} />
      </div>

      <div className="px-4 pb-8 md:px-8 md:py-5">
        <Card className="overflow-hidden">
          <div className="border-b border-line p-4">
            <div className="relative lg:w-[420px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kërko sipas emrit, zyrës ose email-it"
                className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
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
            <EmptyState title="Kontabilistët nuk u ngarkuan" text={(list.error as Error).message} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Calculator className="h-6 w-6" />} title={all.length === 0 ? 'Ende pa kontabilistë' : 'Asnjë nuk përputhet'} text={all.length === 0 ? 'Krijo llogarinë e parë me "Kontabilist i ri".' : undefined} />
          ) : (
            <Table>
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <Th className="pl-4">Kontabilisti</Th>
                  <Th className="hidden md:table-cell">Email-i i hyrjes</Th>
                  <Th className="text-right">Klientë</Th>
                  <Th className="hidden lg:table-cell">Hyrja e fundit</Th>
                  <Th>Statusi</Th>
                  <Th className="pr-4">Veprimet</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.user_id} className={cn(!a.active && 'text-muted')}>
                    <Td className="pl-4">
                      <div className="font-semibold text-ink">{a.full_name}</div>
                      <div className="text-xs text-muted">{[a.office_name, a.phone].filter(Boolean).join(' · ') || '—'}</div>
                      <div className="text-xs text-muted md:hidden">{a.email}</div>
                    </Td>
                    <Td className="hidden md:table-cell">{a.email}</Td>
                    <Td className="text-right">
                      {a.clients}
                      {a.kasa_clients > 0 && <span className="text-xs text-muted"> ({a.kasa_clients} Kasa)</span>}
                    </Td>
                    <Td className="hidden whitespace-nowrap lg:table-cell">{a.last_sign_in_at ? formatKosovoDateTime(a.last_sign_in_at) : 'ende pa hyrë'}</Td>
                    <Td>{a.active ? <Badge tone="success">Aktiv</Badge> : <Badge tone="warn">Çaktivizuar</Badge>}</Td>
                    <Td className="pr-4">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'password', a })}>
                          Fjalëkalim i ri
                        </Button>
                        <Button size="sm" variant={a.active ? 'danger' : 'secondary'} onClick={() => setConfirm({ kind: 'toggle', a })}>
                          {a.active ? 'Çaktivizo' : 'Aktivizo'}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <NewAccountantDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(c) => {
          setNewOpen(false)
          setCredentials(c)
          void qc.invalidateQueries({ queryKey: ['platform-accountants'] })
        }}
      />
      <CredentialsDialog data={credentials} onClose={() => setCredentials(null)} />

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        width="md:max-w-[460px]"
        title={confirm?.kind === 'password' ? 'Fjalëkalim i ri?' : confirm?.a.active ? `Çaktivizo ${confirm?.a.full_name}?` : `Aktivizo ${confirm?.a.full_name}?`}
        footer={
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Anulo
            </Button>
            {confirm?.kind === 'password' ? (
              <Button loading={reset.isPending} onClick={() => confirm && reset.mutate(confirm.a)}>
                Krijo fjalëkalimin
              </Button>
            ) : (
              <Button variant={confirm?.a.active ? 'danger' : 'primary'} loading={toggle.isPending} onClick={() => confirm && toggle.mutate(confirm.a)}>
                {confirm?.a.active ? 'Çaktivizo' : 'Aktivizo'}
              </Button>
            )}
          </div>
        }
      >
        <p className="text-[15px] text-muted">
          {confirm?.kind === 'password'
            ? `Fjalëkalimi i vjetër (${confirm.a.email}) nuk do të punojë më. I riu shfaqet vetëm një herë.`
            : confirm?.a.active
              ? 'Kontabilisti nuk mund të hyjë dhe nuk sheh asnjë klient derisa ta aktivizosh përsëri. Të dhënat ruhen.'
              : 'Kontabilisti mund të hyjë përsëri dhe i sheh klientët e vet.'}
        </p>
      </Dialog>
    </PlatformShell>
  )
}

function NewAccountantDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Credentials) => void }) {
  const [name, setName] = useState('')
  const [office, setOffice] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(() => generatePassword())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    setName('')
    setOffice('')
    setPhone('')
    setEmail('')
    setPassword(generatePassword())
    setError(null)
    onClose()
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return setError('Shkruaj emrin e kontabilistit')
    if (!EMAIL_RE.test(email.trim())) return setError('Email-i nuk është i saktë')
    setBusy(true)
    setError(null)
    try {
      const res = await createAccountant({ full_name: name.trim(), office_name: office.trim() || undefined, phone: phone.trim() || undefined, email: email.trim().toLowerCase(), password })
      onCreated({ title: `${name.trim()} u krijua`, ownerName: name.trim(), email: res.email, password, recipient: 'kontabilistit', address: KONTABILIST_ADDRESS })
      setName('')
      setOffice('')
      setPhone('')
      setEmail('')
      setPassword(generatePassword())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Kontabilist i ri"
      subtitle="Llogari për programin Kasa Kontabilist. Kontabilisti i shton vetë klientët e tij."
      width="md:max-w-[520px]"
      footer={
        <div className="flex items-center justify-end gap-2.5">
          {error && <span className="mr-auto text-sm text-warn-700">{error}</span>}
          <Button variant="secondary" onClick={close}>
            Anulo
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Krijo llogarinë
          </Button>
        </div>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void submit(e)}>
        <Input label="Emri dhe mbiemri" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alton Islami" />
        <Input label="Zyra e kontabilitetit" value={office} onChange={(e) => setOffice(e.target.value)} placeholder="Alton Islami B.I." />
        <Input label="Email-i (për hyrje)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="zyra@shembull.com" />
        <Input label="Telefoni" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+383 4X XXX XXX" />
        <div className="sm:col-span-2">
          <Input
            label="Fjalëkalimi"
            mono
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            labelRight={
              <button type="button" className="text-sm font-semibold text-brand-600" onClick={() => setPassword(generatePassword())}>
                Gjenero tjetër
              </button>
            }
          />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  )
}
