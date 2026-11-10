import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { isManagerRole } from '@/lib/business'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, ChevronLeft, Minus, Plus, Search, Send, X } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Card, Dialog, Input, Tabs } from '@/components/ui'
import { serverDate } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR, round2 } from '@/lib/money'
import { printReceipt, printTicket } from '@/lib/printer'
import { fetchCategories } from '@/features/products/api'
import { APPROVAL_MESSAGES, createSale, type ApprovalError, type PaymentMethod, type Sale } from '@/features/pos/api'
import { ApprovalDialog } from '@/features/pos/dialogs'
import { PrintArea, Receipt } from '@/features/pos/Receipt'
import { fetchReceiptSettings } from '@/features/settings/api'
import {
  addOrderItems,
  cancelOrder,
  cancelOrderItem,
  fetchMenu,
  fetchOrder,
  fetchTables,
  lineOpen,
  moveOrder,
  openOrder,
  orderTotal,
  saleLinesFor,
  sendOrder,
  setOrderItem,
  STATION_LABELS,
  type MenuItem,
  type Order,
  type OrderItem,
} from './api'
import { ticketStationsHere } from './KitchenPage'

const parseNum = (s: string) => {
  const n = Number(s.trim().replace(',', '.'))
  return s.trim() === '' ? null : Number.isFinite(n) ? n : NaN
}

