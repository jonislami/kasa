import type { ReactNode } from 'react'
import type { Business } from '@/app/AuthProvider'
import { Receipt } from '@/features/pos/Receipt'
import type { Sale } from '@/features/pos/api'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'

/**
 * Screens of KontoSef with demo data for the public site, drawn with the program's layout, colours and texts
 * (the till of the SEF program, the owner's report on the phone, tables and kitchen, lots and expiry, services).
 * All names, numbers and amounts are examples ("Market Shembull", NUI 810000001).
 */

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------
export interface DemoLine {
  name: string
  qty: number
  unit: string
  price: number
  vat: 'E' | 'D'
}

export const DEMO_CART: DemoLine[] = [
  { name: 'Qumësht i freskët 1L', qty: 2, unit: 'copë', price: 0.95, vat: 'D' },
  { name: 'Bukë e bardhë 500g', qty: 1, unit: 'copë', price: 0.5, vat: 'D' },
  { name: 'Djathë i bardhë', qty: 0.45, unit: 'kg', price: 6.5, vat: 'D' },
  { name: 'Kafe e bluar 250g', qty: 1, unit: 'copë', price: 3.2, vat: 'E' },
  { name: 'Ujë mineral 1.5L', qty: 6, unit: 'copë', price: 0.45, vat: 'D' },
]

const r2 = (v: number) => Math.round(v * 100) / 100
export const lineTotal = (l: DemoLine) => r2(l.qty * l.price)
export const cartTotal = (ls: DemoLine[]) => r2(ls.reduce((s, l) => s + lineTotal(l), 0))
const vatOf = (ls: DemoLine[], code: 'E' | 'D') => {
  const g = ls.filter((l) => l.vat === code).reduce((s, l) => s + lineTotal(l), 0)
  const rate = code === 'E' ? 0.18 : 0.08
  return { gross: r2(g), net: r2(g / (1 + rate)), vat: r2(g - g / (1 + rate)) }
}

const PRODUCTS = [
  { cat: 'Ushqime', name: 'Bukë e bardhë 500g', price: 0.5, stock: '60 copë' },
  { cat: 'Pije', name: 'Coca-Cola 0.33L', price: 1.0, stock: '96 copë' },
  { cat: 'Ushqime', name: 'Djathë i bardhë', price: 6.5, stock: '12.5 kg' },
  { cat: 'Pije', name: 'Kafe e bluar 250g', price: 3.2, stock: '8 copë', low: true },
  { cat: 'Ushqime', name: 'Qumësht i freskët 1L', price: 0.95, stock: '40 copë' },
  { cat: 'Higjienë', name: 'Letër higjienike 10 copë', price: 4.5, stock: '2 pako', low: true },
  { cat: 'Pije', name: 'Ujë mineral 1.5L', price: 0.45, stock: '144 copë' },
  { cat: 'Higjienë', name: 'Sapun duarsh 500ml', price: 1.9, stock: '18 copë' },
]

export const DEMO_BUSINESS = {
  id: 'demo',
  name: 'Market Shembull',
  type: 'market',
  active: true,
  city: 'Prishtinë',
  address: 'Rr. Shembull 1',
  nui: '810000001',
  vat_number: '330000001',
  phone: '+383 44 000 000',
  fiscal_number: '600000001',
} as unknown as Business

/** The demo sale as the program stores it, for the real receipt component. */
export function demoSale(): Sale {
  const e = vatOf(DEMO_CART, 'E')
  const d = vatOf(DEMO_CART, 'D')
  const total = cartTotal(DEMO_CART)
  return {
    id: 'demo', kind: 'sale', ref_sale_id: null, ref_invoice_no: null, invoice_no: 487, daily_no: 23, sale_date: '2026-11-28',
    created_at: '2026-11-28T09:41:00Z', client_created_at: '2026-11-28T09:41:00Z', items_count: DEMO_CART.length, subtotal: total, invoice_discount: 0,
    discount_total: 0, total, net_total: r2(e.net + d.net), vat_total: r2(e.vat + d.vat),
    vat_lines: [{ code: 'E', rate: 0.18, ...e }, { code: 'D', rate: 0.08, ...d }],
    payment_method: 'cash', cash_amount: total, card_amount: 0, tendered: 20, change_amount: r2(20 - total), reason: null, note: null,
    offline: false, offline_no: null, fiscal_status: 'sent', worker_id: 'w', worker_name: 'Arta Krasniqi', register_name: 'Arka 1',
    items: DEMO_CART.map((l, i) => ({ id: String(i), name: l.name, unit: l.unit === 'kg' ? 'kg' : 'cope', quantity: l.qty, unit_price: l.price, total: lineTotal(l), vat_code: l.vat, line_discount: 0, invoice_discount: 0 })),
    voided: false, has_refunds: false,
    fiscal: { coupon_id: 'SHEMBULL', verification_no: 'SHEMBULL-PA-VLERE', sef_no: '1-810000001-1', issued_at: '2026-11-28T09:41:00Z', status: 'sent', offline: false, env: 'test', qr: 'KontoSef.app – kupon shembull, pa vlerë fiskale' },
  } as unknown as Sale
}

