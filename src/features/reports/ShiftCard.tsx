import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, LogIn, LogOut } from 'lucide-react'
import { Button, Dialog, Input } from '@/components/ui'
import { formatEUR } from '@/lib/money'
import { endShift, fetchOpenShift, formatMinutes, ReportsNotMigrated, startShift } from './api'

const timeFmt = new Intl.DateTimeFormat('sq-AL', { hour: '2-digit', minute: '2-digit' })

/** Clock in / out for the signed-in person (worker panel and "Puna ime"). */
export function ShiftCard() {
  const qc = useQueryClient()
  const shift = useQuery({ queryKey: ['shift', 'mine'], queryFn: fetchOpenShift, refetchInterval: 60_000 })
  const [dialog, setDialog] = useState<'start' | 'end' | null>(null)
  const [cash, setCash] = useState('')
  const [error, setError] = useState<string | null>(null)

  const done = () => {
    setDialog(null)
    setCash('')
    setError(null)
    void qc.invalidateQueries({ queryKey: ['shift'] })
    void qc.invalidateQueries({ queryKey: ['work'] })
  }
  const start = useMutation({ mutationFn: () => startShift(Number(cash.replace(',', '.')) || 0), onSuccess: done, onError: (e: Error) => setError(e.message) })
  const end = useMutation({ mutationFn: () => endShift(cash.trim() ? Number(cash.replace(',', '.')) : null), onSuccess: done, onError: (e: Error) => setError(e.message) })

  if (shift.error instanceof ReportsNotMigrated) return null
  const open = shift.data
  const minutes = open ? (Date.now() - new Date(open.started_at).getTime()) / 60000 : 0

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
            <Clock className="h-5 w-5" />
          </span>
          <div>
            <div className="font-semibold">{open ? `Ndërrimi nga ${timeFmt.format(new Date(open.started_at))}` : 'Ndërrimi nuk ka filluar'}</div>
            <div className="text-sm text-muted">
              {open ? `${formatMinutes(minutes)} · kusur në fillim ${formatEUR(open.opening_cash)}` : 'Shëno hyrjen kur fillon punën'}
            </div>
          </div>
        </div>
        {open ? (
          <Button variant="secondary" onClick={() => setDialog('end')}>
            <LogOut className="h-4 w-4" /> Mbyll ndërrimin
          </Button>
        ) : (
          <Button onClick={() => setDialog('start')} disabled={shift.isLoading}>
            <LogIn className="h-4 w-4" /> Fillo ndërrimin
          </Button>
        )}
      </div>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'start' ? 'Fillo ndërrimin' : 'Mbyll ndërrimin'}
        width="md:max-w-[420px]"
        footer={
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Anulo
            </Button>
            <Button loading={start.isPending || end.isPending} onClick={() => (dialog === 'start' ? start.mutate() : end.mutate())}>
              {dialog === 'start' ? 'Fillo' : 'Mbyll'}
            </Button>
          </div>
        }
      >
        <Input
          label={dialog === 'start' ? 'Kusuri në arkë (€)' : 'Keshi në arkë në mbyllje (€) – opsionale'}
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          autoFocus
          value={cash}
          onChange={(e) => setCash(e.target.value)}
          placeholder="0.00"
        />
        {error && <p className="mt-3 text-sm text-warn-700">{error}</p>}
      </Dialog>
    </>
  )
}
