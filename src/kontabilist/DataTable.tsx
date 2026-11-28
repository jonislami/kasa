import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Columns3, Download, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { downloadReport } from './reportApi'
import type { Kind, Row as ReportRow } from './reportXlsx'

export interface Column<T> {
  id: string
  label: string
  render: (row: T) => ReactNode
  /** Plain value for search, sorting (when `sort` is missing) and export. */
  text?: (row: T) => string
  sort?: (row: T) => string | number
  /** A money column: right-aligned, summed in the footer and in the selection, exported as a number. */
  money?: (row: T) => number
  align?: 'left' | 'right'
  width?: number
  /** Hidden until the user turns it on. */
  hidden?: boolean
  /** Cannot be hidden. */
  fixed?: boolean
}

interface Saved {
  hidden?: Record<string, boolean>
  widths?: Record<string, number>
  sort?: { id: string; dir: 1 | -1 } | null
}

const KEY = (id: string) => `acc.table.${id}`
const loadSaved = (id: string): Saved => {
  try {
    return JSON.parse(localStorage.getItem(KEY(id)) ?? '{}') as Saved
  } catch {
    return {}
  }
}

/**
 * The table of the program: sticky header, sort by any column, columns to show / hide and resize (kept per user
 * and per table in this browser), quick search ("/"), several rows at once with their totals, keyboard
 * (↑ ↓ Enter), footer totals of the money columns and Excel of what is shown.
 */
