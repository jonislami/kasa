import { useRef, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { unitLabel } from '@/lib/units'
import { importProducts } from './api'
import { parseCsv, parseSheet, TEMPLATE_COLUMNS, type ParsedImport } from './importParse'

const CHUNK = 500

export function ImportDialog({
  open,
  onClose,
  onDone,
  services,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  /** Salon: rows without stock default to services. */
  services: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null)

  const reset = () => {
    setFileName(null)
    setParsed(null)
    setError(null)
    setResult(null)
    setProgress(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const onFile = async (file: File) => {
    reset()
    setFileName(file.name)
    try {
      let data: unknown[][]
      if (/\.csv$/i.test(file.name)) {
        data = parseCsv(await file.text())
      } else {
        const { readSheet } = await import('read-excel-file/browser')
        data = (await readSheet(file)) as unknown[][]
      }
      setParsed(parseSheet(data, { services }))
    } catch {
      setError('Skedari nuk u lexua. Përdor .xlsx ose .csv (shabllonin).')
    }
  }

  const downloadTemplate = async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const header = TEMPLATE_COLUMNS.map((c) => ({ value: c.title, fontWeight: 'bold' as const }))
    const sample = services
      ? [['Prerje flokësh', '', 'Flokë', '', 0, 8, 'E', '', '', 30]]
      : [
          ['Qumësht i freskët 1L', '3870001000124', 'Bulmet', 'copë', 0.72, 0.95, 'D', 24, 64, ''],
          ['Domate', '', 'Pemë & Perime', 'kg', 0.55, 0.85, 'D', 5, 12.5, ''],
        ]
    await writeXlsxFile([header, ...sample.map((r) => r.map((v) => ({ value: v, type: typeof v === 'number' ? Number : String })))], {
      columns: TEMPLATE_COLUMNS.map((c) => ({ width: Math.max(12, c.title.length + 4) })),
    }).toFile('kasa-shablloni-produktet.xlsx')
  }

  const run = async () => {
    if (!parsed?.rows.length) return
    setBusy(true)
    setError(null)
    let created = 0
    let updated = 0
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const res = await importProducts(parsed.rows.slice(i, i + CHUNK))
        created += res.created
        updated += res.updated
        setProgress(Math.min(parsed.rows.length, i + CHUNK))
      }
      setResult({ created, updated })
      onDone()
    } catch (e) {
      setError(
        `${(e as Error).message}${created + updated > 0 ? ` (u ruajtën ${created + updated} rreshtat e parë; nëse e provon përsëri, ata përditësohen, nuk dyfishohen)` : ''}`,
      )
      if (created + updated > 0) onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Importo nga Excel"
      subtitle="Produktet me të njëjtin barkod (ose emër) përditësohen, të rejat shtohen."
      width="md:max-w-[760px]"
      footer={
        result ? (
          <div className="flex justify-end">
            <Button size="lg" onClick={close}>
              Mbyll
            </Button>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="lg" onClick={close} disabled={busy}>
              Anulo
            </Button>
            <Button size="lg" onClick={() => void run()} loading={busy} disabled={!parsed?.rows.length}>
              {busy ? `Duke importuar ${progress}/${parsed?.rows.length ?? 0}` : `Importo ${parsed?.rows.length ?? 0} rreshta`}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-brand-600" />
          <div className="mt-3 text-lg font-semibold">Importi përfundoi</div>
          <p className="mt-1 text-muted">
            {result.created} të reja · {result.updated} të përditësuara
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-1 items-center gap-3 rounded-xl border-2 border-dashed border-field px-4 py-5 text-left hover:border-brand-600 hover:bg-[#F0F7F3]"
            >
              <Upload className="h-6 w-6 shrink-0 text-brand-600" />
              <div className="min-w-0">
                <div className="font-semibold">{fileName ?? 'Zgjidh skedarin'}</div>
                <div className="text-sm text-muted">.xlsx ose .csv – rreshti i parë: titujt e kolonave</div>
              </div>
            </button>
            <Button variant="secondary" className="sm:h-auto" onClick={() => void downloadTemplate()}>
              <Download className="h-4 w-4" /> Shablloni
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
            />
          </div>

          <p className="text-sm text-muted">
            Kolonat: <strong className="text-ink">Emri</strong>, <strong className="text-ink">Çmimi i shitjes</strong> (të detyrueshme), Barkodi, Kategoria,
            Njësia (copë/kg/pako/litër), Çmimi i blerjes, TVSH (E/D/C/A ose 18/8/0), Stoku minimal, Stoku, Kohëzgjatja (min). Stoku merret vetëm për
            produktet e reja.
          </p>

          {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}

          {parsed && (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded-md bg-brand-100 px-2.5 py-1 font-semibold text-brand-600">{parsed.rows.length} gati</span>
                {parsed.errors.length > 0 && (
                  <span className="rounded-md bg-warn-100 px-2.5 py-1 font-semibold text-warn-700">{parsed.errors.length} me gabim (nuk importohen)</span>
                )}
              </div>
              {parsed.errors.length > 0 && (
                <ul className="max-h-36 overflow-y-auto rounded-ctl border border-[#F3C9AE] bg-[#FFF8F3] px-4 py-2 text-sm text-warn-700">
                  {parsed.errors.slice(0, 100).map((e, i) => (
                    <li key={i} className="py-0.5">
                      Rreshti {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {parsed.rows.length > 0 && (
                <div className="overflow-x-auto rounded-ctl border border-line">
                  <table className="w-full text-sm">
                    <thead className="bg-[#F8FAF8] text-left text-muted">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Emri</th>
                        <th className="px-3 py-2 font-semibold">Barkodi</th>
                        <th className="px-3 py-2 font-semibold">Kategoria</th>
                        <th className="px-3 py-2 text-right font-semibold">Shitja</th>
                        <th className="px-3 py-2 font-semibold">TVSH</th>
                        <th className="px-3 py-2 text-right font-semibold">Stoku</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-3 py-2 font-medium">{r.name}</td>
                          <td className="px-3 py-2 tabular-nums text-muted">{r.barcode ?? '—'}</td>
                          <td className="px-3 py-2">{r.category ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatEUR(r.sale_price)}</td>
                          <td className="px-3 py-2">{r.vat_code ?? 'E'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.kind === 'service' ? 'shërbim' : r.stock != null ? `${r.stock} ${unitLabel(r.unit ?? 'cope')}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.rows.length > 8 && <div className="border-t border-line px-3 py-2 text-xs text-muted">… dhe {parsed.rows.length - 8} të tjera</div>}
                </div>
              )}
            </>
          )}

          {!parsed && !error && (
            <div className="flex items-center gap-3 rounded-ctl bg-bg px-4 py-3 text-sm text-muted">
              <FileSpreadsheet className="h-5 w-5 shrink-0" /> Shkarko shabllonin, mbushe në Excel dhe ngarkoje këtu.
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
