import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { formatEUR, round2 } from '@/lib/money'
import { formatDay } from '@/features/accounting/api'
import {
  categoryLabel,
  deleteDoc,
  docNet,
  docVat,
  fetchDocs,
  importDocs,
  PURCHASE_CATEGORIES,
  SALE_CATEGORIES,
  saveDoc,
  type Doc,
  type DocCategory,
  type DocInput,
  type DocKind,
} from './api'

const SHOWN = 300
const TITLES: Record<DocKind, { list: string; one: string; partner: string; empty: string }> = {
  sale: { list: 'Faturat e shitjes', one: 'Faturë shitjeje', partner: 'Blerësi', empty: 'Regjistro faturat e shitjes që klienti i lëshon (me dorë ose nga Excel).' },
  purchase: { list: 'Faturat e blerjes dhe shpenzimet', one: 'Faturë blerjeje / shpenzim', partner: 'Furnitori', empty: 'Regjistro faturat e furnitorëve, qiranë, rrymën, pagat dhe shpenzimet e tjera.' },
}

/** The accountant's own documents of one kind for a client and period. */
export function DocumentsTab({ clientId, kind, from, to, onChanged }: { clientId: string; kind: DocKind; from: string; to: string; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<DocInput | null>(null)
  const [remove, setRemove] = useState<Doc | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const docs = useQuery({ queryKey: ['client', clientId, 'docs', kind, from, to], queryFn: () => fetchDocs(clientId, kind, from, to) })
  const t = TITLES[kind]

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (docs.data ?? []).filter((d) => !s || [d.partner_name, d.partner_nui, d.doc_no, d.description].some((v) => v?.toLowerCase().includes(s)) || d.total.toFixed(2).includes(s))
  }, [docs.data, q])
  const sum = list.reduce((a, d) => ({ net: a.net + docNet(d), vat: a.vat + docVat(d), total: a.total + d.total }), { net: 0, vat: 0, total: 0 })

  const changed = () => {
    void docs.refetch()
    onChanged()
  }
  const del = useMutation({
    mutationFn: (id: string) => deleteDoc(id),
    onSuccess: () => {
      setRemove(null)
      changed()
    },
  })

  const today = kosovoDateISO()
  const blank = (): DocInput => ({
    kind,
    category: 'goods',
    doc_date: today >= from && today <= to ? today : to,
    doc_no: '',
    partner_name: '',
    partner_nui: '',
    partner_vat: '',
    description: '',
    payment: 'bank',
    net_e: 0,
    vat_e: 0,
    net_d: 0,
    vat_d: 0,
    amt_c: 0,
    amt_a: 0,
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-[17px] font-semibold">{t.list}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative md:w-[280px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Partneri, NUI, nr. ose shuma" className="h-[44px] w-full rounded-ctl border border-field pl-10 pr-3 focus:border-brand-600 focus:outline-none" />
          </div>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="h-4 w-4" /> Nga Excel
          </Button>
          <Button onClick={() => setEdit(blank())}>
            <Plus className="h-4 w-4" /> {kind === 'sale' ? 'Faturë shitjeje' : 'Faturë blerjeje'}
          </Button>
        </div>
      </div>

      {!docs.data ? (
        <p className={docs.error ? 'px-5 py-8 text-sm text-warn-700' : 'py-10 text-center text-muted'}>{docs.error ? (docs.error as Error).message : 'Duke ngarkuar…'}</p>
      ) : list.length === 0 ? (
        <EmptyState title={docs.data.length ? 'Asnjë dokument me këtë kërkim' : 'Asnjë dokument në këtë periudhë'} text={docs.data.length ? undefined : t.empty} />
      ) : (
        <>
          <Table>
            <thead className="bg-[#F8FAF8]">
              <tr>
                <Th className="pl-5">Data</Th>
                <Th>{t.partner}</Th>
                <Th className="hidden md:table-cell">Nr.</Th>
                <Th className="hidden lg:table-cell">Kategoria</Th>
                <Th className="hidden text-right md:table-cell">Baza</Th>
                <Th className="hidden text-right md:table-cell">TVSH</Th>
                <Th className="text-right">Totali</Th>
                <Th className="pr-5" />
              </tr>
            </thead>
            <tbody>
              {list.slice(0, SHOWN).map((d) => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap pl-5">{formatDay(d.doc_date)}</Td>
                  <Td>
                    <div className="font-medium">{d.partner_name || '—'}</div>
                    <div className="text-xs text-muted">{[d.partner_nui && `NUI ${d.partner_nui}`, d.description].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td className="hidden md:table-cell">{d.doc_no || '—'}</Td>
                  <Td className="hidden lg:table-cell">
                    {categoryLabel(kind, d.category)}
                    {d.payment === 'due' && <Badge tone="amber" className="ml-2">Me afat</Badge>}
                  </Td>
                  <Td className="hidden text-right md:table-cell">{formatEUR(docNet(d))}</Td>
                  <Td className="hidden text-right md:table-cell">{docVat(d) ? formatEUR(docVat(d)) : '—'}</Td>
                  <Td className="text-right font-semibold">{formatEUR(d.total)}</Td>
                  <Td className="whitespace-nowrap pr-5 text-right">
                    <button type="button" aria-label="Ndrysho" title="Ndrysho" onClick={() => setEdit({ ...d })} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Fshi" title="Fshi" onClick={() => setRemove(d)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-warn-100 hover:text-warn-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td className="border-b-0 pl-5">Gjithsej ({list.length})</Td>
                <Td className="border-b-0" />
                <Td className="hidden border-b-0 md:table-cell" />
                <Td className="hidden border-b-0 lg:table-cell" />
                <Td className="hidden border-b-0 text-right md:table-cell">{formatEUR(sum.net)}</Td>
                <Td className="hidden border-b-0 text-right md:table-cell">{formatEUR(sum.vat)}</Td>
                <Td className="border-b-0 text-right">{formatEUR(sum.total)}</Td>
                <Td className="border-b-0" />
              </tr>
            </tbody>
          </Table>
          {list.length > SHOWN && <p className="px-5 py-3 text-sm text-muted">Shfaqen {SHOWN} nga {list.length}. Eksporti në Excel i përmban të gjitha.</p>}
        </>
      )}

      <DocDialog
        clientId={clientId}
        value={edit}
        onClose={() => setEdit(null)}
        onSaved={(again) => {
          changed()
          setEdit(again ? { ...blank(), doc_date: edit?.doc_date ?? blank().doc_date, category: edit?.category ?? 'goods' } : null)
        }}
      />
      <ImportDialog
        clientId={clientId}
        kind={kind}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false)
          changed()
        }}
      />
      <Dialog
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        title="Të fshihet dokumenti?"
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Anulo
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => remove && del.mutate(remove.id)}>
              Fshije
            </Button>
          </div>
        }
      >
        {remove && (
          <p className="text-[15px]">
            {remove.partner_name || t.one} · {formatDay(remove.doc_date)} · <strong>{formatEUR(remove.total)}</strong>
          </p>
        )}
        {del.error && <p className="mt-3 text-sm text-warn-700">{(del.error as Error).message}</p>}
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------
type Amounts = { net_e: string; vat_e: string; net_d: string; vat_d: string; amt_c: string; amt_a: string }
const num = (s: string) => {
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}
const txt = (v: number) => (v ? v.toFixed(2) : '')
const cleanNum = (s: string) => s.replace(/[^\d.,-]/g, '')

