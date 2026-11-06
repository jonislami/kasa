import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBusiness } from '@/app/AuthProvider'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, EmptyState, Select } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { fetchPeople } from '@/features/stock/api'
import { fetchAudit, periodRange, type AuditRow, type PeriodKey } from './api'

type Tone = 'success' | 'warn' | 'amber' | 'neutral' | 'info'

const ACTIONS: Record<string, { label: string; tone: Tone }> = {
  login: { label: 'Hyrje', tone: 'neutral' },
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
  product_restore: { label: 'Rikthim', tone: 'neutral' },
  products_import: { label: 'Import', tone: 'info' },
  stock_entry_confirm: { label: 'Hyrje malli', tone: 'success' },
  stock_adjust: { label: 'Shkarkim', tone: 'amber' },
  inventory_confirm: { label: 'Inventarizim', tone: 'info' },
  shift_start: { label: 'Fillim ndërrimi', tone: 'neutral' },
  shift_end: { label: 'Mbyllje ndërrimi', tone: 'neutral' },
  settings_change: { label: 'Cilësime', tone: 'info' },
  pin_set: { label: 'PIN i ri', tone: 'info' },
}

const REASONS: Record<string, string> = { damage: 'i dëmtuar', expired: 'skadim', loss: 'humbje', own_use: 'përdorim i brendshëm', return_supplier: 'kthim te furnitori', correction: 'korrigjim', other: 'tjetër' }

const dtFmt = new Intl.DateTimeFormat('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

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

export function AuditPage() {
  const { business } = useBusiness()
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const range = periodRange(period)

  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, staleTime: 5 * 60_000 })
  const audit = useQuery({
    queryKey: ['audit', range.from, range.to, userId, action],
    queryFn: () => fetchAudit({ from: range.from, to: range.to, userId: userId || undefined, action: action || undefined }),
  })
  const names = people.data ?? new Map<string, string>()

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = (audit.data ?? []).map((a) => ({ a, text: describe(a) }))
    return s ? list.filter((x) => x.text.toLowerCase().includes(s)) : list
  }, [audit.data, q])

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [
      ['Data / ora', 'Përdoruesi', 'Veprimi', 'Detajet'].map(esc).join(';'),
      ...rows.map(({ a, text }) => [dtFmt.format(new Date(a.created_at)), a.user_id ? names.get(a.user_id) ?? '' : 'Sistemi', ACTIONS[a.action]?.label ?? a.action, text].map(esc).join(';')),
    ]
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `regjistri-${range.from}-${range.to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title="Regjistri i veprimeve"
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
              CSV
            </Button>
            <Button variant="secondary" onClick={() => window.print()} disabled={rows.length === 0}>
              PDF
            </Button>
          </div>
        }
      />
      <p className="-mt-5 hidden px-8 pb-5 text-muted md:block">Çdo veprim në arkë dhe në cilësime, me kohën dhe përdoruesin. Nuk mund të fshihet.</p>

      <div className="px-4 pb-8 pt-4 md:px-8 md:pt-0">
        <Card className="overflow-hidden">
          <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[180px_200px_200px_1fr] print:hidden">
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
            <Select label="Përdoruesi" value={userId} onChange={(e) => setUserId(e.target.value)} options={[{ value: '', label: 'Të gjithë' }, ...[...names.entries()].map(([value, label]) => ({ value, label }))]} />
            <Select label="Veprimi" value={action} onChange={(e) => setAction(e.target.value)} options={[{ value: '', label: 'Të gjitha' }, ...Object.entries(ACTIONS).map(([value, v]) => ({ value, label: v.label }))]} />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Kërko</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kërko në detaje" className="h-[46px] rounded-ctl border border-field px-3.5 focus:border-brand-600 focus:outline-none" />
            </div>
          </div>

          {audit.isLoading ? (
            <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
          ) : audit.isError ? (
            <EmptyState title="Regjistri nuk u ngarkua" text={(audit.error as Error).message} />
          ) : rows.length === 0 ? (
            <EmptyState title="Asnjë veprim në këtë periudhë" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[#F8FAF8]">
                  <tr className="text-left text-[13px] text-muted">
                    <th className="border-b border-line px-4 py-3 font-semibold">Data / ora</th>
                    <th className="border-b border-line px-3 py-3 font-semibold">Përdoruesi</th>
                    <th className="border-b border-line px-3 py-3 font-semibold">Veprimi</th>
                    <th className="border-b border-line px-4 py-3 font-semibold">Detajet</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ a, text }) => {
                    const meta = ACTIONS[a.action] ?? { label: a.action, tone: 'neutral' as Tone }
                    return (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap border-b border-line px-4 py-3 font-mono text-[13px]">{dtFmt.format(new Date(a.created_at))}</td>
                        <td className="whitespace-nowrap border-b border-line px-3 py-3">{a.user_id ? names.get(a.user_id) ?? '—' : 'Sistemi'}</td>
                        <td className="border-b border-line px-3 py-3">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="border-b border-line px-4 py-3">{text}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between px-4 py-3 text-sm text-muted">
            <span>{rows.length} veprime</span>
            {(audit.data?.length ?? 0) >= 1000 && <span>Shfaqen 1000 të fundit – ngushto periudhën.</span>}
          </div>
        </Card>
      </div>

      {createPortal(
        <div className="print-root print-a4 hidden text-[11px] text-black">
          <h1 className="text-lg font-bold">Regjistri i veprimeve – {business.name}</h1>
          <p className="mb-3">
            {range.from === range.to ? range.from : `${range.from} – ${range.to}`} · {rows.length} veprime
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left">
                <th className="border-b border-black py-1 pr-2">Data / ora</th>
                <th className="border-b border-black py-1 pr-2">Përdoruesi</th>
                <th className="border-b border-black py-1 pr-2">Veprimi</th>
                <th className="border-b border-black py-1">Detajet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, text }) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap border-b border-gray-300 py-1 pr-2 align-top">{dtFmt.format(new Date(a.created_at))}</td>
                  <td className="border-b border-gray-300 py-1 pr-2 align-top">{a.user_id ? names.get(a.user_id) ?? '—' : 'Sistemi'}</td>
                  <td className="border-b border-gray-300 py-1 pr-2 align-top">{ACTIONS[a.action]?.label ?? a.action}</td>
                  <td className="border-b border-gray-300 py-1 align-top">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
        document.body,
      )}
    </>
  )
}
