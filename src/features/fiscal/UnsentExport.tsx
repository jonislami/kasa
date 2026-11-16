import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { Button, Dialog, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { unsentOnDevice } from '@/lib/fiscal'

// ATK, Kërkesat specifike – ndryshim-plotësimi 2026, neni 26 pika 4: "Të dhënat e pa transmetuara në Sistemin
// Informativ të ATK-së duhet të mundësohet të eksportohen në formate të përshtatshme si: CSV, PDF vetëm me kërkesë
// të ATK-së apo ndonjë autoriteti tjetër shtetëror." Each export is written to the audit log with the request.

interface Row {
  where: 'Pajisja' | 'Serveri'
  coupon_id: string
  verification_no: string
  type: string
  issued_at: string
  total: number | null
  offline: boolean
  status: string
  error: string | null
  attempts: number
  reference_no: string | null
  details: string
  signature: string
}

const TYPE: Record<number, string> = { 1: 'Shitje', 2: 'Anulim', 3: 'Kthim' }
const STATUS: Record<string, string> = { pending: 'Në pritje', failed: 'Refuzuar nga ATK', sent: 'Dërguar' }

/** CitizenCoupon.Total (field 8, cents) read from the QR (base64 protobuf before "|"). */
function qrTotal(qr: string): number | null {
  try {
    const b = Uint8Array.from(atob(qr.split('|')[0]), (c) => c.charCodeAt(0))
    let i = 0
    const varint = () => {
      let v = 0n
      let shift = 0n
      for (;;) {
        const x = b[i++]
        v |= BigInt(x & 0x7f) << shift
        if (!(x & 0x80)) return v
        shift += 7n
      }
    }
    while (i < b.length) {
      const key = Number(varint())
      const field = key >> 3
      const wire = key & 7
      if (wire === 0) {
        const v = varint()
        if (field === 8) return Number(BigInt.asIntN(64, v)) / 100
      } else if (wire === 2) i += Number(varint())
      else if (wire === 1) i += 8
      else if (wire === 5) i += 4
      else return null
    }
  } catch {
    /* not readable */
  }
  return null
}

const dt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Belgrade', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

async function collect(includeDevice: boolean): Promise<Row[]> {
  const rows: Row[] = []
  if (includeDevice) {
    for (const q of await unsentOnDevice())
      rows.push({ where: 'Pajisja', coupon_id: q.coupon_id, verification_no: q.verification_no, type: TYPE[q.coupon_type] ?? String(q.coupon_type), issued_at: q.issued_at, total: qrTotal(q.qr), offline: q.offline, status: q.status, error: q.error, attempts: q.attempts, reference_no: q.reference_no, details: q.details, signature: q.signature })
  }
  const { data, error } = await supabase
    .from('fiscal_coupons')
    .select('coupon_id, verification_no, coupon_type, issued_at, offline, status, error, attempts, reference_no, details, signature, qr')
    .neq('status', 'sent')
    .order('issued_at')
    .limit(5000)
  if (error) throw new Error(error.message)
  const seen = new Set(rows.map((r) => r.coupon_id))
  for (const q of (data ?? []) as Record<string, unknown>[]) {
    if (seen.has(String(q.coupon_id))) continue
    rows.push({ where: 'Serveri', coupon_id: String(q.coupon_id), verification_no: String(q.verification_no), type: TYPE[Number(q.coupon_type)] ?? String(q.coupon_type), issued_at: String(q.issued_at), total: qrTotal(String(q.qr)), offline: Boolean(q.offline), status: String(q.status), error: (q.error as string) ?? null, attempts: Number(q.attempts) || 0, reference_no: q.reference_no == null ? null : String(q.reference_no), details: String(q.details), signature: String(q.signature) })
  }
  return rows.sort((a, b) => a.issued_at.localeCompare(b.issued_at))
}

function csv(rows: Row[], head: string[]): Blob {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    ...head.map((h) => esc(h)),
    ['Ku ruhet', 'Nr. i kuponit', 'NUIKF', 'Lloji', 'Data dhe ora', 'Totali (EUR)', 'Offline', 'Statusi', 'Gabimi', 'Tentime', 'Kuponi origjinal', 'Të dhënat e nënshkruara (base64)', 'Nënshkrimi'].map(esc).join(';'),
    ...rows.map((r) => [r.where, r.coupon_id, r.verification_no, r.type, dt(r.issued_at), r.total == null ? '' : r.total.toFixed(2).replace('.', ','), r.offline ? 'Po' : 'Jo', STATUS[r.status] ?? r.status, r.error ?? '', r.attempts, r.reference_no ?? '', r.details, r.signature].map(esc).join(';')),
  ]
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

/**
 * "Eksporto kuponët e padërguar" – only on a request of ATK / a state authority: the request is noted and logged.
 * In the till it also includes the coupons waiting on this device.
 */
export function UnsentExport({ includeDevice, businessName }: { includeDevice: boolean; businessName: string }) {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState('')
  const [agree, setAgree] = useState(false)
  const [print, setPrint] = useState<Row[] | null>(null)
  const [count, setCount] = useState<number | null>(null)

  const go = useMutation({
    mutationFn: async (kind: 'csv' | 'pdf') => {
      const rows = await collect(includeDevice)
      setCount(rows.length)
      void supabase.rpc('log_action', { p_action: 'fiscal_export', p_entity: 'fiscal_coupons', p_entity_id: null, p_details: { request: request.trim(), format: kind, coupons: rows.length } })
      const head = [`Kuponët fiskalë të padërguar në ATK – ${businessName}`, `Kërkesa: ${request.trim()}`, `Eksportuar më: ${dt(new Date().toISOString())}`]
      if (kind === 'csv') {
        const url = URL.createObjectURL(csv(rows, head))
        const a = document.createElement('a')
        a.href = url
        a.download = `kuponet-e-paderguar-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      } else {
        setPrint(rows)
        setTimeout(() => {
          window.print()
          setPrint(null)
        }, 150)
      }
    },
  })

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileDown className="h-4 w-4" /> Kuponët e padërguar (për ATK)
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Eksporto kuponët e padërguar"
        width="md:max-w-[560px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={!agree || !request.trim()} loading={go.isPending && go.variables === 'pdf'} onClick={() => go.mutate('pdf')}>
              PDF
            </Button>
            <Button disabled={!agree || !request.trim()} loading={go.isPending && go.variables === 'csv'} onClick={() => go.mutate('csv')}>
              CSV
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Sipas kërkesave të ATK-së, kuponët që nuk janë dërguar ende në sistemin e ATK-së eksportohen vetëm me kërkesë të ATK-së ose të një autoriteti tjetër shtetëror. Eksporti ruhet në regjistrin e veprimeve.
            {includeDevice ? ' Përfshihen edhe kuponët që presin në këtë pajisje.' : ''}
          </p>
          <Input label="Kërkesa (nr. / data / zyrtari)" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="p.sh. ATK 01-123/2026, 16.11.2026" />
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            Konfirmoj që eksporti bëhet me kërkesë të ATK-së ose të një autoriteti shtetëror.
          </label>
          {count != null && <p className="text-sm">U eksportuan {count} kuponë.</p>}
          {go.error && <p className="text-sm text-warn-700">{(go.error as Error).message}</p>}
        </div>
      </Dialog>
      {print &&
        createPortal(
          <div className="print-root print-a4 hidden bg-white text-[10px] text-black">
            <div className="mb-2 text-[13px] font-bold">Kuponët fiskalë të padërguar në ATK – {businessName}</div>
            <div className="mb-3">
              Kërkesa: {request.trim()} · Eksportuar më: {dt(new Date().toISOString())} · {print.length} kuponë
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Ku', 'Nr. i kuponit', 'NUIKF', 'Lloji', 'Data dhe ora', 'Totali', 'Offline', 'Statusi', 'Gabimi'].map((h) => (
                    <th key={h} className="border border-black px-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {print.map((r) => (
                  <tr key={r.coupon_id}>
                    <td className="border border-black px-1">{r.where}</td>
                    <td className="border border-black px-1">{r.coupon_id}</td>
                    <td className="border border-black px-1">{r.verification_no}</td>
                    <td className="border border-black px-1">{r.type}</td>
                    <td className="border border-black px-1">{dt(r.issued_at)}</td>
                    <td className="border border-black px-1 text-right">{r.total == null ? '' : r.total.toFixed(2)}</td>
                    <td className="border border-black px-1">{r.offline ? 'Po' : 'Jo'}</td>
                    <td className="border border-black px-1">{STATUS[r.status] ?? r.status}</td>
                    <td className="border border-black px-1">{r.error ?? ''}</td>
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
