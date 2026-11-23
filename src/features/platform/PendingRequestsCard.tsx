import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, Eye, Receipt, X } from 'lucide-react'
import { Badge, Button, Card, Dialog, Input } from '@/components/ui'
import { formatKosovoDateTime } from '@/lib/clock'
import { decideUnit, documentUrl } from '@/features/onboarding/applicationApi'
import { decideVat, fetchPendingRequests, type PendingVat } from '@/features/onboarding/profileRequests'

const day = (d: string) => d.slice(0, 10).split('-').reverse().join('.')

/**
 * Requests of businesses that are already active (0049): a new unit, and the move into VAT. A unit approved here gets
 * its tills at once; the business becomes "Me TVSH" only when the VAT request is approved.
 */
export function PendingRequestsCard() {
  const qc = useQueryClient()
  const req = useQuery({ queryKey: ['platform-pending-requests'], queryFn: fetchPendingRequests, refetchInterval: 60_000 })
  const [reject, setReject] = useState<PendingVat | null>(null)
  const [note, setNote] = useState('')
  const [docError, setDocError] = useState<string | null>(null)
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['platform-pending-requests'] })
    void qc.invalidateQueries({ queryKey: ['platform-onboarding'] })
    void qc.invalidateQueries({ queryKey: ['platform-businesses'] })
  }
  const unit = useMutation({ mutationFn: (p: { id: string; status: 'approved' | 'rejected' }) => decideUnit(p.id, p.status), onSuccess: done })
  const vat = useMutation({
    mutationFn: (p: { id: string; action: 'approve' | 'reject'; note?: string }) => decideVat(p.id, p.action, p.note),
    onSuccess: () => {
      setReject(null)
      setNote('')
      done()
    },
  })
  const units = req.data?.units ?? []
  const vats = req.data?.vat ?? []
  if (req.isLoading || (units.length === 0 && vats.length === 0 && !req.error)) return null

  const openDoc = async (path: string) => {
    setDocError(null)
    const w = window.open('', '_blank')
    try {
      const url = await documentUrl(path)
      if (w) w.location.href = url
    } catch (e) {
      w?.close()
      setDocError((e as Error).message)
    }
  }

  return (
    <Card className="mb-4 overflow-hidden border-amber-700/30">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 className="font-semibold">Kërkesat e bizneseve aktive</h2>
        <Badge tone="amber">{units.length + vats.length}</Badge>
      </div>
      {req.error && <p className="p-5 text-sm text-warn-700">{(req.error as Error).message}</p>}
      <ul className="divide-y divide-line">
        {vats.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <Receipt className="h-5 w-5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                Kalim në TVSH ·{' '}
                <Link to={`/platforma/biznes/${r.business_id}`} className="hover:underline">
                  {r.business}
                </Link>
              </div>
              <div className="text-xs text-muted">
                {[r.nui && `NUI ${r.nui}`, `Nr. TVSH ${r.vat_number}`, `nga ${day(r.vat_date)}`, `dërguar ${formatKosovoDateTime(r.created_at)}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            {r.document ? (
              <Button size="sm" variant="secondary" onClick={() => void openDoc(r.document!.path)}>
                <Eye className="h-4 w-4" /> Dokumenti
              </Button>
            ) : (
              <Badge tone="warn">Pa dokument</Badge>
            )}
            <Button size="sm" variant="danger" disabled={vat.isPending} onClick={() => setReject(r)}>
              <X className="h-4 w-4" /> Refuzo
            </Button>
            <Button size="sm" loading={vat.isPending && vat.variables?.id === r.id && vat.variables.action === 'approve'} onClick={() => vat.mutate({ id: r.id, action: 'approve' })}>
              <Check className="h-4 w-4" /> Mirato
            </Button>
          </li>
        ))}
        {units.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <Building2 className="h-5 w-5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                Njësi e re · {u.name} ·{' '}
                <Link to={`/platforma/biznes/${u.business_id}`} className="hover:underline">
                  {u.business}
                </Link>
              </div>
              <div className="text-xs text-muted">
                {[u.address, u.city, u.country, u.unit_no && `nr. ${u.unit_no}`, `${u.registers} ${u.registers === 1 ? 'arkë' : 'arka'}`, u.activities.join(', '), formatKosovoDateTime(u.created_at)]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <Button size="sm" variant="danger" disabled={unit.isPending} onClick={() => unit.mutate({ id: u.id, status: 'rejected' })}>
              <X className="h-4 w-4" /> Refuzo
            </Button>
            <Button size="sm" loading={unit.isPending && unit.variables?.id === u.id && unit.variables.status === 'approved'} onClick={() => unit.mutate({ id: u.id, status: 'approved' })}>
              <Check className="h-4 w-4" /> Mirato
            </Button>
          </li>
        ))}
      </ul>
      {(unit.error || vat.error || docError) && <p className="px-5 pb-4 text-sm text-warn-700">{docError ?? ((unit.error ?? vat.error) as Error).message}</p>}

      <Dialog
        open={Boolean(reject)}
        onClose={() => !vat.isPending && setReject(null)}
        title="Refuzo kalimin në TVSH"
        subtitle={reject ? `${reject.business} · Nr. TVSH ${reject.vat_number}` : undefined}
        width="md:max-w-[460px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={vat.isPending} onClick={() => setReject(null)}>
              Anulo
            </Button>
            <Button variant="danger" loading={vat.isPending} disabled={!note.trim()} onClick={() => reject && vat.mutate({ id: reject.id, action: 'reject', note })}>
              Refuzo
            </Button>
          </div>
        }
      >
        <Input label="Arsyeja (e sheh klienti)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="p.sh. Dokumenti nuk lexohet / numri nuk përputhet" autoFocus />
      </Dialog>
    </Card>
  )
}
