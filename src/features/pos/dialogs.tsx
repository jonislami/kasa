import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Delete, ShieldCheck } from 'lucide-react'
import { Button, Dialog, Input, Select, Tabs } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR, round2 } from '@/lib/money'
import { unitLabel } from '@/lib/units'
import { fetchApprovers, PAYMENT_KIND_LABELS, type PaymentKind } from './api'
import type { CartLine } from './cart'
import { unitDecimals } from '@/lib/units'

const parseNum = (s: string) => {
  const n = Number(s.trim().replace(',', '.'))
  return s.trim() === '' ? null : Number.isFinite(n) ? n : NaN
}

// ---------------------------------------------------------------------------
// Manager PIN approval
// ---------------------------------------------------------------------------
export interface ApprovalRequest {
  action: string // "Anulim i faturës"
  details: { label: string; value: string }[]
}

export function ApprovalDialog({
  request,
  requester,
  busy,
  error,
  onApprove,
  onCancel,
}: {
  request: ApprovalRequest | null
  requester: string
  busy: boolean
  error: string | null
  onApprove: (approverId: string, pin: string) => void
  onCancel: () => void
}) {
  const approvers = useQuery({ queryKey: ['approvers'], queryFn: fetchApprovers, enabled: Boolean(request) })
  const [approver, setApprover] = useState('')
  const [pin, setPin] = useState('')

  useEffect(() => {
    if (request) setPin('')
  }, [request])
  useEffect(() => {
    if (!approver && approvers.data?.length) setApprover((approvers.data.find((a) => a.has_pin) ?? approvers.data[0]).id)
  }, [approvers.data, approver])
  useEffect(() => {
    if (error) setPin('')
  }, [error])

  // physical keyboard
  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter' && pin.length === 4 && approver) onApprove(approver, pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, pin, approver, onApprove])

  const press = (d: string) => setPin((p) => (p.length < 4 ? p + d : p))
  const selected = approvers.data?.find((a) => a.id === approver)

  return (
    <Dialog open={Boolean(request)} onClose={onCancel} width="md:max-w-[480px]">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h2 className="mt-3 text-[22px] font-semibold">Kërkohet PIN-i i menaxherit</h2>
        <p className="mt-1 text-sm text-muted">
          {requester} kërkon: {request?.action.toLowerCase()}
        </p>
      </div>
      <div className="mt-4 rounded-xl bg-[#F7F8FA] px-4 py-3 text-sm">
        {request?.details.map((d) => (
          <div key={d.label} className="flex justify-between gap-3 py-1">
            <span className="text-muted">{d.label}</span>
            <span className="text-right font-semibold">{d.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Select
          label="Menaxheri"
          value={approver}
          onChange={(e) => {
            setApprover(e.target.value)
            setPin('')
          }}
          options={(approvers.data ?? []).map((a) => ({
            value: a.id,
            label: `${a.full_name || 'Pa emër'} (${a.role === 'admin' ? 'pronari' : 'menaxher'})${a.has_pin ? '' : ' – pa PIN'}`,
          }))}
        />
      </div>
      <div className="my-5 flex justify-center gap-4" aria-label={`${pin.length} nga 4 shifra`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('h-3.5 w-3.5 rounded-full border-2', i < pin.length ? 'border-brand-600 bg-brand-600' : 'border-field')} />
        ))}
      </div>
      {(error || (selected && !selected.has_pin)) && (
        <p className="mb-3 rounded-ctl bg-warn-100 px-4 py-2.5 text-center text-sm text-warn-700">
          {error ?? 'Ky menaxher nuk ka vendosur ende PIN (Cilësimet → PIN-i im).'}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} className="h-[60px] rounded-xl border border-line text-[22px] font-medium hover:bg-bg">
            {d}
          </button>
        ))}
        <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} className="flex h-[60px] items-center justify-center rounded-xl border border-line text-muted hover:bg-bg">
          <Delete className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => press('0')} className="h-[60px] rounded-xl border border-line text-[22px] font-medium hover:bg-bg">
          0
        </button>
        <Button size="lg" className="h-[60px]" disabled={pin.length !== 4 || !approver} loading={busy} onClick={() => onApprove(approver, pin)}>
          Mirato
        </Button>
      </div>
      <Button variant="danger" block className="mt-3" onClick={onCancel} disabled={busy}>
        Anulo
      </Button>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Edit a cart line: quantity (kg with decimals) and line discount
