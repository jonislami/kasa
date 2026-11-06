import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bluetooth, Printer, Usb } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Card, Input, Select, Toggle } from '@/components/ui'
import { device } from '@/lib/device'
import { lastPrinterName, printerReady, testPageBytes } from '@/lib/printer'
import { isManagerRole } from '@/lib/business'
import type { Sale } from '@/features/pos/api'
import { Receipt } from '@/features/pos/Receipt'
import { DEFAULT_RECEIPT, fetchReceiptSettings, saveReceiptSettings, type ReceiptSettings } from './api'

/** Bluetooth connection on this device (everyone) + receipt settings for the business (managers). */
export function PrinterSection() {
  const { business, profile } = useBusiness()
  const manager = isManagerRole(profile.role)
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['receipt-settings'], queryFn: fetchReceiptSettings, networkMode: 'always' })
  const [form, setForm] = useState<ReceiptSettings>(DEFAULT_RECEIPT)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings.data) setForm(settings.data)
  }, [settings.data])

  const save = useMutation({
    mutationFn: () => saveReceiptSettings(business.id, form),
    onSuccess: () => {
      setSaved('Ndryshimet u ruajtën')
      setError(null)
      void qc.invalidateQueries({ queryKey: ['receipt-settings'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const set = <K extends keyof ReceiptSettings>(k: K, v: ReceiptSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setOpt = (k: keyof ReceiptSettings['settings'], v: boolean | number) => setForm((f) => ({ ...f, settings: { ...f.settings, [k]: v } }))

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <BluetoothCard settings={form} />

        {manager && (
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">Printimi</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Select
                label="Gjerësia e letrës"
                value={String(form.paper_width)}
                onChange={(e) => set('paper_width', Number(e.target.value) as 58 | 80)}
                options={[
                  { value: '80', label: '80 mm (48 shenja)' },
                  { value: '58', label: '58 mm (32 shenja)' },
                ]}
              />
              <Select
                label="Kopje për faturë"
                value={String(form.settings.copies ?? 1)}
                onChange={(e) => setOpt('copies', Number(e.target.value))}
                options={[
                  { value: '1', label: '1' },
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                ]}
              />
              <Select
                label="Shkronjat ë / ç"
                value={form.printer_charset}
                onChange={(e) => set('printer_charset', e.target.value as ReceiptSettings['printer_charset'])}
                options={[
                  { value: 'replace', label: 'Zëvendëso me e / c (punon kudo)' },
                  { value: 'cp852', label: 'CP852 (Latin-2)' },
                  { value: 'cp1250', label: 'CP1250 (Windows)' },
                ]}
              />
              <Select
                label="Madhësia e copave (Bluetooth)"
                value={String(form.printer_chunk)}
                onChange={(e) => set('printer_chunk', Number(e.target.value))}
                options={[20, 100, 180, 256, 512].map((n) => ({ value: String(n), label: `${n} bytes${n === 180 ? ' (e zakonshme)' : n === 20 ? ' (printerë të vjetër)' : ''}` }))}
              />
            </div>
            <div className="mt-2 divide-y divide-line">
              <ToggleRow label="Printo automatikisht pas pagesës" hint={'Fatura del sapo shtypet "Paguaj"'} value={Boolean(form.settings.auto_print)} onChange={(v) => setOpt('auto_print', v)} />
              <ToggleRow label="Hap sirtarin e parave (kasa)" hint="Vetëm kur paguhet me kesh" value={Boolean(form.settings.open_drawer)} onChange={(v) => setOpt('open_drawer', v)} />
              <ToggleRow label="Preje letrën në fund" value={form.settings.cut !== false} onChange={(v) => setOpt('cut', v)} />
            </div>
          </Card>
        )}

        {manager && (
          <Card className="p-5">
            <h2 className="text-[17px] font-semibold">Pamja e faturës</h2>
            <p className="mt-1 text-sm text-muted">Emri, adresa, NUI dhe telefoni merren nga "Të dhënat e biznesit".</p>
            <div className="mt-4 grid gap-3">
              <Input label="Rresht shtesë nën emër (opsional)" value={form.receipt_header ?? ''} onChange={(e) => set('receipt_header', e.target.value || null)} placeholder="p.sh. Dyqani qendror" />
              <Input label="Teksti në fund të faturës" value={form.receipt_footer ?? ''} onChange={(e) => set('receipt_footer', e.target.value || null)} />
            </div>
            <div className="mt-2 divide-y divide-line">
              <ToggleRow label="Shfaq logon" value={form.settings.show_logo !== false} onChange={(v) => setOpt('show_logo', v)} />
              <ToggleRow label="Shfaq ndarjen e TVSH-së" value={form.settings.show_vat !== false} onChange={(v) => setOpt('show_vat', v)} />
              <ToggleRow label="Shfaq barkodin e faturës" value={Boolean(form.settings.show_barcode)} onChange={(v) => setOpt('show_barcode', v)} />
            </div>
            {error && <p className="mt-3 text-sm text-warn-700">{error}</p>}
            {saved && <p className="mt-3 text-sm font-medium text-brand-600">{saved}</p>}
            <div className="mt-4 flex justify-end gap-2.5">
              <Button variant="secondary" onClick={() => settings.data && setForm(settings.data)}>
                Anulo
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Ruaj ndryshimet
              </Button>
            </div>
          </Card>
        )}
      </div>

      <div className="rounded-card bg-[#E9EDEA] p-5 xl:sticky xl:top-6 xl:w-[360px] xl:shrink-0">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Parapamja · {form.paper_width}mm</div>
        <div className="overflow-x-auto rounded-md bg-white py-2 shadow-sm">
          <Receipt sale={SAMPLE} business={business} settings={form} />
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-sm text-muted">{hint}</div>}
      </div>
      <Toggle checked={value} onChange={onChange} label={label} />
    </div>
  )
}

function BluetoothCard({ settings }: { settings: ReceiptSettings }) {
  const { business } = useBusiness()
  const support = device.printer.support()
  const [connected, setConnected] = useState(device.printer.isConnected())
  const [name, setName] = useState<string | null>(lastPrinterName())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!connected && name !== null) void printerReady().then(setConnected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      const m = (e as Error).message
      if (!/cancel/i.test(m)) setMsg({ ok: false, text: m || 'Printeri nuk u lidh' })
    } finally {
      setBusy(false)
      setConnected(device.printer.isConnected())
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E6EDFD] text-bt-600">
            <Bluetooth className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Printeri i faturave (Bluetooth)</h2>
            <p className="text-sm text-muted">Printer termik 58mm ose 80mm · lidhet për këtë pajisje</p>
          </div>
        </div>
        <Badge tone={connected ? 'success' : 'neutral'}>{connected ? `I lidhur${name ? ` · ${name}` : ''}` : 'I palidhur'}</Badge>
      </div>

      {!support.bluetooth ? (
        <div className="mt-4 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
          {support.reason} Fatura printohet nga shfletuesi (80mm).
        </div>
      ) : (
        <div className="mt-4 rounded-card border border-dashed border-field p-4">
          <p className="text-[15px] text-muted">Ndize printerin dhe Bluetooth-in e pajisjes, pastaj shtyp butonin për ta kërkuar.</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Button
              variant="bluetooth"
              loading={busy}
              onClick={() =>
                run(async () => {
                  setName(await device.printer.connect())
                  setMsg({ ok: true, text: 'Printeri u lidh' })
                })
              }
            >
              <Bluetooth className="h-4 w-4" /> {connected ? 'Lidh një printer tjetër' : 'Lidh printerin me Bluetooth'}
            </Button>
            {support.usbSerial && device.printer.connectSerial && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setName(await device.printer.connectSerial!())
                    setMsg({ ok: true, text: 'Printeri USB u lidh' })
                  })
                }
              >
                <Usb className="h-4 w-4" /> Printer me USB
              </Button>
            )}
            {connected && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await device.printer.write(testPageBytes(business.name, settings), settings.printer_chunk)
                      setMsg({ ok: true, text: 'Faqja provë u dërgua' })
                    })
                  }
                >
                  <Printer className="h-4 w-4" /> Printo provë
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => run(() => device.printer.disconnect())}>
                  Shkëput
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-brand-600' : 'text-warn-700'}`}>{msg.text}</p>}
    </Card>
  )
}

