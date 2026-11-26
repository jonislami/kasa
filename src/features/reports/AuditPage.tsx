import { friendlyMessage, NOT_READY } from '@/lib/friendlyError'
import { useMemo, useState } from 'react'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { KOSOVO_TZ } from '@/lib/clock'
import { createPortal } from 'react-dom'
import { useBusiness } from '@/app/AuthProvider'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, EmptyState, Select, Tabs } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { fetchPeople, peopleMap } from '@/features/stock/api'
import { fetchAccountants } from '@/features/accounting/api'
import { fetchAudit, fetchChain, fetchFiscalLog, periodRange, type AuditRow, type ChainRow, type FiscalLogRow, type PeriodKey } from './api'
import { SqDateFormat } from '@/lib/sqDate'
import { isSefApp } from '@/lib/device'

type Tone = 'success' | 'warn' | 'amber' | 'neutral' | 'info'

const ACTIONS: Record<string, { label: string; tone: Tone }> = {
  login: { label: 'Hyrje', tone: 'neutral' },
  fiscal_export: { label: 'Eksport kuponësh për ATK', tone: 'amber' },
  sef_update: { label: 'Përditësim i programit', tone: 'info' },
  ecoupon_sent: { label: 'e-kupon i dërguar', tone: 'info' },
  pin_login: { label: 'Hyrje me PIN', tone: 'neutral' },
  login_failed: { label: 'Hyrje e dështuar', tone: 'warn' },
  sale: { label: 'Shitje', tone: 'success' },
  void: { label: 'Anulim', tone: 'warn' },
  refund: { label: 'Kthim malli', tone: 'amber' },
  approval_failed: { label: 'PIN i gabuar', tone: 'warn' },
  sale_price_mismatch: { label: 'Çmim i ndryshëm', tone: 'amber' },
  price_change: { label: 'Ndryshim çmimi', tone: 'amber' },
  product_create: { label: 'Produkt i ri', tone: 'info' },
  product_update: { label: 'Ndryshim produkti', tone: 'info' },
  product_archive: { label: 'Arkivim', tone: 'neutral' },
  product_delete: { label: 'Fshirje produkti', tone: 'warn' },
  unit_requested: { label: 'Kërkesë për njësi', tone: 'info' },
  vat_requested: { label: 'Kërkesë për TVSH', tone: 'info' },
  vat_approved: { label: 'Kalimi në TVSH', tone: 'success' },
  vat_rejected: { label: 'TVSH e refuzuar', tone: 'warn' },
  product_restore: { label: 'Rikthim', tone: 'neutral' },
  products_import: { label: 'Import', tone: 'info' },
  stock_entry_confirm: { label: 'Hyrje malli', tone: 'success' },
  stock_adjust: { label: 'Shkarkim', tone: 'amber' },
  inventory_confirm: { label: 'Inventarizim', tone: 'info' },
  shift_start: { label: 'Fillim ndërrimi', tone: 'neutral' },
  shift_end: { label: 'Mbyllje ndërrimi', tone: 'neutral' },
  settings_change: { label: 'Cilësime', tone: 'info' },
  pin_set: { label: 'PIN i ri', tone: 'info' },
  accountant_request: { label: 'Kërkesë kontabilisti', tone: 'info' },
  accountant_approve: { label: 'Kontabilisti u miratua', tone: 'success' },
  accountant_add: { label: 'Kontabilisti u shtua', tone: 'success' },
  accountant_reject: { label: 'Kërkesa u refuzua', tone: 'neutral' },
  accountant_unlink: { label: 'Kontabilisti u shkëput', tone: 'neutral' },
  accountant_revoke: { label: 'Qasja e hequr', tone: 'warn' },
  accountant_open: { label: 'Kontabilisti hapi librat', tone: 'neutral' },
  expense_save: { label: 'Shpenzim', tone: 'info' },
  expense_delete: { label: 'Shpenzim i fshirë', tone: 'amber' },
  period_status: { label: 'Statusi i TVSH-së', tone: 'info' },
}

