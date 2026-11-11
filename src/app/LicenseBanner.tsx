import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from './AuthProvider'

const day = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')

/** Strip above the screens when the license is about to expire, in grace, or expired (SEF, 0029). */
export function LicenseBanner() {
  const { ctx } = useAuth()
  const l = ctx?.business?.license
  if (!l || !['expiring', 'grace', 'expired'].includes(l.state)) return null
  const owner = ctx?.profile?.role === 'admin'
  const text =
    l.state === 'expiring'
      ? `Abonimi skadon më ${day(l.expires_on)}${l.days_left != null ? ` (pas ${l.days_left} ditësh)` : ''}.`
      : l.state === 'grace'
        ? `Abonimi ka skaduar. Kasa punon normalisht deri më ${day(l.grace_until)}; pastaj ndalen shitjet e reja.`
        : 'Abonimi ka skaduar: shitjet e reja janë ndalur. Raportet dhe të dhënat shihen normalisht.'
  return (
    <div className={l.state === 'expiring' ? 'bg-amber-100 text-amber-700' : 'bg-warn-100 text-warn-700'}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm md:px-8">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">{text}</span>
        {owner ? (
          <Link to="/llogaria" className="font-semibold underline">
            Paguaj abonimin
          </Link>
        ) : (
          <span className="font-semibold">Njofto pronarin.</span>
        )}
      </div>
    </div>
  )
}
