import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Camera, ClipboardList, Minus, PauseCircle, Pencil, Plus, ScanLine, Search, Trash2, WifiOff, X, type LucideIcon } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Button, Dialog, Select } from '@/components/ui'
import { hasModule, isManagerRole } from '@/lib/business'
import { cn } from '@/lib/cn'
import { formatEUR, round2 } from '@/lib/money'
import { formatQty, unitLabel } from '@/lib/units'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { fetchCategories } from '@/features/products/api'
import { hasVat, saleVatCode } from '@/lib/vat'
import { createSale, fetchPosProducts, fetchRegisters, NetworkError, type CreateSaleInput, type PaymentKind, type PaymentMethod, type Sale, type SplitKind } from './api'
import { addToCart, computeTotals, emptyCart, setLineDiscount, setLineStaff, setQuantity, type Cart, type CartLine, type PosProduct } from './cart'
import { fetchAppointment, fetchStaff, initials, staffColor, type Appointment } from '@/features/salon/api'
import { CameraScanner, CashDialog, DiscountDialog, LineDialog } from './dialogs'
import { enqueueSale, loadCatalog, loadHeld, nextOfflineNo, saveCatalog, saveHeld, useOfflineQueue, type HeldCart } from './offline'
import { PrintArea, Receipt } from './Receipt'
import { QuickProductDialog } from './QuickProductDialog'
import { ManageProductsDialog } from './ManageProductsDialog'
import { BookEntryDialog, type BookEntry } from './BookEntryDialog'
import { EcouponButton } from './EcouponDialog'
import { VariantPicker } from './VariantPicker'
import { expiryStatus, fetchLots, formatExpiry, summarizeLots } from '@/lib/lots'
import { printPage, printReceipt } from '@/lib/printer'
import { serverDate, KOSOVO_TZ } from '@/lib/clock'
import { fetchReceiptSettings } from '@/features/settings/api'
import { fetchFiscalContext } from '@/lib/fiscal'
import { t as tr, useLang } from '@/lib/i18n'
import { fiscalizeSale } from './fiscal'
import { formatSq } from '@/lib/sqDate'
import { roundQty, unitDecimals } from '@/lib/units'
import { usePrintProblem } from './PrintProblem'
import { assignDeviceRegister, fetchDeviceRegister, registerLock } from '@/lib/deviceLink'
import { isSefApp } from '@/lib/device'
import { inUnit, useBusinessUnits } from '@/lib/businessUnits'


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
  // a business outside VAT sells everything as A (0%), as the server does (0042)
  const vat = hasVat(business)
  const catalog = useQuery({
    queryKey: ['pos-products', vat],
    networkMode: 'always', // has its own local copy when offline
    queryFn: async () => {
      try {
        const [products, categories] = await Promise.all([fetchPosProducts(), fetchCategories()])
        void saveCatalog(business.id, products, categories)
        return { products: products.map((p) => ({ ...p, vat_code: saleVatCode(p.vat_code, vat) })), categories, offline: false }
      } catch (e) {
        // no internet (or no session yet while working offline): the copy kept on this device
        const local = await loadCatalog(business.id)
        const offline = e instanceof NetworkError || (typeof navigator !== 'undefined' && !navigator.onLine) || /lidhje|internet|fetch|network|JWT|session/i.test((e as Error)?.message ?? '')
        if (local && offline)
          return { products: local.products.map((p) => ({ ...p, vat_code: saleVatCode(p.vat_code, vat) })), categories: local.categories, offline: true }
        throw e
      }
    },
    staleTime: 60_000,
  })

  // "+" in the till: the owner / manager (in the SEF app signed in with PIN) adds a product on the spot
  const canAddProduct = isManagerRole(profile.actual_role ?? profile.role)
  const [quickAdd, setQuickAdd] = useState<{ barcode: string | null } | null>(null)
  // owner / manager: change or delete a product from the till
  const [manageOpen, setManageOpen] = useState(false)
  const [editProductId, setEditProductId] = useState<string | null>(null)
  // ATK (UA neni 45): coupons written by hand from the separate coupon book while the device was down
  const [bookEntry, setBookEntry] = useState<BookEntry | null>(null)
  const [bookOpen, setBookOpen] = useState(false)
  // the book was opened from the payment window: go back to it afterwards
  const [bookFromPay, setBookFromPay] = useState(false)
  const allProducts = useMemo(() => catalog.data?.products ?? [], [catalog.data])
  const categories = catalog.data?.categories ?? []

  const registers = useQuery({ queryKey: ['registers'], queryFn: fetchRegisters, retry: false, networkMode: 'always' })
  const receiptSettings = useQuery({ queryKey: ['receipt-settings'], queryFn: fetchReceiptSettings, retry: false, staleTime: 5 * 60_000, networkMode: 'always' })
  const [registerId, setRegisterId] = useState<string | null>(() => registerLock(business.id) ?? localStorage.getItem(`kasa.register.${business.id}`))
  // a device activated for one till sells only as that till (its ATK key and POS ID); no choosing another one.
  // The server is asked once per visit, so a till given / taken away elsewhere is followed here.
  const deviceRegister = useQuery({ queryKey: ['device-register', business.id], queryFn: () => fetchDeviceRegister(business.id), enabled: isSefApp, staleTime: 60_000, retry: false })
  const lockedRegister = deviceRegister.data ?? registerLock(business.id)
  const locked = Boolean(lockedRegister && registers.data?.some((r) => r.id === lockedRegister))
  useEffect(() => {
    const list = registers.data
    if (locked && lockedRegister && registerId !== lockedRegister) setRegisterId(lockedRegister)
    else if (list?.length && !list.some((r) => r.id === registerId)) setRegisterId(list[0].id)
  }, [registers.data, registerId, locked, lockedRegister])
  useEffect(() => {
    if (registerId) localStorage.setItem(`kasa.register.${business.id}`, registerId)
  }, [registerId, business.id])
  const registerName = registers.data?.find((r) => r.id === registerId)?.name ?? null
  // 0050: the till of a unit shows only what sells in that unit (a product with no unit sells everywhere)
  const registerUnit = registers.data?.find((r) => r.id === registerId)?.unit_id ?? null
  const products = useMemo(() => (registerUnit ? allProducts.filter((p) => inUnit(p.unit_ids, registerUnit)) : allProducts), [allProducts, registerUnit])
  // Fiscal data of this register, cached on the device so offline sales can be signed too.
  useQuery({ queryKey: ['fiscal-context', registerId], queryFn: () => fetchFiscalContext(registerId), enabled: Boolean(registerId), staleTime: 5 * 60_000, retry: false })

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
  const lang = useLang()
  const [busy, setBusy] = useState(false)
  const payingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editLine, setEditLine] = useState<CartLine | null>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [camera, setCamera] = useState(false)
  // phone: the product list (tap to add) or the coupon being made
  const [phoneView, setPhoneView] = useState<'products' | 'coupon'>('products')
  const [receipt, setReceipt] = useState<Sale | null>(null)
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
      if (unitDecimals(p.unit) > 0 && qty === 1) {
        // weight: open the line so the weight can be typed
        setEditLine({ key: p.id, product: p, quantity: (cart.lines.find((l) => l.key === p.id)?.quantity ?? 0) + 1, discount: 0 })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart.lines, salon, staffId, lotSum],
  )

  const findByCode = useCallback(
    (raw: string): PosProduct | undefined => {
      const code = raw.replace(/[\s\u0000-\u001f]/g, '')
      if (!code) return undefined
      const exact = products.find((x) => x.barcode === code)
      if (exact) return exact
      const bare = code.replace(/^0+/, '')
      return bare.length >= 4 ? products.find((x) => x.barcode && x.barcode.replace(/^0+/, '') === bare) : undefined
    },
    [products],
  )

  const onScan = useCallback(
    (code: string) => {
      const p = findByCode(code)
      if (p) {
        setCart((c) => addToCart(c, p, 1, salon ? staffId : null))
        setNotice(`${p.name} u shtua`)
        setError(lotWarning(p, 1))
      } else if (canAddProduct) {
        setError(`Barkodi ${code} nuk u gjet – shtoje si produkt të ri`)
        setQuickAdd({ barcode: code.trim() })
      } else setError(`Barkodi ${code} nuk u gjet`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, findByCode, salon, staffId, lotSum, cart.lines, canAddProduct],
  )

  // A barcode scanner types the code very fast; many add Enter, some do not. A code that is exactly a product's
  // barcode goes on the coupon by itself, without waiting for Enter.
  useEffect(() => {
    const q = search.trim()
    if (q.length < 4 || !/^[0-9A-Za-z\-_.]+$/.test(q)) return
    const t = window.setTimeout(() => {
      const p = findByCode(q)
      if (!p) return
      add(p)
      setNotice(`${p.name} u shtua`)
      setSearch('')
    }, 180)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, findByCode])

  // The scanner also works when the search field does not have the focus (after a payment, a click on a product …):
  // fast keystrokes outside a field are collected and taken as a scanned code.
  useEffect(() => {
    let buf = ''
    let last = 0
    let timer = 0
    const flush = () => {
      const code = buf
      buf = ''
      if (code.length >= 4) onScan(code)
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (inField || document.querySelector('[role="dialog"]') || e.ctrlKey || e.altKey || e.metaKey) {
        buf = ''
        return
      }
      const now = Date.now()
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buf.length >= 4) {
          e.preventDefault()
          window.clearTimeout(timer)
          flush()
        }
        buf = ''
        return
      }
      if (e.key.length !== 1) return
      // a person types slower than ~60 ms between keys; a scanner types faster
      if (now - last > 60) buf = ''
      last = now
      buf += e.key
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, 120)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [onScan])

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
    const exact = findByCode(q)
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
    if (/^\d{6,}$/.test(q)) {
      setError(canAddProduct ? `Barkodi ${q} nuk u gjet – shtoje si produkt të ri` : `Barkodi ${q} nuk u gjet`)
      if (canAddProduct) setQuickAdd({ barcode: q })
    }
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 1800)
    return () => clearTimeout(t)
  }, [notice])

  // ---------- payment ----------
  const pay = useCallback(
    async (m: PaymentMethod, tenderedAmount?: number, cardAmount?: number, cardKind: PaymentKind | 'card' = 'card', split?: { kind: SplitKind; amount: number }) => {
      // a ref, not the state: a double press (click + F12) comes before React shows "busy"
      if (cart.lines.length === 0 || busy || payingRef.current) return
      payingRef.current = true
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
        payment: { method: m, tendered: m === 'card' ? undefined : tenderedAmount, card_amount: m === 'mixed' ? cardAmount : undefined, kind: m !== 'cash' && cardKind !== 'card' ? cardKind : undefined, ...(split ? { split } : {}) },
        client_created_at: bookEntry ? bookEntry.at : serverDate().toISOString(),
        ...(bookEntry ? { note: `Blloku i veçantë i kuponëve – nr. ${bookEntry.serial}` } : {}),
      }
      setBusy(true)
      try {
        const sale = await createSale(input)
        // ATK: the coupon is signed and sent before the receipt is printed.
        const fiscal = await fiscalizeSale(sale, { key: input.client_id, registerId, operator: profile.full_name, saved: true, issuedAt: bookEntry?.at }).catch((e: Error) => {
          setError('Kuponi fiskal nuk u krijua: ' + e.message)
          return null
        })
        finish({ ...sale, fiscal })
        void qc.invalidateQueries({ queryKey: ['pos-products'] })
        if (lotsOn) void qc.invalidateQueries({ queryKey: ['lots'] })
        void qc.invalidateQueries({ queryKey: ['products'] })
        void qc.invalidateQueries({ queryKey: ['today-sales'] })
      } catch (e) {
        if (e instanceof NetworkError) {
          const offlineNo = await nextOfflineNo()
          const queued = { ...input, offline: true, offline_no: offlineNo }
          await enqueueSale(queued)
          const local = localReceipt(queued, cart, totals, profile.full_name, registerName, profile.worker_no ?? null)
          const fiscal = await fiscalizeSale(local, { key: input.client_id, registerId, operator: profile.full_name, saved: false, issuedAt: bookEntry?.at }).catch(() => null)
          finish({ ...local, fiscal })
        } else setError((e as Error).message)
      } finally {
        payingRef.current = false
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, totals, registerId, busy, registerName, profile.full_name, appointment, bookEntry],
  )

  const finish = (sale: Sale) => {
    setBookEntry(null)
    setReceipt(sale)
    setExchange(null)
    if (appointment) {
      setAppointment(null)
      void qc.invalidateQueries({ queryKey: ['appointments'] })
    }
    if (receiptSettings.data?.settings.auto_print) void print(sale, false, true)
    setCart(emptyCart())
    setCashOpen(false)
  }

  const payCard = (kind: PaymentKind | 'card' = 'card') => {
    // With exchange credit the card pays only the rest; the credit is the cash part.
    if (credit <= 0) return void pay('card', undefined, undefined, kind)
    if (due <= 0) return void pay('cash', credit)
    void pay('mixed', credit, due, kind)
  }

  // PAGUAJ / F12: the payment is chosen only in the payment window
  const openPayment = () => {
    if (cart.lines.length) setCashOpen(true)
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
        if (cashOpen || bookOpen) return // the payment window closes the sale with Enter
        openPayment()
      } else if (e.key === 'F4') {
        e.preventDefault()
        holdCart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // This device's printer; the print dialog only when the device has no printer. A printer that does not answer
  // opens the notice (try again / print with the dialog / go on) instead of the dialog.
  const [printProblem, showPrintProblem] = usePrintProblem()
  async function print(sale: Sale, copy = false, afterPayment = false) {
    const settings = receiptSettings.data
    const viaDialog = () => {
      setPrintSale({ sale, copy })
      setTimeout(() => void printPage(), 50)
    }
    if (settings) {
      const attempt = async () => {
        const how = await printReceipt(sale, business, settings, { copy, openDrawer: afterPayment })
        if (how === 'browser') viaDialog()
      }
      try {
        await attempt()
      } catch (e) {
        showPrintProblem(e, attempt, viaDialog)
      }
      return
    }
    viaDialog()
  }


  const exchangeBanner = exchange && (
    <div className="flex items-center justify-between gap-2 rounded-ctl bg-brand-100 px-3 py-2 text-sm">
      <span>
        Ndërrim{exchange.from && ` nga fatura #${String(exchange.from).padStart(5, '0')}`} · kredi <strong className="tabular-nums">−{formatEUR(credit)}</strong>
        <span className="block text-sm text-muted">
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
      <span className="mt-0.5 block truncate text-sm text-muted">
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
              <div className="truncate text-[15px] font-semibold">{l.product.name}</div>
              <div className="text-sm text-muted">
                {formatEUR(l.product.sale_price)} / {unitLabel(l.product.unit)}
                {l.discount > 0 && <span className="text-warn-700"> · −{formatEUR(l.discount)}</span>}
                <span className="font-semibold text-ink lg:hidden"> · {formatEUR(t?.total ?? 0)}</span>
              </div>
            </button>
              {salon && staff.length > 0 && (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-1 pr-2 text-sm font-semibold">
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
                onClick={() => setCart((c) => setQuantity(c, l.key, unitDecimals(l.product.unit) > 0 ? roundQty(l.quantity - 0.1, l.product.unit) : l.quantity - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-field md:h-9 md:w-9 md:rounded-lg"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setEditLine(l)} className="min-w-[44px] text-center text-lg font-semibold tabular-nums md:min-w-[36px] md:text-base">
                {unitDecimals(l.product.unit) > 0 ? l.quantity.toFixed(unitDecimals(l.product.unit)).replace(/\.?0+$/, '') : l.quantity}
              </button>
              <button
                type="button"
                aria-label="Më shumë"
                onClick={() => setCart((c) => setQuantity(c, l.key, unitDecimals(l.product.unit) > 0 ? roundQty(l.quantity + 0.1, l.product.unit) : l.quantity + 1))}
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
    <div className="flex items-center gap-2 overflow-x-auto">
      {canAddProduct && (
        <ToolButton icon={Plus} label={tr('Shto', lang)} primary title={business.type === 'salon' ? 'Shto shërbimin' : 'Shto produktin'} onClick={() => setQuickAdd({ barcode: null })} />
      )}
      {canAddProduct && <ToolButton icon={Pencil} label={tr('Ndrysho', lang)} title="Ndrysho ose fshi një produkt" onClick={() => setManageOpen(true)} />}
      {canAddProduct && <ToolButton icon={BookOpen} label={tr('Blloku', lang)} title="Kupon nga blloku i veçantë (pajisja ishte e prishur)" active={Boolean(bookEntry)} onClick={() => setBookOpen(true)} />}
      <ToolButton icon={PauseCircle} label={tr('Në pritje', lang)} title="Kuponët e ruajtur në pritje (F4 e ruan)" badge={held.length || undefined} onClick={() => setHeldOpen(true)} />
      <ToolButton icon={ClipboardList} label={tr('Kuponët', lang)} title="Kuponët e lëshuar: sot dhe më herët, anulimi, kthimi, printimi" badge={queue.pending.length || undefined} badgeTone="warn" onClick={() => navigate('/kuponet')} />
      {locked && (registers.data?.length ?? 0) > 1 ? (
        <span className="flex h-[56px] shrink-0 items-center whitespace-nowrap rounded-ctl border border-line bg-bg px-3 text-sm font-semibold" title="Kjo pajisje është aktivizuar për këtë arkë">
          {registerName}
        </span>
      ) : (registers.data?.length ?? 0) > 1 && (
        <Select
          aria-label="Arka"
          value={registerId ?? ''}
          onChange={(e) => setRegisterId(e.target.value)}
          className="h-[56px] w-auto"
          options={(registers.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
        />
      )}
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
          // Enter (or Tab, which some scanners send) adds the product
          if (e.key === 'Enter' || (e.key === 'Tab' && search.trim())) {
            e.preventDefault()
            submitSearch()
          } else if (e.key === 'Escape') setSearch('')
        }}
        placeholder={wide ? tr('Skano barkodin ose shkruaj emrin e produktit…', lang) : tr('Kërko produktin…', lang)}
        className="h-[52px] w-full rounded-xl border-2 border-field bg-white pl-12 pr-14 text-[16px] focus:border-brand-600 focus:outline-none"
      />
      {search ? (
        <button type="button" aria-label="Pastro" onClick={() => setSearch('')} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-bg">
          <X className="h-4 w-4" />
        </button>
      ) : (
        wide && <span className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-field px-1.5 text-sm text-muted">F2</span>
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
      {canAddProduct && (
        <button className="font-semibold text-brand-600 underline" onClick={() => setQuickAdd({ barcode: null })}>
          Shto produktin e parë
        </button>
      )}
    </div>
  ) : null

  const bookBanner = bookEntry && (
    <div className="flex items-center gap-2 rounded-ctl bg-amber-100 px-3 py-2 text-sm text-amber-700">
      <BookOpen className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        Kupon nga blloku nr. <b>{bookEntry.serial}</b>, lëshuar më {formatSq(bookEntry.at, { timeZone: KOSOVO_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
      <button type="button" className="font-semibold underline" onClick={() => setBookEntry(null)}>
        Anulo
      </button>
    </div>
  )

  const sharedDialogs = (
    <>
      <BookEntryDialog
        open={bookOpen}
        onClose={() => {
          setBookOpen(false)
          if (bookFromPay) setCashOpen(true)
          setBookFromPay(false)
        }}
        onSet={(b) => {
          setBookEntry(b)
          setBookOpen(false)
          if (bookFromPay) setCashOpen(true)
          setBookFromPay(false)
        }}
      />
      {printProblem}
      <ManageProductsDialog
        open={manageOpen && !editProductId}
        products={products}
        onClose={() => setManageOpen(false)}
        onEdit={(id) => setEditProductId(id)}
        onDeleted={(p, result) => {
          void qc.invalidateQueries({ queryKey: ['products'] })
          void catalog.refetch()
          setNotice(result === 'deleted' ? `${p.name} u fshi` : `${p.name} u hoq nga arka (ka shitje, ruhet si joaktiv)`)
        }}
      />
      <QuickProductDialog
        open={Boolean(editProductId)}
        editId={editProductId}
        type={business.type}
        vatRegistered={vat}
        categories={catalog.data?.categories ?? []}
        onClose={() => setEditProductId(null)}
        onSaved={async (id) => {
          setEditProductId(null)
          void qc.invalidateQueries({ queryKey: ['products'] })
          const fresh = await catalog.refetch()
          const p = fresh.data?.products.find((x) => x.id === id)
          if (p) setNotice(`${p.name} u ruajt`)
        }}
      />
      <QuickProductDialog
        open={Boolean(quickAdd)}
        type={business.type}
        vatRegistered={vat}
        categories={catalog.data?.categories ?? []}
        barcode={quickAdd?.barcode ?? null}
        onClose={() => setQuickAdd(null)}
        onSaved={async (id) => {
          setQuickAdd(null)
          setError(null)
          void qc.invalidateQueries({ queryKey: ['products'] })
          const fresh = await catalog.refetch()
          const p = fresh.data?.products.find((x) => x.id === id)
          if (p) {
            add(p)
            setNotice(`${p.name} u shtua në katalog dhe në faturë`)
          }
        }}
      />
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
      <CashDialog
        open={cashOpen}
        total={due}
        busy={busy}
        bookActive={Boolean(bookEntry)}
        onClose={() => setCashOpen(false)}
        onCash={(t) => void pay('cash', round2(t + credit))}
        onCard={(k) => payCard(k)}
        onMixed={(c, t, k) => void pay('mixed', round2(t + credit), c, k)}
        onSplit={(first, second, amount) => {
          // an exchange credit is paid back in cash / card only
          if (credit > 0) return setError('Ndërrimi me kredi paguhet me kesh ose kartelë')
          void pay('card', undefined, undefined, first, { kind: second, amount })
        }}
        onBook={
          canAddProduct
            ? () => {
                setCashOpen(false)
                setBookFromPay(true)
                setBookOpen(true)
              }
            : undefined
        }
      />
      <Dialog open={Boolean(receipt)} onClose={() => setReceipt(null)} width="md:max-w-[440px]">
        {receipt && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <div className="text-sm text-muted">{receipt.offline ? 'Ruajtur pa internet – dërgohet më vonë' : tr('Pagesa u krye', lang)}</div>
              {receipt.change_amount > 0 && (
                <div className="mt-1 text-[28px] font-semibold tracking-[-0.015em]">
                  Kusuri <span className="text-ok-700">{formatEUR(receipt.change_amount)}</span>
                </div>
              )}
            </div>
            <div className="max-h-[calc(50dvh/var(--zoom,1))] overflow-y-auto rounded-xl border border-line bg-white py-2">
              <Receipt sale={receipt} business={business} settings={receiptSettings.data} />
            </div>
            {receipt.fiscal && !receipt.offline && receipt.id && <EcouponButton saleId={receipt.id} />}
            <div className="grid grid-cols-2 gap-2.5">
              <Button variant="secondary" size="lg" onClick={() => void print(receipt)}>
                {tr('Printo', lang)}
              </Button>
              <Button size="lg" autoFocus onClick={() => setReceipt(null)}>
                {tr('Shitje e re', lang)}
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
                  <div className="text-sm text-muted">{formatSq(h.saved_at, { timeZone: KOSOVO_TZ, hour: '2-digit', minute: '2-digit' })}</div>
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
      <PrintArea sale={printSale?.sale ?? null} copy={printSale?.copy} business={business} settings={receiptSettings.data} />
    </>
  )

  // A SEF device of a business with several tills that has no till yet: the owner / manager gives it one, once.
  // Until then nobody sells on it (it would not know its ATK key, unit, workers and products).
  if (isSefApp && deviceRegister.data === null && (registers.data?.length ?? 0) > 1) {
    return (
      <AssignRegister
        registers={registers.data ?? []}
        canAssign={canAddProduct}
        onAssign={async (id) => {
          await assignDeviceRegister(business.id, id)
          setRegisterId(id)
          await qc.invalidateQueries({ queryKey: ['device-register', business.id] })
        }}
      />
    )
  }

  // ================= DESKTOP =================
  if (wide) {
    return (
      <div className="flex h-[calc(100dvh/var(--zoom,1)-44px-69px)] gap-5 p-6 pt-3">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-3">
            {searchBox}
            <Button variant="secondary" className="h-[52px]" onClick={() => setCamera((v) => !v)}>
              <Camera className="h-5 w-5" /> Kamera
            </Button>
            {toolbar}
          </div>
          {staffBar}
        {offlineBanner}
          {messages}
          <CameraScanner active={camera} onCode={onScan} />
          <div className="flex flex-wrap gap-2">
            {[{ id: 'all', name: tr('Të gjitha', lang) }, ...categories].map((c) => (
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
                    <div className="text-sm text-muted">{categories.find((c) => c.id === p.category_id)?.name ?? ' '}</div>
                    <div className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-tight">{p.name}</div>
                    {lotsOn && lotLine(p)}
                    <div className="mt-auto flex items-end justify-between pt-3">
                      <span className="text-lg font-bold tabular-nums">{formatEUR(p.sale_price)}</span>
                      {p.has_variants ? (
                        <span className="text-sm text-muted">{variantSummary(p)}</span>
                      ) : (
                        showStock && p.kind === 'product' && <span className={cn('text-sm', stockClass(p))}>{formatQty(p.stock, p.unit)}</span>
                      )}
                      {p.kind === 'service' && p.duration_min && <span className="text-sm text-muted">{p.duration_min} min</span>}
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
              <div className="text-xl font-semibold">{tr('Kupon i ri', lang)}</div>
              <div className="text-sm text-muted">
                {cart.lines.length} {cart.lines.length === 1 ? 'produkt' : 'produkte'} · {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(totals.itemsCount)} artikuj
                {registerName && ` · ${registerName}`}
              </div>
              {exchangeBanner && <div className="mt-2">{exchangeBanner}</div>}
              {bookBanner && <div className="mt-2">{bookBanner}</div>}
              {appointment && (
                <div className="mt-1 text-sm font-medium text-brand-600">
                  Klienti: {appointment.customer_name} · termini{' '}
                  {formatSq(appointment.starts_at, { timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit' })}
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
                {tr('Skano një barkod ose kliko një produkt', lang)}
              </div>
            ) : (
              cartLines
            )}
          </div>
          <div className="border-t border-line bg-[#F9FAFB] px-5 py-3 text-sm">
            {totals.discountTotal > 0 && (
              <div className="flex justify-between py-0.5 text-warn-700">
                <span>Zbritje</span>
                <span className="tabular-nums">−{formatEUR(totals.discountTotal)}</span>
              </div>
            )}
            {vat && (
              <div className="flex justify-between py-0.5 text-muted">
                <span>{tr('Pa TVSH', lang)}</span>
                <span className="tabular-nums">{formatEUR(totals.netTotal)}</span>
              </div>
            )}
            {totals.vat
              .filter((v) => v.rate > 0)
              .map((v) => (
                <div key={v.code} className="flex justify-between py-0.5 text-muted">
                  <span>TVSH {Math.round(v.rate * 100)}%</span>
                  <span className="tabular-nums">{formatEUR(v.vat)}</span>
                </div>
              ))}
            <div className="mt-2 flex items-end justify-between border-t border-dashed border-field pt-2">
              <span className="text-base font-semibold">{tr('Totali', lang)}</span>
              <span className="text-[32px] font-semibold tracking-[-0.015em] leading-none tabular-nums">{formatEUR(totals.total)}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-line p-5">
            <Button size="lg" className="h-[58px] text-[18px]" disabled={!cart.lines.length} loading={busy} onClick={openPayment}>
              {tr('Paguaj', lang)} {formatEUR(due)} <span className="rounded-md border border-white/40 px-1.5 text-sm font-medium">F12</span>
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
    <div className="flex min-h-[calc(100dvh/var(--zoom,1)-var(--chrome,116px)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col">
      <div className="sticky top-[calc(var(--topbar,0px)+env(safe-area-inset-top))] z-20 border-b border-line bg-white px-4 pb-3 pt-4">
        <div className="mb-3">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em] leading-tight">{tr('Kupon i ri', lang)}</h1>
          <div className="text-[15px] text-muted">
            {registerName ?? 'Arka'} · {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(totals.itemsCount)} artikuj
          </div>
          {bookBanner && <div className="mt-2">{bookBanner}</div>}
        </div>
        <div className="mb-3">{toolbar}</div>
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
          <ul className="absolute inset-x-4 top-full z-30 mt-1 max-h-[calc(55dvh/var(--zoom,1))] overflow-y-auto rounded-xl border border-line bg-white shadow-pop">
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
                      <span className="text-sm text-muted">{variantSummary(p)}</span>
                    ) : (
                      showStock && p.kind === 'product' && <span className={cn('text-sm', stockClass(p))}>{formatQty(p.stock, p.unit)}</span>
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
        {/* the products right away (tap to add) or the coupon being made */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-1 shadow-card" role="tablist" aria-label="Pamja">
          {(
            [
              ['products', tr('Produktet', lang)],
              ['coupon', `${tr('Kuponi', lang)}${cart.lines.length ? ` (${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(totals.itemsCount)})` : ''}`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={phoneView === v}
              onClick={() => setPhoneView(v)}
              className={cn('h-11 rounded-lg text-[15px] font-semibold', phoneView === v ? 'bg-brand-600 text-white' : 'text-ink')}
            >
              {label}
            </button>
          ))}
        </div>

        {phoneView === 'products' ? (
          catalogState ?? (
            <>
              {categories.length > 0 && (
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  {[{ id: 'all', name: tr('Të gjitha', lang) }, ...categories].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className={cn('h-10 shrink-0 rounded-full border px-4 text-[15px] font-medium', category === c.id ? 'border-ink bg-ink text-white' : 'border-line bg-white')}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                {results.slice(0, 200).map((p) => {
                  const inCart = cart.lines.filter((l) => l.product.id === p.id || l.product.parent_id === p.id).reduce((t, l) => t + l.quantity, 0)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => add(p)}
                      className={cn(
                        'relative flex min-h-[96px] flex-col rounded-card border bg-white p-3 text-left active:bg-brand-100',
                        inCart > 0 ? 'border-brand-600' : 'border-line',
                      )}
                    >
                      <span className="line-clamp-2 text-[15px] font-semibold leading-tight">{p.name}</span>
                      {lotsOn && lotLine(p)}
                      <span className="mt-auto flex items-end justify-between gap-1 pt-2">
                        <span className="text-[17px] font-bold tabular-nums">{formatEUR(p.sale_price)}</span>
                        {p.has_variants ? (
                          <span className="text-sm text-muted">{variantSummary(p)}</span>
                        ) : (
                          showStock && p.kind === 'product' && <span className={cn('text-sm', stockClass(p))}>{formatQty(p.stock, p.unit)}</span>
                        )}
                      </span>
                      {inCart > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 min-w-[26px] rounded-full bg-brand-600 px-1.5 text-center text-[13px] font-bold leading-[26px] text-white">
                          {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(inCart)}
                        </span>
                      )}
                    </button>
                  )
                })}
                {results.length === 0 && <div className="col-span-full py-10 text-center text-muted">Asgjë nuk u gjet</div>}
              </div>
            </>
          )
        ) : cart.lines.length > 0 ? (
          <>
            <div className="-mx-4 bg-bg">{cartLines}</div>
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
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center text-muted">
            <ScanLine className="h-8 w-8" />
            Kuponi është bosh
            <Button variant="secondary" onClick={() => setPhoneView('products')}>
              Zgjidh produktet
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
          <span className="text-[34px] font-semibold tracking-[-0.015em] leading-none tabular-nums">{formatEUR(totals.total)}</span>
        </div>
        <Button size="lg" className="w-full" disabled={!cart.lines.length} loading={busy && !cashOpen} onClick={() => setCashOpen(true)}>
          {tr('Paguaj', lang)} {formatEUR(due)}
        </Button>
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
  workerNo: number | null = null,
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
    payment_kind: input.payment.kind ?? null,
    cash_amount: cash,
    card_amount: card,
    split_kind: input.payment.split?.kind ?? null,
    split_amount: input.payment.split?.amount ?? 0,
    tendered: cash > 0 ? (t ?? cash) : null,
    change_amount: cash > 0 ? round2((t ?? cash) - cash) : 0,
    reason: null,
    note: null,
    offline: true,
    offline_no: input.offline_no ?? null,
    fiscal_status: 'non_fiscal',
    worker_id: '',
    worker_name: workerName,
    worker_no: workerNo,
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


/** A till button: the icon with its name under it (no icon-only buttons on the till). */
function AssignRegister({ registers, canAssign, onAssign }: { registers: { id: string; name: string; unit_id?: string | null }[]; canAssign: boolean; onAssign: (id: string) => Promise<void> }) {
  const units = useBusinessUnits()
  const unitName = new Map((units.data ?? []).map((u) => [u.id, u.name]))
  // "Njësia · Arka 1" also for the tills named before the units
  const label = (r: { name: string; unit_id?: string | null }) => {
    const u = r.unit_id ? unitName.get(r.unit_id) : null
    return u && !r.name.startsWith(u) ? `${u} · ${r.name}` : r.name
  }
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-4">
      <div className="w-full max-w-[480px] rounded-card border border-line bg-white p-6 shadow-card">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Cakto arkën e kësaj pajisjeje</h1>
        <p className="mt-2 text-[15px] text-muted">
          Biznesi ka disa arka. Kjo pajisje do të shesë vetëm si arka që zgjidhet këtu: me çelësin e saj të ATK-së, në njësinë e saj, me punëtorët dhe artikujt e asaj njësie.
        </p>
        {canAssign ? (
          <>
            <div className="mt-4">
              <Select
                label="Arka"
                value={id}
                onChange={(e) => setId(e.target.value)}
                options={[{ value: '', label: 'Zgjidh arkën' }, ...registers.map((r) => ({ value: r.id, label: label(r) }))]}
              />
            </div>
            {error && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
            <Button
              className="mt-4 w-full"
              size="lg"
              disabled={!id}
              loading={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await onAssign(id)
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Cakto arkën
            </Button>
          </>
        ) : (
          <p className="mt-4 rounded-ctl bg-amber-100 px-4 py-3 text-[15px] text-amber-700">
            Thirr pronarin ose menaxherin: hyn me PIN-in e vet në këtë pajisje dhe e cakton arkën njëherë.
          </p>
        )}
      </div>
    </div>
  )
}

function ToolButton({
  icon: Icon,
  label,
  title,
  onClick,
  primary,
  active,
  badge,
  badgeTone = 'amber',
}: {
  icon: LucideIcon
  label: string
  title?: string
  onClick: () => void
  primary?: boolean
  active?: boolean
  badge?: number
  badgeTone?: 'amber' | 'warn'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'relative flex h-[56px] min-w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 text-[12px] font-semibold leading-none',
        primary ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700' : active ? 'border-amber-700 bg-amber-100 text-amber-700' : 'border-line bg-white text-ink hover:bg-bg',
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="whitespace-nowrap">{label}</span>
      {badge ? <span className={cn('absolute -right-1 -top-1 rounded-full px-1.5 text-[12px] font-bold text-white', badgeTone === 'warn' ? 'bg-warn-700' : 'bg-amber-700')}>{badge}</span> : null}
    </button>
  )
}
