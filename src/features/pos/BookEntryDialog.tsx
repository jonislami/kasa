import { useEffect, useState } from 'react'
import { Button, Dialog, Input } from '@/components/ui'
import { serverDate } from '@/lib/clock'

export interface BookEntry {
  /** Serial number printed on the coupon of the separate book. */
  serial: string
  /** When it was written (ISO). */
  at: string
}

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

/**
 * ATK, Udhëzimi Administrativ 01/2026 neni 45: when the device stops completely, coupons are written from a
 * separate coupon book (serial number on each, two copies). Within 48 hours the device works again and within
 * 5 more days every coupon of the book is registered in the SEF, which sends it to ATK. Here the owner / manager
 * enters one such coupon: serial number and the time on paper; the items are added in the till as usual.
 */
export function BookEntryDialog({ open, onClose, onSet }: { open: boolean; onClose: () => void; onSet: (b: BookEntry) => void }) {
  const [serial, setSerial] = useState('')
  const [at, setAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setSerial('')
    setAt(local(serverDate()))
    setError(null)
  }, [open])

  const submit = () => {
    const t = new Date(at)
    const now = serverDate().getTime()
    if (!serial.trim()) return setError('Shkruaj numrin serik të kuponit nga blloku')
    if (Number.isNaN(t.getTime())) return setError('Shkruaj datën dhe orën')
    if (t.getTime() > now + 60_000) return setError('Data nuk mund të jetë në të ardhmen')
    if (now - t.getTime() > 8 * 86_400_000) return setError('Kuponët e bllokut regjistrohen brenda 48 orëve + 5 ditëve (UA neni 45). Për më të vjetër njofto ATK-në.')
    onSet({ serial: serial.trim(), at: t.toISOString() })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Kupon nga blloku i veçantë"
      width="md:max-w-[480px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button onClick={submit}>Vazhdo</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Për kuponët e shkruar me dorë nga blloku i veçantë kur pajisja ishte prishur plotësisht. Shkruaj numrin serik dhe kohën nga kuponi në letër, pastaj shto artikujt dhe pagesën si zakonisht – kuponi nënshkruhet dhe dërgohet në ATK me këtë kohë.
        </p>
        <Input label="Numri serik i kuponit në bllok" value={serial} onChange={(e) => setSerial(e.target.value)} autoFocus />
        <Input label="Data dhe ora në kupon" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        {error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{error}</p>}
      </div>
    </Dialog>
  )
}