// ---------------------------------------------------------------------------
export function LineDialog({
  line,
  onSave,
  onRemove,
  onClose,
}: {
  line: CartLine | null
  onSave: (quantity: number, discount: number) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [d, setD] = useState('')
  const [mode, setMode] = useState<'eur' | 'pct'>('eur')
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!line) return
    setQ(String(line.quantity))
    setD(line.discount ? String(line.discount) : '')
    setMode('eur')
    setErr(null)
    setTimeout(() => ref.current?.select(), 50)
  }, [line])

  if (!line) return null
  const kg = unitDecimals(line.product.unit) > 0
  const qty = parseNum(q)
  const gross = qty && !Number.isNaN(qty) ? round2(qty * line.product.sale_price) : 0
  const dv = parseNum(d)
  const discount = dv == null || Number.isNaN(dv) ? 0 : mode === 'pct' ? round2((gross * dv) / 100) : round2(dv)

  const save = () => {
    if (qty == null || Number.isNaN(qty) || qty <= 0) return setErr('Sasia nuk është e saktë')
    if (!kg && !Number.isInteger(qty)) return setErr('Kjo njësi shitet vetëm me numra të plotë')
    if (dv != null && (Number.isNaN(dv) || dv < 0 || discount > gross)) return setErr('Zbritja nuk është e saktë')
    onSave(qty, discount)
  }

  return (
    <Dialog open onClose={onClose} title={line.product.name} subtitle={`${formatEUR(line.product.sale_price)} / ${unitLabel(line.product.unit)}`} width="md:max-w-[420px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Input ref={ref} label={line.product.unit === 'kg' ? 'Pesha (kg)' : kg ? `Sasia (${unitLabel(line.product.unit)})` : 'Sasia'} inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Zbritje për këtë rresht</span>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input aria-label="Zbritja" inputMode="decimal" value={d} onChange={(e) => setD(e.target.value)} placeholder="0" />
            </div>
            <Tabs size="sm" value={mode} onChange={setMode} options={[{ value: 'eur', label: '€' }, { value: 'pct', label: '%' }]} />
          </div>
        </div>
        <div className="flex justify-between rounded-ctl bg-bg px-4 py-3 text-sm">
          <span className="text-muted">Totali i rreshtit</span>
          <span className="font-semibold tabular-nums">{formatEUR(Math.max(0, gross - discount))}</span>
        </div>
        {err && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{err}</p>}
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="danger" size="lg" onClick={onRemove}>
            Hiqe
          </Button>
          <Button type="submit" size="lg">
            Ruaj
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Invoice discount
// ---------------------------------------------------------------------------
export function DiscountDialog({
  open,
  subtotal,
  current,
  onSave,
  onClose,
}: {
  open: boolean
  subtotal: number
  current: number
  onSave: (amount: number) => void
  onClose: () => void
}) {
  const [v, setV] = useState('')
  const [mode, setMode] = useState<'eur' | 'pct'>('pct')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setV(current ? String(current) : '')
      setMode(current ? 'eur' : 'pct')
      setErr(null)
    }
  }, [open, current])
  const n = parseNum(v)
  const amount = n == null || Number.isNaN(n) ? 0 : mode === 'pct' ? round2((subtotal * n) / 100) : round2(n)
  return (
    <Dialog open={open} onClose={onClose} title="Zbritje në faturë" subtitle={`Nëntotali ${formatEUR(subtotal)}`} width="md:max-w-[420px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (n != null && (Number.isNaN(n) || n < 0 || amount > subtotal)) return setErr('Zbritja nuk është e saktë')
          onSave(amount)
        }}
      >
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input aria-label="Zbritja" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder="0" />
          </div>
          <Tabs size="sm" value={mode} onChange={setMode} options={[{ value: 'pct', label: '%' }, { value: 'eur', label: '€' }]} />
        </div>
        <div className="flex flex-wrap gap-2">
          {[5, 10, 15, 20].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setMode('pct')
                setV(String(p))
              }}
              className="h-10 rounded-full border border-field px-4 text-sm font-medium hover:bg-bg"
            >
              {p}%
            </button>
          ))}
        </div>
        <div className="flex justify-between rounded-ctl bg-bg px-4 py-3 text-sm">
          <span className="text-muted">Zbritja</span>
          <span className="font-semibold tabular-nums">−{formatEUR(amount)}</span>
        </div>
        {err && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{err}</p>}
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" size="lg" onClick={() => onSave(0)}>
            Pa zbritje
          </Button>
          <Button type="submit" size="lg">
            Apliko
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Cash payment (phone) – amount given, quick notes, change
// ---------------------------------------------------------------------------
type PayTab = 'cash' | 'card' | 'mixed'
type CardKind = PaymentKind | 'card'
const CARD_KINDS: [CardKind, string][] = [['card', 'Kartelë'], ...(Object.entries(PAYMENT_KIND_LABELS) as [PaymentKind, string][])]

