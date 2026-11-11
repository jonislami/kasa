import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ChevronLeft, Download, ExternalLink, FileText, Image as ImageIcon, Pencil, Search, Share2, Trash2, Upload } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatDay, monthName, monthStart } from '@/features/accounting/api'
import { deleteDocFile, fetchClients, openDocFile, type AccMe } from './api'
import { PasswordDialog, TopShell } from './ClientsPage'
import { CATEGORY_LABELS, downloadJson, fetchArchive, fetchClientBackup, saveArchiveMeta, slug, uploadToArchive, type ArchiveFile, type ArchiveMeta, type FileCategory } from './archive'

/** Office-wide archive page (/arkiva). */
export function ArchivePage({ me }: { me: AccMe }) {
  const navigate = useNavigate()
  const [pw, setPw] = useState(false)
  return (
    <TopShell me={me} onPassword={() => setPw(true)}>
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-12 pt-6 md:px-8 md:pt-10">
        <button type="button" onClick={() => navigate('/')} className="mb-3 flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> Kompanitë
        </button>
        <h1 className="text-[30px] font-bold leading-tight md:text-[34px]">Arkiva e dokumenteve</h1>
        <p className="mt-1 text-muted">Faturat, kontratat, deklaratat, ekstraktet bankare dhe dokumentet e punëtorëve të të gjithë klientëve, sipas vitit dhe muajit.</p>
        <div className="mt-5">
          <ArchivePanel canBackup={me.accountant?.role !== 'assistant'} />
        </div>
      </div>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </TopShell>
  )
}

const iconOf = (mime: string | null) => (mime?.startsWith('image/') ? ImageIcon : FileText)