function DocDialog({ clientId, value, onClose, onSaved }: { clientId: string; value: DocInput | null; onClose: () => void; onSaved: (again: boolean) => void }) {
  const [form, setForm] = useState<DocInput | null>(null)
  const [amt, setAmt] = useState<Amounts>({ net_e: '', vat_e: '', net_d: '', vat_d: '', amt_c: '', amt_a: '' })
  const [seed, setSeed] = useState<DocInput | null>(null)
  const again = useRef(false)
  if (value !== seed) {
    setSeed(value)
    setForm(value)
    if (value) setAmt({ net_e: txt(value.net_e), vat_e: txt(value.vat_e), net_d: txt(value.net_d), vat_d: txt(value.vat_d), amt_c: txt(value.amt_c), amt_a: txt(value.amt_a) })
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return
      if (!form.doc_date) throw new Error('Zgjidh datën')
      if (form.partner_nui && !/^\d{9}$/.test(form.partner_nui.replace(/\s/g, ''))) throw new Error('NUI e partnerit ka 9 shifra')
      const d = { ...form, net_e: num(amt.net_e), vat_e: num(amt.vat_e), net_d: num(amt.net_d), vat_d: num(amt.vat_d), amt_c: num(amt.amt_c), amt_a: num(amt.amt_a) }
      if (!(d.net_e || d.vat_e || d.net_d || d.vat_d || d.amt_c || d.amt_a)) throw new Error('Shkruaj shumat e faturës')
      await saveDoc(clientId, d)
    },
    onSuccess: () => onSaved(again.current),
  })

  if (!value || !form) return null
  const set = <K extends keyof DocInput>(k: K, v: DocInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  // Typing a base fills its VAT (it stays editable for rounding on the supplier's invoice).
  const setBase = (base: 'net_e' | 'net_d', vat: 'vat_e' | 'vat_d', rate: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = cleanNum(e.target.value)
    setAmt((a) => ({ ...a, [base]: v, [vat]: v ? round2(num(v) * rate).toFixed(2) : '' }))
  }
  const setA = (k: keyof Amounts) => (e: React.ChangeEvent<HTMLInputElement>) => setAmt((a) => ({ ...a, [k]: cleanNum(e.target.value) }))
  const total = num(amt.net_e) + num(amt.vat_e) + num(amt.net_d) + num(amt.vat_d) + num(amt.amt_c) + num(amt.amt_a)
  const t = TITLES[form.kind]
  const cats = form.kind === 'sale' ? SALE_CATEGORIES : PURCHASE_CATEGORIES

  return (
    <Dialog
      open
      onClose={() => {
        save.reset()
        onClose()
      }}
      title={form.id ? `Ndrysho: ${t.one.toLowerCase()}` : t.one}
      width="md:max-w-[680px]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {save.error && <span className="mr-auto text-sm text-warn-700">{(save.error as Error).message}</span>}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          {!form.id && (
            <Button
              variant="secondary"
              loading={save.isPending && again.current}
              onClick={() => {
                again.current = true
                save.mutate()
              }}
            >
              Ruaj dhe shto tjetër
            </Button>
          )}
          <Button
            loading={save.isPending && !again.current}
            onClick={() => {
              again.current = false
              save.mutate()
            }}
          >
            Ruaj
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          again.current = false
          save.mutate()
        }}
      >
        <Input label="Data e faturës" type="date" value={form.doc_date} onChange={(e) => set('doc_date', e.target.value)} />
        <Input label="Nr. i faturës" value={form.doc_no ?? ''} onChange={(e) => set('doc_no', e.target.value)} />
        <Input label={t.partner} value={form.partner_name ?? ''} onChange={(e) => set('partner_name', e.target.value)} placeholder={form.kind === 'sale' ? 'Emri i blerësit (bosh = qytetar)' : 'Emri i furnitorit'} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="NUI" inputMode="numeric" maxLength={9} value={form.partner_nui ?? ''} onChange={(e) => set('partner_nui', e.target.value.replace(/\D/g, ''))} />
          <Input label="Nr. TVSH" value={form.partner_vat ?? ''} onChange={(e) => set('partner_vat', e.target.value)} />
        </div>
        <Select label="Kategoria" value={form.category} onChange={(e) => set('category', e.target.value as DocCategory)} options={cats} />
        <Select
          label="Pagesa"
          value={form.payment}
          onChange={(e) => set('payment', e.target.value as DocInput['payment'])}
          options={[
            { value: 'bank', label: 'Bankë' },
            { value: 'cash', label: 'Kesh' },
            { value: 'due', label: 'Me afat (e papaguar)' },
          ]}
        />

        <div className="rounded-xl border border-line bg-[#F8FAF8] p-4 sm:col-span-2">
          <div className="mb-3 text-sm font-semibold">Shumat sipas normës së TVSH-së</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Input label="Baza 18%" inputMode="decimal" placeholder="0.00" value={amt.net_e} onChange={setBase('net_e', 'vat_e', 0.18)} />
            <Input label="TVSH 18%" inputMode="decimal" placeholder="0.00" value={amt.vat_e} onChange={setA('vat_e')} />
            <Input label="Baza 8%" inputMode="decimal" placeholder="0.00" value={amt.net_d} onChange={setBase('net_d', 'vat_d', 0.08)} />
            <Input label="TVSH 8%" inputMode="decimal" placeholder="0.00" value={amt.vat_d} onChange={setA('vat_d')} />
            <Input label="0%" inputMode="decimal" placeholder="0.00" value={amt.amt_c} onChange={setA('amt_c')} />
            <Input label="E liruar / pa TVSH" inputMode="decimal" placeholder="0.00" value={amt.amt_a} onChange={setA('amt_a')} />
            <div className="col-span-2 flex items-end justify-end">
              <div className="text-right">
                <div className="text-sm text-muted">Totali i faturës</div>
                <div className="text-[22px] font-bold tabular-nums">{formatEUR(total)}</div>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">TVSH-ja plotësohet vetë nga baza; ndryshoje nëse fatura ka rrumbullakim tjetër. Për notë krediti shkruaj shuma negative.</p>
        </div>

        <div className="sm:col-span-2">
          <Input label="Përshkrimi" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="p.sh. Qiraja e tetorit" />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Excel import