/**
 * "Pagesa" – the only place where the payment is chosen (opens after PAGUAJ / F12):
 *  Kesh            what the client gave (typed or Saktë / 5 / 10 / 20 / 50 / 100 €) and the change
 *  Kartelë         card, bank transfer, voucher or cheque for the whole amount
 *  Të kombinuara   part by card (or transfer …), the rest in cash with its change
 * then MBYLL SHITJEN (Enter). BLLOKU TATIMOR (owner / manager) enters a coupon of the separate book.
 */
export function CashDialog({
  open,
  total,
  busy,
  bookActive,
  onCash,
  onCard,
  onMixed,
  onBook,
  onClose,
}: {
  open: boolean
  total: number
  busy: boolean
  /** A coupon of the separate book is being entered. */
  bookActive?: boolean
  onCash: (tendered: number) => void
  onCard: (kind: CardKind) => void
  onMixed: (cardAmount: number, tendered: number, kind: CardKind) => void
  onBook?: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<PayTab>('cash')
  const [kind, setKind] = useState<CardKind>('card')
  const [v, setV] = useState('')
  const [exact, setExact] = useState(false)
  const [cardPart, setCardPart] = useState('')
  useEffect(() => {
    if (open) {
      setTab('cash')
      setKind('card')
      setV('')
      setExact(false)
      setCardPart('')
    }
  }, [open])

  const c = parseNum(cardPart)
  const cardOk = tab !== 'mixed' || (c != null && !Number.isNaN(c) && c > 0 && c < total)
  const cashDue = tab === 'mixed' ? round2(total - (cardOk && c ? c : 0)) : total
  const n = parseNum(v)
  const tendered = n == null || Number.isNaN(n) ? cashDue : n
  const change = round2(tendered - cashDue)
  const short = tab !== 'card' && change < 0
  const ready = !busy && !short && cardOk
  const close = () => {
    if (!ready) return
    if (tab === 'cash') onCash(tendered)
    else if (tab === 'card') onCard(kind)
    else onMixed(c!, tendered, kind)
  }
  const pick = (x: number | 'exact') => {
    setExact(x === 'exact')
    setV(x === 'exact' ? '' : String(x))
  }
  const chip = 'h-11 rounded-ctl border text-[15px] font-semibold tabular-nums disabled:opacity-40'
  const on = 'border-brand-600 bg-brand-100 text-brand-700'
  const kindLabel = kind === 'card' ? 'kartelë' : PAYMENT_KIND_LABELS[kind].toLowerCase()

  const cashBlock = (
    <>
      <Input
        label={tab === 'mixed' ? 'Marrë kesh nga klienti' : 'Marrë nga klienti'}
        inputMode="decimal"
        autoFocus={tab === 'cash'}
        value={v}
        onChange={(e) => {
          setExact(false)
          setV(e.target.value)
        }}
        onKeyDown={(e) => e.key === 'Enter' && close()}
        placeholder={formatEUR(cashDue)}
      />
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        <button type="button" onClick={() => pick('exact')} className={cn(chip, exact ? on : 'border-field hover:bg-bg')}>
          Saktë
        </button>
        {[5, 10, 20, 50, 100].map((x) => (
          <button key={x} type="button" disabled={x < cashDue} onClick={() => pick(x)} className={cn(chip, n === x && !exact ? on : 'border-field hover:bg-bg')}>
            {x} €
          </button>
        ))}
      </div>
      <div className={cn('flex items-center justify-between rounded-ctl border px-4 py-3', short ? 'border-[#F3C4BE] bg-warn-100 text-warn-700' : 'border-line bg-[#F8FAFC]')}>
        <span className="text-[15px] font-medium">{short ? 'Mungojnë' : 'Kusuri'}</span>
        <span className={cn('text-[26px] font-semibold tracking-[-0.015em] tabular-nums', short ? 'text-warn-700' : 'text-brand-700')}>{formatEUR(Math.abs(change))}</span>
      </div>
    </>
  )

  const kinds = (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Mënyra e pagesës pa kesh">
      {CARD_KINDS.map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn('h-11 rounded-full border px-4 text-[15px] font-semibold', kind === k ? on : 'border-field bg-white text-ink')}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title="Pagesa" width="md:max-w-[500px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] text-muted">Totali</span>
          <span className="text-[28px] font-semibold tracking-[-0.015em] tabular-nums">{formatEUR(total)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Mënyra e pagesës">
          {(
            [
              ['cash', 'Kesh'],
              ['card', 'Kartelë'],
              ['mixed', 'Të kombinuara'],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn('h-12 rounded-ctl border text-[15px] font-semibold', tab === t ? 'border-2 border-brand-600 bg-brand-100 text-brand-700' : 'border-field bg-white text-ink hover:bg-bg')}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'cash' && cashBlock}
        {tab === 'card' && (
          <>
            {kinds}
            <p className="text-[15px] text-muted">E gjithë shuma paguhet me {kindLabel}.</p>
          </>
        )}
        {tab === 'mixed' && (
          <>
            {kinds}
            <Input
              label={`Paguhet me ${kindLabel} (€)`}
              inputMode="decimal"
              autoFocus
              value={cardPart}
              onChange={(e) => setCardPart(e.target.value)}
              placeholder="0.00"
              error={cardPart.trim() && !cardOk ? 'Më pak se totali' : undefined}
            />
            <div className="flex items-baseline justify-between text-[15px]">
              <span className="text-muted">Mbetet kesh</span>
              <span className="font-semibold tabular-nums">{formatEUR(cashDue)}</span>
            </div>
            {cashBlock}
          </>
        )}

        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <Button variant="secondary" size="lg" disabled={busy} onClick={onClose}>
            Anulo
          </Button>
          <Button size="lg" className="disabled:opacity-50" disabled={!ready} loading={busy} onClick={close}>
            MBYLL SHITJEN
          </Button>
        </div>
        {onBook && (
          <Button variant="secondary" size="lg" disabled={busy} onClick={onBook} className={cn(bookActive && 'border-amber-700 bg-amber-100 text-amber-700')}>
            <BookOpen className="h-4 w-4" /> BLLOKU TATIMOR{bookActive ? ' ✓' : ''}
          </Button>
        )}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Camera barcode scanner (BarcodeDetector – Chrome/Edge/Android). iPhone Safari: not available.
// ---------------------------------------------------------------------------
interface Detector {
  detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

export function cameraScanSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia)
}

export function CameraScanner({ active, onCode, className }: { active: boolean; onCode: (code: string) => void; className?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  useEffect(() => {
    if (!active) return
    if (!cameraScanSupported()) {
      setError('Ky shfletues nuk lexon barkod me kamerë. Përdor Chrome në Android ose skanerin USB.')
      return
    }
    let stream: MediaStream | null = null
    let stop = false
    const Ctor = (window as unknown as { BarcodeDetector: new (o: unknown) => Detector }).BarcodeDetector
    const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!video.current || stop) return
        video.current.srcObject = stream
        await video.current.play()
        const tick = async () => {
          if (stop || !video.current) return
          try {
            const codes = await detector.detect(video.current)
            const code = codes[0]?.rawValue
            const now = Date.now()
            if (code && (code !== last.current.code || now - last.current.at > 1500)) {
              last.current = { code, at: now }
              navigator.vibrate?.(60)
              onCode(code)
            }
          } catch {
            /* frame not ready */
          }
          setTimeout(tick, 250)
        }
        void tick()
      } catch {
        setError('Kamera nuk u hap. Lejo qasjen në kamerë te shfletuesi.')
      }
    })()
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, onCode])

  if (!active) return null
  return (
    <div className={cn('relative overflow-hidden rounded-card bg-brand-950', className)}>
      {error ? (
        <p className="px-6 py-10 text-center text-sm text-white/80">{error}</p>
      ) : (
        <>
          <video ref={video} muted playsInline className="h-48 w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-[22%] top-1/2 h-20 -translate-y-1/2 rounded-xl border-2 border-brand-400">
            <div className="absolute inset-x-0 top-1/2 h-0.5 bg-brand-400" />
          </div>
          <p className="absolute inset-x-0 bottom-2 text-center text-sm text-white/80">Drejtoje kamerën te barkodi</p>
        </>
      )}
    </div>
  )
}