/** The real receipt of the program, with the demo sale, at a paper width (58 / 80 mm). */
export function DemoReceipt({ width = 80 }: { width?: 58 | 80 }) {
  return <Receipt sale={demoSale()} business={DEMO_BUSINESS} width={width} />
}

// ---------------------------------------------------------------------------
// The till (SEF program) – 1280 × 800
// ---------------------------------------------------------------------------
function Rail({ active = 'Arka' }: { active?: string }) {
  return (
    <div className="flex w-[64px] flex-col items-center gap-3 bg-[#0F1B2D] py-4 text-[10px] text-white/70">
      <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-white/10 text-[12px] font-bold text-white">MS</div>
      {['Arka', 'Kuponët', 'Puna ime', 'Printeri'].map((x) => (
        <div key={x} className={cn('flex w-[52px] flex-col items-center gap-1 rounded-[8px] py-2', x === active ? 'bg-white text-[#0F1B2D]' : '')}>
          <span className={cn('h-4 w-4 rounded-[4px] border-2', x === active ? 'border-[#1F4FA8]' : 'border-white/50')} />
          {x}
        </div>
      ))}
      <div className="mt-auto text-center text-[9px] leading-tight text-white/50">
        KULETA
        <div className="text-[11px] font-semibold text-white">€184.30</div>
      </div>
    </div>
  )
}

function CartLines({ lines, big }: { lines: DemoLine[]; big?: boolean }) {
  return (
    <div className="flex flex-col">
      {lines.map((l) => (
        <div key={l.name} className={cn('flex items-center gap-2 border-b border-[#EEF0F3]', big ? 'py-3' : 'py-2')}>
          <div className="min-w-0 flex-1">
            <div className={cn('truncate font-semibold text-[#0F172A]', big ? 'text-[16px]' : 'text-[13px]')}>{l.name}</div>
            <div className={cn('text-[#5F6B7A]', big ? 'text-[13px]' : 'text-[11px]')}>
              {formatEUR(l.price)} / {l.unit}
            </div>
          </div>
          <div className={cn('flex items-center rounded-[8px] border border-[#D0D5DD]', big ? 'h-9' : 'h-7')}>
            <span className={cn('px-2 text-[#5F6B7A]', big ? 'text-[16px]' : 'text-[13px]')}>−</span>
            <span className={cn('min-w-[34px] text-center font-semibold tabular-nums', big ? 'text-[15px]' : 'text-[12px]')}>{String(l.qty).replace('.', ',')}</span>
            <span className={cn('px-2 text-[#5F6B7A]', big ? 'text-[16px]' : 'text-[13px]')}>+</span>
          </div>
          <div className={cn('w-[62px] text-right font-semibold tabular-nums', big ? 'text-[15px]' : 'text-[13px]')}>{formatEUR(lineTotal(l))}</div>
        </div>
      ))}
    </div>
  )
}

