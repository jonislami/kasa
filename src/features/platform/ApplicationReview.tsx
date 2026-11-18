import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, FileText, Plus, RotateCcw, X } from 'lucide-react'
import { Badge, Button, Card, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { legalFormLabel, taxCategoryLabel } from '@/lib/taxProfile'
import {
  ApplicationNotMigrated,
  decideUnit,
  documentUrl,
  fetchActivities,
  fetchAdminApplication,
  saveActivity,
  type Activity,
} from '@/features/onboarding/applicationApi'

const kb = (n: number | null) => (n == null ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const day = (d: unknown) => (typeof d === 'string' && d ? d.slice(0, 10).split('-').reverse().join('.') : '')

/** The application of a business (0041): tax profile, units (each approved or rejected) and documents. */
export function ApplicationReview({ businessId, registration, open, onChanged }: { businessId: string; registration: Record<string, unknown> | null | undefined; open: boolean; onChanged: () => void }) {
  const qc = useQueryClient()
  const app = useQuery({ queryKey: ['platform-application', businessId], queryFn: () => fetchAdminApplication(businessId), retry: false })
  const [docError, setDocError] = useState<string | null>(null)
  const unit = useMutation({
    mutationFn: (p: { id: string; status: 'pending' | 'approved' | 'rejected' }) => decideUnit(p.id, p.status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-application', businessId] })
      onChanged()
    },
  })
  if (app.error instanceof ApplicationNotMigrated) return null
  const r = registration ?? {}
  const units = app.data?.units ?? []
  const docs = app.data?.documents ?? []
  const hasCert = docs.some((d) => d.kind === 'certificate')
  const openDoc = async (path: string) => {
    const w = window.open('', '_blank')
    try {
      const url = await documentUrl(path)
      if (w) w.location.href = url
    } catch (e) {
      w?.close()
      setDocError((e as Error).message)
    }
  }
  if (!app.isLoading && !units.length && !docs.length && r.version !== 2) return null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Profili tatimor</h2>
        <dl className="mt-3 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-sm">
          {(
            [
              ['Forma juridike', legalFormLabel(r.legal_form as string)],
              ['Kategoria tatimore', `${taxCategoryLabel(r.legal_form as string, r.tax_category as string)}${r.real_income ? ' · e ardhur reale (vullnetare)' : ''}`],
              ['TVSH', r.vat_registered === true ? `Po · nga ${day(r.vat_date)}` : r.vat_registered === false ? 'Jo' : ''],
              ['Qendra tatimore', r.tax_center as string],
              ['Shteti', r.country as string],
              ['Kodi i partnerit', r.partner_code as string],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="break-words">{v || '—'}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-5 text-[14px] font-semibold">Dokumentet</h3>
        {!hasCert && !app.isLoading && <p className="mt-2 rounded-ctl bg-amber-100 px-3 py-2 text-sm text-amber-700">Mungon certifikata e regjistrimit të biznesit.</p>}
        <ul className="mt-2 divide-y divide-line rounded-card border border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.file_name}</div>
                <div className="text-xs text-muted">
                  {d.kind === 'certificate' ? 'Certifikata e regjistrimit' : 'Dokument shtesë'} · {kb(d.size_bytes)}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void openDoc(d.path)}>
                <Eye className="h-4 w-4" /> Shiko
              </Button>
            </li>
          ))}
          {!docs.length && <li className="px-3 py-2.5 text-sm text-muted">{app.isLoading ? 'Duke ngarkuar…' : 'Asnjë dokument'}</li>}
        </ul>
        {docError && <p className="mt-2 text-sm text-warn-700">{docError}</p>}
      </Card>

      <Card className="p-5">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Njësitë e biznesit ({units.length})</h2>
        <p className="mt-0.5 text-sm text-muted">Njësitë e refuzuara nuk marrin arka; “Aprovo” i biznesit aprovon njësitë që presin.</p>
        <ul className="mt-3 flex flex-col gap-2">
          {units.map((u) => (
            <li key={u.id} className={cn('rounded-card border px-4 py-3', u.status === 'rejected' ? 'border-warn-700/30 bg-warn-100/40' : 'border-line')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{u.name}</span>
                {u.unit_no && <span className="num text-xs text-muted">Nr. {u.unit_no}</span>}
                <Badge tone={u.status === 'approved' ? 'success' : u.status === 'rejected' ? 'warn' : 'amber'}>
                  {u.status === 'approved' ? 'Aprovuar' : u.status === 'rejected' ? 'Refuzuar' : 'Në pritje'}
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted">
                {[u.address, u.city, u.country].filter(Boolean).join(', ')} · {u.registers} {u.registers === 1 ? 'arkë' : 'arka'}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(u.activities ?? []).map((a) => (
                  <span key={a} className="rounded-md bg-bg px-2 py-0.5 text-[12px] text-ink">
                    {a}
                  </span>
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {u.status !== 'approved' && (
                  <Button size="sm" variant="secondary" loading={unit.isPending && unit.variables?.id === u.id && unit.variables.status === 'approved'} onClick={() => unit.mutate({ id: u.id, status: 'approved' })}>
                    <Check className="h-4 w-4" /> Aprovo njësinë
                  </Button>
                )}
                {u.status !== 'rejected' && (open || u.status !== 'approved') && (
                  <Button size="sm" variant="ghost" loading={unit.isPending && unit.variables?.id === u.id && unit.variables.status === 'rejected'} onClick={() => unit.mutate({ id: u.id, status: 'rejected' })}>
                    <X className="h-4 w-4" /> Refuzo
                  </Button>
                )}
                {u.status !== 'pending' && open && (
                  <Button size="sm" variant="ghost" onClick={() => unit.mutate({ id: u.id, status: 'pending' })}>
                    <RotateCcw className="h-4 w-4" /> Në pritje
                  </Button>
                )}
              </div>
            </li>
          ))}
          {!units.length && <li className="text-sm text-muted">{app.isLoading ? 'Duke ngarkuar…' : 'Aplikim i vjetër, pa njësi – arkat krijohen si më parë.'}</li>}
        </ul>
        {unit.error && <p className="mt-2 text-sm text-warn-700">{(unit.error as Error).message}</p>}
      </Card>
    </div>
  )
}

/** The activities offered for a unit at registration: add, rename, hide (0041). */
export function ActivitiesCard() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['business-activities'], queryFn: fetchActivities, retry: false })
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null)
  const done = () => void qc.invalidateQueries({ queryKey: ['business-activities'] })
  const save = useMutation({
    mutationFn: (a: Partial<Activity> & { name: string }) => saveActivity(a),
    onSuccess: () => {
      setName('')
      setEdit(null)
      done()
    },
  })
  if (list.error instanceof ApplicationNotMigrated) return null
  return (
    <Card className="p-5">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Veprimtaritë e njësive</h2>
      <p className="mt-0.5 text-sm text-muted">Lista që klienti zgjedh te njësitë e biznesit. Një veprimtari e fshehur nuk ofrohet më, por mbetet te njësitë që e kanë.</p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) save.mutate({ name: name.trim() })
        }}
      >
        <div className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Veprimtari e re, p.sh. Prodhim" />
        </div>
        <Button type="submit" loading={save.isPending && !edit} disabled={!name.trim()}>
          <Plus className="h-4 w-4" /> Shto
        </Button>
      </form>
      {save.error && <p className="mt-2 text-sm text-warn-700">{(save.error as Error).message}</p>}
      <ul className="mt-4 divide-y divide-line rounded-card border border-line">
        {(list.data ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-3 py-2">
            {edit?.id === a.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  save.mutate({ id: a.id, name: edit.name, active: a.active })
                }}
              >
                <div className="flex-1">
                  <Input value={edit.name} onChange={(e) => setEdit({ id: a.id, name: e.target.value })} autoFocus />
                </div>
                <Button type="submit" size="sm" loading={save.isPending}>
                  Ruaj
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                  Anulo
                </Button>
              </form>
            ) : (
              <>
                <span className={cn('flex-1 text-sm', !a.active && 'text-muted line-through')}>{a.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setEdit({ id: a.id, name: a.name })}>
                  Ndrysho
                </Button>
                <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: a.id, name: a.name, active: !a.active })}>
                  {a.active ? 'Fshih' : 'Shfaq'}
                </Button>
              </>
            )}
          </li>
        ))}
        {list.isLoading && <li className="px-3 py-2 text-sm text-muted">Duke ngarkuar…</li>}
      </ul>
    </Card>
  )
}