// ---------------------------------------------------------------------------
const COLUMNS = ['Data', 'Nr. i faturës', 'Partneri', 'NUI', 'Nr. TVSH', 'Baza 18%', 'TVSH 18%', 'Baza 8%', 'TVSH 8%', '0%', 'E liruar', 'Kategoria', 'Pagesa', 'Përshkrimi']

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/ë/g, 'e')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')

const ALIASES: Record<string, string[]> = {
  date: ['data', 'data e fatures', 'date'],
  no: ['nr. i fatures', 'nr i fatures', 'nr.', 'nr', 'numri', 'fatura', 'nr. fatures'],
  partner: ['partneri', 'blersi', 'bleresi', 'furnitori', 'emri', 'klienti'],
  nui: ['nui', 'nr. biznesit', 'nrb'],
  vatno: ['nr. tvsh', 'nr tvsh', 'numri i tvsh'],
  net_e: ['baza 18%', 'baza 18', 'vlera pa tvsh 18%', '18% baza'],
  vat_e: ['tvsh 18%', 'tvsh 18', '18% tvsh'],
  net_d: ['baza 8%', 'baza 8', 'vlera pa tvsh 8%', '8% baza'],
  vat_d: ['tvsh 8%', 'tvsh 8', '8% tvsh'],
  amt_c: ['0%', 'norma 0', 'zero'],
  amt_a: ['e liruar', 'liruar', 'pa tvsh', 'te liruara'],
  category: ['kategoria', 'lloji'],
  payment: ['pagesa', 'menyra e pageses'],
  description: ['pershkrimi', 'pershkrim', 'shenim'],
}

function toDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim().replace(/\s|€/g, '')
  if (!s) return 0
  // 1.234,56 → 1234.56 ; 1234.56 stays
  const t = s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

function toCategory(kind: DocKind, v: unknown): DocCategory {
  const s = norm(v)
  const cats = kind === 'sale' ? SALE_CATEGORIES : PURCHASE_CATEGORIES
  return cats.find((c) => norm(c.label) === s || c.value === s || norm(c.label).startsWith(s) && s.length > 3)?.value ?? 'goods'
}

function toPayment(v: unknown): DocInput['payment'] {
  const s = norm(v)
  if (s.startsWith('kesh') || s === 'cash') return 'cash'
  if (s.includes('afat') || s === 'due') return 'due'
  return 'bank'
}

function parseRows(kind: DocKind, data: unknown[][]): { rows: Omit<DocInput, 'id'>[]; errors: string[] } {
  const headerIdx = data.findIndex((r) => r.some((c) => ALIASES.date.includes(norm(c))))
  if (headerIdx < 0) return { rows: [], errors: ['Nuk u gjet rreshti i titujve (duhet të ketë kolonën "Data").'] }
  const head = data[headerIdx].map(norm)
  const col = (key: string) => head.findIndex((h) => ALIASES[key].includes(h))
  const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)])) as Record<string, number>
  const get = (r: unknown[], key: string) => (idx[key] >= 0 ? r[idx[key]] : undefined)
  const rows: Omit<DocInput, 'id'>[] = []
  const errors: string[] = []
  data.slice(headerIdx + 1).forEach((r, i) => {
    if (r.every((c) => String(c ?? '').trim() === '')) return
    const line = headerIdx + i + 2
    const date = toDate(get(r, 'date'))
    if (!date) return errors.push(`Rreshti ${line}: data mungon ose nuk njihet`)
    const amounts = { net_e: toNum(get(r, 'net_e')), vat_e: toNum(get(r, 'vat_e')), net_d: toNum(get(r, 'net_d')), vat_d: toNum(get(r, 'vat_d')), amt_c: toNum(get(r, 'amt_c')), amt_a: toNum(get(r, 'amt_a')) }
    if (Object.values(amounts).some((v) => Number.isNaN(v))) return errors.push(`Rreshti ${line}: një shumë nuk është numër`)
    if (Object.values(amounts).every((v) => v === 0)) return errors.push(`Rreshti ${line}: pa shuma`)
    // A base without VAT: fill the VAT from the rate.
    if (amounts.net_e && idx.vat_e < 0) amounts.vat_e = round2(amounts.net_e * 0.18)
    if (amounts.net_d && idx.vat_d < 0) amounts.vat_d = round2(amounts.net_d * 0.08)
    rows.push({
      kind,
      category: toCategory(kind, get(r, 'category')),
      doc_date: date,
      doc_no: String(get(r, 'no') ?? '').trim(),
      partner_name: String(get(r, 'partner') ?? '').trim(),
      partner_nui: String(get(r, 'nui') ?? '').replace(/\D/g, ''),
      partner_vat: String(get(r, 'vatno') ?? '').trim(),
      description: String(get(r, 'description') ?? '').trim(),
      payment: toPayment(get(r, 'payment')),
      ...amounts,
    })
  })
  return { rows, errors }
}

