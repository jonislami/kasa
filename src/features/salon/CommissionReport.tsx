import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, EmptyState, Select } from '@/components/ui'
import { kosovoDateISO } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { fetchCommission, fetchStaff, SalonNotMigrated, staffColor } from './api'

const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor']

function monthOptions(): { value: string; label: string; from: string; to: string }[] {
  const t = kosovoDateISO()
  let y = Number(t.slice(0, 4))
  let m = Number(t.slice(5, 7))
  const out = []
  for (let i = 0; i < 12; i++) {
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const to = i === 0 ? t : `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    out.push({ value: from, label: `${MONTHS[m - 1]} ${y}`, from, to })
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
  }
  return out
}

/** "Raporti i komisionit" – value of the lines each person performed × their commission. */
export function CommissionReport() {
  const months = useMemo(monthOptions, [])
  const [month, setMonth] = useState(months[0].value)
  const range = months.find((m) => m.value === month) ?? months[0]
  const rows = useQuery({ queryKey: ['commission', range.from, range.to], queryFn: () => fetchCommission(range.from, range.to) })
  const staff = useQuery({ queryKey: ['staff'], queryFn: fetchStaff, staleTime: 5 * 60_000 })
  const list = (rows.data ?? []).filter((r) => r.value !== 0 || r.role === 'worker')
  const max = Math.max(...list.map((r) => r.value), 0)
  const sum = list.reduce((a, r) => ({ services: a.services + r.services, value: a.value + r.value, commission: a.commission + r.commission }), { services: 0, value: 0, commission: 0 })

  const exportExcel = async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const b = (v: string) => ({ value: v, fontWeight: 'bold' as const })
    const n = (v: number) => ({ value: Math.round(v * 100) / 100, type: Number, format: '0.00' })
    await writeXlsxFile(
      [
        [b('Punëtori'), b('Komisioni %'), b('Shërbime'), b('Produkte'), b('Vlera'), b('Komisioni')],
        ...list.map((r) => [{ value: r.name, type: String }, n(r.commission_pct), n(r.services), n(r.products), n(r.value), n(r.commission)]),
        [b('Gjithsej'), { value: '', type: String }, n(sum.services), { value: '', type: String }, n(sum.value), n(sum.commission)],
      ],
      { columns: [{ width: 28 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 13 }, { width: 13 }] },
    ).toFile(`komisioni-${range.from.slice(0, 7)}.xlsx`)
  }

  if (rows.error instanceof SalonNotMigrated) return null

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="text-[17px] font-semibold">Raporti i komisionit</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Periudha</span>
          <Select aria-label="Muaji" value={month} onChange={(e) => setMonth(e.target.value)} className="h-11 w-auto" options={months.map((m) => ({ value: m.value, label: m.label }))} />
          <Button variant="secondary" onClick={() => void exportExcel()} disabled={list.length === 0}>
            Eksporto
          </Button>
        </div>
      </div>
      {rows.isLoading ? (
        <p className="py-10 text-center text-muted">Duke ngarkuar…</p>
      ) : list.length === 0 ? (
        <EmptyState title="Ende pa shërbime në këtë muaj" />
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAF8]">
            <tr className="text-left text-[13px] text-muted">
              <th className="border-y border-line px-5 py-3 font-semibold">Punëtori</th>
              <th className="border-y border-line px-3 py-3 text-right font-semibold">Shërbime</th>
              <th className="border-y border-line px-3 py-3 text-right font-semibold">Vlera e shërbimeve</th>
              <th className="hidden border-y border-line px-3 py-3 md:table-cell" />
              <th className="border-y border-line px-5 py-3 text-right font-semibold">Komisioni</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.staff_id}>
                <td className="border-b border-line px-5 py-3">
                  {r.name} · {r.commission_pct}%
                </td>
                <td className="border-b border-line px-3 py-3 text-right tabular-nums">{Number(r.services.toFixed(2))}</td>
                <td className="border-b border-line px-3 py-3 text-right tabular-nums">{formatEUR(r.value)}</td>
                <td className="hidden w-[160px] border-b border-line px-3 py-3 md:table-cell">
                  <div className="h-2 rounded-full bg-[#E8ECE9]">
                    <div className="h-2 rounded-full" style={{ width: `${max ? Math.max((r.value / max) * 100, 2) : 0}%`, background: staffColor(r.staff_id, staff.data ?? []) }} />
                  </div>
                </td>
                <td className="border-b border-line px-5 py-3 text-right font-semibold tabular-nums">{formatEUR(r.commission)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-5 py-3">Gjithsej</td>
              <td className="px-3 py-3 text-right tabular-nums">{Number(sum.services.toFixed(2))}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatEUR(sum.value)}</td>
              <td className="hidden md:table-cell" />
              <td className="px-5 py-3 text-right tabular-nums">{formatEUR(sum.commission)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  )
}
