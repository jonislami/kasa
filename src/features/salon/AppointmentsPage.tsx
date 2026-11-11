import { useEffect, useMemo, useRef, useState } from 'react'
import { isSefApp } from '@/lib/device'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { isManagerRole } from '@/lib/business'
import { cn } from '@/lib/cn'
import { kosovoDateISO, kosovoParts, kosovoTime, kosovoToIso, serverNow } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { fetchPosProducts } from '@/features/pos/api'
import { addDays } from '@/features/reports/api'
import {
  fetchAppointments,
  fetchStaff,
  initials,
  saveAppointment,
  SalonNotMigrated,
  setAppointmentStatus,
  staffColor,
  STATUS_LABELS,
  type Appointment,
  type AppointmentStatus,
  type Staff,
} from './api'

const START_H = 8
const END_H = 21
const PX_PER_MIN = 1 // 60 px per hour
const dayFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: 'Europe/Belgrade', weekday: 'long', day: 'numeric', month: 'long' })

function title(date: string): string {
  const s = dayFmt.format(new Date(kosovoToIso(date, '12:00')))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function minutesOfDay(iso: string): number {
  const { h, min } = kosovoParts(Date.parse(iso))
  return h * 60 + min
}

type Editing = { mode: 'new'; staffId: string; time: string } | { mode: 'edit'; appt: Appointment } | null

/** /terminet – day calendar, one column per worker (a worker sees only their own column). */
export function AppointmentsPage() {
  const { profile } = useBusiness()
  const manager = isManagerRole(profile.role)
  const qc = useQueryClient()
  const [date, setDate] = useState(() => kosovoDateISO())
  const [editing, setEditing] = useState<Editing>(null)

  const staffQ = useQuery({ queryKey: ['staff'], queryFn: fetchStaff, staleTime: 5 * 60_000 })
  // ±1 day in UTC, then keep only this Kosovo day (time zones and summer time).
  const appts = useQuery({
    queryKey: ['appointments', date],
    queryFn: async () => (await fetchAppointments(kosovoToIso(addDays(date, -1), '00:00'), kosovoToIso(addDays(date, 1), '23:59'))).filter((a) => kosovoDateISO(Date.parse(a.starts_at)) === date),
    refetchInterval: 60_000,
  })
  const services = useQuery({ queryKey: ['salon-services'], queryFn: async () => (await fetchPosProducts()).filter((p) => p.kind === 'service'), staleTime: 5 * 60_000 })

  const staff = useMemo(() => {
    const all = staffQ.data ?? []
    return manager ? all.filter((s) => s.role !== 'admin' || (appts.data ?? []).some((a) => a.staff_id === s.id)) : all.filter((s) => s.id === profile.id)
  }, [staffQ.data, manager, profile.id, appts.data])
  const allStaff = staffQ.data ?? []
  const list = appts.data ?? []
  const today = kosovoDateISO()

  if (appts.error instanceof SalonNotMigrated || staffQ.error instanceof SalonNotMigrated) {
    return (
      <div className="px-4 py-5 md:px-8 md:py-8">
        <Card>
          <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Terminet nuk janë aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0008_salon.sql në Supabase." />
        </Card>
      </div>
    )
  }

  const active = list.filter((a) => a.status !== 'cancelled')

  return (
    <div className="flex flex-col gap-4 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" aria-label="Dita e kaluar" onClick={() => setDate((d) => addDays(d, -1))}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-[180px]">
          <h1 className="text-[22px] font-bold leading-tight md:text-[26px]">{title(date)}</h1>
          <div className="text-sm text-muted">
            {active.length} termine · {staff.length} {staff.length === 1 ? 'punëtor' : 'punëtorë'}
          </div>
        </div>
        <Button variant="secondary" aria-label="Dita tjetër" onClick={() => setDate((d) => addDays(d, 1))}>
          <ChevronRight className="h-5 w-5" />
        </Button>
        {date !== today && (
          <Button variant="secondary" onClick={() => setDate(today)}>
            Sot
          </Button>
        )}
        <input
          type="date"
          aria-label="Zgjidh datën"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-11 rounded-ctl border border-field px-3"
        />
        <Button className="ml-auto" onClick={() => setEditing({ mode: 'new', staffId: staff[0]?.id ?? profile.id, time: nextSlot(date) })}>
          <Plus className="h-4 w-4" /> Termin i ri
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <div className="min-w-fit" style={{ minWidth: 64 + Math.max(staff.length, 1) * 220 }}>
          {/* header */}
          <div className="sticky top-0 z-10 flex border-b border-line bg-white">
            <div className="w-16 shrink-0" />
            {staff.map((s) => (
              <div key={s.id} className="flex min-w-[220px] flex-1 items-center gap-2.5 border-l border-line px-3 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: staffColor(s.id, allStaff) }}>
                  {initials(s.full_name)}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.full_name.split(' ')[0]}</div>
                  <div className="truncate text-xs text-muted">
                    {[s.specialty, `${active.filter((a) => a.staff_id === s.id).length} termine`].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* grid */}
          <DayGrid
            date={date}
            today={today}
            staff={staff}
            allStaff={allStaff}
            appts={list}
            onSlot={(staffId, time) => setEditing({ mode: 'new', staffId, time })}
            onOpen={(appt) => setEditing({ mode: 'edit', appt })}
          />
        </div>
      </Card>
      {appts.isLoading && <p className="text-center text-sm text-muted">Duke ngarkuar…</p>}

      <AppointmentDialog
        editing={editing}
        date={date}
        staff={manager ? allStaff : allStaff.filter((s) => s.id === profile.id)}
        services={services.data ?? []}
        onClose={() => setEditing(null)}
        onChanged={() => void qc.invalidateQueries({ queryKey: ['appointments'] })}
      />
    </div>
  )
}

function nextSlot(date: string): string {
  if (date !== kosovoDateISO()) return '09:00'
  const { h, min } = kosovoParts(serverNow())
  const m = Math.min(Math.max(h * 60 + min + 15, START_H * 60), (END_H - 1) * 60)
  const r = Math.ceil(m / 15) * 15
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`
}

function DayGrid({
  date,
  today,
  staff,
  allStaff,
  appts,
  onSlot,
  onOpen,
}: {
  date: string
  today: string
  staff: Staff[]
  allStaff: Staff[]
  appts: Appointment[]
  onSlot: (staffId: string, time: string) => void
  onOpen: (a: Appointment) => void
}) {
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i)
  const height = (END_H - START_H) * 60 * PX_PER_MIN
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 60_000)
    return () => clearInterval(t)
  }, [])
  const nowMin = (() => {
    const { h, min } = kosovoParts(now)
    return h * 60 + min
  })()
  const scroller = useRef<HTMLDivElement>(null)

  return (
    <div ref={scroller} className="relative flex" style={{ height }}>
      <div className="relative w-16 shrink-0">
        {hours.map((h) => (
          <div key={h} className="absolute right-2 -translate-y-2 text-xs tabular-nums text-muted" style={{ top: (h - START_H) * 60 * PX_PER_MIN }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>
      {staff.map((s) => (
        <div
          key={s.id}
          className="relative min-w-[220px] flex-1 cursor-pointer border-l border-line"
          onClick={(e) => {
            const y = e.clientY - (e.currentTarget as HTMLDivElement).getBoundingClientRect().top
            const m = Math.round((START_H * 60 + y / PX_PER_MIN) / 15) * 15
            const mm = Math.min(Math.max(m, START_H * 60), END_H * 60 - 15)
            onSlot(s.id, `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`)
          }}
        >
          {hours.map((h) => (
            <div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: (h - START_H) * 60 * PX_PER_MIN }} />
          ))}
          {appts
            .filter((a) => a.staff_id === s.id)
            .map((a) => {
              const top = (minutesOfDay(a.starts_at) - START_H * 60) * PX_PER_MIN
              const h = Math.max(a.duration_min * PX_PER_MIN, 26)
              const color = staffColor(a.staff_id, allStaff)
              const faded = a.status === 'cancelled' || a.status === 'no_show'
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(a)
                  }}
                  className={cn('absolute inset-x-1.5 overflow-hidden rounded-lg border px-2 py-1 text-left text-xs', faded && 'opacity-50')}
                  style={{ top: Math.max(top, 0), height: h, borderColor: `${color}55`, background: a.status === 'paid' ? '#F2F5F2' : `${color}14` }}
                >
                  <div className={cn('truncate font-semibold', faded && 'line-through')} style={{ color }}>
                    {kosovoTime(a.starts_at)} {a.customer_name}
                  </div>
                  <div className={cn('truncate text-muted', faded && 'line-through')}>
                    {a.status === 'no_show' ? 'Nuk erdhi' : a.status === 'paid' ? `✓ ${a.service_name}` : `${a.service_name} · ${a.duration_min} min`}
                  </div>
                </button>
              )
            })}
        </div>
      ))}
      {date === today && nowMin >= START_H * 60 && nowMin <= END_H * 60 && (
        <div className="pointer-events-none absolute left-14 right-0 z-[5] flex items-center" style={{ top: (nowMin - START_H * 60) * PX_PER_MIN }}>
          <span className="h-2.5 w-2.5 -translate-x-1 rounded-full bg-warn-700" />
          <span className="h-px flex-1 bg-warn-700" />
        </div>
      )}
    </div>
  )
}

function AppointmentDialog({
  editing,
  date,
  staff,
  services,
  onClose,
  onChanged,
}: {
  editing: Editing
  date: string
  staff: Staff[]
  services: { id: string; name: string; sale_price: number; duration_min: number | null }[]
  onClose: () => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const appt = editing?.mode === 'edit' ? editing.appt : null
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', product_id: '', staff_id: '', date, time: '09:00', duration: '30', note: '' })
  const [error, setError] = useState<string | null>(null)
  const locked = appt?.status === 'paid' || appt?.status === 'cancelled'

  useEffect(() => {
    if (!editing) return
    setError(null)
    if (editing.mode === 'new') {
      setForm({ customer_name: '', customer_phone: '', product_id: services[0]?.id ?? '', staff_id: editing.staffId, date, time: editing.time, duration: String(services[0]?.duration_min ?? 30), note: '' })
    } else {
      const a = editing.appt
      setForm({
        customer_name: a.customer_name,
        customer_phone: a.customer_phone ?? '',
        product_id: a.product_id ?? '',
        staff_id: a.staff_id,
        date: kosovoDateISO(Date.parse(a.starts_at)),
        time: kosovoTime(a.starts_at),
        duration: String(a.duration_min),
        note: a.note ?? '',
      })
    }
  }, [editing, date, services])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const service = services.find((s) => s.id === form.product_id)

  const save = useMutation({
    mutationFn: () =>
      saveAppointment({
        id: appt?.id,
        staff_id: form.staff_id,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        product_id: form.product_id || null,
        service_name: service?.name ?? appt?.service_name,
        price: service?.sale_price ?? appt?.price,
        starts_at: kosovoToIso(form.date, form.time),
        duration_min: Number(form.duration) || 30,
        note: form.note,
      }),
    onSuccess: () => {
      onChanged()
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const status = useMutation({
    mutationFn: (s: Exclude<AppointmentStatus, 'paid'>) => setAppointmentStatus(appt!.id, s),
    onSuccess: () => {
      onChanged()
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!editing) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title={appt ? appt.customer_name : 'Termin i ri'}
      subtitle={appt ? `${appt.service_name} · ${formatEUR(appt.price)}` : undefined}
      width="md:max-w-[560px]"
      footer={
        appt && !locked ? (
          <div className="flex flex-col gap-2.5">
            {isSefApp && (
              <Button size="lg" block onClick={() => navigate(`/arka?termin=${appt.id}`)}>
                Paguaj në arkë · {formatEUR(appt.price)}
              </Button>
            )}
            <div className="grid grid-cols-3 gap-2.5">
              <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate(appt.status === 'arrived' ? 'done' : 'arrived')}>
                {appt.status === 'arrived' ? 'I kryer' : 'Erdhi'}
              </Button>
              <Button variant="secondary" className="text-amber-700" onClick={() => status.mutate('no_show')}>
                Nuk erdhi
              </Button>
              <Button variant="danger" onClick={() => status.mutate('cancelled')}>
                Anulo
              </Button>
            </div>
            <Button variant="ghost" loading={save.isPending} onClick={() => save.mutate()}>
              Ruaj ndryshimet
            </Button>
          </div>
        ) : !appt ? (
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={onClose}>
              Anulo
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Ruaj terminin
            </Button>
          </div>
        ) : undefined
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!locked) save.mutate()
        }}
      >
        <Input label="Klienti" autoFocus={!appt} value={form.customer_name} onChange={set('customer_name')} disabled={locked} placeholder="Emri dhe mbiemri" />
        <Input label="Telefoni" inputMode="tel" value={form.customer_phone} onChange={set('customer_phone')} disabled={locked} placeholder="049 …" />
        <Select
          label="Shërbimi"
          value={form.product_id}
          disabled={locked}
          onChange={(e) => {
            const s = services.find((x) => x.id === e.target.value)
            setForm((f) => ({ ...f, product_id: e.target.value, duration: String(s?.duration_min ?? f.duration) }))
          }}
          options={services.length ? services.map((s) => ({ value: s.id, label: `${s.name} · ${formatEUR(s.sale_price)}` })) : [{ value: '', label: 'Shto shërbime te Shërbimet' }]}
        />
        <Select label="Punëtori" value={form.staff_id} onChange={set('staff_id')} disabled={locked || staff.length <= 1} options={staff.map((s) => ({ value: s.id, label: s.full_name }))} />
        <Input label="Data" type="date" value={form.date} onChange={set('date')} disabled={locked} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Ora" type="time" step={300} value={form.time} onChange={set('time')} disabled={locked} />
          <Input label="Minuta" type="number" min={5} max={720} step={5} value={form.duration} onChange={set('duration')} disabled={locked} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Shënim" value={form.note} onChange={set('note')} disabled={locked} />
        </div>
        <button type="submit" className="hidden" />
      </form>
      {appt && (
        <p className="mt-4 text-sm text-muted">
          Statusi: <b className="text-ink">{STATUS_LABELS[appt.status]}</b>
        </p>
      )}
      {error && <p className="mt-3 rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
    </Dialog>
  )
}
