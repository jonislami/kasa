import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Hammer, KeyRound } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, EmptyState, Input } from '@/components/ui'
import { isManagerRole } from '@/lib/business'
import { myPinStatus, setOwnPin } from '@/features/pos/api'

/** Phase 3: only "My PIN" (needed for approvals). The full settings screen comes in phase 6. */
export function SettingsPage() {
  const { profile } = useBusiness()
  const manager = isManagerRole(profile.role)
  return (
    <>
      <PageHeader title={manager ? 'Cilësimet' : 'Printeri'} />
      <div className="flex max-w-[720px] flex-col gap-4 px-4 py-5 md:px-8 md:py-0">
        {manager && <PinCard />}
        <Card>
          <EmptyState icon={<Hammer className="h-6 w-6" />} title="Cilësimet e tjera po ndërtohen" text="Të dhënat e biznesit, arkat, përdoruesit dhe printeri vijnë në Fazën 6." />
        </Card>
      </div>
    </>
  )
}

function PinCard() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['my-pin'], queryFn: myPinStatus, retry: false })
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const save = async () => {
    if (!/^\d{4}$/.test(pin)) return setMsg({ ok: false, text: 'PIN-i duhet të ketë 4 shifra' })
    if (pin !== pin2) return setMsg({ ok: false, text: 'PIN-et nuk përputhen' })
    setBusy(true)
    setMsg(null)
    try {
      await setOwnPin(pin)
      setPin('')
      setPin2('')
      setMsg({ ok: true, text: 'PIN-i u ruajt' })
      void qc.invalidateQueries({ queryKey: ['my-pin'] })
      void qc.invalidateQueries({ queryKey: ['approvers'] })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold">PIN-i im</h2>
            <p className="text-sm text-muted">Me të miraton anulimet dhe kthimet që kërkojnë punëtorët.</p>
          </div>
        </div>
        {status.data !== undefined && <Badge tone={status.data ? 'success' : 'amber'}>{status.data ? 'I vendosur' : 'Pa PIN'}</Badge>}
      </div>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Input label={status.data ? 'PIN i ri' : 'PIN (4 shifra)'} type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <Input label="Përsërite" type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
        <Button type="submit" className="h-[46px]" loading={busy}>
          Ruaj PIN-in
        </Button>
      </form>
      {msg && <p className={`mt-3 rounded-ctl px-4 py-2.5 text-sm ${msg.ok ? 'bg-brand-100 text-brand-600' : 'bg-warn-100 text-warn-700'}`}>{msg.text}</p>}
    </Card>
  )
}
