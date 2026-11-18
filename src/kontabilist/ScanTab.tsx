import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Camera, CheckCircle2, ExternalLink, FileText, Loader2, RefreshCw, RotateCw, ScanLine, Sparkles, Trash2, Upload } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import { categoryName, categoryOptions } from '@/lib/atk/catalog'
import { DuplicateInvoice, fetchPartners, openDocFile, PURCHASE_CATEGORIES, SALE_CATEGORIES, saveInvoice, savePartner, type Client, type DocCategory } from './api'
import { confirmScan, deleteScan, fetchScans, markReview, readScan, SCAN_KINDS, SCAN_STATUS, setScanKind, uploadScan, type Scan, type ScanKind, type ScanStatus } from './scan'

const n2 = (v: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.')) || 0
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

type Filter = 'todo' | 'all' | ScanStatus

/**
 * Skanimi me AI in four kinds – purchase, expense, investment, sale: photos / PDFs are read by AI, checked side by
 * side with the original and confirmed into the purchase or sales book (VAT and postings follow automatically).
 */
export function ScanTab({ client }: { client: Client }) {
  const qc = useQueryClient()
  const scans = useQuery({ queryKey: ['client', client.id, 'scans'], queryFn: () => fetchScans(client.id), refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'pending') ? 5000 : false) })
  const [filter, setFilter] = useState<Filter>('todo')
  const [kind, setKind] = useState<ScanKind>('purchase')
  const [kindFilter, setKindFilter] = useState<ScanKind | 'all'>('all')
  const [busy, setBusy] = useState<Record<string, string>>({}) // file/scan → what is happening
  const [errors, setErrors] = useState<string[]>([])
  const [open, setOpen] = useState<Scan | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['client', client.id, 'scans'] })

  const read = async (id: string, strong = false) => {
    setBusy((b) => ({ ...b, [id]: strong ? 'Duke lexuar me AI më të fortë…' : 'Duke lexuar me AI…' }))
    const r = await readScan(id, strong)
    if (r.status === 'failed' && r.error) setErrors((e) => [...e, r.error!])
    setBusy(({ [id]: _, ...rest }) => rest)
    refresh()
  }

  // Upload all, then read two at a time.
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setErrors([])
    const ids: string[] = []
    for (const f of Array.from(files)) {
      const key = 'up:' + f.name
      setBusy((b) => ({ ...b, [key]: `Duke ngarkuar ${f.name}…` }))
      try {
        ids.push(await uploadScan(client.id, f, kind))
      } catch (e) {
        setErrors((x) => [...x, (e as Error).message])
      }
      setBusy(({ [key]: _, ...rest }) => rest)
    }
    refresh()
    const queue = [...ids]
    await Promise.all([0, 1].map(async () => {
      while (queue.length) await read(queue.shift()!)
    }))
  }

  const del = useMutation({ mutationFn: deleteScan, onSuccess: refresh, onError: (e) => setErrors([(e as Error).message]) })

  const list = scans.data ?? []
  const shown = list.filter((s) => (filter === 'all' ? true : filter === 'todo' ? s.status !== 'confirmed' : s.status === filter) && (kindFilter === 'all' || (s.scan_kind ?? 'purchase') === kindFilter))
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of list) c[s.status] = (c[s.status] ?? 0) + 1
    return c
  }, [list])
  const uploading = Object.entries(busy).filter(([k]) => k.startsWith('up:'))
  const kindInfo = SCAN_KINDS.find((k) => k.value === kind)!

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Card className="p-5">
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {SCAN_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              className={cn('min-h-[52px] rounded-ctl border-2 px-3 py-2 text-left text-[15px] font-semibold', kind === k.value ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-ink hover:bg-bg')}
            >
              {k.button}
            </button>
          ))}
        </div>
        <div
          className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-field bg-[#F9FAFB] px-4 py-8 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void addFiles(e.dataTransfer.files)
          }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[16px] font-semibold tracking-[-0.01em]">{kindInfo.button}</div>
            <p className="mt-1 max-w-[560px] text-sm text-muted">
              {kindInfo.hint} Foto nga telefoni, skaner ose PDF – edhe disa njëherësh. AI lexon {kind === 'sale' ? 'blerësin' : 'furnitorin'}, NUI-në / numrin fiskal, numrin, datën, artikujt me sasi dhe çmime, bazën dhe TVSH-në sipas normave, totalin dhe kategorinë e ATK-së; ti i kontrollon pranë origjinalit dhe i konfirmon.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Zgjidh skedarët
            </Button>
            <Button variant="secondary" onClick={() => camRef.current?.click()}>
              <Camera className="h-4 w-4" /> Bëj foto
            </Button>
          </div>
          <p className="text-xs text-muted">JPG, PNG, WEBP ose PDF, deri në 20 MB · ose tërhiqi këtu</p>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
        </div>
        {uploading.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">
            {uploading.map(([k, v]) => (
              <li key={k} className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {v}
              </li>
            ))}
          </ul>
        )}
        {errors.length > 0 && (
          <div className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">
            {errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Dokumentet e skanuara</h2>
          <div className="flex flex-wrap gap-2">
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ScanKind | 'all')} className="h-9 rounded-full border border-line bg-white px-3 text-sm font-semibold text-muted">
              <option value="all">Të gjitha llojet</option>
              {SCAN_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            {(
              [
                ['todo', `Për t'u kryer (${list.length - (counts.confirmed ?? 0)})`],
                ['confirmed', `Të regjistruara (${counts.confirmed ?? 0})`],
                ['failed', `Nuk u lexuan (${counts.failed ?? 0})`],
                ['all', 'Të gjitha'],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn('h-9 rounded-full border px-3 text-sm font-semibold', filter === k ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {scans.isLoading ? (
          <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
        ) : scans.error ? (
          <p className="px-5 py-6 text-sm text-warn-700">{(scans.error as Error).message}</p>
        ) : shown.length === 0 ? (
          <EmptyState icon={<ScanLine className="h-6 w-6" />} title={filter === 'todo' ? 'Asgjë për të kontrolluar' : 'Asnjë dokument'} text="Faturat e skanuara shfaqen këtu derisa t'i konfirmosh." />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((s) => {
              const x = s.extracted
              const working = busy[s.id]
              const canOpen = ['read', 'review'].includes(s.status) && !working
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <button type="button" disabled={!canOpen} onClick={() => setOpen(s)} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl bg-bg text-muted">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className={cn('truncate font-semibold', canOpen && 'text-brand-600 hover:underline')}>
                        <span className="mr-1.5 rounded bg-bg px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted">{SCAN_KINDS.find((k) => k.value === (s.scan_kind ?? 'purchase'))!.label}</span>
                        {x?.supplier_name ?? s.file_name}
                        {x?.doc_no && <span className="font-normal text-muted"> · nr. {x.doc_no}</span>}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[
                          x?.doc_date && formatDay(x.doc_date),
                          x?.summary,
                          `${s.source === 'portal' ? 'dërguar nga klienti' : 'skanuar'} ${formatKosovoDateTime(s.created_at)}${s.scanned_by_name ? ` nga ${s.scanned_by_name}` : ''}`,
                          s.request_title && `për: ${s.request_title}`,
                          s.note,
                          s.confirmed_at && `konfirmuar${s.confirmed_by_name ? ` nga ${s.confirmed_by_name}` : ''}${s.doc_no ? ` → ${s.doc_no}` : ''}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      {s.status === 'failed' && s.error && <div className="text-xs text-warn-700">{s.error}</div>}
                      {s.suggest?.duplicate_doc_no && s.status !== 'confirmed' && (
                        <div className="text-xs text-warn-700">Mund të jetë e regjistruar tashmë: {s.suggest.duplicate_doc_no}</div>
                      )}
                    </div>
                  </button>
                  {x && <div className="text-right font-semibold tabular-nums">{formatEUR(x.total)}</div>}
                  {working ? (
                    <span className="flex items-center gap-2 text-sm text-muted">
                      <Loader2 className="h-4 w-4 animate-spin" /> {working}
                    </span>
                  ) : (
                    <Badge tone={SCAN_STATUS[s.status].tone}>{SCAN_STATUS[s.status].label}</Badge>
                  )}
                  <div className="flex gap-1">
                    {canOpen && (
                      <Button size="sm" onClick={() => setOpen(s)}>
                        Kontrollo
                      </Button>
                    )}
                    {['failed', 'pending'].includes(s.status) && !working && (
                      <Button size="sm" variant="secondary" onClick={() => void read(s.id)}>
                        <RefreshCw className="h-4 w-4" /> Lexo
                      </Button>
                    )}
                    {['failed', 'read', 'review'].includes(s.status) && !working && (
                      <Button size="sm" variant="secondary" title="Lexo përsëri me AI më të fortë (për fatura të vështira, kushton më shumë)" onClick={() => void read(s.id, true)}>
                        <Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">AI më i fortë</span>
                      </Button>
                    )}
                    {s.status !== 'confirmed' && !working && (
                      <button type="button" aria-label="Fshi" onClick={() => confirm('Ta fshij këtë skanim?') && del.mutate(s.id)} className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted hover:bg-warn-100 hover:text-warn-700">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <ScanReview
        client={client}
        scan={open}
        onClose={() => setOpen(null)}
        onDone={() => { setOpen(null); refresh() }}
        onReread={(id) => { setOpen(null); void read(id, true) }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review: original next to the data read, corrections, confirm.
// ---------------------------------------------------------------------------
interface Form {
  kind: ScanKind
  atk_category: string
  doc_type: 'invoice' | 'credit_note'
  partner_id: string
  partner_name: string
  partner_nui: string
  add_partner: boolean
  doc_no: string
  doc_date: string
  due_date: string
  category: DocCategory
  payment: 'due' | 'cash' | 'bank'
  description: string
  net_e: number
  vat_e: number
  net_d: number
  vat_d: number
  amt_c: number
  amt_a: number
}

const CAT_VALUES = new Set(PURCHASE_CATEGORIES.map((c) => c.value as string))

/** Default category for the kind: investment → fixed assets, expense → what AI found (not goods), sale → goods/services. */
function categoryFor(kind: ScanKind, s: Scan): DocCategory {
  const x = s.extracted!
  if (kind === 'sale') return [s.suggest?.category, x.category].includes('services') ? 'services' : 'goods'
  if (kind === 'investment') return 'assets'
  const cat = [s.suggest?.category, x.category].find((c) => c && CAT_VALUES.has(c)) as DocCategory | undefined
  if (kind === 'expense') return cat && cat !== 'goods' && cat !== 'assets' ? cat : 'operating'
  return cat && cat !== 'assets' ? cat : 'goods'
}

/** What was used last time for the partner, what AI chose, or the most frequent category of the lines. */
function atkOf(s: Scan): string {
  const x = s.extracted!
  if (s.suggest?.atk_category) return s.suggest.atk_category
  if (x.atk_category) return x.atk_category
  const count = new Map<string, number>()
  for (const l of x.lines) if (l.category_code) count.set(l.category_code, (count.get(l.category_code) ?? 0) + (l.total_gross ?? 1))
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

function formOf(s: Scan): Form {
  const x = s.extracted!
  const kind = s.scan_kind ?? 'purchase'
  return {
    kind,
    atk_category: atkOf(s),
    doc_type: x.doc_type === 'credit_note' ? 'credit_note' : 'invoice',
    partner_id: s.suggest?.partner_id ?? '',
    partner_name: x.supplier_name ?? '',
    partner_nui: (x.supplier_nui ?? '').replace(/\D/g, '').slice(0, 9),
    add_partner: Boolean(x.supplier_name),
    doc_no: x.doc_no ?? '',
    doc_date: x.doc_date && /^\d{4}-\d{2}-\d{2}$/.test(x.doc_date) ? x.doc_date : kosovoDateISO(),
    due_date: x.due_date && /^\d{4}-\d{2}-\d{2}$/.test(x.due_date) ? x.due_date : '',
    category: categoryFor(kind, s),
    payment: x.payment === 'cash' ? 'cash' : x.payment === 'card' || x.payment === 'bank' ? 'bank' : 'due',
    description: x.summary ?? '',
    net_e: x.net_e || 0,
    vat_e: x.vat_e || 0,
    net_d: x.net_d || 0,
    vat_d: x.vat_d || 0,
    amt_c: x.amt_c || 0,
    amt_a: x.amt_a || 0,
  }
}

function ScanReview({ client, scan, onClose, onDone, onReread }: { client: Client; scan: Scan | null; onClose: () => void; onDone: () => void; onReread: (id: string) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<Form | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [rot, setRot] = useState(0)
  const [dupe, setDupe] = useState<string | null>(null)
  const partners = useQuery({ queryKey: ['client', client.id, 'partners'], queryFn: () => fetchPartners(client.id), enabled: Boolean(scan) })

  useEffect(() => {
    if (!scan?.extracted) return
    setF(formOf(scan))
    setRot(0)
    setDupe(null)
    setUrl(null)
    void openDocFile(scan.path).then(setUrl).catch(() => setUrl(''))
    if (scan.status === 'read') void markReview(scan.id).catch(() => undefined)
  }, [scan])

  const sale = f?.kind === 'sale'
  const changeKind = (k: ScanKind) => {
    if (!scan || !f) return
    setF({ ...f, kind: k, category: categoryFor(k, scan) })
    void setScanKind(scan.id, k).catch(() => undefined)
  }
  const save = useMutation({
    mutationFn: async (force: boolean) => {
      if (!scan || !f) return
      let partnerId = f.partner_id || null
      if (!partnerId && f.add_partner && f.partner_name.trim()) {
        const x = scan.extracted!
        partnerId = await savePartner(client.id, {
          role: sale ? 'customer' : 'supplier',
          name: f.partner_name.trim(),
          nui: f.partner_nui || null,
          fiscal_number: x.supplier_fiscal_no,
          vat_number: x.supplier_vat_no,
          address: x.supplier_address,
          city: null,
          country: 'Kosovë',
          phone: null,
          email: null,
          note: null,
        })
      }
      const r = await saveInvoice(client.id, {
        kind: sale ? 'sale' : 'purchase',
        atk_category: f.atk_category || null,
        doc_type: f.doc_type,
        category: f.category,
        doc_date: f.doc_date,
        due_date: f.payment === 'due' ? f.due_date || null : null,
        doc_no: f.doc_no || null,
        partner_id: partnerId,
        partner_name: partnerId ? null : f.partner_name || null,
        partner_nui: partnerId ? null : f.partner_nui || null,
        description: f.description || null,
        lines: [],
        net_e: f.net_e,
        vat_e: f.vat_e,
        net_d: f.net_d,
        vat_d: f.vat_d,
        amt_c: f.amt_c,
        amt_a: f.amt_a,
        paid_now: f.payment === 'due' ? null : { method: f.payment },
        force,
      })
      await confirmScan(scan.id, r.id)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['client', client.id] })
      onDone()
    },
    onError: (e) => {
      if (e instanceof DuplicateInvoice) setDupe(e.message)
    },
  })

  if (!scan?.extracted || !f) return null
  const x = scan.extracted
  const total = r2(f.net_e + f.vat_e + f.net_d + f.vat_d + f.amt_c + f.amt_a)
  const off = x.total && Math.abs(total - x.total) > 0.05
  const pdf = scan.mime === 'application/pdf'
  const supplierOptions = (partners.data ?? []).filter((p) => p.active && p.role !== (sale ? 'supplier' : 'customer'))
  const party = sale ? 'Blerësi' : 'Furnitori'
  const amount = (k: 'net_e' | 'vat_e' | 'net_d' | 'vat_d' | 'amt_c' | 'amt_a', label: string, rate?: { key: 'vat_e' | 'vat_d'; r: number }) => (
    <Input
      label={label}
      inputMode="decimal"
      value={f[k] ? String(f[k]) : ''}
      onChange={(e) => {
        const v = num(e.target.value)
        setF({ ...f, [k]: v, ...(rate ? { [rate.key]: r2(v * rate.r) } : {}) })
      }}
    />
  )

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Kontrollo: ${SCAN_KINDS.find((k) => k.value === f.kind)!.label.toLowerCase()}`}
      subtitle={`${scan.file_name}${scan.model ? ' · lexuar me ' + scan.model : ''}`}
      width="md:max-w-[1200px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[15px]">
            Totali <span className="text-[22px] font-semibold tracking-[-0.015em] tabular-nums">{formatEUR(f.doc_type === 'credit_note' ? -total : total)}</span>
            {off && <span className="ml-2 text-sm text-warn-700">në faturë: {formatEUR(x.total)}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Mbyll
            </Button>
            {scan.model !== 'claude-opus-5-5' && (
              <Button variant="secondary" title="Për fatura të vështira; kushton më shumë" onClick={() => onReread(scan.id)}>
                <Sparkles className="h-4 w-4" /> Rilexo me AI më të fortë
              </Button>
            )}
            <Button loading={save.isPending && !dupe} disabled={!total} onClick={() => save.mutate(false)}>
              <CheckCircle2 className="h-4 w-4" /> Konfirmo dhe regjistro
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* original */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted">Origjinali</span>
            <div className="flex gap-1">
              {!pdf && (
                <Button size="sm" variant="secondary" onClick={() => setRot((r) => (r + 90) % 360)}>
                  <RotateCw className="h-4 w-4" /> Rrotullo
                </Button>
              )}
              {url && (
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-ctl border border-line px-3 text-sm font-semibold text-brand-600 hover:bg-bg">
                  <ExternalLink className="h-4 w-4" /> Hape
                </a>
              )}
            </div>
          </div>
          <div className="flex h-[60vh] items-center justify-center overflow-auto rounded-card border border-line bg-[#F2F4F7] lg:h-[70vh]">
            {url === null ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            ) : url === '' ? (
              <span className="text-sm text-muted">Origjinali nuk u hap</span>
            ) : pdf ? (
              <iframe title="Origjinali" src={url} className="h-full w-full" />
            ) : (
              <img src={url} alt="Fatura" style={{ transform: `rotate(${rot}deg)` }} className="max-h-full max-w-full object-contain transition-transform" />
            )}
          </div>
        </div>

        {/* data read */}
        <div className="flex flex-col gap-4">
          {(dupe || s_dupe(scan) || scan.suggest?.buyer_mismatch || x.warnings.length > 0 || x.confidence === 'low') && (
            <div className="flex flex-col gap-2">
              {(dupe || s_dupe(scan)) && (
                <div className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4" /> Mund të jetë dyfishim
                  </div>
                  {dupe ?? `Fatura ${scan.suggest!.duplicate_doc_no} e këtij furnitori është regjistruar më ${formatDay(scan.suggest!.duplicate_doc_date!)}.`}
                  {dupe && (
                    <div className="mt-2">
                      <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate(true)}>
                        Regjistroje gjithsesi
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {scan.suggest?.buyer_mismatch && (
                <div className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
                  {sale ? 'Lëshuesi i faturës' : 'Blerësi në faturë'} ({x.buyer_name ?? '—'}, NUI {x.buyer_nui}) nuk është {client.name}. A është faturë e këtij biznesi?
                </div>
              )}
              {(x.warnings.length > 0 || x.confidence === 'low') && (
                <div className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
                  <div className="font-semibold">Kontrollo{x.confidence === 'low' ? ' – fotoja lexohet me vështirësi' : ''}:</div>
                  <ul className="ml-4 list-disc">
                    {x.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {sale ? (
              <div className="rounded-ctl bg-bg px-3 py-2 text-sm text-muted sm:col-span-2">Faturë shitjeje e lëshuar nga {client.name} – hyn te libri i shitjeve.</div>
            ) : (
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-semibold text-muted">Regjistroje si</span>
                <div className="grid grid-cols-3 gap-2">
                  {SCAN_KINDS.filter((k) => k.value !== 'sale').map((k) => (
                    <button key={k.value} type="button" onClick={() => changeKind(k.value)} className={cn('h-10 rounded-ctl border text-sm font-semibold', f.kind === k.value ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-line bg-white text-muted')}>
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Select
              label="Lloji"
              value={f.doc_type}
              onChange={(e) => setF({ ...f, doc_type: e.target.value as Form['doc_type'] })}
              options={[
                { value: 'invoice', label: x.doc_type === 'receipt' ? 'Kupon fiskal / faturë' : 'Faturë' },
                { value: 'credit_note', label: 'Faturë kreditore (kthim)' },
              ]}
            />
            <Select
              label={`Kategoria${scan.suggest?.category ? ' (si herën e kaluar)' : ''}`}
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value as DocCategory })}
              options={(sale ? SALE_CATEGORIES : PURCHASE_CATEGORIES).map((c) => ({ value: c.value, label: c.label }))}
            />
            <div className="sm:col-span-2">
              <Select
                label="Kategoria sipas ATK-së"
                value={f.atk_category}
                onChange={(e) => setF({ ...f, atk_category: e.target.value })}
                options={[{ value: '', label: '— pa kategori —' }, ...categoryOptions()]}
              />
            </div>
            <div className="sm:col-span-2">
              <Select
                label={party}
                value={f.partner_id}
                onChange={(e) => setF({ ...f, partner_id: e.target.value })}
                options={[
                  { value: '', label: f.partner_name ? `I ri: ${f.partner_name}` : sale ? '— pa blerës të regjistruar —' : '— pa furnitor të regjistruar —' },
                  ...supplierOptions.map((p) => ({ value: p.id, label: p.name + (p.nui ? ` · ${p.nui}` : '') })),
                ]}
              />
            </div>
            {!f.partner_id && (
              <>
                <Input label={sale ? 'Emri i blerësit' : 'Emri i furnitorit'} value={f.partner_name} onChange={(e) => setF({ ...f, partner_name: e.target.value })} />
                <Input label="NUI" inputMode="numeric" maxLength={9} value={f.partner_nui} onChange={(e) => setF({ ...f, partner_nui: e.target.value.replace(/\D/g, '') })} />
                <label className="flex items-center gap-2 text-[15px] sm:col-span-2">
                  <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={f.add_partner} onChange={(e) => setF({ ...f, add_partner: e.target.checked })} />
                  Shtoje te {sale ? 'klientët' : 'furnitorët'} (herën tjetër njihet vetë)
                </label>
              </>
            )}
            <Input label="Nr. i faturës" value={f.doc_no} onChange={(e) => setF({ ...f, doc_no: e.target.value })} />
            <Input label="Data" type="date" value={f.doc_date} onChange={(e) => setF({ ...f, doc_date: e.target.value })} />
            <Select
              label="Pagesa"
              value={f.payment}
              onChange={(e) => setF({ ...f, payment: e.target.value as Form['payment'] })}
              options={[
                { value: 'due', label: sale ? 'E papaguar (borxh i blerësit)' : 'E papaguar (borxh te furnitori)' },
                { value: 'cash', label: 'E paguar me para në dorë' },
                { value: 'bank', label: 'E paguar me bankë / kartelë' },
              ]}
            />
            {f.payment === 'due' ? (
              <Input label="Afati i pagesës" type="date" value={f.due_date} min={f.doc_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
            ) : (
              <div />
            )}
            <div className="sm:col-span-2">
              <Input label="Përshkrimi" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-muted">Shumat sipas normave të TVSH-së</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {amount('net_e', 'Baza 18%', { key: 'vat_e', r: 0.18 })}
              {amount('vat_e', 'TVSH 18%')}
              {amount('net_d', 'Baza 8%', { key: 'vat_d', r: 0.08 })}
              {amount('vat_d', 'TVSH 8%')}
              {amount('amt_c', 'Shuma 0%')}
              {amount('amt_a', 'E liruar')}
            </div>
          </div>

          {x.lines.length > 0 && (
            <details className="rounded-card border border-line">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Artikujt e lexuar ({x.lines.length})</summary>
              <table className="w-full text-sm">
                <thead className="bg-[#F6F8FB] text-left text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Artikulli</th>
                    <th className="px-2 py-2 text-right font-medium">Sasia</th>
                    <th className="px-2 py-2 text-center font-medium">TVSH</th>
                    <th className="px-2 py-2 font-medium">Kategoria ATK</th>
                    <th className="px-4 py-2 text-right font-medium">Totali</th>
                  </tr>
                </thead>
                <tbody>
                  {x.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-4 py-1.5">{l.description}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {l.quantity != null ? `${l.quantity}${l.unit ? ' ' + l.unit : ''}` : ''}
                        {l.unit_price_net != null && <div className="text-xs text-muted">× {n2(l.unit_price_net)}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-center">{l.vat_rate}</td>
                      <td className="px-2 py-1.5 text-xs text-muted">{categoryName(l.category_code)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{l.total_gross != null ? n2(l.total_gross) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <p className="text-xs text-muted">
            {sale
              ? 'Pas konfirmimit fatura hyn te shitjet, libri i shitjeve dhe TVSH-ja e llogaritur; kontohet vetë dhe origjinali ruhet si skedar i faturës.'
              : f.kind === 'investment'
                ? 'Pas konfirmimit hyn si blerje investive (mjete themelore) te libri i blerjeve dhe TVSH-ja e zbritshme; origjinali ruhet si skedar i faturës.'
                : 'Pas konfirmimit fatura hyn te blerjet, libri i blerjeve dhe TVSH-ja e zbritshme; kontohet vetë dhe origjinali ruhet si skedar i faturës.'}
          </p>
          {save.error && !(save.error instanceof DuplicateInvoice) && <p className="text-sm text-warn-700">{(save.error as Error).message}</p>}
        </div>
      </div>
    </Dialog>
  )
}

const s_dupe = (s: Scan) => Boolean(s.suggest?.duplicate_doc_no)