function Totals({ lines }: { lines: DemoLine[] }) {
  const e = vatOf(lines, 'E')
  const d = vatOf(lines, 'D')
  return (
    <div className="mt-2 flex flex-col gap-0.5 text-[12px] text-[#5F6B7A]">
      <div className="flex justify-between">
        <span>Pa TVSH</span>
        <span className="tabular-nums">{formatEUR(e.net + d.net)}</span>
      </div>
      <div className="flex justify-between">
        <span>TVSH 18%</span>
        <span className="tabular-nums">{formatEUR(e.vat)}</span>
      </div>
      <div className="flex justify-between">
        <span>TVSH 8%</span>
        <span className="tabular-nums">{formatEUR(d.vat)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[#0F172A]">
        <span className="text-[14px] font-semibold">Totali</span>
        <span className="text-[30px] font-semibold tracking-[-0.02em] tabular-nums">{formatEUR(cartTotal(lines))}</span>
      </div>
    </div>
  )
}

/** The till with the products and the open bill. `step`: 'scan' highlights the scanned item, 'pay' shows the payment. */
export function PosScreen({ step = 'scan', lines = DEMO_CART }: { step?: 'scan' | 'pay'; lines?: DemoLine[] }) {
  return (
    <div className="flex h-[800px] w-[1280px] bg-[#F7F8FA] font-sans text-[#0F172A]">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] items-center justify-between border-b border-[#E6E8EC] bg-white px-5">
          <span className="text-[14px] font-semibold">Mirë se erdhe, Arta Krasniqi</span>
          <span className="flex items-center gap-2 text-[12px] text-[#0B6B4B]">
            <span className="h-2 w-2 rounded-full bg-[#12B76A]" /> ATK · Arka 1 · 09:41
          </span>
        </div>
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          {/* products */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex gap-2">
              <div className="flex h-11 flex-1 items-center gap-2 rounded-[10px] border-2 border-[#1F4FA8] bg-white px-3 text-[14px] text-[#0F172A]">
                <span className="text-[#5F6B7A]">⌕</span> 3830012345678
                <span className="ml-auto rounded-[4px] border border-[#D0D5DD] px-1.5 text-[11px] text-[#5F6B7A]">F2</span>
              </div>
              <div className="flex h-11 items-center rounded-[10px] border border-[#D0D5DD] bg-white px-4 text-[13px] font-semibold">Kamera</div>
            </div>
            <div className="flex gap-2 text-[13px]">
              {['Të gjitha', 'Pije', 'Ushqime', 'Higjienë'].map((c, i) => (
                <span key={c} className={cn('rounded-full px-3.5 py-1.5 font-semibold', i === 0 ? 'bg-[#0F1B2D] text-white' : 'bg-white text-[#344054] ring-1 ring-[#E6E8EC]')}>
                  {c}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {PRODUCTS.map((p) => (
                <div key={p.name} className={cn('rounded-[12px] border bg-white px-3.5 py-3', p.name === 'Ujë mineral 1.5L' && step === 'scan' ? 'border-2 border-[#1F4FA8] bg-[#F5F8FD]' : 'border-[#E6E8EC]')}>
                  <div className="text-[11px] text-[#5F6B7A]">{p.cat}</div>
                  <div className="truncate text-[14px] font-semibold">{p.name}</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-[16px] font-semibold tabular-nums">{formatEUR(p.price)}</span>
                    <span className={cn('text-[11px]', p.low ? 'font-semibold text-[#8A5A00]' : 'text-[#5F6B7A]')}>{p.stock}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* bill */}
          <div className="flex w-[400px] flex-col rounded-[12px] border border-[#E6E8EC] bg-white p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[16px] font-semibold">Kupon i ri</span>
              <span className="text-[12px] text-[#5F6B7A]">{lines.length} artikuj · Arka 1</span>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-hidden">
              <CartLines lines={lines} />
            </div>
            {step === 'pay' ? <PaymentBox lines={lines} /> : <Totals lines={lines} />}
            <div className="mt-3 flex h-12 items-center justify-center rounded-[10px] bg-[#1F4FA8] text-[16px] font-semibold text-white">
              {step === 'pay' ? 'Konfirmo dhe printo' : `Paguaj ${formatEUR(cartTotal(lines))}`} <span className="ml-2 rounded-[4px] bg-white/20 px-1.5 text-[11px]">{step === 'pay' ? 'Enter' : 'F2'}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] font-semibold text-[#344054]">
              {['Zbritje', 'Ruaj në pritje', 'Kthim'].map((x) => (
                <div key={x} className="flex h-9 items-center justify-center rounded-[8px] border border-[#D0D5DD]">
                  {x}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The payment part of the bill: method, received, change. */
export function PaymentBox({ lines = DEMO_CART, big }: { lines?: DemoLine[]; big?: boolean }) {
  const total = cartTotal(lines)
  return (
    <div className={cn('mt-2 flex flex-col', big ? 'gap-3' : 'gap-2')}>
      <div className="flex items-baseline justify-between">
        <span className={cn('font-semibold', big ? 'text-[16px]' : 'text-[13px]')}>Për pagesë</span>
        <span className={cn('font-semibold tabular-nums tracking-[-0.02em]', big ? 'text-[34px]' : 'text-[26px]')}>{formatEUR(total)}</span>
      </div>
      <div className={cn('grid grid-cols-3 overflow-hidden rounded-[10px] border border-[#D0D5DD] font-semibold', big ? 'text-[15px]' : 'text-[12px]')}>
        {['Kesh', 'Kartelë', 'Të kombinuara'].map((m, i) => (
          <span key={m} className={cn('py-2 text-center', i === 0 ? 'bg-[#1F4FA8] text-white' : 'bg-white text-[#344054]', i > 0 && 'border-l border-[#D0D5DD]')}>
            {m}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[10px] border-2 border-[#1F4FA8] px-3 py-1.5">
          <div className={cn('text-[#5F6B7A]', big ? 'text-[13px]' : 'text-[11px]')}>Paguar</div>
          <div className={cn('font-semibold tabular-nums', big ? 'text-[22px]' : 'text-[17px]')}>€20.00</div>
        </div>
        <div className="rounded-[10px] bg-[#E6F4EE] px-3 py-1.5">
          <div className={cn('text-[#0B6B4B]', big ? 'text-[13px]' : 'text-[11px]')}>Kusuri</div>
          <div className={cn('font-semibold tabular-nums text-[#0B6B4B]', big ? 'text-[22px]' : 'text-[17px]')}>{formatEUR(20 - total)}</div>
        </div>
      </div>
      <div className={cn('flex gap-1.5', big ? 'text-[14px]' : 'text-[11px]')}>
        {['€10', '€20', '€50'].map((x) => (
          <span key={x} className={cn('flex-1 rounded-[8px] border py-1 text-center font-semibold', x === '€20' ? 'border-[#1F4FA8] bg-[#EBF1FB] text-[#1A4390]' : 'border-[#D0D5DD] text-[#344054]')}>
            {x}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The scanned item arriving in the bill, large (for the close-up). */
export function ScanCloseup() {
  return (
    <div className="font-sans text-[#0F172A]">
      <div className="flex h-12 items-center gap-2 rounded-[10px] border-2 border-[#1F4FA8] bg-white px-3 text-[16px]">
        <span className="text-[#5F6B7A]">⌕</span> 3830012345678
      </div>
      <div className="mt-3 rounded-[10px] bg-[#F5F8FD] px-3 ring-1 ring-[#D3DEF2]">
        <CartLines lines={[DEMO_CART[4]]} big />
      </div>
      <p className="mt-2 text-[13px] text-[#5F6B7A]">Skaneri lexon barkodin; artikulli hyn në kupon me çmimin dhe TVSH-në e vet.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The owner's daily report on the phone – 390 × 844
// ---------------------------------------------------------------------------
export function PhoneReport() {
  const regs = [
    { name: 'Arka 1', worker: 'Arta Krasniqi', coupons: 142, cash: 1084.6, card: 412.3 },
    { name: 'Arka 2', worker: 'Arben Gashi', coupons: 96, cash: 688.2, card: 301.9 },
  ]
  const total = regs.reduce((s, r) => s + r.cash + r.card, 0)
  return (
    <div className="h-[844px] w-[390px] bg-[#F7F8FA] font-sans text-[#0F172A]">
      <div className="bg-[#0F1B2D] px-5 pb-5 pt-12 text-white">
        <div className="text-[13px] text-white/60">Market Shembull · Sot</div>
        <div className="mt-1 text-[28px] font-semibold tracking-[-0.02em] tabular-nums">{formatEUR(total)}</div>
        <div className="text-[13px] text-white/70">238 kuponë · 3 kthime</div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {regs.map((r) => (
          <div key={r.name} className="rounded-[12px] border border-[#E6E8EC] bg-white p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold">{r.name}</span>
              <span className="text-[16px] font-semibold tabular-nums">{formatEUR(r.cash + r.card)}</span>
            </div>
            <div className="text-[12px] text-[#5F6B7A]">
              {r.worker} · {r.coupons} kuponë
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-[8px] bg-[#F7F8FA] px-2.5 py-1.5">
                Kesh <b className="float-right tabular-nums">{formatEUR(r.cash)}</b>
              </div>
              <div className="rounded-[8px] bg-[#F7F8FA] px-2.5 py-1.5">
                Kartelë <b className="float-right tabular-nums">{formatEUR(r.card)}</b>
              </div>
            </div>
          </div>
        ))}
        <div className="rounded-[12px] border border-[#E6E8EC] bg-white p-4 text-[13px]">
          <div className="mb-2 font-semibold">TVSH sipas normës</div>
          {[
            ['E · 18%', 216.4],
            ['D · 8%', 118.7],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between border-t border-[#EEF0F3] py-1.5">
              <span className="text-[#5F6B7A]">{k}</span>
              <span className="font-semibold tabular-nums">{formatEUR(v as number)}</span>
            </div>
          ))}
        </div>
        <div className="rounded-[12px] border border-[#FDE68A] bg-[#FDF3DC] p-3 text-[13px] text-[#8A5A00]">
          <b>Stoku i ulët:</b> Kafe e bluar 250g (8 copë), Letër higjienike (2 pako)
        </div>
      </div>
    </div>
  )
}

/** One register's line of the report, large. */
export function ReportCloseup() {
  return (
    <div className="font-sans text-[#0F172A]">
      <div className="flex items-baseline justify-between">
        <span className="text-[17px] font-semibold">Arka 1</span>
        <span className="text-[22px] font-semibold tabular-nums">€1,496.90</span>
      </div>
      <div className="text-[14px] text-[#5F6B7A]">Arta Krasniqi · 142 kuponë</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[14px]">
        <div className="rounded-[8px] bg-[#F7F8FA] px-3 py-2">
          Kesh <b className="float-right tabular-nums">€1,084.60</b>
        </div>
        <div className="rounded-[8px] bg-[#F7F8FA] px-3 py-2">
          Kartelë <b className="float-right tabular-nums">€412.30</b>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gastronomy: tables (waiter's phone) and the kitchen screen
// ---------------------------------------------------------------------------
export function PhoneOrder() {
  const items = [
    { name: 'Makiato e madhe', qty: 2, price: 1.2, to: 'Bar' },
    { name: 'Picë Margarita', qty: 1, price: 5.5, to: 'Kuzhina' },
    { name: 'Sallatë shope', qty: 1, price: 3.0, to: 'Kuzhina' },
    { name: 'Ujë 0.5L', qty: 2, price: 0.8, to: 'Bar' },
  ]
  return (
    <div className="h-[844px] w-[390px] bg-[#F7F8FA] font-sans text-[#0F172A]">
      <div className="bg-[#0F1B2D] px-5 pb-4 pt-12 text-white">
        <div className="text-[13px] text-white/60">Kafe Shembull · Kamarieri: Drita</div>
        <div className="mt-1 text-[24px] font-semibold">Tavolina 7</div>
      </div>
      <div className="p-4">
        <div className="rounded-[12px] border border-[#E6E8EC] bg-white p-3">
          {items.map((i) => (
            <div key={i.name} className="flex items-center gap-2 border-b border-[#EEF0F3] py-2.5 last:border-0">
              <span className="w-6 text-[15px] font-semibold tabular-nums">{i.qty}×</span>
              <span className="flex-1 text-[15px] font-medium">{i.name}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', i.to === 'Bar' ? 'bg-[#EBF1FB] text-[#1A4390]' : 'bg-[#FDF3DC] text-[#8A5A00]')}>{i.to}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between text-[15px] font-semibold">
            <span>Totali</span>
            <span className="tabular-nums">{formatEUR(items.reduce((s, i) => s + i.qty * i.price, 0))}</span>
          </div>
        </div>
        <div className="mt-3 flex h-12 items-center justify-center rounded-[10px] bg-[#1F4FA8] text-[16px] font-semibold text-white">Dërgo porosinë</div>
        <div className="mt-2 text-center text-[12px] text-[#5F6B7A]">Pijet shkojnë në bar, ushqimi në kuzhinë</div>
      </div>
    </div>
  )
}

export function KitchenScreen() {
  const tickets = [
    { table: 'Tavolina 7', time: '2 min', items: ['1× Picë Margarita', '1× Sallatë shope'], state: 'E re' },
    { table: 'Tavolina 3', time: '9 min', items: ['2× Tavë kosi', '1× Pomfrit'], state: 'Në përgatitje' },
    { table: 'Për me vete', time: '14 min', items: ['3× Sanduiç me pulë'], state: 'Gati' },
  ]
  return (
    <div className="h-[600px] w-[1000px] bg-[#0F1B2D] p-5 font-sans text-white">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-[20px] font-semibold">Kuzhina</span>
        <span className="text-[13px] text-white/60">3 porosi të hapura</span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {tickets.map((t) => (
          <div key={t.table} className={cn('rounded-[12px] bg-white p-4 text-[#0F172A]', t.state === 'E re' && 'ring-4 ring-[#8AAEEB]')}>
            <div className="flex items-baseline justify-between">
              <span className="text-[17px] font-semibold">{t.table}</span>
              <span className="text-[13px] text-[#5F6B7A]">{t.time}</span>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 text-[16px]">
              {t.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            <div className={cn('mt-4 rounded-[8px] py-2 text-center text-[14px] font-semibold', t.state === 'Gati' ? 'bg-[#E6F4EE] text-[#0B6B4B]' : t.state === 'E re' ? 'bg-[#1F4FA8] text-white' : 'bg-[#FDF3DC] text-[#8A5A00]')}>
              {t.state === 'E re' ? 'Fillo përgatitjen' : t.state === 'Gati' ? 'Gati për servim' : 'Shëno gati'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pharmacy: lots and expiry (FEFO)
// ---------------------------------------------------------------------------
export function PharmacyScreen() {
  const lots = [
    { lot: 'L2409A', expiry: '15.01.2027', qty: 12, state: 'warn' },
    { lot: 'L2503C', expiry: '30.06.2027', qty: 40, state: 'ok' },
    { lot: 'L2511B', expiry: '28.02.2028', qty: 60, state: 'ok' },
  ]
  return (
    <div className="h-[640px] w-[1000px] bg-[#F7F8FA] p-6 font-sans text-[#0F172A]">
      <div className="text-[13px] text-[#5F6B7A]">Barnat › Paracetamol 500 mg, 20 tableta</div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-[22px] font-semibold">Paracetamol 500 mg</span>
        <span className="text-[14px] text-[#5F6B7A]">Gjithsej 112 kuti · 3 seri</span>
      </div>
      <div className="mt-4 overflow-hidden rounded-[12px] border border-[#E6E8EC] bg-white">
        <div className="grid grid-cols-[1fr_1fr_120px_1fr] bg-[#F5F6F8] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#5F6B7A]">
          <span>Seria (lot)</span>
          <span>Afati</span>
          <span className="text-right">Sasia</span>
          <span className="pl-6">Statusi</span>
        </div>
        {lots.map((l, i) => (
          <div key={l.lot} className={cn('grid grid-cols-[1fr_1fr_120px_1fr] items-center border-t border-[#EEF0F3] px-4 py-3.5 text-[15px]', i === 0 && 'bg-[#FFFBEB]')}>
            <span className="font-semibold">{l.lot}</span>
            <span className={cn('tabular-nums', l.state === 'warn' && 'font-semibold text-[#8A5A00]')}>{l.expiry}</span>
            <span className="text-right tabular-nums">{l.qty}</span>
            <span className="pl-6">
              {l.state === 'warn' ? (
                <span className="rounded-full bg-[#FDF3DC] px-2.5 py-1 text-[12px] font-semibold text-[#8A5A00]">Skadon brenda 90 ditëve · shitet e para</span>
              ) : (
                <span className="rounded-full bg-[#E6F4EE] px-2.5 py-1 text-[12px] font-semibold text-[#0B6B4B]">Në rregull</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[12px] border border-[#D3DEF2] bg-[#F5F8FD] p-4 text-[14px] text-[#1A4390]">
        Në arkë, kur shitet Paracetamol 500 mg, programi zbret nga seria me afatin më të afërt (<b>L2409A</b>). Seritë e skaduara dalin veçmas te stoku, që të hiqen nga shitja.
      </div>
    </div>
  )
}

export function ExpiryCloseup() {
  return (
    <div className="font-sans text-[#0F172A]">
      <div className="flex items-center justify-between rounded-[10px] bg-[#FFFBEB] px-3 py-3 ring-1 ring-[#FDE68A]">
        <div>
          <div className="text-[16px] font-semibold">Seria L2409A</div>
          <div className="text-[14px] font-semibold text-[#8A5A00]">Afati 15.01.2027</div>
        </div>
        <span className="rounded-full bg-[#FDF3DC] px-3 py-1 text-[13px] font-semibold text-[#8A5A00]">48 ditë</span>
      </div>
      <p className="mt-2 text-[13px] text-[#5F6B7A]">Shitet e para. Paneli i pronarit tregon seritë që skadojnë brenda 30 dhe 90 ditëve.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Services: the work done, billed with the worker
// ---------------------------------------------------------------------------
export function ServiceScreen() {
  const work = [
    { name: 'Prerje flokësh – meshkuj', worker: 'Blerim', price: 6.0 },
    { name: 'Rruajtje me brisk', worker: 'Blerim', price: 4.0 },
    { name: 'Larje dhe tharje', worker: 'Lirie', price: 3.0 },
  ]
  const total = work.reduce((s, w) => s + w.price, 0)
  return (
    <div className="h-[640px] w-[1000px] bg-[#F7F8FA] p-6 font-sans text-[#0F172A]">
      <div className="grid grid-cols-[1fr_380px] gap-5">
        <div>
          <div className="text-[20px] font-semibold">Terminet sot</div>
          <div className="mt-3 flex flex-col gap-2">
            {[
              ['09:00', 'Arben K.', 'Prerje + rruajtje', 'Blerim', 'Kryer'],
              ['09:45', 'Valon S.', 'Prerje flokësh', 'Blerim', 'Në punë'],
              ['10:30', 'Dafina M.', 'Larje dhe tharje', 'Lirie', 'Në pritje'],
            ].map(([t, c, s, w, st]) => (
              <div key={t} className="flex items-center gap-4 rounded-[12px] border border-[#E6E8EC] bg-white px-4 py-3 text-[14px]">
                <span className="w-12 font-semibold tabular-nums">{t}</span>
                <span className="flex-1">
                  <b>{c}</b> · {s}
                </span>
                <span className="text-[#5F6B7A]">{w}</span>
                <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-semibold', st === 'Kryer' ? 'bg-[#E6F4EE] text-[#0B6B4B]' : st === 'Në punë' ? 'bg-[#EBF1FB] text-[#1A4390]' : 'bg-[#F0F2F5] text-[#475467]')}>{st}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[12px] border border-[#E6E8EC] bg-white p-4">
          <div className="text-[16px] font-semibold">Fatura · Arben K.</div>
          <div className="mt-2 flex flex-col">
            {work.slice(0, 2).map((w) => (
              <div key={w.name} className="flex justify-between border-b border-[#EEF0F3] py-2.5 text-[14px]">
                <span>
                  {w.name}
                  <span className="block text-[12px] text-[#5F6B7A]">Punëtori: {w.worker}</span>
                </span>
                <span className="font-semibold tabular-nums">{formatEUR(w.price)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">Totali</span>
            <span className="text-[28px] font-semibold tabular-nums">{formatEUR(10)}</span>
          </div>
          <div className="mt-1 text-[12px] text-[#5F6B7A]">Komisioni i Blerimit (40%): €4.00</div>
          <div className="mt-3 flex h-11 items-center justify-center rounded-[10px] bg-[#1F4FA8] text-[15px] font-semibold text-white">Paguaj {formatEUR(10)}</div>
        </div>
      </div>
      <div className="mt-5 text-[13px] text-[#5F6B7A]">Shërbimet nuk kanë stok. Çdo shërbim ruan punëtorin që e kreu, për komisionin dhe për punën e tij te paneli i pronarit. Gjithsej sot: {formatEUR(total)}.</div>
    </div>
  )
}

export function ServiceCloseup() {
  return (
    <div className="font-sans text-[#0F172A]">
      <div className="flex justify-between border-b border-[#EEF0F3] py-2 text-[16px]">
        <span>
          Prerje flokësh – meshkuj
          <span className="block text-[13px] text-[#5F6B7A]">Punëtori: Blerim</span>
        </span>
        <b className="tabular-nums">€6.00</b>
      </div>
      <div className="mt-2 text-[14px] text-[#0B6B4B]">Komisioni i Blerimit llogaritet vetë nga fatura.</div>
    </div>
  )
}

export function ScreenNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-center text-[12px] text-muted">{children}</p>
}
