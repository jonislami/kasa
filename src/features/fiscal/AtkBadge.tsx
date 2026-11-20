import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBusiness } from '@/app/AuthProvider'
import { cn } from '@/lib/cn'
import { cachedFiscalContext, fiscalQueueState, isFiscalHere, onFiscalQueueChange } from '@/lib/fiscal'
import { tillRegisterId } from './TillFiscalCard'

type AtkState = 'ok' | 'waiting' | 'failed' | 'off'

/**
 * The ATK sign in the header of the till (ATK asks for a visible sign of the connection with SIATK, not a clock):
 *  ATK ✓  green  – this till is registered at ATK and every coupon is confirmed
 *  ATK 3  amber  – 3 coupons signed here are still waiting to be sent (offline / no answer)
 *  ATK !  red    – ATK refused a coupon
 *  ATK –  grey   – this till is not registered at ATK on this device
 * Reads only what is on the device (no network), so it works offline; tapping it opens the till's fiscal card.
 */
export function AtkBadge({ dark }: { dark?: boolean }) {
  const { business } = useBusiness()
  const [state, setState] = useState<{ s: AtkState; waiting: number } | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const registerId = tillRegisterId(business.id)
        const here = registerId ? await isFiscalHere(await cachedFiscalContext(registerId)) : false
        const q = await fiscalQueueState()
        const s: AtkState = !here ? 'off' : q.failed > 0 ? 'failed' : q.waiting > 0 ? 'waiting' : 'ok'
        if (alive) setState({ s, waiting: q.waiting })
      } catch {
        if (alive) setState({ s: 'off', waiting: 0 })
      }
    }
    void load()
    const off = onFiscalQueueChange(() => void load())
    const t = setInterval(() => void load(), 30_000)
    window.addEventListener('online', load)
    window.addEventListener('offline', load)
    return () => {
      alive = false
      off()
      clearInterval(t)
      window.removeEventListener('online', load)
      window.removeEventListener('offline', load)
    }
  }, [business.id])

  if (!state) return null
  const { s, waiting } = state
  const label = s === 'ok' ? 'Lidhja me ATK aktive' : s === 'waiting' ? `${waiting} kuponë fiskalë në pritje për ATK` : s === 'failed' ? 'ATK refuzoi një kupon' : 'Arka nuk është regjistruar në ATK'
  return (
    <Link
      to="/cilesimet"
      title={label}
      aria-label={label}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[14px] font-semibold tabular-nums md:h-10 md:px-4 md:text-[15px]',
        s === 'ok' && (dark ? 'border-white/20 bg-white/10 text-white' : 'border-line bg-white text-ink'),
        s === 'waiting' && 'border-[#F5D98B] bg-amber-100 text-amber-700',
        s === 'failed' && 'border-[#F3C4BE] bg-warn-100 text-warn-700',
        s === 'off' && (dark ? 'border-white/15 text-white/55' : 'border-line text-muted'),
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', s === 'ok' ? 'bg-[#22C55E]' : s === 'waiting' ? 'bg-[#F59E0B]' : s === 'failed' ? 'bg-[#EF4444]' : 'bg-[#94A3B8]')} />
      ATK
      <span>{s === 'ok' ? '✓' : s === 'waiting' ? waiting : s === 'failed' ? '!' : '–'}</span>
    </Link>
  )
}