/** Archive of one client (clientId) or of all clients the member sees. */
export function ArchivePanel({ clientId, clientName, canBackup }: { clientId?: string; clientName?: string; canBackup: boolean }) {
  const qc = useQueryClient()
  const thisYear = Number(kosovoDateISO().slice(0, 4))
  const [category, setCategory] = useState<FileCategory | ''>('')
  const [year, setYear] = useState<number | ''>(thisYear)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])
  const files = useQuery({
    queryKey: ['acc-archive', clientId ?? null, category, year, query],
    queryFn: () => fetchArchive({ clientId, category: category || null, year: year || null, q: query }),
  })
  const [upload, setUpload] = useState(false)
  const [edit, setEdit] = useState<ArchiveFile | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['acc-archive'] })
  const del = useMutation({ mutationFn: deleteDocFile, onSuccess: refresh })
  const backup = useMutation({
    mutationFn: async () => downloadJson(`backup-${slug(clientName ?? 'klienti')}-${kosovoDateISO()}.json`, await fetchClientBackup(clientId!)),
  })
  const open = async (f: ArchiveFile) => window.open(await openDocFile(f.path), '_blank', 'noopener')

  // Grouped by month of the period / invoice date.
  const groups: [string, ArchiveFile[]][] = []
  for (const f of files.data ?? []) {
    const m = f.sort_date.slice(0, 7) + '-01'
    const g = groups.find((x) => x[0] === m)
    if (g) g[1].push(f)
    else groups.push([m, [f]])
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={clientId ? 'Kërko emrin, numrin, furnitorin…' : 'Kërko klientin, numrin, furnitorin, emrin e skedarit…'}
              className="h-[46px] w-full rounded-ctl border border-field bg-white pl-10 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </div>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as FileCategory | '')}
            options={[{ value: '', label: 'Të gjitha llojet' }, ...(Object.keys(CATEGORY_LABELS) as FileCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
          />
          <Select
            value={String(year)}
            onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')}
            options={[{ value: '', label: 'Të gjitha vitet' }, ...[0, 1, 2, 3, 4].map((i) => ({ value: String(thisYear - i), label: String(thisYear - i) }))]}
          />
          <Button onClick={() => setUpload(true)}>
            <Upload className="h-4 w-4" /> Shto dokument
          </Button>
          {clientId && canBackup && (
            <Button variant="secondary" loading={backup.isPending} onClick={() => backup.mutate()} title="Të gjitha të dhënat e klientit në një skedar (JSON)">
              <Download className="h-4 w-4" /> Backup
            </Button>
          )}
        </div>
        {backup.error && <p className="mt-2 text-sm text-warn-700">{(backup.error as Error).message}</p>}
      </Card>

      {files.isLoading ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : files.error ? (
        <Card className="p-5 text-sm text-warn-700">{(files.error as Error).message}</Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={<Archive className="h-6 w-6" />} title="Asnjë dokument" text="Faturat me origjinal, skanimet e konfirmuara dhe dokumentet që shton këtu dalin në arkivë." />
        </Card>
      ) : (
        groups.map(([m, list]) => (
          <Card key={m} className="overflow-hidden">
            <div className="flex items-center justify-between bg-[#F6F9F7] px-5 py-2.5 text-sm font-semibold text-muted">
              <span>{monthName(m)}</span>
              <span>{list.length}</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((f) => {
                const Icon = iconOf(f.mime)
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <button type="button" onClick={() => void open(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl bg-bg text-muted">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-brand-600 hover:underline">
                          {f.title ?? (f.doc_no ? `${f.doc_kind === 'sale' ? 'Shitje' : 'Blerje'} ${f.doc_no}` : f.file_name)}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {[!clientId && f.client_name, f.partner_name, f.doc_date && formatDay(f.doc_date), f.title || f.doc_no ? f.file_name : null, f.note, f.uploaded_by_name && `nga ${f.uploaded_by_name}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </button>
                    <Badge tone="neutral">{CATEGORY_LABELS[f.category]}</Badge>
                    {f.shared && (
                      <Badge tone="info">
                        <Share2 className="mr-1 inline h-3 w-3" />
                        Te klienti
                      </Badge>
                    )}
                    <div className="flex gap-1">
                      <button type="button" aria-label="Hape" onClick={() => void open(f)} className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-bg hover:text-ink">
                        <ExternalLink className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label="Ndrysho" onClick={() => setEdit(f)} className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-bg hover:text-ink">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Fshi"
                        onClick={() => confirm(`Ta fshij "${f.title ?? f.file_name}"? Skedari nuk kthehet.`) && del.mutate(f.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        ))
      )}
      {files.data && files.data.length >= 500 && <p className="text-center text-sm text-muted">Shfaqen 500 të fundit – ngushto kërkimin.</p>}
      {del.error && <p className="text-sm text-warn-700">{(del.error as Error).message}</p>}

      <UploadDialog open={upload} clientId={clientId} onClose={() => setUpload(false)} onSaved={refresh} />
      <MetaDialog file={edit} onClose={() => setEdit(null)} onSaved={refresh} />
    </div>
  )
}

function MetaFields({ m, setM }: { m: ArchiveMeta; setM: (m: ArchiveMeta) => void }) {
  const months = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(monthStart() + 'T12:00:00')
    d.setMonth(d.getMonth() - i)
    return d.toISOString().slice(0, 8) + '01'
  })
  return (
    <>
      <Select label="Lloji" value={m.category} onChange={(e) => setM({ ...m, category: e.target.value as FileCategory })} options={(Object.keys(CATEGORY_LABELS) as FileCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
      <Select label="Periudha" value={m.period ?? ''} onChange={(e) => setM({ ...m, period: e.target.value || null })} options={[{ value: '', label: '— sipas datës —' }, ...months.map((x) => ({ value: x, label: monthName(x) }))]} />
      <div className="sm:col-span-2">
        <Input label="Titulli" value={m.title ?? ''} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder="p.sh. Kontrata e qirasë, Ekstrakti bankar tetor" />
      </div>
      <div className="sm:col-span-2">
        <Input label="Shënim" value={m.note ?? ''} onChange={(e) => setM({ ...m, note: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-[15px] sm:col-span-2">
        <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={Boolean(m.shared)} onChange={(e) => setM({ ...m, shared: e.target.checked })} />
        Ndaje me klientin (e sheh te portali)
      </label>
    </>
  )
}

function UploadDialog({ open, clientId, onClose, onSaved }: { open: boolean; clientId?: string; onClose: () => void; onSaved: () => void }) {
  const [client, setClient] = useState(clientId ?? '')
  const [m, setM] = useState<ArchiveMeta>({ category: 'contract', title: '', period: null, note: '', shared: false })
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  const clients = useQuery({ queryKey: ['acc-clients-min'], queryFn: () => fetchClients(monthStart()), enabled: open && !clientId })
  useEffect(() => {
    if (!open) return
    setClient(clientId ?? '')
    setM({ category: 'contract', title: '', period: null, note: '', shared: false })
    setFiles([])
    setErrors([])
  }, [open, clientId])
  const save = useMutation({
    mutationFn: async () => {
      const errs: string[] = []
      for (const f of files) {
        try {
          await uploadToArchive(client, f, { ...m, title: files.length > 1 ? null : m.title })
        } catch (e) {
          errs.push((e as Error).message)
        }
      }
      setErrors(errs)
      if (errs.length) throw new Error('Disa skedarë nuk u ngarkuan')
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onSettled: onSaved,
  })
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Shto dokument në arkivë"
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} disabled={!client || !files.length} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!clientId && (
          <div className="sm:col-span-2">
            <Select label="Klienti" value={client} onChange={(e) => setClient(e.target.value)} options={[{ value: '', label: 'Zgjidh klientin' }, ...(clients.data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
        )}
        <div className="sm:col-span-2">
          <button type="button" onClick={() => input.current?.click()} className={cn('flex w-full items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-sm font-semibold', files.length ? 'border-brand-600 text-brand-600' : 'border-field text-muted hover:border-brand-600')}>
            <Upload className="h-4 w-4" />
            {files.length ? files.map((f) => f.name).join(', ') : 'Zgjidh skedarët (PDF, foto, Word, Excel)'}
          </button>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </div>
        <MetaFields m={m} setM={setM} />
      </div>
      {errors.length > 0 && <div className="mt-3 text-sm text-warn-700">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
    </Dialog>
  )
}

function MetaDialog({ file, onClose, onSaved }: { file: ArchiveFile | null; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState<ArchiveMeta>({ category: 'other' })
  useEffect(() => {
    if (file) setM({ category: file.category, title: file.title, period: file.period, note: file.note, shared: file.shared })
  }, [file])
  const save = useMutation({
    mutationFn: () => saveArchiveMeta(file!.id, m),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Dialog
      open={Boolean(file)}
      onClose={onClose}
      title="Të dhënat e dokumentit"
      subtitle={file?.file_name}
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MetaFields m={m} setM={setM} />
      </div>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}