const now = new Date().toISOString()
const SAMPLE: Sale = {
  id: 'sample',
  kind: 'sale',
  ref_sale_id: null,
  ref_invoice_no: null,
  invoice_no: 487,
  daily_no: 12,
  sale_date: now.slice(0, 10),
  created_at: now,
  client_created_at: null,
  items_count: 4,
  subtotal: 10.7,
  invoice_discount: 0,
  discount_total: 0,
  total: 10.7,
  net_total: 9.7,
  vat_total: 1.0,
  vat_lines: [
    { code: 'E', rate: 0.18, gross: 2.7, net: 2.29, vat: 0.41 },
    { code: 'D', rate: 0.08, gross: 8.0, net: 7.41, vat: 0.59 },
  ],
  payment_method: 'cash',
  cash_amount: 10.7,
  card_amount: 0,
  tendered: 20,
  change_amount: 9.3,
  reason: null,
  note: null,
  offline: false,
  offline_no: null,
  fiscal_status: 'non_fiscal',
  worker_id: '',
  worker_name: 'Arkëtari 1',
  register_name: 'Arka 1',
  items: [
    { id: '1', position: 1, product_id: null, name: 'Qumësht i freskët 1L', unit: 'cope', quantity: 2, unit_price: 0.95, line_discount: 0, invoice_discount: 0, total: 1.9, vat_code: 'D', refunded: 0 },
    { id: '2', position: 2, product_id: null, name: 'Bukë e bardhë 500g', unit: 'cope', quantity: 1, unit_price: 0.5, line_discount: 0, invoice_discount: 0, total: 0.5, vat_code: 'D', refunded: 0 },
    { id: '3', position: 3, product_id: null, name: 'Djathë i bardhë 400g', unit: 'cope', quantity: 1, unit_price: 5.6, line_discount: 0, invoice_discount: 0, total: 5.6, vat_code: 'D', refunded: 0 },
    { id: '4', position: 4, product_id: null, name: 'Ujë mineral 1.5L', unit: 'cope', quantity: 6, unit_price: 0.45, line_discount: 0, invoice_discount: 0, total: 2.7, vat_code: 'E', refunded: 0 },
  ],
  voided: false,
  has_refunds: false,
}
