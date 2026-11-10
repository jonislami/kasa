import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileSpreadsheet } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { formatEUR, round2 } from '@/lib/money'
import { importDocs, PURCHASE_CATEGORIES, SALE_CATEGORIES, type DocCategory, type DocInput, type DocKind } from './api'

// Excel import of documents (amounts per rate, one row per invoice).
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

export function ImportDialog({ clientId, kind, open, onClose, onDone }: { clientId: string; kind: DocKind; open: boolean; onClose: () => void; onDone: () => void }) {
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