function ImportDialog({ clientId, kind, open, onClose, onDone }: { clientId: string; kind: DocKind; open: boolean; onClose: () => void; onDone: () => void }) {
  const [parsed, setParsed] = useState<{ rows: Omit<DocInput, 'id'>[]; errors: string[]; file: string } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () => importDocs(clientId, parsed!.rows),
    onSuccess: () => {
      setParsed(null)
      onDone()
    },
  })

  const close = () => {
    setParsed(null)
    setReadError(null)
    run.reset()
    onClose()
  }

  const pick = async (file: File) => {
    setReadError(null)
    try {
      const { readSheet } = await import('read-excel-file/browser')
      const data = (await readSheet(file)) as unknown[][]
      setParsed({ ...parseRows(kind, data), file: file.name })
    } catch (e) {
      setReadError('Skedari nuk u lexua: ' + (e as Error).message)
    }
  }

  const template = async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const example = kind === 'sale' ? ['01.11.2026', 'F-001', 'Blerësi SH.P.K.', '810000000', '330000000', 100, 18, 0, 0, 0, 0, 'Mallra', 'Bankë', ''] : ['01.11.2026', '123/26', 'Furnitori SH.P.K.', '810000000', '330000000', 100, 18, 50, 4, 0, 0, 'Mall për rishitje', 'Me afat', '']
    await writeXlsxFile(
      [COLUMNS.map((c) => ({ value: c, fontWeight: 'bold' as const })), example.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: v, type: String }))] as never,
      { columns: COLUMNS.map((c) => ({ width: Math.max(12, c.length + 4) })) },
    ).toFile(kind === 'sale' ? 'shablloni-shitjet.xlsx' : 'shablloni-blerjet.xlsx')
  }

  const total = parsed?.rows.reduce((a, r) => a + r.net_e + r.vat_e + r.net_d + r.vat_d + r.amt_c + r.amt_a, 0) ?? 0

  return (
    <Dialog
      open={open}
      onClose={close}
      title={kind === 'sale' ? 'Importo faturat e shitjes' : 'Importo faturat e blerjes'}
      subtitle="Kolonat: Data, Nr. i faturës, Partneri, NUI, Nr. TVSH, Baza 18%, TVSH 18%, Baza 8%, TVSH 8%, 0%, E liruar, Kategoria, Pagesa, Përshkrimi."
      width="md:max-w-[600px]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {run.error && <span className="mr-auto text-sm text-warn-700">{(run.error as Error).message}</span>}
          <Button variant="secondary" onClick={() => void template()}>
            Shkarko shabllonin
          </Button>
          <Button disabled={!parsed || parsed.rows.length === 0} loading={run.isPending} onClick={() => run.mutate()}>
            Importo {parsed?.rows.length ? `(${parsed.rows.length})` : ''}
          </Button>
        </div>
      }
    >
      <label className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-field bg-[#F8FAF8] px-4 text-center hover:border-brand-600">
        <FileSpreadsheet className="h-7 w-7 text-brand-600" />
        <span className="font-semibold">{parsed ? parsed.file : 'Zgjidh skedarin Excel (.xlsx)'}</span>
        <span className="text-sm text-muted">Rreshti i parë me tituj; çdo rresht tjetër një faturë.</span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void pick(f)
            e.target.value = ''
          }}
        />
      </label>
      {readError && <p className="mt-3 text-sm text-warn-700">{readError}</p>}
      {parsed && (
        <div className="mt-4 text-sm">
          <p>
            <strong>{parsed.rows.length}</strong> fatura gati për import · gjithsej <strong>{formatEUR(total)}</strong>
          </p>
          {parsed.errors.length > 0 && (
            <div className="mt-3 max-h-[160px] overflow-y-auto rounded-ctl bg-amber-100 px-4 py-3 text-amber-700">
              <div className="font-semibold">{parsed.errors.length} rreshta nuk merren:</div>
              {parsed.errors.slice(0, 50).map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
