import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Camera, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileSpreadsheet, FileText, Landmark, LayoutGrid, Loader2, LogOut, MessageSquare, Receipt, Upload } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { LogoMark } from '@/components/Logo'
import { Badge, Button, Card, EmptyState, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { addMonths, formatDay, monthName, monthStart } from '@/features/accounting/api'
import { addDays } from '@/features/reports/api'
import { downloadSheets } from '../xls'
import {
  fetchDeclarations,
  fetchDocuments,
  fetchMessages,
  fetchOfficeInvoices,
  fetchOverview,
  fetchPortalMe,
  fetchRequests,
  fetchSharedFiles,
  openFile,
  sendMessage,
  uploadToOffice,
  type PortalClient,
  type PortalUpload,
} from './api'
import { MessageThread } from './MessageThread'

type Tab = 'permbledhje' | 'faturat' | 'dokumentet' | 'mesazhet' | 'deklaratat' | 'zyra'
const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'permbledhje', label: 'Përmbledhje', icon: LayoutGrid },
  { key: 'faturat', label: 'Faturat', icon: Receipt },
  { key: 'dokumentet', label: 'Dokumentet', icon: Upload },
  { key: 'mesazhet', label: 'Mesazhet', icon: MessageSquare },
  { key: 'deklaratat', label: 'Deklaratat', icon: FileText },
  { key: 'zyra', label: 'Zyra', icon: Landmark },
]
const CLIENT_KEY = 'kasa.portal.client'

