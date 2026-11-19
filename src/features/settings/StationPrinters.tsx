import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChefHat, Printer } from 'lucide-react'
import { Button, Card, Input, Select } from '@/components/ui'
import { device } from '@/lib/device'
import { PAPER_WIDTHS, type PaperWidth } from '@/lib/printer/escpos'
import { printTicket } from '@/lib/printer'
import { setStationTarget, stationTarget, STATIONS, targetSupport, validHost, type StationTarget } from '@/lib/printer/stations'
import { STATION_LABELS, type Station, type Ticket } from '@/features/restaurant/api'
import type { ReceiptSettings } from './api'

type Kind = StationTarget['kind']

/** A short sample ticket for "Printo provë". */
const sample = (station: Station): Ticket => ({
  id: 'test',
  order_id: 'test',
  station,
  table_name: 'Provë',
  order_no: 0,
  waiter_name: null,
  items: [
    { name: station === 'bar' ? 'Makiato e madhe' : 'Pica Margarita', quantity: 2, modifiers: station === 'bar' ? ['pa sheqer'] : ['djathë shtesë'], note: null },
    { name: station === 'bar' ? 'Ujë 0.5L' : 'Sallatë', quantity: 1, modifiers: [], note: 'Faqja e provës' },
  ],
  created_at: new Date().toISOString(),
  printed_at: null,
  done_at: null,
})

function StationRow({ station, settings }: { station: Station; settings: ReceiptSettings }) {
  const support = targetSupport()
  const saved = stationTarget(station)
  const [kind, setKind] = useState<Kind>(saved?.kind ?? 'receipt')
  const [name, setName] = useState(saved?.kind === 'windows' ? saved.name : '')
  const [host, setHost] = useState(saved?.kind === 'network' ? saved.host : '')
  const [port, setPort] = useState(saved?.kind === 'network' ? String(saved.port || 9100) : '9100')
  const [paper, setPaper] = useState<string>(saved && (saved.kind === 'windows' || saved.kind === 'network') && saved.paper ? String(saved.paper) : '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const printers = useQuery({ queryKey: ['windows-printers'], queryFn: () => device.systemPrint!.list(), enabled: support.windows && kind === 'windows' })

  const build = (k: Kind): StationTarget | null | string => {
    const p = paper ? (Number(paper) as PaperWidth) : undefined
    if (k === 'off') return { kind: 'off' }
    if (k === 'receipt') return null
    if (k === 'windows') return name ? { kind: 'windows', name, paper: p } : 'Zgjidh printerin e Windows-it'
    const n = Number(port)
    if (!validHost(host)) return 'Shkruaj IP-në e printerit, p.sh. 192.168.1.100'
    if (!Number.isInteger(n) || n < 1 || n > 65535) return 'Porta duhet të jetë numër (zakonisht 9100)'
    return { kind: 'network', host: host.trim(), port: n, paper: p }
  }
  const save = (k: Kind = kind) => {
    const t = build(k)
    if (typeof t === 'string') {
      setMsg({ ok: false, text: t })
      return false
    }
    setStationTarget(station, t)
    setMsg({ ok: true, text: 'U ruajt në këtë pajisje' })
    return true
  }
  const test = useMutation({
    mutationFn: async () => {
      if (!save()) return
      const r = await printTicket(sample(station), settings)
      if (r === 'browser') throw new Error('Nuk ka printer të lidhur – lidhe printerin e faturave më lart ose zgjidh një printer tjetër.')
    },
    onSuccess: () => setMsg((m) => (m && !m.ok ? m : { ok: true, text: 'Faqja e provës u dërgua' })),
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  })

  const options: { value: Kind; label: string }[] = [
    { value: 'receipt', label: 'Printeri i faturave i kësaj pajisjeje' },
    ...(support.network ? [{ value: 'network' as Kind, label: 'Printer në rrjet (IP)' }] : []),
    ...(support.windows ? [{ value: 'windows' as Kind, label: 'Printer i instaluar në Windows' }] : []),
    { value: 'off', label: 'Nuk printohet në këtë pajisje' },
  ]

  return (
    <div className="rounded-card border border-line p-4">
      <div className="mb-3 font-semibold">{STATION_LABELS[station]}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Ku printohen porositë"
          value={kind}
          onChange={(e) => {
            const k = e.target.value as Kind
            setKind(k)
            setMsg(null)
            if (k === 'receipt' || k === 'off') save(k)
          }}
          options={options}
        />
        {kind === 'windows' && (
          <Select
            label="Printeri"
            value={name}
            onChange={(e) => (setName(e.target.value), setMsg(null))}
            options={[{ value: '', label: printers.isLoading ? 'Duke ngarkuar…' : 'Zgjidh' }, ...(printers.data ?? []).map((p) => ({ value: p.name, label: p.displayName }))]}
          />
        )}
        {kind === 'network' && (
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <Input label="IP e printerit" inputMode="decimal" placeholder="192.168.1.100" value={host} onChange={(e) => (setHost(e.target.value), setMsg(null))} className="num" />
            <Input label="Porta" inputMode="numeric" value={port} onChange={(e) => (setPort(e.target.value.replace(/\D/g, '')), setMsg(null))} className="num" />
          </div>
        )}
        {(kind === 'windows' || kind === 'network') && (
          <Select
            label="Letra e këtij printeri"
            value={paper}
            onChange={(e) => (setPaper(e.target.value), setMsg(null))}
            options={[{ value: '', label: `Si te fatura (${settings.paper_width} mm)` }, ...PAPER_WIDTHS.map((p) => ({ value: String(p.value), label: `${p.value} mm` }))]}
          />
        )}
      </div>
      {kind === 'network' && <p className="mt-2 text-xs text-muted">IP-ja shtypet nga vetë printeri: mbaje butonin FEED kur e ndez. Pajisja dhe printeri duhet të jenë në të njëjtin rrjet.</p>}
      {kind === 'off' && <p className="mt-2 text-xs text-muted">Porositë shfaqen te ekrani i {station === 'bar' ? 'barit' : 'kuzhinës'}; i printon pajisja atje.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {(kind === 'windows' || kind === 'network') && (
          <Button variant="secondary" onClick={() => save()}>
            Ruaj
          </Button>
        )}
        {kind !== 'off' && (
          <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            <Printer className="h-4 w-4" /> Printo provë
          </Button>
        )}
      </div>
      {msg && <p className={`mt-3 rounded-ctl px-4 py-2.5 text-sm ${msg.ok ? 'bg-brand-100 text-brand-600' : 'bg-warn-100 text-warn-700'}`}>{msg.text}</p>}
    </div>
  )
}

/** Restaurant: where this device prints the kitchen and bar tickets of the orders sent from it. */
export function StationPrintersCard({ settings }: { settings: ReceiptSettings }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
          <ChefHat className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Printerët e kuzhinës dhe barit</h2>
          <p className="text-sm text-muted">Kur dërgohet porosia nga kjo pajisje, çdo pjesë printohet te printeri i vet. Ruhet në këtë pajisje.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {STATIONS.map((s) => (
          <StationRow key={s} station={s} settings={settings} />
        ))}
      </div>
    </Card>
  )
}
