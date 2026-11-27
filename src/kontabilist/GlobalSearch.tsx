import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import { addMonths, formatDay, monthStart } from '@/features/accounting/api'
import { fetchClients } from './api'
import { MENU, OFFICE_NAV } from './nav'

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface DocHit {
  id: string
  client_id: string
  kind: 'sale' | 'purchase' | 'proforma'
  doc_no: string | null
  doc_date: string
  partner_name: string | null
  partner_nui: string | null
  total: number
}

type Item =
  | { kind: 'client'; id: string; title: string; sub: string }
  | { kind: 'page'; to: string; title: string; sub: string }
  | { kind: 'doc'; to: string; title: string; sub: string; amount: number }

const DOC_TAB = { sale: 'shitjet', purchase: 'blerjet', proforma: 'proformat' } as const
const DOC_LABEL = { sale: 'Shitje', purchase: 'Blerje', proforma: 'Proformë' } as const

/**
 * Documents of every client the user may see (RLS on acc_documents): by number, partner or NUI.
 * Two words or more must all match the partner / number.
 */
async function searchDocs(q: string, clientId?: string): Promise<DocHit[]> {
  // the database looks for the longest word; every word must then match number / partner / NUI
  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\-/]+/gu, ' ').split(/\s+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  const key = [...words].sort((a, b) => b.length - a.length)[0]
  const like = `%${key}%`
  const { data, error } = await supabase
    .from('acc_documents')
    .select('id, client_id, kind, doc_no, doc_date, partner_name, partner_nui, total')
    .or(`doc_no.ilike.${like},partner_name.ilike.${like},partner_nui.ilike.${like}`)
    .order('doc_date', { ascending: false })
    .limit(40)
  if (error) return []
  const rows = ((data as Record<string, unknown>[]) ?? [])
    .map((r) => ({ ...(r as unknown as DocHit), total: Number(r.total) || 0 }))
    .filter((r) => {
      const hay = fold(`${r.doc_no ?? ''} ${r.partner_name ?? ''} ${r.partner_nui ?? ''}`)
      return words.every((w) => hay.includes(fold(w)))
    })
  // the open company first
  return (clientId ? [...rows.filter((r) => r.client_id === clientId), ...rows.filter((r) => r.client_id !== clientId)] : rows).slice(0, 12)
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}

/**
 * Global search (Ctrl+K, or the box in the top bar): companies, pages and documents in one list, keyboard only.
 * A company opens on the page you are on (from one client's VAT return straight to the next one's).
 */
