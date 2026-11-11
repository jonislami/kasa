import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, MessageSquare, Phone, Trash2, Users } from 'lucide-react'
import { Badge, Button, Card, Select } from '@/components/ui'
import { formatKosovoDateTime } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import type { AccMe, Client } from './api'
import { ContractDialog } from './ContractsPanel'
import { RequestsPanel, TasksPanel } from './WorkPage'
import { deleteNote, fetchClientContract, fetchNotes, NOTE_KINDS, saveNote, type NoteKind } from './work'

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