/** One table's bill: add from the menu, send to kitchen/bar, pay all or part, move table. */
export function OrderPage() {
  const { tableId = 'merr' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { business, profile } = useBusiness()
  const waiter = !isManagerRole(profile.role)
  const takeaway = tableId === 'merr'

  const menu = useQuery({ queryKey: ['menu'], queryFn: fetchMenu, staleTime: 60_000 })
  const categories = useQuery({ queryKey: ['categories'], queryFn: fetchCategories })
  const tables = useQuery({ queryKey: ['tables'], queryFn: fetchTables })
  const receiptSettings = useQuery({ queryKey: ['receipt-settings'], queryFn: fetchReceiptSettings, retry: false, staleTime: 5 * 60_000 })
  const menuById = useMemo(() => new Map((menu.data ?? []).map((m) => [m.id, m])), [menu.data])

  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [pane, setPane] = useState<'menu' | 'order'>('menu')
  const [modItem, setModItem] = useState<MenuItem | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [cancelLine, setCancelLine] = useState<OrderItem | null>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [printSale, setPrintSale] = useState<Sale | null>(null)

  // Open (or load) the table's bill.
  const orderParam = params.get('order')
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const o = orderParam ? await fetchOrder(orderParam) : await openOrder({ table_id: takeaway ? null : tableId })
        if (cancelled) return
        if (!o || o.status !== 'open') {
          navigate('/tavolinat', { replace: true })
          return
        }
        setOrder(o)
        if (takeaway && !orderParam) setParams({ order: o.id }, { replace: true })
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tableId, takeaway, orderParam, navigate, setParams])

  // Others (another waiter, the kitchen) change the bill too.
  useEffect(() => {
    if (!order) return
    const t = setInterval(() => {
      void fetchOrder(order.id).then((o) => {
        if (!o) return
        if (o.status !== 'open') navigate('/tavolinat', { replace: true })
        else setOrder((cur) => (busy ? cur : o))
      })
    }, 10_000)
    return () => clearInterval(t)
  }, [order?.id, busy, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(t)
  }, [notice])

  const run = async (fn: () => Promise<Order | null | void>, msg?: string) => {
    setBusy(true)
    setError(null)
    try {
      const o = await fn()
      if (o) setOrder(o)
      if (msg) setNotice(msg)
      void qc.invalidateQueries({ queryKey: ['open-orders'] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const add = (m: MenuItem, mods: { group: string; name: string }[] = [], note?: string, qty = 1) => {
    if (!order) return
    void run(() => addOrderItems(order.id, [{ product_id: m.id, quantity: qty, modifiers: mods, note }]), `${m.name} u shtua`)
  }
  const tap = (m: MenuItem) => (m.modifiers.length ? setModItem(m) : add(m))

  const send = () =>
    order &&
    void run(async () => {
      const r = await sendOrder(order.id)
      const here = ticketStationsHere()
      let printed = 0
      if (receiptSettings.data) {
        for (const t of r.tickets.filter((t) => here.includes(t.station))) {
          try {
            if ((await printTicket(t, receiptSettings.data)) === 'printer') printed++
          } catch {
            /* the kitchen screen still shows it */
          }
        }
      }
      const where = [...new Set(r.tickets.map((t) => STATION_LABELS[t.station]))].join(' dhe ')
      const msg = where ? `U dërgua në ${where.toLowerCase()}${printed ? ' · u printua' : ''}` : 'U shënua si e dërguar'
      // The waiter goes straight back to the tables; the owner/manager stays on the bill.
      if (waiter) {
        navigate('/tavolinat', { state: { notice: `${order.table_name ? order.table_name + ': ' : ''}porosia u konfirmua · ${msg.toLowerCase()}` } })
        return null
      }
      setNotice(msg)
      return r.order
    })

  const items = order?.items ?? []
  const unsent = items.filter((i) => i.status === 'new')
  const sent = items.filter((i) => i.status !== 'new' && lineOpen(i) > 0)
  const paidLines = items.filter((i) => lineOpen(i) <= 0)
  const total = order ? orderTotal(order) : 0

  const results = useMemo(() => {
    let list = menu.data ?? []
    if (category !== 'all') list = list.filter((m) => m.category_id === category)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q))
    return list
  }, [menu.data, category, search])
  const usedCats = useMemo(() => (categories.data ?? []).filter((c) => (menu.data ?? []).some((m) => m.category_id === c.id)), [categories.data, menu.data])

  const title = takeaway ? `Për të marrë${order ? ` #${order.order_no}` : ''}` : `Tavolina ${order?.table_name ?? tables.data?.find((t) => t.id === tableId)?.name ?? ''}`

  const menuPane = (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kërko në meny" className="h-12 w-full rounded-xl border border-field bg-white pl-11 pr-4 text-[16px] focus:border-brand-600 focus:outline-none" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[{ id: 'all', name: 'Të gjitha' }, ...usedCats].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={cn('h-10 shrink-0 rounded-full border px-4 text-sm font-medium', category === c.id ? 'border-ink bg-ink text-white' : 'border-field bg-white')}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {results.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={!order || busy}
            onClick={() => tap(m)}
            className="flex min-h-[92px] flex-col rounded-card border border-line bg-white p-3.5 text-left transition-colors hover:border-brand-600 active:bg-brand-100 disabled:opacity-60"
          >
            <span className="line-clamp-2 text-[15px] font-semibold leading-tight">{m.name}</span>
            <span className="mt-auto flex items-end justify-between pt-2">
              <span className="font-bold tabular-nums">{formatEUR(m.sale_price)}</span>
              {m.modifiers.length > 0 && <span className="text-xs text-muted">opsione</span>}
            </span>
          </button>
        ))}
        {menu.data && results.length === 0 && <p className="col-span-full py-10 text-center text-muted">Asgjë nuk u gjet</p>}
      </div>
    </div>
  )

  const lineRow = (i: OrderItem) => (
    <li key={i.id} className="flex items-start gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-tight">
          {i.status === 'new' ? '' : `${lineOpen(i)} × `}
          {i.name}
        </div>
        {(i.modifiers.length > 0 || i.note) && (
          <div className="text-xs text-muted">
            {i.modifiers.map((m) => m.name + (m.price ? ` +${formatEUR(m.price)}` : '')).join(', ')}
            {i.note && <span className="font-medium text-amber-700"> · {i.note}</span>}
          </div>
        )}
        {i.status !== 'new' && (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            {i.status === 'ready' ? <Badge tone="info">Gati</Badge> : <Badge tone="neutral">{i.station ? `Në ${STATION_LABELS[i.station].toLowerCase()}` : 'Dërguar'}</Badge>}
            {i.paid_qty > 0 && <span className="text-muted">paguar {i.paid_qty}</span>}
          </div>
        )}
      </div>
      {i.status === 'new' ? (
        <div className="flex items-center gap-1">
          <button type="button" disabled={busy} onClick={() => void run(() => setOrderItem(i.id, { quantity: i.quantity - 1 }))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-field">
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-7 text-center font-semibold tabular-nums">{i.quantity}</span>
          <button type="button" disabled={busy} onClick={() => void run(() => setOrderItem(i.id, { quantity: i.quantity + 1 }))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-field">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setCancelLine(i)} title="Anulo" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-warn-700">
          <X className="h-4 w-4" />
        </button>
      )}
      <span className="w-[68px] pt-1.5 text-right font-semibold tabular-nums">{formatEUR(round2(i.unit_price * lineOpen(i)))}</span>
    </li>
  )

  const orderPane = (
    <Card className="flex flex-col lg:sticky lg:top-6 lg:max-h-[calc(100dvh-110px)] lg:w-[400px]">
      <div className="flex items-start justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <div className="text-xl font-semibold">{title}</div>
          <div className="text-sm text-muted">
            {order ? `#${order.order_no}` : ''}
            {order?.waiter_name && ` · ${order.waiter_name}`}
          </div>
        </div>
        {order && !takeaway && (
          <Button variant="secondary" size="sm" onClick={() => setMoveOpen(true)}>
            <ArrowLeftRight className="h-4 w-4" /> Ndërro
          </Button>
        )}
      </div>
      <div className="min-h-[120px] flex-1 overflow-y-auto px-5">
        {!order ? (
          <p className="py-10 text-center text-muted">{error ?? 'Duke hapur…'}</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted">Zgjidh artikujt nga menuja.</p>
        ) : (
          <>
            {unsent.length > 0 && (
              <>
                <div className="pt-3 text-xs font-semibold uppercase tracking-wide text-amber-700">Pa dërguar</div>
                <ul className="divide-y divide-line">{unsent.map(lineRow)}</ul>
              </>
            )}
            {sent.length > 0 && (
              <>
                <div className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Dërguar</div>
                <ul className="divide-y divide-line">{sent.map(lineRow)}</ul>
              </>
            )}
            {paidLines.length > 0 && <p className="py-2 text-xs text-muted">{paidLines.length} rreshta të paguar</p>}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line p-5">
        {error && order && <p className="rounded-ctl bg-warn-100 px-3 py-2 text-sm text-warn-700">{error}</p>}
        {notice && <p className="rounded-ctl bg-brand-100 px-3 py-2 text-sm font-medium text-brand-600">{notice}</p>}
        <div className="flex items-end justify-between">
          <span className="font-semibold">Për të paguar</span>
          <span className="text-[30px] font-bold leading-none tabular-nums">{formatEUR(total)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" size="lg" disabled={!unsent.length} loading={busy && unsent.length > 0} onClick={send}>
            <Send className="h-4 w-4" /> {waiter ? 'Konfirmo' : 'Dërgo'}{unsent.length ? ` (${unsent.length})` : ''}
          </Button>
          <Button size="lg" disabled={!order || total <= 0} onClick={() => setPayOpen(true)}>
            Paguaj
          </Button>
        </div>
        {order && items.length === 0 && (
          <Button variant="ghost" className="text-warn-700" onClick={() => void run(async () => {
            await cancelOrder(order.id)
            navigate('/tavolinat')
          })}>
            Mbylle pa porosi
          </Button>
        )}
      </div>
    </Card>
  )

  return (
    <div className="px-4 pb-28 pt-4 md:px-8 md:pb-8 md:pt-6">
      <Link to="/tavolinat" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
        <ChevronLeft className="h-4 w-4" /> Tavolinat
      </Link>
      <div className="mt-3 lg:hidden">
        <Tabs
          className="w-full"
          value={pane}
          onChange={setPane}
          options={[
            { value: 'menu', label: 'Menuja' },
            { value: 'order', label: `Porosia${items.length ? ` (${items.length})` : ''} · ${formatEUR(total)}` },
          ]}
        />
      </div>
      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className={cn('min-w-0 flex-1', pane !== 'menu' && 'hidden lg:block')}>
          {menuPane}
          {unsent.length > 0 && (
            <div className="sticky bottom-[calc(var(--tabbar,60px)+env(safe-area-inset-bottom)+8px)] z-20 mt-4 lg:hidden">
              <Button size="lg" className="w-full shadow-lg" loading={busy} onClick={send}>
                <Send className="h-4 w-4" /> Konfirmo porosinë ({unsent.length}) · {formatEUR(unsent.reduce((a, i) => a + i.quantity * i.unit_price, 0))}
              </Button>
            </div>
          )}
        </div>
        <div className={cn(pane !== 'order' && 'hidden lg:block')}>{orderPane}</div>
      </div>

      <ModifierDialog item={modItem} onClose={() => setModItem(null)} onAdd={(mods, note, qty) => {
        if (modItem) add(modItem, mods, note, qty)
        setModItem(null)
      }} />

      {order && (
        <PayDialog
          open={payOpen}
          order={order}
          menu={menuById}
          registerId={localStorage.getItem(`kasa.register.${business.id}`) || undefined}
          onClose={() => setPayOpen(false)}
          onPaid={async (sale) => {
            setPayOpen(false)
            setReceipt(sale)
            void qc.invalidateQueries({ queryKey: ['open-orders'] })
            void qc.invalidateQueries({ queryKey: ['today-sales'] })
            if (receiptSettings.data?.settings.auto_print) {
              try {
                if ((await printReceipt(sale, business, receiptSettings.data, { openDrawer: true })) === 'browser') {
                  setPrintSale(sale)
                  setTimeout(() => window.print(), 50)
                }
              } catch {
                /* the receipt dialog has a print button */
              }
            }
            const o = await fetchOrder(order.id)
            if (o) setOrder(o)
          }}
        />
      )}

      <Dialog open={moveOpen} onClose={() => setMoveOpen(false)} title="Ndërro tavolinën" subtitle="Në një tavolinë të zënë, porositë bashkohen." width="md:max-w-[520px]">
        <div className="grid grid-cols-4 gap-2">
          {(tables.data ?? [])
            .filter((t) => t.id !== order?.table_id)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setMoveOpen(false)
                  if (order)
                    void run(async () => {
                      const o = await moveOrder(order.id, t.id)
                      navigate(`/tavolinat/${t.id}`, { replace: true })
                      return o
                    }, `U kalua në tavolinën ${t.name}`)
                }}
                className="h-16 rounded-xl border border-line font-bold hover:border-brand-600"
              >
                {t.name}
                <span className="block text-xs font-normal text-muted">{t.area}</span>
              </button>
            ))}
        </div>
      </Dialog>

      <CancelLineDialog
        line={cancelLine}
        requester={profile.full_name || 'Kamarieri'}
        onClose={() => setCancelLine(null)}
        onDone={(o) => {
          setCancelLine(null)
          setOrder(o)
          setNotice('Artikulli u anulua')
          void qc.invalidateQueries({ queryKey: ['open-orders'] })
        }}
      />

      <Dialog open={Boolean(receipt)} onClose={() => (order && orderTotal(order) <= 0 ? navigate('/tavolinat') : setReceipt(null))} width="md:max-w-[440px]">
        {receipt && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <div className="text-sm text-muted">Pagesa u krye</div>
              <div className="mt-1 text-[28px] font-bold tabular-nums">{formatEUR(receipt.total)}</div>
              {receipt.change_amount > 0 && <div className="font-semibold text-warn-700">Kusuri {formatEUR(receipt.change_amount)}</div>}
            </div>
            <div className="max-h-[45dvh] overflow-y-auto rounded-xl border border-line py-2">
              <Receipt sale={receipt} business={business} settings={receiptSettings.data} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                variant="secondary"
                size="lg"
                onClick={async () => {
                  if (receiptSettings.data) {
                    try {
                      if ((await printReceipt(receipt, business, receiptSettings.data)) === 'printer') return
                    } catch {
                      /* browser */
                    }
                  }
                  setPrintSale(receipt)
                  setTimeout(() => window.print(), 50)
                }}
              >
                Printo
              </Button>
              <Button size="lg" onClick={() => (order && orderTotal(order) <= 0 ? navigate('/tavolinat') : setReceipt(null))}>
                {order && orderTotal(order) <= 0 ? 'Te tavolinat' : 'Vazhdo'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      {printSale && <PrintArea sale={printSale} business={business} settings={receiptSettings.data} />}
    </div>
  )
}

function ModifierDialog({ item, onClose, onAdd }: { item: MenuItem | null; onClose: () => void; onAdd: (mods: { group: string; name: string }[], note: string, qty: number) => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({})
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)
  useEffect(() => {
    if (!item) return
    setChosen({})
    setNote('')
    setQty(1)
  }, [item])
  if (!item) return null
  const missing = item.modifiers.filter((g) => g.required && !(chosen[g.name]?.length))
  const extra = item.modifiers.reduce((s, g) => s + g.options.filter((o) => chosen[g.name]?.includes(o.name)).reduce((a, o) => a + o.price, 0), 0)
  const toggle = (g: string, o: string, multi: boolean) =>
    setChosen((c) => {
      const cur = c[g] ?? []
      if (multi) return { ...c, [g]: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] }
      return { ...c, [g]: cur.includes(o) ? [] : [o] }
    })
  return (
    <Dialog open onClose={onClose} title={item.name} subtitle={formatEUR(item.sale_price)} width="md:max-w-[520px]">
      <div className="flex flex-col gap-4">
        {item.modifiers.map((g) => (
          <div key={g.name}>
            <div className="mb-2 text-sm font-semibold">
              {g.name}
              {g.required && <span className="text-warn-700"> *</span>}
              {g.multi && <span className="font-normal text-muted"> · disa</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => {
                const on = chosen[g.name]?.includes(o.name)
                return (
                  <button
                    key={o.name}
                    type="button"
                    onClick={() => toggle(g.name, o.name, g.multi)}
                    className={cn('h-11 rounded-xl border px-3.5 font-medium', on ? 'border-ink bg-ink text-white' : 'border-field bg-white')}
                  >
                    {o.name}
                    {o.price > 0 && <span className={cn('ml-1 text-sm', on ? 'text-white/80' : 'text-muted')}>+{formatEUR(o.price)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <Input label="Shënim për kuzhinën" value={note} onChange={(e) => setNote(e.target.value)} placeholder="p.sh. pa qepë, e ftohtë" />
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-field">
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-lg font-semibold tabular-nums">{qty}</span>
          <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-field">
            <Plus className="h-4 w-4" />
          </button>
          <Button
            size="lg"
            className="ml-auto"
            disabled={missing.length > 0}
            onClick={() => onAdd(Object.entries(chosen).flatMap(([group, names]) => names.map((name) => ({ group, name }))), note.trim(), qty)}
          >
            Shto · {formatEUR(round2((item.sale_price + extra) * qty))}
          </Button>
        </div>
        {missing.length > 0 && <p className="-mt-2 text-sm text-muted">Zgjidh: {missing.map((g) => g.name).join(', ')}</p>}
      </div>
    </Dialog>
  )
}

/** Pay the whole bill or chosen lines/quantities (split bill). */
function PayDialog({ open, order, menu, registerId, onClose, onPaid }: { open: boolean; order: Order; menu: Map<string, MenuItem>; registerId?: string; onClose: () => void; onPaid: (sale: Sale) => void }) {
  const openLines = order.items.filter((i) => lineOpen(i) > 0)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tendered, setTendered] = useState('')
  const [cardPart, setCardPart] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setQty(Object.fromEntries(openLines.map((i) => [i.id, lineOpen(i)])))
    setTendered('')
    setCardPart('')
    setMethod('cash')
    setError(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = openLines.map((i) => ({ item: i, qty: Math.min(qty[i.id] ?? 0, lineOpen(i)) })).filter((x) => x.qty > 0)
  const total = round2(chosen.reduce((s, x) => s + x.item.unit_price * x.qty, 0))
  const all = chosen.length === openLines.length && chosen.every((x) => x.qty === lineOpen(x.item))
  const t = parseNum(tendered)
  const c = parseNum(cardPart)
  const cashDue = method === 'mixed' ? round2(total - (c || 0)) : total
  const change = t == null || Number.isNaN(t) ? null : round2(t - cashDue)

  const pay = useMutation({
    mutationFn: () => {
      if (method === 'cash' && t != null && (Number.isNaN(t) || t < total)) throw new Error('Shuma e paguar është më e vogël se totali')
      if (method === 'mixed' && (c == null || Number.isNaN(c) || c <= 0 || c >= total)) throw new Error('Shkruaj sa paguhet me kartelë (më pak se totali)')
      return createSale({
        client_id: crypto.randomUUID(),
        register_id: registerId,
        order_id: order.id,
        items: saleLinesFor(chosen, menu),
        payment: {
          method,
          tendered: method === 'card' ? undefined : (t ?? cashDue),
          card_amount: method === 'mixed' ? c ?? undefined : undefined,
        },
        client_created_at: serverDate().toISOString(),
      })
    },
    onSuccess: onPaid,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <Dialog open={open} onClose={onClose} title={all ? 'Paguaj llogarinë' : 'Paguaj një pjesë'} subtitle="Hiq ose zvogëlo artikujt që paguhen më vonë (ndarja e llogarisë)." width="md:max-w-[560px]">
      <div className="flex flex-col gap-4">
        <ul className="max-h-[38dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {openLines.map((i) => {
            const q = qty[i.id] ?? 0
            const max = lineOpen(i)
            return (
              <li key={i.id} className={cn('flex items-center gap-2 px-3 py-2', q === 0 && 'opacity-50')}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{i.name}</div>
                  {i.modifiers.length > 0 && <div className="truncate text-xs text-muted">{i.modifiers.map((m) => m.name).join(', ')}</div>}
                </div>
                <button type="button" disabled={q <= 0} onClick={() => setQty((s) => ({ ...s, [i.id]: q - 1 }))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-field disabled:opacity-40">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-12 text-center font-semibold tabular-nums">
                  {q}/{max}
                </span>
                <button type="button" disabled={q >= max} onClick={() => setQty((s) => ({ ...s, [i.id]: q + 1 }))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-field disabled:opacity-40">
                  <Plus className="h-4 w-4" />
                </button>
                <span className="w-[68px] text-right font-semibold tabular-nums">{formatEUR(round2(i.unit_price * q))}</span>
              </li>
            )
          })}
        </ul>
        <div className="flex gap-2 text-sm">
          <button type="button" className="font-semibold text-brand-600" onClick={() => setQty(Object.fromEntries(openLines.map((i) => [i.id, lineOpen(i)])))}>
            Të gjitha
          </button>
          <span className="text-muted">·</span>
          <button type="button" className="font-semibold text-brand-600" onClick={() => setQty({})}>
            Asnjë
          </button>
        </div>
        <Tabs
          className="w-full"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'cash', label: 'Kesh' },
            { value: 'card', label: 'Kartelë' },
            { value: 'mixed', label: 'Të kombinuara' },
          ]}
        />
        {method === 'mixed' && <Input label="Me kartelë" inputMode="decimal" value={cardPart} onChange={(e) => setCardPart(e.target.value)} placeholder="€0.00" />}
        {method !== 'card' && (
          <div className="flex gap-2">
            <div className="flex-1">
              <Input label={method === 'mixed' ? 'Paguar kesh' : 'Paguar'} inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={formatEUR(cashDue)} />
            </div>
            <div className="w-[120px]">
              <div className="mb-1.5 text-right text-sm font-medium">Kusuri</div>
              <div className="flex h-12 items-center justify-end rounded-ctl bg-[#FFF4EC] px-3 text-lg font-bold tabular-nums text-warn-700">{change == null ? '—' : formatEUR(change)}</div>
            </div>
          </div>
        )}
        {error && <p className="rounded-ctl bg-warn-100 px-3 py-2 text-sm text-warn-700">{error}</p>}
        <Button size="lg" className="h-[56px] text-[18px]" disabled={total <= 0} loading={pay.isPending} onClick={() => pay.mutate()}>
          Paguaj {formatEUR(total)}
        </Button>
      </div>
    </Dialog>
  )
}

/** Cancelling a sent line: reason, and a manager's PIN when a waiter does it. */
function CancelLineDialog({ line, requester, onClose, onDone }: { line: OrderItem | null; requester: string; onClose: () => void; onDone: (o: Order) => void }) {
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('Klienti hoqi dorë')
  const [approve, setApprove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!line) return
    setQty(lineOpen(line))
    setApprove(false)
    setError(null)
  }, [line])
  if (!line) return null
  const submit = async (approverId?: string, pin?: string) => {
    setBusy(true)
    setError(null)
    try {
      const r = await cancelOrderItem({ item_id: line.id, quantity: qty, reason, approver_id: approverId, pin })
      if (r.ok) onDone(r.order)
      else {
        setError(APPROVAL_MESSAGES[r.error as ApprovalError] ?? r.error)
        setApprove(true)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const max = lineOpen(line)
  return (
    <>
      <Dialog open={!approve} onClose={onClose} title={`Anulo: ${line.name}`} subtitle="Artikulli është dërguar – anulimi shkruhet te regjistri." width="md:max-w-[440px]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Sasia</span>
            <button type="button" disabled={qty <= 1} onClick={() => setQty(qty - 1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-field disabled:opacity-40">
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-10 text-center font-semibold tabular-nums">
              {qty}/{max}
            </span>
            <button type="button" disabled={qty >= max} onClick={() => setQty(qty + 1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-field disabled:opacity-40">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Klienti hoqi dorë', 'Gabim i kamarierit', 'U vonua', 'Problem me cilësinë'].map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn('h-10 rounded-full border px-4 text-sm font-medium', reason === r ? 'border-ink bg-ink text-white' : 'border-field bg-white')}>
                {r}
              </button>
            ))}
          </div>
          {error && <p className="rounded-ctl bg-warn-100 px-3 py-2 text-sm text-warn-700">{error}</p>}
          <Button size="lg" loading={busy} onClick={() => void submit()}>
            Anulo {qty} × {line.name}
          </Button>
        </div>
      </Dialog>
      <ApprovalDialog
        request={approve ? { action: 'Anulim artikulli', details: [{ label: 'Artikulli', value: `${qty} × ${line.name}` }, { label: 'Arsyeja', value: reason }] } : null}
        requester={requester}
        busy={busy}
        error={approve ? error : null}
        onApprove={(id, pin) => void submit(id, pin)}
        onCancel={() => {
          setApprove(false)
          setError(null)
        }}
      />
    </>
  )
}
