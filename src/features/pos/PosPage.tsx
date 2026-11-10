import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ClipboardList, Minus, PauseCircle, Plus, ScanLine, Search, Trash2, WifiOff, X } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Button, Dialog, Select } from '@/components/ui'
import { hasModule } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR, round2 } from '@/lib/money'
import { formatQty, unitLabel } from '@/lib/units'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { fetchCategories } from '@/features/products/api'
import { createSale, fetchPosProducts, fetchRegisters, NetworkError, type CreateSaleInput, type PaymentMethod, type Sale } from './api'
import { addToCart, computeTotals, emptyCart, setLineDiscount, setLineStaff, setQuantity, type Cart, type CartLine, type PosProduct } from './cart'
import { fetchAppointment, fetchStaff, initials, staffColor, type Appointment } from '@/features/salon/api'
import { CameraScanner, CashDialog, DiscountDialog, LineDialog } from './dialogs'
import { enqueueSale, loadCatalog, loadHeld, nextOfflineNo, saveCatalog, saveHeld, useOfflineQueue, type HeldCart } from './offline'
import { PrintArea, Receipt } from './Receipt'
import { SalesDialog } from './SalesDialog'
import { VariantPicker } from './VariantPicker'
import { expiryStatus, fetchLots, formatExpiry, summarizeLots } from '@/lib/lots'
import { printReceipt } from '@/lib/printer'
import { serverDate, KOSOVO_TZ } from '@/lib/clock'
import { fetchReceiptSettings } from '@/features/settings/api'

const parseNum = (s: string) => {
  const n = Number(s.trim().replace(',', '.'))
  return s.trim() === '' ? null : Number.isFinite(n) ? n : NaN
}

function stockClass(p: PosProduct) {
  if (p.kind === 'service' || p.min_stock <= 0) return 'text-muted'
  if (p.stock <= p.min_stock / 2) return 'text-warn-700 font-semibold'
  if (p.stock <= p.min_stock) return 'text-amber-700 font-semibold'
  return 'text-muted'
}

function variantSummary(p: PosProduct): string {
  const s = p.variant_sizes?.length ?? 0
  const c = p.variant_colors?.length ?? 0
  return [s ? `${s} madhësi` : null, c ? `${c} ngjyra` : null].filter(Boolean).join(' · ') || 'variante'
}

