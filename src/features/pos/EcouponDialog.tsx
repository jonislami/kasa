import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
import { Button, Dialog, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'

/** Sends the fiscal coupon to the buyer by e-mail (Edge Function send-ecoupon); the buyer's consent is required (ATK). */
async function sendEcoupon(saleId: string, email: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-ecoupon', { body: { sale_id: saleId, email, consent: true } })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const b = (await ctx.json()) as { error?: string }
        if (b?.error) msg = b.error
      } catch {
        /* keep the message */
      }
    }
    if (/Failed to send|not found|404/i.test(msg)) msg = 'Shërbimi i e-kuponit (send-ecoupon) nuk është vendosur ende në Supabase.'
    throw new Error(msg)
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
}

export function EcouponButton({ saleId, disabled }: { saleId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" size="lg" disabled={disabled} onClick={() => setOpen(true)} title="Dërgo kuponin fiskal me email (me pëlqimin e blerësit)">
        <Mail className="h-4 w-4" /> e-kupon
      </Button>
      <EcouponDialog saleId={open ? saleId : null} onClose={() => setOpen(false)} />
    </>
  )
}

function EcouponDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!saleId) return
    setEmail('')
    setConsent(false)
    setDone(false)
  }, [saleId])
  const send = useMutation({ mutationFn: () => sendEcoupon(saleId!, email.trim()), onSuccess: () => setDone(true) })
  const valid = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim())
  return (
    <Dialog
      open={Boolean(saleId)}
      onClose={onClose}
      title="Dërgo e-kupon"
      width="md:max-w-[460px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {done ? 'Mbyll' : 'Anulo'}
          </Button>
          {!done && (
            <Button disabled={!valid || !consent} loading={send.isPending} onClick={() => send.mutate()}>
              <Mail className="h-4 w-4" /> Dërgo
            </Button>
          )}
        </div>
      }
    >
      {done ? (
        <p className="rounded-ctl bg-brand-100 px-4 py-3 text-[15px] text-brand-600">Kuponi fiskal u dërgua te {email.trim()}.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Kuponi fiskal dërgohet me të gjitha të dhënat, kodin QR dhe shënimin "e-kuponi".</p>
          <Input label="Email-i i blerësit" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Blerësi pajtohet ta marrë kuponin fiskal në formë elektronike.
          </label>
          {send.error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{(send.error as Error).message}</p>}
        </div>
      )}
    </Dialog>
  )
}
