import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Mail, MessageSquare, Phone, Trash2, UserPlus, Users } from 'lucide-react'
import { Badge, Button, Card, Dialog, Input, Select } from '@/components/ui'
import { formatKosovoDateTime } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import type { AccMe, Client } from './api'
import { ContractDialog } from './ContractsPanel'
import { RequestsPanel, TasksPanel } from './WorkPage'
import { deleteNote, fetchClientContract, fetchNotes, NOTE_KINDS, saveNote, type NoteKind } from './work'
import { createPortalUser, fetchOfficeMessages, fetchPortalUsers, sendOfficeMessage, setPortalPassword, setPortalUserActive, type PortalUser } from './portal/api'
import { MessageThread } from './portal/MessageThread'

/** Zyra (per client): service contract and what the client owes the office, tasks, document requests, communication. */
export function ClientOfficeTab({ client, me }: { client: Client; me: AccMe }) {
  const admin = (me.accountant?.role ?? 'admin') === 'admin'
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      {admin && <ContractCard client={client} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <TasksPanel clientId={client.id} />
        <RequestsPanel clientId={client.id} clientEmail={client.email} clientPhone={client.phone} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-[17px] font-semibold">Mesazhet me klientin (portali)</h2>
          <MessageThread
            queryKey={['acc-messages', client.id]}
            load={() => fetchOfficeMessages(client.id)}
            send={(b) => sendOfficeMessage(client.id, b)}
            side="office"
            emptyText="Klienti i sheh mesazhet te portali dhe ju përgjigjet këtu."
          />
        </Card>
        <PortalUsersCard client={client} canManage={(me.accountant?.role ?? 'admin') !== 'assistant'} />
      </div>
      <NotesCard client={client} />
    </div>
  )
}

function ContractCard({ client }: { client: Client }) {
  const data = useQuery({ queryKey: ['acc-client-contract', client.id], queryFn: () => fetchClientContract(client.id) })
  const [edit, setEdit] = useState(false)
  const c = data.data?.contract
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">Kontrata e shërbimit</h2>
          {data.error ? (
            <p className="text-sm text-warn-700">{(data.error as Error).message}</p>
          ) : c ? (
            <p className="text-sm text-muted">
              {c.services} · {formatEUR(c.monthly_fee)}/muaj{c.vat_rate ? ` (me TVSH ${c.vat_rate}%)` : ''} · nga {formatDay(c.start_date)}
              {c.end_date && ` deri ${formatDay(c.end_date)}`} {!c.active && <Badge tone="neutral">Joaktive</Badge>}
            </p>
          ) : (
            <p className="text-sm text-muted">{data.isLoading ? 'Duke ngarkuar…' : 'Pa kontratë – vendos tarifën mujore që zyra ta faturojë vetë.'}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {data.data && data.data.open > 0 && (
            <div className="text-right">
              <div className="text-sm text-muted">I detyrohet zyrës</div>
              <div className="text-[18px] font-bold tabular-nums text-warn-700">{formatEUR(data.data.open)}</div>
            </div>
          )}
          <Button size="sm" variant={c ? 'secondary' : 'primary'} onClick={() => setEdit(true)}>
            {c ? 'Ndrysho' : 'Shto kontratë'}
          </Button>
        </div>
      </div>
      {data.data && data.data.invoices.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line text-sm">
          {data.data.invoices.slice(0, 6).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate">
                {i.inv_no} · {formatDay(i.issue_date)} · {i.description}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatEUR(i.total)}</span>
                <Badge tone={i.status === 'paid' ? 'success' : i.status === 'open' ? 'amber' : 'neutral'}>{i.status === 'paid' ? 'E paguar' : i.status === 'open' ? 'E papaguar' : 'E anuluar'}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ContractDialog value={edit ? { clientId: client.id, name: client.name, contract: c ?? null } : null} onClose={() => setEdit(false)} />
    </Card>
  )
}

const KIND_ICON: Record<NoteKind, typeof Phone> = { call: Phone, email: Mail, meeting: Users, message: MessageSquare, note: MessageSquare }

function NotesCard({ client }: { client: Client }) {
  const qc = useQueryClient()
  const notes = useQuery({ queryKey: ['acc-notes', client.id], queryFn: () => fetchNotes(client.id) })
  const [kind, setKind] = useState<NoteKind>('call')
  const [body, setBody] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['acc-notes', client.id] })
  const add = useMutation({ mutationFn: () => saveNote({ client_id: client.id, kind, body }), onSuccess: () => (setBody(''), refresh()) })
  const del = useMutation({ mutationFn: deleteNote, onSuccess: refresh })
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Komunikimi me klientin</h2>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-[170px]">
          <Select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} options={(Object.keys(NOTE_KINDS) as NoteKind[]).map((k) => ({ value: k, label: NOTE_KINDS[k] }))} />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Çka u fol / çka u dërgua / çka u vendos…"
          className="min-h-[46px] flex-1 rounded-ctl border border-field px-3 py-2.5 text-[16px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 md:text-[15px]"
        />
        <Button className="h-[46px]" loading={add.isPending} disabled={!body.trim()} onClick={() => add.mutate()}>
          Shto
        </Button>
      </div>
      {(add.error || del.error) && <p className="mt-2 text-sm text-warn-700">{((add.error ?? del.error) as Error).message}</p>}
      <ul className="mt-4 flex flex-col gap-3">
        {(notes.data ?? []).map((n) => {
          const Icon = KIND_ICON[n.kind]
          return (
            <li key={n.id} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-muted">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">
                  {NOTE_KINDS[n.kind]} · {formatKosovoDateTime(n.note_date)}
                  {n.author && ` · ${n.author}`}
                </div>
                <div className="whitespace-pre-wrap text-[15px]">{n.body}</div>
              </div>
              <button type="button" aria-label="Fshi" onClick={() => confirm('Ta fshij shënimin?') && del.mutate(n.id)} className="flex h-8 w-8 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          )
        })}
        {notes.data && notes.data.length === 0 && <li className="text-sm text-muted">Asnjë shënim ende.</li>}
      </ul>
    </Card>
  )
}

