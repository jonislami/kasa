import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Delete, ShieldCheck } from 'lucide-react'
import { Button, Dialog, Input, Select, Tabs } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatEUR, round2 } from '@/lib/money'
import { unitLabel } from '@/lib/units'
import { fetchApprovers } from './api'
import type { CartLine } from './cart'

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
      <div className="mt-4 rounded-xl bg-[#F6F8F6] px-4 py-3 text-sm">
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
  const kg = line.product.unit === 'kg'
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
        <Input ref={ref} label={kg ? 'Pesha (kg)' : 'Sasia'} inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} />
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
export function CashDialog({
  open,
  total,
  busy,
  onPay,
  onClose,
}: {
  open: boolean
  total: number
  busy: boolean
  onPay: (tendered: number) => void
  onClose: () => void
}) {
  const [v, setV] = useState('')
  useEffect(() => {
    if (open) setV('')
  }, [open])
  const n = parseNum(v)
  const tendered = n == null || Number.isNaN(n) ? total : n
  const change = round2(tendered - total)
  const notes = [5, 10, 20, 50, 100].filter((x) => x >= total).slice(0, 4)
  return (
    <Dialog open={open} onClose={onClose} title={`Paguaj kesh ${formatEUR(total)}`} width="md:max-w-[420px]">
      <div className="flex flex-col gap-4">
        <Input label="Paguar" inputMode="decimal" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={formatEUR(total)} />
        <div className="grid grid-cols-4 gap-2">
          {notes.map((x) => (
            <button key={x} type="button" onClick={() => setV(String(x))} className="h-11 rounded-ctl border border-field font-semibold hover:bg-bg">
              €{x}
            </button>
          ))}
        </div>
        <div className={cn('flex items-center justify-between rounded-ctl px-4 py-3', change < 0 ? 'bg-warn-100 text-warn-700' : 'bg-[#FFF4EC]')}>
          <span>{change < 0 ? 'Mungojnë' : 'Kusuri'}</span>
          <span className="text-[22px] font-bold tabular-nums text-warn-700">{formatEUR(Math.abs(change))}</span>
        </div>
        <Button size="lg" disabled={change < 0} loading={busy} onClick={() => onPay(tendered)}>
          Paguaj {formatEUR(total)}
        </Button>
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
    <div className={cn('relative overflow-hidden rounded-[20px] bg-[#1B2A22]', className)}>
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
