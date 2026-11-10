import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Armchair, CheckCircle2, ChefHat, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Input, Select } from '@/components/ui'
import { isManagerRole } from '@/lib/business'
import { serverNow } from '@/lib/clock'
import { cn } from '@/lib/cn'
import { formatEUR } from '@/lib/money'
import { fetchOpenOrders, fetchTables, RestaurantNotMigrated, saveTables, type DiningTable, type OpenOrderSummary, type TableShape } from './api'

const COLS = 8
const ROWS = 6

type Draft = Omit<DiningTable, 'id'> & { id?: string; key: string }

function minutesSince(iso: string) {
  return Math.max(0, Math.round((serverNow() - Date.parse(iso)) / 60000))
}

function since(iso: string) {
  const m = minutesSince(iso)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} orë ${m % 60} min`
}

/** Floor plan: free / occupied tables, open bills; managers arrange the plan. */
export function TablesPage() {
  const { profile } = useBusiness()
  const manager = isManagerRole(profile.role)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const tables = useQuery({ queryKey: ['tables'], queryFn: fetchTables })
  const orders = useQuery({ queryKey: ['open-orders'], queryFn: fetchOpenOrders, refetchInterval: 8000 })
  const [area, setArea] = useState<string>('')
  const [editing, setEditing] = useState<Draft[] | null>(null)
  // "Porosia u konfirmua" after the waiter confirmed an order (OrderPage).
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null)
  useEffect(() => {
    if (!notice) return
    window.history.replaceState({}, '')
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const list = editing ?? (tables.data ?? []).map((t) => ({ ...t, key: t.id }))
  const areas = useMemo(() => {
    const a = [...new Set(list.map((t) => t.area))]
    return a.length ? a : ['Salla']
  }, [list])
  useEffect(() => {
    if (!areas.includes(area)) setArea(areas[0])
  }, [areas, area])

  const byTable = useMemo(() => {
    const m = new Map<string, OpenOrderSummary>()
    for (const o of orders.data ?? []) if (o.table_id) m.set(o.table_id, o)
    return m
  }, [orders.data])
  const takeaway = (orders.data ?? []).filter((o) => !o.table_id)

  const notMigrated = tables.error instanceof RestaurantNotMigrated
  if (notMigrated) {
    return (
      <>
        <PageHeader title="Tavolinat" />
        <div className="px-4 py-5 md:px-8 md:py-0">
          <Card>
            <EmptyState icon={<Armchair className="h-6 w-6" />} title="Tavolinat nuk janë aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0011_restaurant.sql në Supabase." />
          </Card>
        </div>
      </>
    )
  }

  const inArea = list.filter((t) => t.area === area)
  const occupied = (orders.data ?? []).filter((o) => o.table_id).length

  return (
    <>
      <PageHeader
        eyebrow={`${occupied} të zëna · ${(tables.data ?? []).length - occupied} të lira`}
        title="Tavolinat"
        actions={
          <div className="flex gap-2">
            {manager && (
              <Button variant="secondary" onClick={() => navigate('/kuzhina')}>
                <ChefHat className="h-4 w-4" /> Kuzhina / Bari
              </Button>
            )}
            {manager && !editing && (
              <Button variant="secondary" onClick={() => setEditing((tables.data ?? []).map((t) => ({ ...t, key: t.id })))}>
                Ndrysho planin
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-28 pt-2 md:px-8 md:pb-8">
        {notice && (
          <p className="flex items-center gap-2 rounded-ctl bg-brand-100 px-4 py-3 text-[15px] font-medium text-brand-600">
            <CheckCircle2 className="h-5 w-5 shrink-0" /> {notice}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {areas.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setArea(a)}
              className={cn('h-11 rounded-full border px-5 text-[15px] font-medium', a === area ? 'border-ink bg-ink text-white' : 'border-field bg-white')}
            >
              {a}
            </button>
          ))}
          {!editing && (
            <Button variant="secondary" className="ml-auto" onClick={() => navigate('/tavolinat/merr')}>
              <ShoppingBag className="h-4 w-4" /> Për të marrë
            </Button>
          )}
        </div>

        {editing ? (
          <PlanEditor tables={editing} setTables={setEditing} area={area} areas={areas} onArea={setArea} onCancel={() => setEditing(null)} onSaved={() => {
            setEditing(null)
            void qc.invalidateQueries({ queryKey: ['tables'] })
          }} />
        ) : tables.isLoading ? (
          <Card>
            <p className="py-12 text-center text-muted">Duke ngarkuar…</p>
          </Card>
        ) : (tables.data ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon={<Armchair className="h-6 w-6" />}
              title="Ende nuk ka tavolina"
              text={manager ? 'Kliko "Ndrysho planin" dhe shto tavolinat e sallës.' : 'Menaxheri duhet t’i shtojë tavolinat.'}
            />
          </Card>
        ) : (
          <>
            {/* Desktop: the floor plan */}
            <div
              className="hidden gap-3 rounded-card border border-line bg-white p-4 md:grid"
              style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridAutoRows: '112px' }}
            >
              {inArea.map((t) => (
                <TableTile key={t.key} t={t} order={t.id ? byTable.get(t.id) : undefined} style={{ gridColumn: t.x + 1, gridRow: t.y + 1 }} onClick={() => navigate(`/tavolinat/${t.id}`)} />
              ))}
            </div>
            {/* Phone: tiles in plan order */}
            <div className="grid grid-cols-3 gap-2.5 md:hidden">
              {[...inArea]
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map((t) => (
                  <TableTile key={t.key} t={t} order={t.id ? byTable.get(t.id) : undefined} onClick={() => navigate(`/tavolinat/${t.id}`)} className="h-[104px]" />
                ))}
            </div>
          </>
        )}

        {!editing && takeaway.length > 0 && (
          <Card className="p-5">
            <div className="font-semibold">Porosi për të marrë</div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {takeaway.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => navigate(`/tavolinat/merr?order=${o.id}`)} className="rounded-ctl border border-line px-4 py-2.5 text-left hover:border-brand-600">
                    <div className="font-semibold">#{o.order_no}</div>
                    <div className="text-sm text-muted tabular-nums">
                      {formatEUR(o.total)} · {since(o.opened_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}

function TableTile({ t, order, onClick, style, className }: { t: Draft; order?: OpenOrderSummary; onClick: () => void; style?: React.CSSProperties; className?: string }) {
  const busy = Boolean(order)
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={cn(
        'relative flex flex-col items-center justify-center gap-0.5 border-2 p-2 text-center transition-colors',
        t.shape === 'round' ? 'rounded-full' : 'rounded-card',
        busy ? 'border-brand-600 bg-brand-100' : 'border-line bg-[#FAFBFA] hover:border-brand-600',
        className,
      )}
    >
      <span className="text-[20px] font-bold leading-none">{t.name}</span>
      {order ? (
        <>
          <span className="text-sm font-semibold tabular-nums text-brand-900">{formatEUR(order.total)}</span>
          <span className="text-xs text-muted">{since(order.opened_at)}</span>
        </>
      ) : (
        <span className="text-xs text-muted">{t.seats} vende</span>
      )}
      {order && order.ready > 0 && (
        <Badge tone="info" className="absolute -top-2 right-1">
          Gati
        </Badge>
      )}
      {order && order.unsent > 0 && <span className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-700" title="Ka artikuj të padërguar" />}
    </button>
  )
}

function PlanEditor({
  tables,
  setTables,
  area,
  areas,
  onArea,
  onCancel,
  onSaved,
}: {
  tables: Draft[]
  setTables: (t: Draft[]) => void
  area: string
  areas: string[]
  onArea: (a: string) => void
  onCancel: () => void
  onSaved: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [newArea, setNewArea] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => saveTables(tables.map(({ key: _k, ...t }) => t)),
    onSuccess: onSaved,
  })
  const inArea = tables.filter((t) => t.area === area)
  const at = (x: number, y: number) => inArea.find((t) => t.x === x && t.y === y)
  const sel = tables.find((t) => t.key === selected) ?? null
  const patch = (key: string, p: Partial<Draft>) => setTables(tables.map((t) => (t.key === key ? { ...t, ...p } : t)))

  const add = (x?: number, y?: number) => {
    let cx = x
    let cy = y
    if (cx === undefined || cy === undefined) {
      outer: for (let yy = 0; yy < ROWS; yy++)
        for (let xx = 0; xx < COLS; xx++)
          if (!at(xx, yy)) {
            cx = xx
            cy = yy
            break outer
          }
    }
    const names = tables.map((t) => Number(t.name)).filter(Number.isFinite)
    const key = crypto.randomUUID()
    setTables([...tables, { key, name: String((names.length ? Math.max(...names) : 0) + 1), area, seats: 4, shape: 'square', x: cx ?? 0, y: cy ?? 0 }])
    setSelected(key)
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm text-muted">Tërhiqe tavolinën në vendin e saj, ose kliko një katror bosh për të shtuar. Kliko tavolinën për emrin, vendet dhe formën.</p>
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] gap-2" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridAutoRows: '84px' }}>
          {Array.from({ length: ROWS * COLS }, (_, i) => {
            const x = i % COLS
            const y = Math.floor(i / COLS)
            const t = at(x, y)
            return (
              <div
                key={i}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragKey && !t) patch(dragKey, { x, y })
                  setDragKey(null)
                }}
                className="rounded-xl border border-dashed border-field"
              >
                {t ? (
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragKey(t.key)}
                    onClick={() => setSelected(t.key)}
                    className={cn(
                      'flex h-full w-full flex-col items-center justify-center border-2 bg-white font-bold',
                      t.shape === 'round' ? 'rounded-full' : 'rounded-xl',
                      selected === t.key ? 'border-brand-600' : 'border-ink/30',
                    )}
                  >
                    {t.name}
                    <span className="text-xs font-normal text-muted">{t.seats} vende</span>
                  </button>
                ) : (
                  <button type="button" aria-label="Shto tavolinë këtu" onClick={() => add(x, y)} className="h-full w-full rounded-xl text-transparent hover:bg-brand-100 hover:text-brand-600">
                    <Plus className="mx-auto h-5 w-5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => add()}>
          <Plus className="h-4 w-4" /> Tavolinë
        </Button>
        <Button variant="secondary" onClick={() => setNewArea('')}>
          <Plus className="h-4 w-4" /> Zonë (p.sh. Terasa)
        </Button>
        {save.error && <span className="text-sm text-warn-700">{(save.error as Error).message}</span>}
        <span className="ml-auto" />
        <Button variant="ghost" onClick={onCancel}>
          Anulo
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Ruaj planin
        </Button>
      </div>

      <Dialog open={Boolean(sel)} onClose={() => setSelected(null)} title={`Tavolina ${sel?.name ?? ''}`} width="md:max-w-[420px]">
        {sel && (
          <div className="flex flex-col gap-3">
            <Input label="Emri / numri" value={sel.name} maxLength={20} onChange={(e) => patch(sel.key, { name: e.target.value })} />
            <Input label="Vende" type="number" min={1} max={40} value={String(sel.seats)} onChange={(e) => patch(sel.key, { seats: Math.min(40, Math.max(1, Number(e.target.value) || 1)) })} />
            <Select
              label="Forma"
              value={sel.shape}
              onChange={(e) => patch(sel.key, { shape: e.target.value as TableShape })}
              options={[
                { value: 'square', label: 'Katrore' },
                { value: 'round', label: 'E rrumbullakët' },
                { value: 'long', label: 'E gjatë' },
              ]}
            />
            <Select label="Zona" value={sel.area} onChange={(e) => patch(sel.key, { area: e.target.value })} options={areas.map((a) => ({ value: a, label: a }))} />
            <div className="mt-2 flex justify-between gap-2">
              <Button
                variant="ghost"
                className="text-warn-700"
                onClick={() => {
                  setTables(tables.filter((t) => t.key !== sel.key))
                  setSelected(null)
                }}
              >
                <Trash2 className="h-4 w-4" /> Hiqe
              </Button>
              <Button onClick={() => setSelected(null)}>Gati</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={newArea !== null} onClose={() => setNewArea(null)} title="Zonë e re" width="md:max-w-[380px]">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const a = (newArea ?? '').trim()
            if (!a) return
            const key = crypto.randomUUID()
            setTables([...tables, { key, name: 'T1', area: a, seats: 4, shape: 'square', x: 0, y: 0 }])
            onArea(a)
            setNewArea(null)
          }}
        >
          <Input label="Emri i zonës" autoFocus value={newArea ?? ''} onChange={(e) => setNewArea(e.target.value)} placeholder="p.sh. Terasa, Kati 1" />
          <Button type="submit">Shto</Button>
        </form>
      </Dialog>
    </Card>
  )
}