/** Who of the client company may open the portal. */
function PortalUsersCard({ client, canManage }: { client: Client; canManage: boolean }) {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['acc-portal-users', client.id], queryFn: () => fetchPortalUsers(client.id) })
  const [add, setAdd] = useState(false)
  const [pw, setPw] = useState<PortalUser | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['acc-portal-users', client.id] })
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => setPortalUserActive(id, active), onSuccess: refresh })
  const portalUrl = `${window.location.origin}/login`
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">Portali i klientit</h2>
          <p className="text-sm text-muted">Klienti hyn te {portalUrl} dhe sheh faturat, deklaratat, dërgon dokumente dhe mesazhe.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAdd(true)}>
            <UserPlus className="h-4 w-4" /> Jep qasje
          </Button>
        )}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {(users.data ?? []).map((u) => (
          <li key={u.id} className={u.active ? 'flex flex-wrap items-center gap-2 py-2.5' : 'flex flex-wrap items-center gap-2 py-2.5 opacity-50'}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{u.full_name}</div>
              <div className="truncate text-xs text-muted">
                {u.email}
                {u.kasa_owner && ' · llogari Kasa'}
                {u.last_seen_at ? ` · parë së fundi ${formatKosovoDateTime(u.last_seen_at)}` : ' · nuk ka hyrë ende'}
              </div>
            </div>
            {canManage && !u.kasa_owner && (
              <Button size="sm" variant="secondary" aria-label="Fjalëkalim i ri" onClick={() => setPw(u)}>
                <KeyRound className="h-4 w-4" />
              </Button>
            )}
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => toggle.mutate({ id: u.id, active: !u.active })}>
                {u.active ? 'Hiqi qasjen' : 'Riaktivizo'}
              </Button>
            )}
          </li>
        ))}
        {users.data && users.data.length === 0 && <li className="py-2 text-sm text-muted">Askush nga kompania nuk ka qasje ende.</li>}
        {users.error && <li className="py-2 text-sm text-warn-700">{(users.error as Error).message}</li>}
      </ul>
      <AddPortalUserDialog open={add} client={client} onClose={() => setAdd(false)} onSaved={refresh} />
      <PortalPasswordDialog user={pw} onClose={() => setPw(null)} />
    </Card>
  )
}

function AddPortalUserDialog({ open, client, onClose, onSaved }: { open: boolean; client: Client; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ full_name: '', email: client.email ?? '', password: '' })
  const [linked, setLinked] = useState<boolean | null>(null)
  const save = useMutation({
    mutationFn: () => createPortalUser({ client_id: client.id, full_name: f.full_name, email: f.email, password: f.password || undefined }),
    onSuccess: (r) => {
      setLinked(r.linked)
      onSaved()
    },
  })
  const close = () => {
    setF({ full_name: '', email: client.email ?? '', password: '' })
    setLinked(null)
    save.reset()
    onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Qasje në portal"
      subtitle={client.name}
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {linked != null ? 'Mbyll' : 'Anulo'}
          </Button>
          {linked == null && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Jep qasje
            </Button>
          )}
        </div>
      }
    >
      {linked != null ? (
        <p className="text-[15px]">
          {linked
            ? 'Ky email kishte tashmë llogari (p.sh. në Kasa): klienti hyn në portal me fjalëkalimin e vet.'
            : 'U krijua llogaria. Jepja klientit email-in dhe fjalëkalimin; mund ta ndryshojë vetë pas hyrjes.'}{' '}
          Adresa: <b>{window.location.origin}/login</b>
        </p>
      ) : (
        <div className="grid gap-3">
          <Input label="Emri dhe mbiemri" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input
            label="Fjalëkalimi (të paktën 8 shenja)"
            type="text"
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
          <p className="text-xs text-muted">Nëse email-i ka tashmë llogari (pronari që përdor Kasa), lidhet ajo dhe fjalëkalimi nuk ndryshohet.</p>
        </div>
      )}
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}

function PortalPasswordDialog({ user, onClose }: { user: PortalUser | null; onClose: () => void }) {
  const [p, setP] = useState('')
  const save = useMutation({ mutationFn: () => setPortalPassword(user!.id, p), onSuccess: () => (setP(''), onClose()) })
  return (
    <Dialog
      open={Boolean(user)}
      onClose={onClose}
      title="Fjalëkalim i ri për portalin"
      subtitle={user?.email}
      width="md:max-w-[420px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} disabled={p.length < 8} onClick={() => save.mutate()}>
            Vendos
          </Button>
        </div>
      }
    >
      <Input label="Fjalëkalimi i ri" type="text" autoComplete="new-password" value={p} onChange={(e) => setP(e.target.value)} />
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}