export function DataTable<T>({
  id,
  rows,
  columns,
  rowKey,
  onOpen,
  selectable,
  bulk,
  filters,
  actions,
  empty,
  loading,
  error,
  exportName,
  title,
  maxHeight = 'calc(100dvh - 210px)',
  limit = 500,
}: {
  /** Storage key of this table's settings. */
  id: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onOpen?: (row: T) => void
  selectable?: boolean
  /** Actions for the selected rows. */
  bulk?: (selected: T[], clear: () => void) => ReactNode
  /** Extra filter controls left of the search. */
  filters?: ReactNode
  /** Buttons at the right end of the toolbar (e.g. "New"). */
  actions?: ReactNode
  empty?: ReactNode
  loading?: boolean
  error?: string | null
  exportName?: string
  /** Title of the exported report (e.g. "Faturat e shitjes"). */
  title?: string
  maxHeight?: string
  limit?: number
}) {
  const [saved, setSaved] = useState<Saved>(() => loadSaved(id))
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [colsOpen, setColsOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const [shown, setShown] = useState(limit)
  const searchRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY(id), JSON.stringify(saved))
    } catch {
      /* storage unavailable */
    }
  }, [id, saved])

  // "/" focuses the search of the first table on the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== '/' || (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) || document.querySelector('[role="dialog"]')) return
      const first = document.querySelector<HTMLInputElement>('[data-table-search]')
      if (first !== searchRef.current) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isHidden = (c: Column<T>) => !c.fixed && (saved.hidden?.[c.id] ?? c.hidden ?? false)
  const visible = columns.filter((c) => !isHidden(c))
  const textOf = (c: Column<T>, r: T) => (c.text ? c.text(r) : c.money ? c.money(r).toFixed(2) : '')

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let out = words.length ? rows.filter((r) => {
      const hay = columns.map((c) => textOf(c, r)).join(' ').toLowerCase()
      return words.every((w) => hay.includes(w))
    }) : rows
    const s = saved.sort
    const col = s && columns.find((c) => c.id === s.id)
    if (s && col) {
      const val = (r: T) => (col.sort ? col.sort(r) : col.money ? col.money(r) : textOf(col, r).toLowerCase())
      out = [...out].sort((a, b) => {
        const x = val(a)
        const y = val(b)
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'sq')) * s.dir
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, saved.sort, columns])

  useEffect(() => {
    setCursor(-1)
    setShown(limit)
  }, [q, rows, limit])
  // drop selected rows that are no longer in the data
  useEffect(() => {
    setSel((cur) => {
      const keys = new Set(rows.map(rowKey))
      const next = new Set([...cur].filter((k) => keys.has(k)))
      return next.size === cur.size ? cur : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const selected = list.filter((r) => sel.has(rowKey(r)))
  const moneyCols = visible.filter((c) => c.money)
  const sumOf = (rs: T[], c: Column<T>) => rs.reduce((s, r) => s + (c.money?.(r) ?? 0), 0)
  const allOn = list.length > 0 && selected.length === list.length

  const toggleSort = (c: Column<T>) => {
    const s = saved.sort
    setSaved({ ...saved, sort: !s || s.id !== c.id ? { id: c.id, dir: c.money ? -1 : 1 } : s.dir === (c.money ? -1 : 1) ? { id: c.id, dir: (c.money ? 1 : -1) as 1 | -1 } : null })
  }

  const startResize = (c: Column<T>, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).parentElement!
    const start = e.clientX
    const w0 = th.getBoundingClientRect().width
    const move = (ev: PointerEvent) => {
      const w = Math.max(56, Math.round(w0 + ev.clientX - start))
      setSaved((s) => ({ ...s, widths: { ...s.widths, [c.id]: w } }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const exportRows = async (rs: T[]) => {
    // the common report layout: column kinds from the table (amounts, dates, codes), totals of the amounts
    const kindOf = (c: Column<T>): Kind => (c.money ? 'money' : /^(data|afati|fillimi|përfundimi)/i.test(c.label) ? 'date' : /nui|nr\.|iban|konto|kodi/i.test(c.label) ? 'code' : 'text')
    const kinds = visible.map(kindOf)
    const rows: ReportRow[] = rs.map((r) => ({ cells: visible.map((c) => (c.money ? Math.round(c.money(r) * 100) / 100 : textOf(c, r))) }))
    rows.push({ cells: visible.map((c, i) => (c.money ? Math.round(sumOf(rs, c) * 100) / 100 : i === 0 ? `Gjithsej (${rs.length})` : null)), style: 'total' })
    await downloadReport(`${(exportName ?? id).replace(/[\\/:*?"<>|]+/g, ' ')}.xlsx`, [{ name: title ?? 'Lista', columns: visible.map((c, i) => ({ header: c.label, kind: kinds[i] })), rows }], { title })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((v) => Math.min(v + 1, Math.min(list.length, shown) - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((v) => Math.max(v - 1, 0))
    } else if (e.key === 'Enter' && cursor >= 0 && list[cursor]) onOpen?.(list[cursor])
    else if (e.key === ' ' && selectable && cursor >= 0 && list[cursor]) {
      e.preventDefault()
      const k = rowKey(list[cursor])
      setSel((cur) => {
        const n = new Set(cur)
        if (n.has(k)) n.delete(k)
        else n.add(k)
        return n
      })
    }
  }
  useEffect(() => {
    if (cursor < 0) return
    bodyRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const width = (c: Column<T>) => saved.widths?.[c.id] ?? c.width

  return (
    <div className="flex flex-col border border-line bg-white">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-2">
        <div className="relative w-full sm:w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            data-table-search
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('')
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                bodyRef.current?.focus()
                setCursor(0)
              }
            }}
            placeholder="Kërko në listë  /"
            className="h-[44px] w-full rounded-ctl border border-field bg-white pl-8 pr-7 text-[16px] md:h-8 md:text-[13px]"
          />
          {q && (
            <button type="button" aria-label="Fshi kërkimin" onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {filters}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="px-1 text-[12px] tabular-nums text-muted">{list.length === rows.length ? `${rows.length} rreshta` : `${list.length} nga ${rows.length}`}</span>
          <div className="relative">
            <ToolButton onClick={() => setColsOpen((v) => !v)} title="Kolonat">
              <Columns3 className="h-3.5 w-3.5" /> Kolonat
            </ToolButton>
            {colsOpen && (
              <div className="absolute right-0 top-9 z-30 w-[220px] border border-line bg-white py-1 shadow-pop" onMouseLeave={() => setColsOpen(false)}>
                {columns.map((c) => (
                  <label key={c.id} className={cn('flex items-center gap-2 px-3 py-1.5 text-[13px]', c.fixed ? 'text-muted' : 'cursor-pointer hover:bg-bg')}>
                    <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" disabled={c.fixed} checked={!isHidden(c)} onChange={(e) => setSaved({ ...saved, hidden: { ...saved.hidden, [c.id]: !e.target.checked } })} />
                    {c.label}
                  </label>
                ))}
                <button type="button" className="mt-1 w-full border-t border-line px-3 py-1.5 text-left text-[12px] text-brand-600 hover:bg-bg" onClick={() => setSaved({})}>
                  Rikthe kolonat, gjerësitë dhe renditjen
                </button>
              </div>
            )}
          </div>
          <ToolButton onClick={() => void exportRows(list)} title="Shkarko në Excel atë që shihet" disabled={!list.length}>
            <Download className="h-3.5 w-3.5" /> Excel
          </ToolButton>
          {actions}
        </div>
      </div>

      {/* selection bar */}
      {selectable && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-brand-50 px-3 py-1.5 text-[13px]">
          <span className="font-semibold">{selected.length} të zgjedhura</span>
          {moneyCols.map((c) => (
            <span key={c.id} className="tabular-nums text-muted">
              {c.label}: <b className="text-ink">{formatEUR(sumOf(selected, c))}</b>
            </span>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <ToolButton onClick={() => void exportRows(selected)}>
              <Download className="h-3.5 w-3.5" /> Excel i zgjedhjeve
            </ToolButton>
            {bulk?.(selected, () => setSel(new Set()))}
            <ToolButton onClick={() => setSel(new Set())}>Hiq zgjedhjen</ToolButton>
          </div>
        </div>
      )}

      {/* table */}
      <div ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown} className="relative overflow-auto outline-none" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-[13px]" style={{ tableLayout: Object.keys(saved.widths ?? {}).length ? 'fixed' : 'auto' }}>
          <colgroup>
            {selectable && <col style={{ width: 34 }} />}
            {visible.map((c) => (
              <col key={c.id} style={width(c) ? { width: width(c) } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {selectable && (
                <th className="sticky top-0 z-10 border-b border-line bg-[#F5F6F8] px-2 text-left">
                  <input
                    type="checkbox"
                    aria-label="Zgjidh të gjitha"
                    className="h-3.5 w-3.5 accent-brand-600"
                    checked={allOn}
                    onChange={() => setSel(allOn ? new Set() : new Set(list.map(rowKey)))}
                  />
                </th>
              )}
              {visible.map((c) => {
                const s = saved.sort?.id === c.id ? saved.sort.dir : 0
                const right = c.align === 'right' || Boolean(c.money)
                return (
                  <th key={c.id} className={cn('group sticky top-0 z-10 select-none whitespace-nowrap border-b border-line bg-[#F5F6F8] p-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted')}>
                    <button type="button" onClick={() => toggleSort(c)} className={cn('flex w-full items-center gap-1 px-2.5 py-2 hover:text-ink', right && 'justify-end')} title="Rendit">
                      <span className="truncate">{c.label}</span>
                      {s === 1 && <ArrowUp className="h-3 w-3 shrink-0" />}
                      {s === -1 && <ArrowDown className="h-3 w-3 shrink-0" />}
                    </button>
                    <span onPointerDown={(e) => startResize(c, e)} className="absolute right-0 top-0 hidden h-full w-1.5 cursor-col-resize group-hover:bg-field md:block" aria-hidden />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visible.length + 1} className="px-3 py-8 text-center text-muted">
                  Duke ngarkuar…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={visible.length + 1} className="px-3 py-6 text-warn-700">
                  {error}
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={visible.length + 1} className="px-3 py-8 text-center text-muted">
                  {rows.length ? 'Asnjë rresht me këtë kërkim.' : empty ?? 'Asnjë rresht.'}
                </td>
              </tr>
            ) : (
              list.slice(0, shown).map((r, i) => {
                const k = rowKey(r)
                const on = sel.has(k)
                return (
                  <tr
                    key={k}
                    data-row={i}
                    onClick={() => {
                      setCursor(i)
                      onOpen?.(r)
                    }}
                    className={cn(onOpen && 'cursor-pointer', on ? 'bg-brand-50' : i === cursor ? 'bg-[#EEF2F8]' : 'hover:bg-[#F7F8FA]')}
                  >
                    {selectable && (
                      <td className="border-b border-line px-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Zgjidh"
                          className="h-3.5 w-3.5 accent-brand-600"
                          checked={on}
                          onChange={() =>
                            setSel((cur) => {
                              const n = new Set(cur)
                              if (n.has(k)) n.delete(k)
                              else n.add(k)
                              return n
                            })
                          }
                        />
                      </td>
                    )}
                    {visible.map((c) => (
                      <td key={c.id} className={cn('truncate border-b border-line px-2.5 py-[7px] align-middle text-ink', (c.align === 'right' || c.money) && 'text-right tabular-nums')}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
          {moneyCols.length > 0 && list.length > 0 && !loading && (
            <tfoot>
              <tr className="font-semibold">
                {selectable && <td className="sticky bottom-0 border-t border-line bg-[#F5F6F8]" />}
                {visible.map((c, i) => (
                  <td key={c.id} className={cn('sticky bottom-0 truncate border-t border-line bg-[#F5F6F8] px-2.5 py-2', c.money && 'text-right tabular-nums')}>
                    {c.money ? formatEUR(sumOf(list, c)) : i === 0 ? `Gjithsej (${list.length})` : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {list.length > shown && (
          <button type="button" onClick={() => setShown(shown + limit)} className="w-full border-t border-line px-3 py-2 text-left text-[13px] font-semibold text-brand-600 hover:bg-bg">
            Shfaq {Math.min(limit, list.length - shown)} të tjera ({list.length - shown} mbeten)
          </button>
        )}
      </div>
    </div>
  )
}

export function ToolButton({ className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn('inline-flex h-[44px] items-center gap-1.5 rounded-ctl border border-field bg-white px-2.5 text-[13px] font-medium text-ink hover:bg-[#F7F8FA] disabled:text-muted md:h-8', className)}
      {...rest}
    />
  )
}

/** A compact segmented filter (status tabs above a table). */
export function Segments<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string; count?: number }[] }) {
  return (
    <div className="flex h-[44px] items-stretch overflow-hidden rounded-ctl border border-field md:h-8">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('whitespace-nowrap px-2.5 text-[13px]', i > 0 && 'border-l border-field', value === o.value ? 'bg-brand-600 font-semibold text-white' : 'bg-white text-ink hover:bg-[#F7F8FA]')}
        >
          {o.label}
          {o.count != null && <span className={cn('ml-1 tabular-nums', value === o.value ? 'text-white/75' : 'text-muted')}>{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