export function GlobalSearch({ open, onClose, clientId, active, linked }: { open: boolean; onClose: () => void; clientId?: string; active?: string; linked: boolean }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const month = addMonths(monthStart(), -1) // same list (and cache) as the companies page
  const clients = useQuery({ queryKey: ['clients', month], queryFn: () => fetchClients(month), enabled: open, staleTime: 60_000 })
  const dq = useDebounced(q, 200)
  const docs = useQuery({ queryKey: ['acc-search', dq, clientId], queryFn: () => searchDocs(dq, clientId), enabled: open && dq.trim().length >= 2, staleTime: 30_000 })

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => input.current?.focus(), 0)
    }
  }, [open])

  const names = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data])

  const groups = useMemo(() => {
    const s = fold(q.trim())
    const words = s.split(/\s+/).filter(Boolean)
    const match = (text: string) => words.every((w) => text.includes(w))
    const cs: Item[] = (clients.data ?? [])
      .filter((c) => c.active && c.id !== clientId && (!words.length || match(fold(`${c.name} ${c.nui ?? ''} ${c.city ?? ''} ${c.vat_number ?? ''}`))))
      .slice(0, words.length ? 8 : 6)
      .map((c) => ({ kind: 'client', id: c.id, title: c.name, sub: [c.nui && `NUI ${c.nui}`, c.city, c.vat_registered ? 'në TVSH' : 'jo TVSH'].filter(Boolean).join(' · ') }))
    const pages: Item[] = words.length
      ? [
          ...(clientId
            ? MENU.flatMap((g) =>
                g.items
                  .filter((i) => (!i.kasaOnly || linked) && match(fold(`${i.label} ${g.group} ${i.keywords ?? ''}`)))
                  .map((i) => ({ kind: 'page' as const, to: i.key === 'paneli' ? `/klient/${clientId}` : `/klient/${clientId}/${i.key}`, title: i.label, sub: g.group })),
              )
            : []),
          ...OFFICE_NAV.filter((i) => match(fold(i.label))).map((i) => ({ kind: 'page' as const, to: i.to, title: i.label, sub: 'Zyra' })),
        ].slice(0, 6)
      : []
    const ds: Item[] = (dq.trim().length >= 2 ? docs.data ?? [] : []).map((d) => ({
      kind: 'doc',
      to: `/klient/${d.client_id}/${DOC_TAB[d.kind]}?doc=${d.id}`,
      title: `${DOC_LABEL[d.kind]} ${d.doc_no || '(pa numër)'} · ${d.partner_name || '—'}`,
      sub: `${names.get(d.client_id) ?? ''} · ${formatDay(d.doc_date)}${d.partner_nui ? ` · NUI ${d.partner_nui}` : ''}`,
      amount: d.total,
    }))
    return [
      { label: 'Faqet', items: pages },
      { label: 'Kompanitë', items: cs },
      { label: 'Dokumentet', items: ds },
    ].filter((g) => g.items.length)
  }, [q, dq, clients.data, docs.data, clientId, linked, names])

  const flat = groups.flatMap((g) => g.items)
  useEffect(() => setSel(0), [q])

  const go = (it: Item) => {
    onClose()
    if (it.kind === 'client') navigate(active && active !== 'paneli' ? `/klient/${it.id}/${active}` : `/klient/${it.id}`)
    else navigate(it.to)
  }

  if (!open) return null
  let n = -1
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[#0F172A]/35 px-3 pt-[10vh]" onMouseDown={onClose}>
      <div className="w-full max-w-[640px] overflow-hidden rounded-card border border-line bg-white shadow-pop" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Kërkimi">
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((v) => Math.min(v + 1, flat.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((v) => Math.max(v - 1, 0))
              } else if (e.key === 'Enter' && flat[sel]) go(flat[sel])
            }}
            placeholder="Kompania, NUI, nr. i faturës, partneri ose faqja…"
            className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14px]"
            style={{ boxShadow: 'none' }}
          />
          {docs.isFetching && <span className="text-[11px] text-muted">duke kërkuar…</span>}
        </div>
        <div className="max-h-[60vh] overflow-y-auto pb-1">
          {clients.isLoading && <p className="px-4 py-3 text-sm text-muted">Duke ngarkuar…</p>}
          {!clients.isLoading && !flat.length && <p className="px-4 py-3 text-sm text-muted">{q.trim() ? `Asgjë me "${q}".` : 'Shkruaj për të kërkuar.'}</p>}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{g.label}</div>
              {g.items.map((it) => {
                n += 1
                const i = n
                return (
                  <button
                    key={it.kind + (it.kind === 'client' ? it.id : it.to)}
                    type="button"
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it)}
                    className={cn('flex w-full items-center gap-3 px-3.5 py-1.5 text-left', i === sel ? 'bg-brand-100' : 'hover:bg-[#F5F6F8]')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{it.title}</span>
                      <span className="block truncate text-[12px] text-muted">{it.sub}</span>
                    </span>
                    {it.kind === 'doc' && <span className="shrink-0 text-[13px] tabular-nums text-ink">{formatEUR(it.amount)}</span>}
                    {i === sel && <kbd className="shrink-0 text-[11px] text-muted">↵</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex gap-4 border-t border-line bg-[#F9FAFB] px-3.5 py-1.5 text-[11px] text-muted">
          <span>↑ ↓ zgjidh</span>
          <span>↵ hap</span>
          <span>Esc mbyll</span>
          {clientId && active && active !== 'paneli' && <span className="ml-auto">Kompania tjetër hapet në të njëjtën faqe</span>}
        </div>
      </div>
    </div>
  )
}