export function PosPage() {
  const { business, profile } = useBusiness()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const wide = useMediaQuery('(min-width: 1024px)')
  const showStock = hasModule(business.type, 'stock')
  const searchRef = useRef<HTMLInputElement>(null)

  // ---------- catalog (online, with a local copy for offline) ----------
  const catalog = useQuery({
    queryKey: ['pos-products'],
    networkMode: 'always', // has its own local copy when offline
    queryFn: async () => {
      try {
        const [products, categories] = await Promise.all([fetchPosProducts(), fetchCategories()])
        void saveCatalog(business.id, products, categories)
        return { products, categories, offline: false }
      } catch (e) {
        const local = await loadCatalog(business.id)
        if (local && e instanceof NetworkError) return { products: local.products, categories: local.categories, offline: true }
        throw e
      }
    },
    staleTime: 60_000,
  })
  const products = useMemo(() => catalog.data?.products ?? [], [catalog.data])
  const categories = catalog.data?.categories ?? []

  const registers = useQuery({ queryKey: ['registers'], queryFn: fetchRegisters, retry: false, networkMode: 'always' })
  const receiptSettings = useQuery({ queryKey: ['receipt-settings'], queryFn: fetchReceiptSettings, retry: false, staleTime: 5 * 60_000, networkMode: 'always' })
  const [registerId, setRegisterId] = useState<string | null>(() => localStorage.getItem(`kasa.register.${business.id}`))
  useEffect(() => {
    const list = registers.data
    if (list?.length && !list.some((r) => r.id === registerId)) setRegisterId(list[0].id)
  }, [registers.data, registerId])
  useEffect(() => {
    if (registerId) localStorage.setItem(`kasa.register.${business.id}`, registerId)
  }, [registerId, business.id])
  const registerName = registers.data?.find((r) => r.id === registerId)?.name ?? null

  // ---------- salon: who performs each line, appointment being paid ----------
  const salon = hasModule(business.type, 'commission')
  // Pharmacy: lots with expiry (the sale itself takes them FEFO in the database).
  const lotsOn = hasModule(business.type, 'lots')
  const lotsQ = useQuery({ queryKey: ['lots'], queryFn: fetchLots, enabled: lotsOn, retry: false, staleTime: 60_000, networkMode: 'always' })
  const lotSum = useMemo(() => summarizeLots(lotsQ.data ?? []), [lotsQ.data])
  const staffQ = useQuery({ queryKey: ['staff'], queryFn: fetchStaff, enabled: salon, retry: false, staleTime: 5 * 60_000 })
  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const [staffId, setStaffId] = useState<string | null>(salon ? profile.id : null)
  const [params, setParams] = useSearchParams()
  const [appointment, setAppointment] = useState<Appointment | null>(null)
  // Exchange: the refunded amount stayed in the drawer; it pays (part of) the new bill as cash.
  const [exchange, setExchange] = useState<{ credit: number; from: string } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('kasa.exchange') ?? 'null') as { credit: number; from: string } | null
    } catch {
      return null
    }
  })

  // ---------- cart (kept across reloads on this device) ----------
  const cartKey = `kasa.cart.${business.id}.${profile.id}`
  const [cart, setCart] = useState<Cart>(() => {
    try {
      return (JSON.parse(localStorage.getItem(cartKey) ?? 'null') as Cart) ?? emptyCart()
    } catch {
      return emptyCart()
    }
  })
  useEffect(() => {
    localStorage.setItem(cartKey, JSON.stringify(cart))
  }, [cart, cartKey])
  const totals = useMemo(() => computeTotals(cart), [cart])

  // ---------- UI state ----------
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tendered, setTendered] = useState('')
  const [cardPart, setCardPart] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editLine, setEditLine] = useState<CartLine | null>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [camera, setCamera] = useState(false)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [salesOpen, setSalesOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [held, setHeld] = useState<HeldCart[]>(() => loadHeld(business.id))
  const [printSale, setPrintSale] = useState<{ sale: Sale; copy: boolean } | null>(null)

  const queue = useOfflineQueue(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: ['today-sales'] })
    }, [qc]),
  )
  const offline = !queue.online || catalog.data?.offline

  // ---------- search ----------
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = products.filter((p) => !p.parent_id)
    if (category !== 'all') list = list.filter((p) => p.category_id === category)
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.barcode === q || p.barcode?.startsWith(q) || p.substance?.toLowerCase().includes(q))
    return list
  }, [products, search, category])

  const [variantModel, setVariantModel] = useState<PosProduct | null>(null)
  const lotWarning = (p: PosProduct, qty: number): string | null => {
    const sum = lotsOn ? lotSum.get(p.id) : undefined
    if (!sum || sum.expired <= 0) return null
    const inCart = cart.lines.filter((l) => l.product.id === p.id).reduce((t, l) => t + l.quantity, 0)
    const free = Math.max(0, p.stock - sum.valid - sum.expired)
    return inCart + qty > sum.valid + free ? `Kujdes: "${p.name}" – në stok ka mbetur vetëm seri e skaduar` : null
  }
  const add = useCallback(
    (p: PosProduct, qty = 1) => {
      if (p.has_variants) {
        setVariantModel(p)
        return
      }
      setCart((c) => addToCart(c, p, qty, salon ? staffId : null))
      setError(lotWarning(p, qty))
      if (p.unit === 'kg' && qty === 1) {
        // weight: open the line so the weight can be typed
        setEditLine({ key: p.id, product: p, quantity: (cart.lines.find((l) => l.key === p.id)?.quantity ?? 0) + 1, discount: 0 })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart.lines, salon, staffId, lotSum],
  )

  const onScan = useCallback(
    (code: string) => {
      const p = products.find((x) => x.barcode === code.trim())
      if (p) {
        setCart((c) => addToCart(c, p, 1, salon ? staffId : null))
        setNotice(`${p.name} u shtua`)
        setError(lotWarning(p, 1))
      } else setError(`Barkodi ${code} nuk u gjet`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, salon, staffId, lotSum, cart.lines],
  )

  const creditParam = params.get('kredit')
  useEffect(() => {
    if (!creditParam) return
    const credit = round2(Number(creditParam))
    if (credit > 0) setExchange({ credit, from: params.get('nga') ?? '' })
    setParams({}, { replace: true })
  }, [creditParam, params, setParams])
  useEffect(() => {
    try {
      if (exchange) sessionStorage.setItem('kasa.exchange', JSON.stringify(exchange))
      else sessionStorage.removeItem('kasa.exchange')
    } catch {
      /* private mode */
    }
  }, [exchange])
  const credit = exchange?.credit ?? 0
  const due = round2(Math.max(0, totals.total - credit))

  // "Paguaj në arkë" from /terminet: the service goes on the bill for that worker.
  const apptParam = params.get('termin')
  useEffect(() => {
    if (!apptParam || products.length === 0) return
    let cancelled = false
    void fetchAppointment(apptParam)
      .then((a) => {
        if (cancelled || !a) return
        setAppointment(a)
        const p = a.product_id ? products.find((x) => x.id === a.product_id) : undefined
        if (p) setCart((c) => (c.lines.some((l) => l.product.id === p.id && l.staffId === a.staff_id) ? c : addToCart(c, p, 1, a.staff_id)))
        setStaffId(a.staff_id)
        setParams({}, { replace: true })
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
    }
  }, [apptParam, products, setParams])

  const submitSearch = () => {
    const q = search.trim()
    if (!q) return
    const exact = products.find((p) => p.barcode === q)
    if (exact) {
      add(exact)
      setSearch('')
      return
    }
    if (results.length === 1) {
      add(results[0])
      setSearch('')
      return
    }
    if (/^\d{6,}$/.test(q)) setError(`Barkodi ${q} nuk u gjet`)
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 1800)
    return () => clearTimeout(t)
  }, [notice])

  // ---------- payment ----------
  const pay = useCallback(
    async (m: PaymentMethod, tenderedAmount?: number, cardAmount?: number) => {
      if (cart.lines.length === 0 || busy) return
      setError(null)
      const input: CreateSaleInput = {
        client_id: crypto.randomUUID(),
        register_id: registerId,
        items: cart.lines.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          unit_price: l.product.sale_price,
          discount: l.discount || undefined,
          staff_id: l.staffId ?? undefined,
        })),
        appointment_id: appointment?.id,
        invoice_discount: totals.invoiceDiscount || undefined,
        payment: { method: m, tendered: m === 'card' ? undefined : tenderedAmount, card_amount: m === 'mixed' ? cardAmount : undefined },
        client_created_at: serverDate().toISOString(),
      }
      setBusy(true)
      try {
        const sale = await createSale(input)
        finish(sale)
        void qc.invalidateQueries({ queryKey: ['pos-products'] })
        if (lotsOn) void qc.invalidateQueries({ queryKey: ['lots'] })
        void qc.invalidateQueries({ queryKey: ['products'] })
        void qc.invalidateQueries({ queryKey: ['today-sales'] })
      } catch (e) {
        if (e instanceof NetworkError) {
          const offlineNo = await nextOfflineNo()
          const queued = { ...input, offline: true, offline_no: offlineNo }
          await enqueueSale(queued)
          finish(localReceipt(queued, cart, totals, profile.full_name, registerName))
        } else setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, totals, registerId, busy, registerName, profile.full_name, appointment],
  )

  const finish = (sale: Sale) => {
    setReceipt(sale)
    setExchange(null)
    if (appointment) {
      setAppointment(null)
      void qc.invalidateQueries({ queryKey: ['appointments'] })
    }
    if (receiptSettings.data?.settings.auto_print) void print(sale, false, true)
    setCart(emptyCart())
    setTendered('')
    setCardPart('')
    setMethod('cash')
    setCashOpen(false)
  }

  const payCard = () => {
    // With exchange credit the card pays only the rest; the credit is the cash part.
    if (credit <= 0) return void pay('card')
    if (due <= 0) return void pay('cash', credit)
    void pay('mixed', credit, due)
  }

  const payDesktop = () => {
    const t = parseNum(tendered)
    const c = parseNum(cardPart)
    if (method === 'cash') {
      if (t != null && (Number.isNaN(t) || t < due)) return setError('Shuma e paguar është më e vogël se totali')
      return void pay('cash', round2((t ?? due) + credit))
    }
    if (method === 'card') return payCard()
    if (c == null || Number.isNaN(c) || c <= 0 || c >= due) return setError('Shkruaj sa paguhet me kartelë (më pak se totali)')
    const cash = round2(due - c)
    if (t != null && (Number.isNaN(t) || t < cash)) return setError('Keshi i paguar është më i vogël se pjesa me kesh')
    void pay('mixed', round2((t ?? cash) + credit), c)
  }

  // ---------- held invoices ----------
  const holdCart = () => {
    if (!cart.lines.length) return
    const h: HeldCart = {
      id: crypto.randomUUID(),
      label: `${cart.lines[0].product.name}${cart.lines.length > 1 ? ` +${cart.lines.length - 1}` : ''} · ${formatEUR(totals.total)}`,
      saved_at: new Date().toISOString(),
      cart,
    }
    const list = [h, ...held]
    setHeld(list)
    saveHeld(business.id, list)
    setCart(emptyCart())
    setNotice('Fatura u ruajt në pritje')
  }
  const restoreHeld = (h: HeldCart) => {
    const list = held.filter((x) => x.id !== h.id)
    if (cart.lines.length) {
      // swap: the current cart goes on hold
      list.unshift({ id: crypto.randomUUID(), label: `Në pritje · ${formatEUR(totals.total)}`, saved_at: new Date().toISOString(), cart })
    }
    setHeld(list)
    saveHeld(business.id, list)
    setCart(h.cart)
    setHeldOpen(false)
  }

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key === 'F12') {
        e.preventDefault()
        if (wide) payDesktop()
        else if (cart.lines.length) setCashOpen(true)
      } else if (e.key === 'F4') {
        e.preventDefault()
        holdCart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Bluetooth/USB printer when connected, otherwise the browser's print dialog (80mm).
  async function print(sale: Sale, copy = false, afterPayment = false) {
    const settings = receiptSettings.data
    if (settings) {
      try {
        const how = await printReceipt(sale, business, settings, { copy, openDrawer: afterPayment })
        if (how === 'printer') return
      } catch (e) {
        setError(`Printeri: ${(e as Error).message}. Po printoj nga shfletuesi.`)
      }
    }
    setPrintSale({ sale, copy })
    setTimeout(() => window.print(), 50)
  }

  const change = (() => {
    const t = parseNum(tendered)
    if (t == null || Number.isNaN(t)) return null
    const cashDue = method === 'mixed' ? round2(due - (parseNum(cardPart) || 0)) : due
    return round2(t - cashDue)
  })()

  const exchangeBanner = exchange && (
    <div className="flex items-center justify-between gap-2 rounded-ctl bg-brand-100 px-3 py-2 text-sm">
      <span>
        Ndërrim{exchange.from && ` nga fatura #${String(exchange.from).padStart(5, '0')}`} · kredi <strong className="tabular-nums">−{formatEUR(credit)}</strong>
        <span className="block text-xs text-muted">
          {totals.total >= credit ? `Klienti paguan edhe ${formatEUR(due)}` : `Klientit i kthehen ${formatEUR(round2(credit - totals.total))}`}
        </span>
      </span>
      <button type="button" onClick={() => setExchange(null)} title="Hiqe kredinë" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:text-warn-700">
        <X className="h-4 w-4" />
      </button>
    </div>
  )

  const lotLine = (p: PosProduct) => {
    const sum = lotSum.get(p.id)
    const st = sum?.next ? expiryStatus(sum.next) : null
    if (!p.substance && !sum) return null
    return (
      <span className="mt-0.5 block truncate text-xs text-muted">
        {p.substance}
        {p.substance && sum?.next && ' · '}
        {sum?.next && (
          <span className={cn(st === 'soon' ? 'font-semibold text-warn-700' : st === 'near' ? 'font-semibold text-amber-700' : '')}>skadon {formatExpiry(sum.next, true)}</span>
        )}
        {sum && sum.valid <= 0 && sum.expired > 0 && <span className="font-semibold text-warn-700"> · vetëm e skaduar</span>}
      </span>
    )
  }

  // ---------- render ----------
  const offlineBanner = (offline || queue.pending.length > 0) && (
    <div
      className={cn(
        'flex items-center gap-3 rounded-card border px-4 py-3 text-sm',
        offline ? 'border-[#F5D98B] bg-amber-100 text-amber-700' : 'border-line bg-white text-muted',
      )}
    >
      <WifiOff className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {offline ? 'Duke punuar pa internet' : 'Faturat po dërgohen'}
          {queue.pending.length > 0 && ` – ${queue.pending.length} ${queue.pending.length === 1 ? 'faturë' : 'fatura'} në pritje`}
        </div>
        <div>Mund të vazhdosh të shesësh; faturat dërgohen vetë sapo të kthehet lidhja.</div>
        {queue.pending.some((p) => p.rejected) && (
          <div className="mt-1 font-semibold text-warn-700">Disa fatura u refuzuan nga serveri – hape "Faturat e sotme".</div>
        )}
      </div>
    </div>
  )

  // Salon: the worker new lines are added for (as in the design: "Punëtori: A B D").
  const staffBar = salon && staff.length > 0 && (
    <div className="flex items-center gap-2 overflow-x-auto">
      <span className="shrink-0 text-sm font-medium text-muted">Punëtori:</span>
      {staff.map((x) => (
        <button
          key={x.id}
          type="button"
          onClick={() => setStaffId(x.id)}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-full border bg-white py-1 pl-1 pr-3 text-sm font-semibold',
            staffId === x.id ? 'border-2 border-ink' : 'border-line',
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-white" style={{ background: staffColor(x.id, staff) }}>
            {initials(x.full_name)}
          </span>
          {x.full_name.split(' ')[0]}
        </button>
      ))}
    </div>
  )

  const cartLines = (
    <ul className="divide-y divide-line">
      {cart.lines.map((l) => {
        const t = totals.lines.find((x) => x.key === l.key)
        return (
          <li key={l.key} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
            <button type="button" onClick={() => setEditLine(l)} className="w-full min-w-0 text-left">
              <div className="truncate text-[15px] font-semibold md:text-sm">{l.product.name}</div>
              <div className="text-sm text-muted md:text-xs">
                {formatEUR(l.product.sale_price)} / {unitLabel(l.product.unit)}
                {l.discount > 0 && <span className="text-warn-700"> · −{formatEUR(l.discount)}</span>}
                <span className="font-semibold text-ink lg:hidden"> · {formatEUR(t?.total ?? 0)}</span>
              </div>
            </button>
              {salon && staff.length > 0 && (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-1 pr-2 text-xs font-semibold">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white" style={{ background: staffColor(l.staffId ?? '', staff) }}>
                    {initials(staff.find((x) => x.id === l.staffId)?.full_name ?? '?')}
                  </span>
                  <select
                    aria-label={`Kush e kreu: ${l.product.name}`}
                    value={l.staffId ?? ''}
                    onChange={(e) => setCart((c) => setLineStaff(c, l.key, e.target.value))}
                    className="bg-transparent focus:outline-none"
                  >
                    {staff.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.full_name.split(' ')[0]}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Më pak"
                onClick={() => setCart((c) => setQuantity(c, l.key, l.product.unit === 'kg' ? round2(l.quantity - 0.1) : l.quantity - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-field md:h-9 md:w-9 md:rounded-lg"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setEditLine(l)} className="min-w-[44px] text-center text-lg font-semibold tabular-nums md:min-w-[36px] md:text-base">
                {l.product.unit === 'kg' ? l.quantity.toFixed(3).replace(/\.?0+$/, '') : l.quantity}
              </button>
              <button
                type="button"
                aria-label="Më shumë"
                onClick={() => setCart((c) => setQuantity(c, l.key, l.product.unit === 'kg' ? round2(l.quantity + 0.1) : l.quantity + 1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-field md:h-9 md:w-9 md:rounded-lg"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="hidden w-[72px] text-right font-semibold tabular-nums lg:block">{formatEUR(t?.total ?? 0)}</div>
          </li>
        )
      })}
    </ul>
  )

  const toolbar = (
    <div className="flex items-center gap-2">
      {(registers.data?.length ?? 0) > 1 && (
        <Select
          aria-label="Arka"
          value={registerId ?? ''}
          onChange={(e) => setRegisterId(e.target.value)}
          className="h-10 w-auto"
          options={(registers.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
        />
      )}
      <button
        type="button"
        onClick={() => setHeldOpen(true)}
        title="Faturat në pritje"
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white hover:bg-bg"
      >
        <PauseCircle className="h-5 w-5" />
        {held.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-amber-700 px-1.5 text-[11px] font-bold text-white">{held.length}</span>}
      </button>
      <button
        type="button"
        onClick={() => setSalesOpen(true)}
        title="Faturat e sotme"
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white hover:bg-bg"
      >
        <ClipboardList className="h-5 w-5" />
        {queue.pending.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-warn-700 px-1.5 text-[11px] font-bold text-white">{queue.pending.length}</span>}
      </button>
    </div>
  )

  const searchBox = (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
      <input
        ref={searchRef}
        value={search}
        autoFocus={wide}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submitSearch()
          } else if (e.key === 'Escape') setSearch('')
        }}
        placeholder={wide ? 'Skano barkodin ose shkruaj emrin e produktit…' : 'Kërko produktin…'}
        className="h-[52px] w-full rounded-xl border-2 border-field bg-white pl-12 pr-14 text-[16px] focus:border-brand-600 focus:outline-none"
      />
      {search ? (
        <button type="button" aria-label="Pastro" onClick={() => setSearch('')} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-bg">
          <X className="h-4 w-4" />
        </button>
      ) : (
        wide && <span className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-field px-1.5 text-xs text-muted">F2</span>
      )}
    </div>
  )

  const messages = (
    <>
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Mbyll">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {notice && <div className="rounded-ctl bg-brand-100 px-4 py-2.5 text-sm font-medium text-brand-600">{notice}</div>}
    </>
  )

  const catalogState = catalog.isLoading ? (
    <div className="py-16 text-center text-muted">Duke ngarkuar…</div>
  ) : catalog.isError ? (
    <div className="py-16 text-center text-warn-700">{(catalog.error as Error).message}</div>
  ) : products.length === 0 ? (
    <div className="py-16 text-center text-muted">
      Ende pa produkte për arkë.{' '}
      {profile.role !== 'worker' && (
        <button className="font-semibold text-brand-600 underline" onClick={() => navigate('/produktet')}>
          Shto produktet
        </button>
      )}
    </div>
  ) : null

  const sharedDialogs = (
    <>
      {editLine && (
        <LineDialog
          line={cart.lines.find((l) => l.key === editLine.key) ?? editLine}
          onClose={() => setEditLine(null)}
          onRemove={() => {
            setCart((c) => setQuantity(c, editLine.key, 0))
            setEditLine(null)
          }}
          onSave={(q, d) => {
            setCart((c) => setLineDiscount(setQuantity(c, editLine.key, q), editLine.key, d))
            setEditLine(null)
          }}
        />
      )}
      <DiscountDialog
        open={discountOpen}
        subtotal={totals.subtotal}
        current={cart.invoiceDiscount}
        onClose={() => setDiscountOpen(false)}
        onSave={(a) => {
          setCart((c) => ({ ...c, invoiceDiscount: a }))
          setDiscountOpen(false)
        }}
      />
      <VariantPicker
        model={variantModel}
        variants={products}
        onClose={() => setVariantModel(null)}
        onPick={(v) => {
          setVariantModel(null)
          setCart((c) => addToCart(c, v, 1, salon ? staffId : null))
          setNotice(`${v.name} u shtua`)
        }}
      />
      <CashDialog open={cashOpen} total={due} busy={busy} onClose={() => setCashOpen(false)} onPay={(t) => void pay('cash', round2(t + credit))} />
      <Dialog open={Boolean(receipt)} onClose={() => setReceipt(null)} width="md:max-w-[440px]">
        {receipt && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <div className="text-sm text-muted">{receipt.offline ? 'Ruajtur pa internet – dërgohet më vonë' : 'Pagesa u krye'}</div>
              {receipt.change_amount > 0 && (
                <div className="mt-1 text-[28px] font-bold">
                  Kusuri <span className="text-warn-700">{formatEUR(receipt.change_amount)}</span>
                </div>
              )}
            </div>
            <div className="max-h-[50dvh] overflow-y-auto rounded-xl border border-line bg-white py-2">
              <Receipt sale={receipt} business={business} settings={receiptSettings.data} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Button variant="secondary" size="lg" onClick={() => void print(receipt)}>
                Printo
              </Button>
              <Button size="lg" autoFocus onClick={() => setReceipt(null)}>
                Shitje e re
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog open={heldOpen} onClose={() => setHeldOpen(false)} title="Faturat në pritje" width="md:max-w-[460px]">
        {held.length === 0 ? (
          <p className="py-6 text-center text-muted">Asnjë faturë në pritje. Përdor "Ruaj në pritje" (F4) kur klienti kthehet më vonë.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {held.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <button type="button" onClick={() => restoreHeld(h)} className="min-w-0 flex-1 rounded-xl border border-line px-4 py-3 text-left hover:bg-bg">
                  <div className="truncate font-semibold">{h.label}</div>
                  <div className="text-xs text-muted">{new Date(h.saved_at).toLocaleTimeString('sq-AL', { timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' })}</div>
                </button>
                <button
                  type="button"
                  aria-label="Fshi"
                  onClick={() => {
                    const list = held.filter((x) => x.id !== h.id)
                    setHeld(list)
                    saveHeld(business.id, list)
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-warn-700 hover:bg-warn-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <SalesDialog
        open={salesOpen}
        onClose={() => setSalesOpen(false)}
        pending={queue.pending}
        registerId={registerId}
        onPrint={(s) => void print(s, true)}
        onRefund={(nr) => navigate(`/arka/kthim?nr=${nr}`)}
      />
      <PrintArea sale={printSale?.sale ?? null} copy={printSale?.copy} business={business} settings={receiptSettings.data} />
    </>
  )

  // ================= DESKTOP =================
  if (wide) {
    return (
      <div className="flex h-[calc(100dvh-44px)] gap-5 p-6 pt-3">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            {searchBox}
            <Button variant="secondary" className="h-[52px]" onClick={() => setCamera((v) => !v)}>
              <Camera className="h-5 w-5" /> Kamera
            </Button>
            {toolbar}
          </div>
          {staffBar}
          {staffBar}
        {offlineBanner}
          {messages}
          <CameraScanner active={camera} onCode={onScan} />
          <div className="flex flex-wrap gap-2">
            {[{ id: 'all', name: 'Të gjitha' }, ...categories].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={cn(
                  'h-10 rounded-full border px-4 text-sm font-medium',
                  category === c.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:bg-bg',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {catalogState ?? (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
                {results.slice(0, 120).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => add(p)}
                    className="flex min-h-[116px] flex-col rounded-card border border-line bg-white p-4 text-left transition-colors hover:border-brand-600 active:bg-brand-100"
                  >
                    <div className="text-xs text-muted">{categories.find((c) => c.id === p.category_id)?.name ?? ' '}</div>
                    <div className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-tight">{p.name}</div>
                    {lotsOn && lotLine(p)}
                    <div className="mt-auto flex items-end justify-between pt-3">
                      <span className="text-lg font-bold tabular-nums">{formatEUR(p.sale_price)}</span>
                      {p.has_variants ? (
                        <span className="text-xs text-muted">{variantSummary(p)}</span>
                      ) : (
                        showStock && p.kind === 'product' && <span className={cn('text-xs', stockClass(p))}>{formatQty(p.stock, p.unit)}</span>
                      )}
                      {p.kind === 'service' && p.duration_min && <span className="text-xs text-muted">{p.duration_min} min</span>}
                    </div>
                  </button>
                ))}
                {results.length === 0 && <div className="col-span-full py-12 text-center text-muted">Asgjë nuk u gjet</div>}
              </div>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="flex w-[400px] shrink-0 flex-col overflow-hidden rounded-card border border-line bg-white">
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <div className="text-xl font-semibold">Faturë e re</div>
              <div className="text-sm text-muted">
                {cart.lines.length} {cart.lines.length === 1 ? 'produkt' : 'produkte'} · {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(totals.itemsCount)} artikuj
                {registerName && ` · ${registerName}`}
              </div>
              {exchangeBanner && <div className="mt-2">{exchangeBanner}</div>}
              {appointment && (
                <div className="mt-1 text-sm font-medium text-brand-600">
                  Klienti: {appointment.customer_name} · termini{' '}
                  {new Date(appointment.starts_at).toLocaleTimeString('sq-AL', { timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
            {cart.lines.length > 0 && (
              <button type="button" onClick={() => setCart(emptyCart())} title="Pastro faturën" className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-muted hover:text-warn-700">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted">
                <ScanLine className="h-8 w-8" />
                Skano një barkod ose kliko një produkt
              </div>
            ) : (
              cartLines
            )}
          </div>
          <div className="border-t border-line bg-[#F8FAF8] px-5 py-3 text-sm">
            {totals.discountTotal > 0 && (
              <div className="flex justify-between py-0.5 text-warn-700">
                <span>Zbritje</span>
                <span className="tabular-nums">−{formatEUR(totals.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between py-0.5 text-muted">
              <span>Pa TVSH</span>
              <span className="tabular-nums">{formatEUR(totals.netTotal)}</span>
            </div>
            {totals.vat
              .filter((v) => v.rate > 0)
              .map((v) => (
                <div key={v.code} className="flex justify-between py-0.5 text-muted">
                  <span>TVSH {Math.round(v.rate * 100)}%</span>
                  <span className="tabular-nums">{formatEUR(v.vat)}</span>
                </div>
              ))}
            <div className="mt-2 flex items-end justify-between border-t border-dashed border-field pt-2">
              <span className="text-base font-semibold">Totali</span>
              <span className="text-[32px] font-bold leading-none tabular-nums">{formatEUR(totals.total)}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-line p-5">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['cash', 'Kesh'],
                  ['card', 'Kartelë'],
                  ['mixed', 'Të kombinuara'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    'h-11 rounded-xl border text-sm font-semibold',
                    method === m ? 'border-2 border-brand-600 bg-[#F0F7F3] text-brand-900' : 'border-field bg-white',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {method === 'mixed' && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">Me kartelë</span>
                <input value={cardPart} onChange={(e) => setCardPart(e.target.value)} inputMode="decimal" placeholder="€0.00" className="h-11 rounded-ctl border border-field px-3 tabular-nums" />
              </div>
            )}
            {method !== 'card' && (
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-xs text-muted">Paguar{method === 'mixed' ? ' kesh' : ''}</span>
                  <input
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && payDesktop()}
                    inputMode="decimal"
                    placeholder={formatEUR(method === 'mixed' ? Math.max(0, round2(due - (parseNum(cardPart) || 0))) : due)}
                    className="h-11 rounded-ctl border border-field px-3 tabular-nums"
                  />
                </div>
                <div className="flex w-[110px] flex-col gap-1">
                  <span className="text-right text-xs text-muted">Kusuri</span>
                  <div className={cn('flex h-11 items-center justify-end rounded-ctl px-3 text-lg font-bold tabular-nums', change != null && change < 0 ? 'bg-warn-100 text-warn-700' : 'bg-[#FFF4EC] text-warn-700')}>
                    {change == null ? '—' : formatEUR(change)}
                  </div>
                </div>
              </div>
            )}
            <Button size="lg" className="h-[58px] text-[18px]" disabled={!cart.lines.length} loading={busy} onClick={payDesktop}>
              Paguaj {formatEUR(due)} <span className="rounded-md border border-white/40 px-1.5 text-xs font-medium">F12</span>
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" disabled={!cart.lines.length} onClick={() => setDiscountOpen(true)}>
                Zbritje
              </Button>
              <Button variant="secondary" disabled={!cart.lines.length} onClick={holdCart}>
                Ruaj në pritje
              </Button>
              <Button variant="secondary" onClick={() => navigate('/arka/kthim')}>
                Kthim
              </Button>
            </div>
          </div>
        </div>
        {sharedDialogs}
      </div>
    )
  }

  // ================= PHONE / TABLET =================
  return (
    <div className="flex min-h-[calc(100dvh-var(--chrome,116px)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col">
      <div className="sticky top-[calc(var(--topbar,0px)+env(safe-area-inset-top))] z-20 border-b border-line bg-white px-4 pb-3 pt-4">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h1 className="text-[26px] font-bold leading-tight">Faturë e re</h1>
            <div className="text-sm text-muted">
              {registerName ?? 'Arka'} · {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(totals.itemsCount)} artikuj
            </div>
          </div>
          {toolbar}
        </div>
        <div className="flex gap-2">
          {searchBox}
          <button
            type="button"
            aria-label="Skano me kamerë"
            onClick={() => setCamera((v) => !v)}
            className={cn('flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl', camera ? 'bg-ink text-white' : 'bg-brand-600 text-white')}
          >
            <Camera className="h-5 w-5" />
          </button>
        </div>
        {search.trim() && (
          <ul className="absolute inset-x-4 top-full z-30 mt-1 max-h-[55dvh] overflow-y-auto rounded-xl border border-line bg-white shadow-xl">
            {results.slice(0, 40).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    add(p)
                    setSearch('')
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left last:border-0 active:bg-brand-100"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.name}</span>
                    {lotsOn && lotLine(p)}
                    {p.has_variants ? (
                      <span className="text-xs text-muted">{variantSummary(p)}</span>
                    ) : (
                      showStock && p.kind === 'product' && <span className={cn('text-xs', stockClass(p))}>{formatQty(p.stock, p.unit)}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">{formatEUR(p.sale_price)}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-4 py-4 text-center text-muted">Asgjë nuk u gjet</li>}
          </ul>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 bg-bg px-4 py-3">
        {offlineBanner}
        {messages}
        <CameraScanner active={camera} onCode={onScan} />
        {catalogState}
        {cart.lines.length > 0 ? (
          <div className="-mx-4 bg-bg">{cartLines}</div>
        ) : (
          !catalogState && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-muted">
              <ScanLine className="h-8 w-8" />
              Kërko ose skano produktin
            </div>
          )
        )}
        {cart.lines.length > 0 && (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDiscountOpen(true)}>
              Zbritje{totals.discountTotal > 0 && ` (−${formatEUR(totals.discountTotal)})`}
            </Button>
            <Button variant="secondary" className="flex-1" onClick={holdCart}>
              Në pritje
            </Button>
            <Button variant="secondary" onClick={() => navigate('/arka/kthim')}>
              Kthim
            </Button>
          </div>
        )}
      </div>

      <div className="sticky bottom-[calc(var(--tabbar,60px)+env(safe-area-inset-bottom))] z-20 border-t border-line bg-white px-4 py-3">
        {exchangeBanner && <div className="mb-3">{exchangeBanner}</div>}
        <div className="mb-3 flex items-end justify-between">
          <span className="text-[15px] text-muted">
            Totali <span className="text-sm">(TVSH {formatEUR(totals.vatTotal)} e përfshirë)</span>
          </span>
          <span className="text-[34px] font-bold leading-none tabular-nums">{formatEUR(totals.total)}</span>
        </div>
        <div className="grid grid-cols-[1fr_1.6fr] gap-2.5">
          <Button variant="secondary" size="lg" disabled={!cart.lines.length} loading={busy && !cashOpen} onClick={payCard}>
            Kartelë
          </Button>
          <Button size="lg" disabled={!cart.lines.length} onClick={() => setCashOpen(true)}>
            Paguaj kesh
          </Button>
        </div>
      </div>
      {sharedDialogs}
    </div>
  )
}

/** Receipt shown when the sale was queued offline (the server numbers it later). */
function localReceipt(
  input: CreateSaleInput & { offline_no?: string },
  cart: Cart,
  totals: ReturnType<typeof computeTotals>,
  workerName: string,
  registerName: string | null,
): Sale {
  const t = input.payment.tendered
  const card = input.payment.method === 'card' ? totals.total : input.payment.method === 'mixed' ? (input.payment.card_amount ?? 0) : 0
  const cash = round2(totals.total - card)
  return {
    id: input.client_id,
    kind: 'sale',
    ref_sale_id: null,
    ref_invoice_no: null,
    invoice_no: 0,
    daily_no: 0,
    sale_date: '',
    created_at: input.client_created_at ?? serverDate().toISOString(),
    client_created_at: input.client_created_at ?? null,
    items_count: totals.itemsCount,
    subtotal: totals.subtotal,
    invoice_discount: totals.invoiceDiscount,
    discount_total: totals.discountTotal,
    total: totals.total,
    net_total: totals.netTotal,
    vat_total: totals.vatTotal,
    vat_lines: totals.vat,
    payment_method: input.payment.method,
    cash_amount: cash,
    card_amount: card,
    tendered: cash > 0 ? (t ?? cash) : null,
    change_amount: cash > 0 ? round2((t ?? cash) - cash) : 0,
    reason: null,
    note: null,
    offline: true,
    offline_no: input.offline_no ?? null,
    fiscal_status: 'non_fiscal',
    worker_id: '',
    worker_name: workerName,
    register_name: registerName,
    voided: false,
    has_refunds: false,
    items: cart.lines.map((l, i) => {
      const lt = totals.lines.find((x) => x.key === l.key)!
      return {
        id: `${i}`,
        position: i + 1,
        product_id: l.product.id,
        name: l.product.name,
        unit: l.product.unit,
        quantity: l.quantity,
        unit_price: l.product.sale_price,
        line_discount: lt.lineDiscount,
        invoice_discount: lt.invoiceShare,
        total: lt.total,
        vat_code: l.product.vat_code,
        refunded: 0,
      }
    }),
  }
}