/** The client company's portal: its books from the accountant, uploads, messages, declarations. */
export function PortalPage() {
  const { signOut } = useAuth()
  const me = useQuery({ queryKey: ['portal-me'], queryFn: fetchPortalMe, refetchInterval: 60_000 })
  const [clientId, setClientId] = useState<string | null>(() => localStorage.getItem(CLIENT_KEY))
  const [tab, setTab] = useState<Tab>('permbledhje')
  const clients = me.data?.clients ?? []
  const client: PortalClient | undefined = clients.find((c) => c.client_id === clientId) ?? clients[0]
  useEffect(() => {
    if (client) localStorage.setItem(CLIENT_KEY, client.client_id)
  }, [client])

  if (me.isLoading) return <div className="flex min-h-dvh items-center justify-center text-muted">Duke ngarkuar…</div>
  if (me.error || !client)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <LogoMark size={48} />
        <h1 className="text-[22px] font-bold">Portali i klientit</h1>
        <p className="max-w-[380px] text-muted">{me.error ? (me.error as Error).message : 'Kjo llogari nuk ka qasje në asnjë kompani. Kontakto zyrën e kontabilitetit.'}</p>
        <Button variant="secondary" onClick={() => void signOut()}>
          Dil
        </Button>
      </div>
    )

  return (
    <div className="min-h-dvh bg-bg pb-24 md:pb-10">
      <div className="fixed inset-x-0 top-0 z-50 h-safe-top bg-brand-900" />
      <header className="sticky top-0 z-40 bg-brand-900 pt-safe text-white">
        <div className="mx-auto flex h-[64px] max-w-[1100px] items-center gap-3 px-4 md:px-6">
          {client.office_logo ? <img src={client.office_logo} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" /> : <LogoMark size={34} />}
          <div className="min-w-0 flex-1">
            {clients.length > 1 ? (
              <select
                value={client.client_id}
                onChange={(e) => setClientId(e.target.value)}
                className="max-w-full truncate rounded-md bg-transparent text-[16px] font-bold focus:outline-none"
              >
                {clients.map((c) => (
                  <option key={c.client_id} value={c.client_id} className="text-ink">
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="truncate text-[16px] font-bold leading-tight">{client.name}</div>
            )}
            <div className="truncate text-xs font-semibold text-brand-400">Kontabiliteti: {client.office_name ?? 'zyra'}</div>
          </div>
          <button type="button" onClick={() => void signOut()} className="flex h-10 items-center gap-2 rounded-ctl bg-white/10 px-3 text-sm font-semibold hover:bg-white/20">
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Dil</span>
          </button>
        </div>
        <nav className="mx-auto hidden max-w-[1100px] gap-1 px-4 pb-2 md:flex md:px-6">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn('flex h-9 items-center gap-2 rounded-ctl px-3 text-sm font-semibold', tab === t.key ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white')}>
              <t.icon className="h-4 w-4" /> {t.label}
              {t.key === 'mesazhet' && client.unread > 0 && <span className="rounded-full bg-brand-400 px-1.5 text-xs text-brand-900">{client.unread}</span>}
              {t.key === 'dokumentet' && client.open_requests > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{client.open_requests}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 pt-5 md:px-6">
        {tab === 'permbledhje' && <Overview clientId={client.client_id} go={setTab} />}
        {tab === 'faturat' && <Invoices clientId={client.client_id} />}
        {tab === 'dokumentet' && <Documents clientId={client.client_id} />}
        {tab === 'mesazhet' && (
          <Card className="p-4 md:p-5">
            <h2 className="mb-3 text-[17px] font-semibold">Mesazhet me {client.office_name ?? 'kontabilistin'}</h2>
            <MessageThread
              queryKey={['portal-messages', client.client_id]}
              load={() => fetchMessages(client.client_id)}
              send={(b) => sendMessage(client.client_id, b)}
              side="client"
              emptyText="Shkruaji kontabilistit këtu: pyetje, sqarime, dokumente që mungojnë."
            />
          </Card>
        )}
        {tab === 'deklaratat' && <Declarations clientId={client.client_id} />}
        {tab === 'zyra' && <OfficeTab clientId={client.client_id} />}
      </main>

      {/* tab bar on phones */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn('relative flex h-[60px] flex-col items-center justify-center gap-0.5 text-[10px] font-semibold', tab === t.key ? 'text-brand-600' : 'text-muted')}>
            <t.icon className="h-5 w-5" />
            {t.label}
            {t.key === 'mesazhet' && client.unread > 0 && <span className="absolute right-3 top-2 h-2.5 w-2.5 rounded-full bg-brand-600" />}
            {t.key === 'dokumentet' && client.open_requests > 0 && <span className="absolute right-3 top-2 h-2.5 w-2.5 rounded-full bg-amber-700" />}
          </button>
        ))}
      </nav>
    </div>
  )
}

function MonthPicker({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  return (
    <div className="flex items-center overflow-hidden rounded-ctl border border-line bg-white">
      <button type="button" aria-label="Muaji i kaluar" className="flex h-10 w-10 items-center justify-center hover:bg-bg" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[130px] px-2 text-center font-semibold">{monthName(month)}</span>
      <button type="button" aria-label="Muaji tjetër" disabled={Boolean(max && month >= max)} className="flex h-10 w-10 items-center justify-center hover:bg-bg disabled:text-[#B8C2BC]" onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Overview({ clientId, go }: { clientId: string; go: (t: Tab) => void }) {
  const [month, setMonth] = useState(() => monthStart())
  const data = useQuery({ queryKey: ['portal-overview', clientId, month], queryFn: () => fetchOverview(clientId, month) })
  const d = data.data
  const max = Math.max(1, ...(d?.months ?? []).flatMap((m) => [m.sales, m.purchases]))
  if (data.error) return <Card className="p-5 text-sm text-warn-700">{(data.error as Error).message}</Card>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} onChange={setMonth} max={monthStart()} />
        <div className="flex gap-2">
          <Button onClick={() => go('dokumentet')}>
            <Camera className="h-4 w-4" /> Dërgo fatura
          </Button>
          <Button variant="secondary" onClick={() => go('mesazhet')}>
            <MessageSquare className="h-4 w-4" /> Shkruaj
          </Button>
        </div>
      </div>
      {!d ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : (
        <>
          {(d.open_requests > 0 || d.unread > 0) && (
            <div className="flex flex-wrap gap-2">
              {d.open_requests > 0 && (
                <button type="button" onClick={() => go('dokumentet')} className="rounded-ctl bg-amber-100 px-4 py-3 text-left text-sm font-semibold text-amber-700">
                  Kontabilisti pret {d.open_requests} dokument{d.open_requests > 1 ? 'e' : ''} nga ju →
                </button>
              )}
              {d.unread > 0 && (
                <button type="button" onClick={() => go('mesazhet')} className="rounded-ctl bg-brand-100 px-4 py-3 text-left text-sm font-semibold text-brand-600">
                  {d.unread} mesazh{d.unread > 1 ? 'e' : ''} i ri nga zyra →
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Shitjet (pa TVSH)', d.sales.net, `${d.sales.docs} fatura`],
              ['Blerjet (pa TVSH)', d.purchases.net, `${d.purchases.docs} fatura`],
              ['TVSH: shitje − blerje', d.sales.vat - d.purchases.vat, 'llogaritje e përafërt'],
              ['Klientët ju detyrohen', d.receivable, `ju u detyroheni furnitorëve ${formatEUR(d.payable)}`],
            ].map(([l, v, s]) => (
              <Card key={l as string} className="p-4">
                <div className="text-sm text-muted">{l}</div>
                <div className="mt-1 text-[20px] font-bold tabular-nums">{formatEUR(v as number)}</div>
                <div className="text-xs text-muted">{s}</div>
              </Card>
            ))}
          </div>
          {d.kasa_linked && <p className="text-sm text-muted">Shitjet nga arka Kasa i sheh në aplikacionin Kasa; këtu janë faturat që regjistron zyra.</p>}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h2 className="text-[17px] font-semibold">Viti {month.slice(0, 4)}</h2>
              <div className="mt-4 flex h-[160px] items-end gap-2">
                {d.months.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-[130px] w-full items-end justify-center gap-0.5">
                      <div className="w-1/2 max-w-[18px] rounded-t bg-brand-600" style={{ height: `${(m.sales / max) * 100}%` }} title={`Shitjet ${formatEUR(m.sales)}`} />
                      <div className="w-1/2 max-w-[18px] rounded-t bg-[#B9D9C8]" style={{ height: `${(m.purchases / max) * 100}%` }} title={`Blerjet ${formatEUR(m.purchases)}`} />
                    </div>
                    <span className="text-[11px] text-muted">{m.month.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Shitjet
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#B9D9C8]" /> Blerjet
                </span>
              </div>
            </Card>
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-[17px] font-semibold">TVSH-ja e fundit</h2>
              {d.vat_return ? (
                <>
                  <div className="text-sm text-muted">{monthName(d.vat_return.month)}</div>
                  <div className="text-[22px] font-bold tabular-nums">{d.vat_return.amount > 0 ? formatEUR(d.vat_return.amount) : d.vat_return.credit > 0 ? `Kredi ${formatEUR(d.vat_return.credit)}` : formatEUR(0)}</div>
                  <Badge tone={d.vat_return.status === 'filed' ? 'success' : 'amber'}>{d.vat_return.status === 'filed' ? `Deklaruar ${d.vat_return.filed_at ? formatDay(d.vat_return.filed_at) : ''}` : 'Në përgatitje'}</Badge>
                  {d.vat_return.amount > 0 && <div className="text-sm text-muted">{d.vat_return.paid_at ? `Paguar ${formatDay(d.vat_return.paid_at)}` : 'Për pagesë në ATK'}</div>}
                </>
              ) : (
                <p className="text-sm text-muted">Asnjë deklaratë ende.</p>
              )}
              {d.office_open > 0 && (
                <button type="button" onClick={() => go('zyra')} className="mt-auto rounded-ctl bg-bg px-3 py-2 text-left text-sm">
                  Fatura e zyrës për pagesë: <b>{formatEUR(d.office_open)}</b>
                </button>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function Invoices({ clientId }: { clientId: string }) {
  const [kind, setKind] = useState<'sale' | 'purchase'>('sale')
  const [month, setMonth] = useState(() => monthStart())
  const from = month
  const to = addDays(addMonths(month, 1), -1)
  const docs = useQuery({ queryKey: ['portal-docs', clientId, kind, month], queryFn: () => fetchDocuments(clientId, kind, from, to) })
  const list = docs.data ?? []
  const t = list.reduce((a, d) => ({ net: a.net + d.net, vat: a.vat + d.vat, total: a.total + d.total, open: a.open + d.open }), { net: 0, vat: 0, total: 0, open: 0 })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(
            [
              ['sale', 'Shitjet'],
              ['purchase', 'Blerjet'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cn('h-10 rounded-full border px-4 text-sm font-semibold', kind === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <MonthPicker month={month} onChange={setMonth} />
          <Button
            variant="secondary"
            disabled={!list.length}
            onClick={() =>
              void downloadSheets(`${kind === 'sale' ? 'shitjet' : 'blerjet'}-${month.slice(0, 7)}.xlsx`, [
                {
                  name: kind === 'sale' ? 'Shitjet' : 'Blerjet',
                  columns: ['Data', 'Nr.', kind === 'sale' ? 'Blerësi' : 'Furnitori', 'Pa TVSH', 'TVSH', 'Totali', 'E papaguar'],
                  rows: list.map((d) => [d.doc_date, d.doc_no ?? '', d.partner_name ?? '', d.net, d.vat, d.total, d.open]),
                },
              ])
            }
          >
            <FileSpreadsheet className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Pa TVSH', t.net],
          ['TVSH', t.vat],
          ['E papaguar', t.open],
        ].map(([l, v]) => (
          <Card key={l as string} className="p-4">
            <div className="text-sm text-muted">{l}</div>
            <div className="mt-1 text-[18px] font-bold tabular-nums">{formatEUR(v as number)}</div>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        {docs.isLoading ? (
          <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
        ) : docs.error ? (
          <p className="p-5 text-sm text-warn-700">{(docs.error as Error).message}</p>
        ) : list.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="Asnjë faturë këtë muaj" text="Faturat i regjistron zyra; dërgojini te Dokumentet." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{d.partner_name ?? '—'}</div>
                  <div className="truncate text-xs text-muted">
                    {formatDay(d.doc_date)}
                    {d.doc_no && ` · nr. ${d.doc_no}`}
                    {d.doc_type === 'credit_note' && ' · kreditore'}
                    {d.description && ` · ${d.description}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{formatEUR(d.total)}</div>
                  {d.open > 0.004 ? <div className="text-xs font-semibold text-amber-700">e papaguar {formatEUR(d.open)}</div> : <div className="text-xs text-muted">e paguar</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
const UPLOAD_STATUS: Record<PortalUpload['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warn' }> = {
  pending: { label: 'Te kontabilisti', tone: 'neutral' },
  read: { label: 'Në kontroll', tone: 'info' },
  review: { label: 'Në kontroll', tone: 'info' },
  confirmed: { label: 'U regjistrua', tone: 'success' },
  failed: { label: 'Te kontabilisti', tone: 'neutral' },
}

function Documents({ clientId }: { clientId: string }) {
  const qc = useQueryClient()
  const data = useQuery({ queryKey: ['portal-requests', clientId], queryFn: () => fetchRequests(clientId) })
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const [forRequest, setForRequest] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(0)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['portal-requests', clientId] })
    void qc.invalidateQueries({ queryKey: ['portal-me'] })
    void qc.invalidateQueries({ queryKey: ['portal-overview'] })
  }
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      setErrors([])
      let ok = 0
      for (const f of files) {
        setBusy(`Duke dërguar ${f.name}…`)
        try {
          await uploadToOffice(clientId, f, forRequest)
          ok++
        } catch (e) {
          setErrors((x) => [...x, (e as Error).message])
        }
      }
      setBusy(null)
      return ok
    },
    onSuccess: (ok) => {
      setDone(ok)
      setForRequest(null)
      refresh()
    },
  })
  const pick = (requestId: string | null, camera = false) => {
    setForRequest(requestId)
    setDone(0)
    ;(camera ? camRef : fileRef).current?.click()
  }
  const open = (data.data?.requests ?? []).filter((r) => r.status === 'requested')
  const closed = (data.data?.requests ?? []).filter((r) => r.status !== 'requested')
  const uploads = data.data?.uploads ?? []
  const today = kosovoDateISO()

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-field bg-[#F8FAF8] px-4 py-6 text-center">
          <div className="text-[17px] font-semibold">Dërgo fatura dhe dokumente te kontabilisti</div>
          <p className="max-w-[460px] text-sm text-muted">Bëj foto faturave të blerjes, kuponave ose ngarko PDF – edhe disa njëherësh. Kontabilisti i lexon dhe i regjistron.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => pick(null, true)} disabled={upload.isPending}>
              <Camera className="h-4 w-4" /> Bëj foto
            </Button>
            <Button variant="secondary" onClick={() => pick(null)} disabled={upload.isPending}>
              <Upload className="h-4 w-4" /> Zgjidh skedarët
            </Button>
          </div>
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> {busy}
            </p>
          )}
          {done > 0 && !busy && <p className="text-sm font-semibold text-brand-600">U dërguan {done} dokument{done > 1 ? 'e' : ''}. Faleminderit!</p>}
          {errors.length > 0 && <div className="text-sm text-warn-700">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="hidden" onChange={(e) => { if (e.target.files?.length) upload.mutate(Array.from(e.target.files)); e.target.value = '' }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files?.length) upload.mutate(Array.from(e.target.files)); e.target.value = '' }} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-5 pt-4 text-[17px] font-semibold">Kontabilisti kërkon</h2>
        {data.isLoading ? (
          <p className="py-6 text-center text-muted">Duke ngarkuar…</p>
        ) : data.error ? (
          <p className="p-5 text-sm text-warn-700">{(data.error as Error).message}</p>
        ) : open.length === 0 ? (
          <p className="px-5 pb-5 pt-2 text-sm text-muted">Asgjë në pritje. 👍</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {open.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Clock className={cn('h-5 w-5 shrink-0', r.due_date && r.due_date < today ? 'text-warn-700' : 'text-amber-700')} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {r.title}
                    {r.period && <span className="font-normal text-muted"> · {monthName(r.period)}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {r.due_date ? `deri më ${formatDay(r.due_date)}` : 'sa më shpejt'}
                    {r.note && ` · ${r.note}`}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => pick(r.id, true)} disabled={upload.isPending}>
                    <Camera className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => pick(r.id)} disabled={upload.isPending}>
                    <Upload className="h-4 w-4" /> Ngarko
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {closed.length > 0 && (
          <ul className="border-t border-line px-5 py-3 text-sm text-muted">
            {closed.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-0.5">
                <CheckCircle2 className="h-4 w-4 text-brand-600" /> {r.title}
                {r.period && ` · ${monthName(r.period)}`} {r.received_at && `· pranuar ${formatDay(r.received_at.slice(0, 10))}`}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SharedFilesCard clientId={clientId} />

      {uploads.length > 0 && (
        <Card className="overflow-hidden">
          <h2 className="px-5 pt-4 text-[17px] font-semibold">Të dërguarat</h2>
          <ul className="mt-2 divide-y divide-line">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-5 py-2.5">
                <FileText className="h-5 w-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]">{u.file_name}</div>
                  <div className="text-xs text-muted">
                    {formatDay(u.created_at.slice(0, 10))}
                    {u.request_title && ` · për: ${u.request_title}`}
                  </div>
                </div>
                <Badge tone={UPLOAD_STATUS[u.status].tone}>{UPLOAD_STATUS[u.status].label}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
const OTHER_KINDS: Record<string, string> = {
  rent: 'Tatimi në qira',
  payroll: 'Paga',
  income_q: 'Tatimi në fitim (tremujor)',
  income_annual: 'Deklarata vjetore',
  withholding: 'Tatimi në burim',
  other: 'Tjetër',
}

function Declarations({ clientId }: { clientId: string }) {
  const thisYear = Number(kosovoDateISO().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const data = useQuery({ queryKey: ['portal-decl', clientId, year], queryFn: () => fetchDeclarations(clientId, year) })
  const d = data.data
  const empty = d && !d.vat.length && !d.payroll.length && !d.other.length
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-[19px] font-semibold">Deklaratat në ATK</h2>
        <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[0, 1, 2].map((i) => ({ value: String(thisYear - i), label: String(thisYear - i) }))} />
      </div>
      {data.isLoading ? (
        <p className="py-8 text-center text-muted">Duke ngarkuar…</p>
      ) : data.error ? (
        <Card className="p-5 text-sm text-warn-700">{(data.error as Error).message}</Card>
      ) : empty ? (
        <Card>
          <EmptyState icon={<FileText className="h-6 w-6" />} title={`Asnjë deklaratë në ${year}`} />
        </Card>
      ) : (
        <>
          {d!.vat.length > 0 && (
            <Card className="overflow-hidden">
              <h3 className="px-5 pt-4 font-semibold">TVSH</h3>
              <ul className="mt-2 divide-y divide-line">
                {d!.vat.map((v) => (
                  <li key={v.month} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <span className="min-w-[110px] font-medium">{monthName(v.month)}</span>
                    <span className="flex-1 text-sm text-muted">
                      {v.amount > 0 ? `Për pagesë ${formatEUR(v.amount)}` : v.credit > 0 ? `Kredi për muajin tjetër ${formatEUR(v.credit)}` : 'Pa pagesë'}
                      {v.paid_at && ` · paguar ${formatDay(v.paid_at)}`}
                    </span>
                    <Badge tone={v.status === 'filed' ? 'success' : 'amber'}>{v.status === 'filed' ? `Deklaruar${v.filed_at ? ' ' + formatDay(v.filed_at) : ''}` : 'Në përgatitje'}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d!.payroll.length > 0 && (
            <Card className="overflow-hidden">
              <h3 className="px-5 pt-4 font-semibold">Pagat (WPK)</h3>
              <ul className="mt-2 divide-y divide-line">
                {d!.payroll.map((p) => (
                  <li key={p.month} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <span className="min-w-[110px] font-medium">{monthName(p.month)}</span>
                    <span className="flex-1 text-sm text-muted">
                      {p.employees} punëtorë · neto {formatEUR(p.net)} · tatimi dhe kontributet {formatEUR(p.to_pay)}
                    </span>
                    <Badge tone={p.status === 'filed' ? 'success' : 'info'}>{p.status === 'filed' ? 'Deklaruar' : 'E konfirmuar'}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d!.other.length > 0 && (
            <Card className="overflow-hidden">
              <h3 className="px-5 pt-4 font-semibold">Tatime të tjera</h3>
              <ul className="mt-2 divide-y divide-line">
                {d!.other.map((o, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <span className="min-w-[110px] font-medium">{OTHER_KINDS[o.kind] ?? o.kind}</span>
                    <span className="flex-1 text-sm text-muted">
                      {formatDay(o.period)} · {formatEUR(o.amount)}
                    </span>
                    <Badge tone={o.status === 'paid' ? 'success' : o.status === 'filed' ? 'info' : 'amber'}>{o.status === 'paid' ? 'Paguar' : o.status === 'filed' ? 'Deklaruar' : 'Në përgatitje'}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function OfficeTab({ clientId }: { clientId: string }) {
  const data = useQuery({ queryKey: ['portal-office', clientId], queryFn: () => fetchOfficeInvoices(clientId) })
  const o = data.data?.office
  const invs = data.data?.invoices ?? []
  const open = useMemo(() => invs.filter((i) => i.status === 'open').reduce((a, i) => a + i.total - i.paid, 0), [invs])
  if (data.error) return <Card className="p-5 text-sm text-warn-700">{(data.error as Error).message}</Card>
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-brand-600" />
          <h2 className="text-[17px] font-semibold">{o?.name ?? 'Zyra e kontabilitetit'}</h2>
        </div>
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {o?.address && <div>{[o.address, o.city].filter(Boolean).join(', ')}</div>}
          {o?.phone && (
            <a href={`tel:${o.phone}`} className="font-semibold text-brand-600">
              {o.phone}
            </a>
          )}
          {o?.email && (
            <a href={`mailto:${o.email}`} className="font-semibold text-brand-600">
              {o.email}
            </a>
          )}
          {o?.nui && <div className="text-muted">NUI {o.nui}</div>}
        </div>
        {o?.iban && (
          <div className="mt-4 rounded-card bg-bg p-3 text-sm">
            <div className="text-muted">Pagesat te zyra</div>
            <div className="font-semibold">{o.bank}</div>
            <div className="select-all break-all font-mono">{o.iban}</div>
          </div>
        )}
      </Card>
      <Card className="overflow-hidden lg:col-span-2">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-[17px] font-semibold">Faturat e zyrës</h2>
          {open > 0 && <span className="font-semibold text-amber-700">Për pagesë {formatEUR(open)}</span>}
        </div>
        {invs.length === 0 ? (
          <p className="px-5 pb-5 pt-2 text-sm text-muted">{data.isLoading ? 'Duke ngarkuar…' : 'Asnjë faturë.'}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {invs.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {i.inv_no} · {i.description}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDay(i.issue_date)}
                    {i.due_date && i.status === 'open' && ` · afati ${formatDay(i.due_date)}`}
                  </div>
                </div>
                <span className="font-semibold tabular-nums">{formatEUR(i.total)}</span>
                <Badge tone={i.status === 'paid' ? 'success' : 'amber'}>{i.status === 'paid' ? 'E paguar' : 'E papaguar'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

const SHARED_LABELS: Record<string, string> = {
  invoice: 'Faturë',
  contract: 'Kontratë',
  declaration: 'Deklaratë',
  bank: 'Banka',
  payroll: 'Pagat',
  correspondence: 'Letër',
  other: 'Dokument',
}

/** Documents the office shared with the client (declarations, contracts, reports). */
function SharedFilesCard({ clientId }: { clientId: string }) {
  const files = useQuery({ queryKey: ['portal-files', clientId], queryFn: () => fetchSharedFiles(clientId) })
  const list = files.data ?? []
  if (!list.length) return null
  return (
    <Card className="overflow-hidden">
      <h2 className="px-5 pt-4 text-[17px] font-semibold">Nga zyra</h2>
      <ul className="mt-2 divide-y divide-line">
        {list.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={async () => window.open(await openFile(f.path), '_blank', 'noopener')} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-bg">
              <FileText className="h-5 w-5 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-brand-600">{f.title ?? f.file_name}</div>
                <div className="text-xs text-muted">
                  {SHARED_LABELS[f.category] ?? 'Dokument'}
                  {f.period && ` · ${monthName(f.period)}`}
                  {f.note && ` · ${f.note}`}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