const REASONS: Record<string, string> = { damage: 'i dëmtuar', expired: 'skadim', loss: 'humbje', own_use: 'përdorim i brendshëm', return_supplier: 'kthim te furnitori', correction: 'korrigjim', other: 'tjetër' }

const dtFmt = new SqDateFormat({ timeZone: KOSOVO_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function eur(v: unknown): string {
  return v == null || v === '' ? '—' : formatEUR(Number(v))
}

function pair(v: unknown, fmt: (x: unknown) => string): string | null {
  if (!Array.isArray(v) || v.length !== 2 || String(v[0]) === String(v[1])) return null
  return `${fmt(v[0])} → ${fmt(v[1])}`
}

/** Human description of an audit entry. */
export function describe(a: AuditRow): string {
  const d = a.details ?? {}
  const g = (k: string) => d[k] as unknown
  switch (a.action) {
    case 'sale':
      return [`Fatura #${String(g('invoice_no') ?? '').padStart(5, '0')}`, g('total') != null ? eur(g('total')) : null, g('offline') ? 'offline' : null].filter(Boolean).join(' · ')
    case 'void':
    case 'refund':
      return [
        g('invoice_no') ? `Nga #${String(g('ref_invoice_no') ?? g('invoice_no')).padStart(5, '0')}` : null,
        g('total') != null ? eur(g('total')) : null,
        g('reason') ? `arsyeja: "${String(g('reason'))}"` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'price_change': {
      const parts = [pair(g('sale_price'), eur) && `shitja ${pair(g('sale_price'), eur)}`, pair(g('purchase_price'), eur) && `blerja ${pair(g('purchase_price'), eur)}`, pair(g('vat_code'), String) && `TVSH ${pair(g('vat_code'), String)}`].filter(Boolean)
      return `${String(g('name') ?? '')}: ${parts.join(', ')}${g('source') === 'stock_entry' ? ' (nga hyrja e mallit)' : ''}`
    }
    case 'stock_entry_confirm':
      return [`H-${String(g('entry_no') ?? '').padStart(4, '0')}`, g('invoice_no') ? `fatura ${String(g('invoice_no'))}` : null, `${String(g('items') ?? 0)} produkte`, eur(g('total'))].filter(Boolean).join(' · ')
    case 'stock_adjust':
      return `${String(g('name') ?? '')} × ${String(g('quantity') ?? '')} · ${REASONS[String(g('reason'))] ?? String(g('reason') ?? '')}${g('value') != null ? ` · ${eur(g('value'))}` : ''}`
    case 'inventory_confirm':
      return `#${String(g('count_no') ?? '')} · ${String(g('items') ?? 0)} produkte · ${String(g('differences') ?? 0)} dallime · ${eur(g('value_diff'))}`
    case 'shift_start':
      return `Kusur në fillim ${eur(g('opening_cash'))}`
    case 'shift_end':
      return [`${Math.floor(Number(g('minutes') ?? 0) / 60)} orë ${Number(g('minutes') ?? 0) % 60} min`, g('closing_cash') != null ? `kesh ${eur(g('closing_cash'))}` : null].filter(Boolean).join(' · ')
    case 'products_import':
      return `${String(g('created') ?? 0)} të reja, ${String(g('updated') ?? 0)} të ndryshuara`
    case 'approval_failed':
      return `PIN i gabuar i menaxherit (prova ${String(g('attempt') ?? '')} nga 5)`
    case 'accountant_request':
    case 'accountant_approve':
    case 'accountant_add':
    case 'accountant_reject':
    case 'accountant_unlink':
    case 'accountant_revoke':
    case 'accountant_open':
      return [g('name'), g('office'), g('email')].filter(Boolean).map(String).join(' · ')
    case 'expense_save':
    case 'expense_delete':
      return [g('date'), g('category'), eur(g('total'))].filter(Boolean).map(String).join(' · ')
    case 'period_status':
      return `${String(g('month') ?? '').slice(0, 7)} · ${g('vat_status') === 'filed' ? 'e dorëzuar' : 'e rihapur'}`
    case 'login':
      return g('method') === 'pin' ? 'Hyri me PIN' : 'Hyri me email'
    default: {
      const name = g('name')
      if (name) return String(name)
      const keys = Object.keys(d)
      return keys.length ? keys.map((k) => `${k}: ${typeof d[k] === 'object' ? JSON.stringify(d[k]) : String(d[k])}`).join(', ').slice(0, 160) : a.entity ?? ''
    }
  }
}

const FISCAL_ACTIONS: Record<string, string> = { verify: 'Kodi i verifikimit', signcsr: 'Certifikata', coupon: 'Kupon fiskal', store: 'Ruajtja e përgjigjes' }

/** Integrity Check of one row: OK, broken, or written before the chain (0057). */
function integrity(c: ChainRow | undefined): { label: string; tone: Tone } {
  if (!c || c.intact == null) return { label: 'Pa zinxhir', tone: 'neutral' }
  return c.intact ? { label: 'OK', tone: 'success' } : { label: 'I PRISHUR', tone: 'warn' }
}

function download(name: string, header: string[], body: string[][]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [header.map(esc).join(';'), ...body.map((r) => r.map(esc).join(';'))]
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

const fiscalText = (f: FiscalLogRow) =>
  [f.coupon_id ? `Kuponi ${String(f.coupon_id)}` : null, f.http_status ? `HTTP ${f.http_status}` : null, f.env === 'test' ? 'test' : null, f.message].filter(Boolean).join(' · ')

type Tab = 'actions' | 'fiscal'

export function AuditPage() {
  const { business } = useBusiness()
  const [tab, setTab] = useState<Tab>('actions')
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const range = periodRange(period)

  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, staleTime: 5 * 60_000 })
  const audit = useQuery({
    queryKey: ['audit', range.from, range.to, userId, action],
    queryFn: () => fetchAudit({ from: range.from, to: range.to, userId: userId || undefined, action: action || undefined }),
    enabled: tab === 'actions',
  })
  const fiscal = useQuery({ queryKey: ['fiscal-log', range.from, range.to], queryFn: () => fetchFiscalLog({ from: range.from, to: range.to }), enabled: tab === 'fiscal' })
  // Previous Hash, Current Hash, Integrity Check of each row (0057)
  const chain = useQuery({
    queryKey: ['log-chain', tab, range.from, range.to, tab === 'actions' ? audit.dataUpdatedAt : fiscal.dataUpdatedAt],
    queryFn: () => fetchChain(tab === 'actions' ? 'audit' : 'fiscal', range.from, range.to),
  })
  const registers = useQuery({
    queryKey: ['register-names', business.id],
    queryFn: async () => new Map(((await supabase.from('registers').select('id, name')).data ?? []).map((r) => [r.id as string, r.name as string])),
    staleTime: 5 * 60_000,
    enabled: tab === 'fiscal',
  })
  // The accountant is not in profiles; without migration 0012 the list is simply empty.
  const accountants = useQuery({ queryKey: ['accountants', business.id], queryFn: () => fetchAccountants().catch(() => []), staleTime: 5 * 60_000 })
  const names = useMemo(() => {
    const m = new Map(peopleMap(people.data))
    for (const a of accountants.data ?? []) m.set(a.user_id, `${a.full_name || a.email} (kontabilist)`)
    return m
  }, [people.data, accountants.data])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (audit.data ?? []).map((a) => ({ a, text: describe(a) }))
    return s ? list.filter((x) => x.text.toLowerCase().includes(s)) : list
  }, [audit.data, q])

  const fiscalRows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (fiscal.data ?? []).map((f) => ({ f, text: fiscalText(f) }))
    return s ? list.filter((x) => x.text.toLowerCase().includes(s)) : list
  }, [fiscal.data, q])

  const links = chain.data ?? new Map<number, ChainRow>()
  const count = tab === 'actions' ? rows.length : fiscalRows.length
  const current = tab === 'actions' ? audit : fiscal

  // ATK: logs protected with an integrity check (0034 audit_verify, 0057 fiscal_verify)
  const verify = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(tab === 'actions' ? 'audit_verify' : 'fiscal_verify')
      if (error) throw new Error(['PGRST202', '42883'].includes(error.code ?? '') ? NOT_READY : friendlyMessage(error.message))
      return { ...(data as { ok: boolean; checked: number; broken: { id: number; action: string }[] }), tab }
    },
  })

  const userName = (id: string | null) => (id ? names.get(id) ?? '' : 'Sistemi')
  const registerName = (id: string | null) => (id ? registers.data?.get(id) ?? '' : '')

  const exportCsv = () => {
    const chainCols = (id: number) => {
      const c = links.get(id)
      return [c?.prev_hash ?? '', c?.hash ?? '', integrity(c).label]
    }
    if (tab === 'actions') {
      download(
        `regjistri-${range.from}-${range.to}.csv`,
        ['ID', 'Data / ora', 'Përdoruesi', 'Veprimi', 'Detajet', 'Payload', 'Previous Hash', 'Current Hash', 'Integrity Check'],
        rows.map(({ a, text }) => [String(a.id), dtFmt.format(new Date(a.created_at)), userName(a.user_id), ACTIONS[a.action]?.label ?? a.action, text, JSON.stringify(a.details ?? {}), ...chainCols(a.id)]),
      )
    } else {
      download(
        `log-fiskal-${range.from}-${range.to}.csv`,
        ['ID', 'Data / ora', 'Arka', 'Përdoruesi', 'Veprimi', 'Statusi', 'Detajet', 'Payload', 'Previous Hash', 'Current Hash', 'Integrity Check'],
        fiscalRows.map(({ f, text }) => [
          String(f.id),
          dtFmt.format(new Date(f.created_at)),
          registerName(f.register_id),
          userName(f.user_id),
          FISCAL_ACTIONS[f.action] ?? f.action,
          f.ok ? 'OK' : 'Gabim',
          text,
          f.payload ?? '',
          ...chainCols(f.id),
        ]),
      )
    }
  }

  const th = 'border-b border-line px-3 py-3 font-semibold'
  const td = 'border-b border-line px-3 py-3 align-top'
  const hashCell = (id: number) => {
    const c = links.get(id)
    const it = integrity(c)
    return (
      <td className={td}>
        <Badge tone={it.tone}>{it.label}</Badge>
        {c?.hash && (
          <div className="mt-1 font-mono text-[11px] text-muted" title={`Previous: ${c.prev_hash ?? '—'}\nCurrent: ${c.hash}`}>
            {c.hash.slice(0, 12)}…
          </div>
        )}
      </td>
    )
  }

  const printRows =
    tab === 'actions'
      ? rows.map(({ a, text }) => ({ id: a.id, at: a.created_at, who: userName(a.user_id) || '—', what: ACTIONS[a.action]?.label ?? a.action, text, payload: JSON.stringify(a.details ?? {}) }))
      : fiscalRows.map(({ f, text }) => ({ id: f.id, at: f.created_at, who: registerName(f.register_id) || '—', what: FISCAL_ACTIONS[f.action] ?? f.action, text, payload: f.payload ?? '' }))

  return (
    <>
      <PageHeader
        title={isSefApp ? 'Raporti i auditit' : 'Regjistri i veprimeve'}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
              Kontrollo integritetin
            </Button>
            {/* the audit report is downloaded only from the SEF app; the web app shows it */}
            {isSefApp && (
              <>
                <Button variant="secondary" onClick={exportCsv} disabled={count === 0}>
                  CSV
                </Button>
                <Button variant="secondary" onClick={() => window.print()} disabled={count === 0}>
                  PDF
                </Button>
              </>
            )}
          </div>
        }
      />
      {!isSefApp && (
        <p className="mx-4 mb-4 rounded-ctl bg-[#EFF6FF] px-4 py-3 text-sm text-bt-600 md:mx-8">
          Raporti i auditit (CSV / PDF) shkarkohet vetëm nga programi SEF: hyr me PIN-in e pronarit ose të menaxherit, pastaj Menuja → Raporti i auditit.
        </p>
      )}
      <p className="-mt-5 hidden px-8 pb-5 text-muted md:block">
        {tab === 'actions'
          ? 'Çdo veprim në arkë dhe në cilësime, me kohën dhe përdoruesin. Nuk mund të fshihet; çdo rresht është i lidhur me të mëparshmin (SHA-256), që çdo ndryshim të zbulohet.'
          : 'Çdo komunikim me ATK-në: regjistrimi i arkës, çdo kupon i dërguar me payload-in e tij dhe përgjigjja. Çdo rresht është i lidhur me të mëparshmin (SHA-256).'}
      </p>
      <div className="mb-4 px-4 md:px-8 print:hidden">
        <Tabs
          value={tab}
          onChange={(v) => {
            setTab(v)
            verify.reset()
          }}
          options={[
            { value: 'actions', label: 'Veprimet' },
            { value: 'fiscal', label: 'Komunikimi me ATK' },
          ]}
        />
      </div>
      {verify.data && verify.data.tab === tab && (
        <div className={`mx-4 mb-4 rounded-ctl px-4 py-3 text-sm md:mx-8 ${verify.data.ok ? 'bg-brand-100 text-brand-600' : 'bg-warn-100 text-warn-700'}`}>
          {verify.data.ok
            ? `Integriteti në rregull: ${verify.data.checked} rreshta të kontrolluar, asnjë ndryshim.`
            : `Kujdes: ${verify.data.broken.length} rreshta nuk përputhen me zinxhirin (${verify.data.broken.map((b) => '#' + b.id).join(', ')}).`}
        </div>
      )}
      {verify.error && <div className="mx-4 mb-4 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700 md:mx-8">{(verify.error as Error).message}</div>}

      <div className="px-4 pb-8 pt-4 md:px-8 md:pt-0">
        <Card className="overflow-hidden">
          <div className={`grid gap-3 border-b border-line p-4 sm:grid-cols-2 print:hidden ${tab === 'actions' ? 'lg:grid-cols-[180px_200px_200px_1fr]' : 'lg:grid-cols-[180px_1fr]'}`}>
            <Select
              label="Periudha"
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodKey)}
              options={[
                { value: 'today', label: 'Sot' },
                { value: 'yesterday', label: 'Dje' },
                { value: '7', label: '7 ditë' },
                { value: 'month', label: 'Ky muaj' },
              ]}
            />
            {tab === 'actions' && (
              <>
                <Select label="Përdoruesi" value={userId} onChange={(e) => setUserId(e.target.value)} options={[{ value: '', label: 'Të gjithë' }, ...[...names.entries()].map(([value, label]) => ({ value, label }))]} />
                <Select label="Veprimi" value={action} onChange={(e) => setAction(e.target.value)} options={[{ value: '', label: 'Të gjitha' }, ...Object.entries(ACTIONS).map(([value, v]) => ({ value, label: v.label }))]} />
              </>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Kërko</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko në detaje" className="h-[46px] rounded-ctl border border-field px-3.5 focus:border-brand-600 focus:outline-none" />
            </div>
          </div>

          {loadState(current) === 'offline' ? (
            <OfflineEmpty />
          ) : loadState(current) === 'loading' ? (
            <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
          ) : loadState(current) === 'error' ? (
            <EmptyState title="Regjistri nuk u ngarkua" text={(current.error as Error).message} />
          ) : count === 0 ? (
            <EmptyState title="Asnjë rresht në këtë periudhë" text="Zgjidh një periudhë më të gjatë ose hiq filtrat." />
          ) : tab === 'actions' ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[#F9FAFB]">
                  <tr className="text-left text-[13px] text-muted">
                    <th className={th + ' px-4'}>Data / ora</th>
                    <th className={th}>Përdoruesi</th>
                    <th className={th}>Veprimi</th>
                    <th className={th + ' px-4'}>Detajet</th>
                    <th className={th}>Integriteti</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ a, text }) => {
                    const meta = ACTIONS[a.action] ?? { label: a.action, tone: 'neutral' as Tone }
                    return (
                      <tr key={a.id}>
                        <td className={td + ' whitespace-nowrap px-4 font-mono text-[13px]'}>{dtFmt.format(new Date(a.created_at))}</td>
                        <td className={td + ' whitespace-nowrap'}>{a.user_id ? names.get(a.user_id) ?? '—' : 'Sistemi'}</td>
                        <td className={td}>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className={td + ' px-4'}>{text}</td>
                        {hashCell(a.id)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[#F9FAFB]">
                  <tr className="text-left text-[13px] text-muted">
                    <th className={th + ' px-4'}>Data / ora</th>
                    <th className={th}>Arka</th>
                    <th className={th}>Veprimi</th>
                    <th className={th + ' px-4'}>Detajet</th>
                    <th className={th}>Payload</th>
                    <th className={th}>Integriteti</th>
                  </tr>
                </thead>
                <tbody>
                  {fiscalRows.map(({ f, text }) => (
                    <tr key={f.id}>
                      <td className={td + ' whitespace-nowrap px-4 font-mono text-[13px]'}>{dtFmt.format(new Date(f.created_at))}</td>
                      <td className={td + ' whitespace-nowrap'}>{registerName(f.register_id) || '—'}</td>
                      <td className={td}>
                        <Badge tone={f.ok ? 'success' : 'warn'}>{FISCAL_ACTIONS[f.action] ?? f.action}</Badge>
                      </td>
                      <td className={td + ' px-4'}>{text}</td>
                      <td className={td + ' max-w-[220px] truncate font-mono text-[11px] text-muted'} title={f.payload ?? ''}>
                        {f.payload ?? '—'}
                      </td>
                      {hashCell(f.id)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between px-4 py-3 text-sm text-muted">
            <span>{count} rreshta</span>
            {(current.data?.length ?? 0) >= 1000 && <span>Shfaqen 1000 të fundit – ngushto periudhën.</span>}
          </div>
        </Card>
      </div>

      {isSefApp &&
        createPortal(
          <div className="print-root print-a4 hidden text-[10px] text-black">
            <h1 className="text-lg font-bold">
              {tab === 'actions' ? 'Regjistri i veprimeve' : 'Log-u i komunikimit me ATK'} – {business.name}
            </h1>
            <p className="mb-3">
              {range.from === range.to ? range.from : `${range.from} – ${range.to}`} · {count} rreshta · Previous Hash / Current Hash: SHA-256
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="border-b border-black py-1 pr-2">Data / ora</th>
                  <th className="border-b border-black py-1 pr-2">{tab === 'actions' ? 'Përdoruesi' : 'Arka'}</th>
                  <th className="border-b border-black py-1 pr-2">Veprimi</th>
                  <th className="border-b border-black py-1 pr-2">Detajet / Payload</th>
                  <th className="border-b border-black py-1 pr-2">Previous / Current Hash</th>
                  <th className="border-b border-black py-1">Integrity Check</th>
                </tr>
              </thead>
              <tbody>
                {printRows.map((r) => {
                  const c = links.get(r.id)
                  return (
                    <tr key={r.id} className="break-inside-avoid">
                      <td className="whitespace-nowrap border-b border-gray-300 py-1 pr-2 align-top">{dtFmt.format(new Date(r.at))}</td>
                      <td className="border-b border-gray-300 py-1 pr-2 align-top">{r.who}</td>
                      <td className="border-b border-gray-300 py-1 pr-2 align-top">{r.what}</td>
                      <td className="border-b border-gray-300 py-1 pr-2 align-top">
                        {r.text}
                        {r.payload && <div className="break-all font-mono text-[7px] text-gray-600">{r.payload}</div>}
                      </td>
                      <td className="max-w-[170px] break-all border-b border-gray-300 py-1 pr-2 align-top font-mono text-[7px]">
                        {c?.prev_hash ?? '—'}
                        <br />
                        {c?.hash ?? '—'}
                      </td>
                      <td className="border-b border-gray-300 py-1 align-top">{integrity(c).label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>,
          document.body,
        )}
    </>
  )
}
