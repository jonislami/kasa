import { WifiOff } from 'lucide-react'
import { isAppOnline } from '@/lib/connectivity'
import { EmptyState } from './Card'

interface QueryLike {
  data: unknown
  isError: boolean
  error: unknown
  fetchStatus: 'fetching' | 'paused' | 'idle'
}

function networkError(e: unknown): boolean {
  if (e instanceof TypeError) return true
  return /fetch|network|load failed|timeout|ERR_INTERNET|internet/i.test(String((e as { message?: string })?.message ?? ''))
}

/**
 * What a screen should show for a query:
 *   ready   – there is data (fresh or the last copy kept on the device): show it, even offline
 *   offline – no data on this device yet and no internet
 *   error   – a real error from the server
 *   loading – first load in progress
 */
export function loadState(q: QueryLike): 'ready' | 'offline' | 'error' | 'loading' {
  if (q.data !== undefined) return 'ready'
  if (q.isError) return networkError(q.error) || !isAppOnline() ? 'offline' : 'error'
  if (q.fetchStatus === 'paused' || !isAppOnline()) return 'offline'
  return 'loading'
}

export function OfflineEmpty() {
  return (
    <EmptyState
      icon={<WifiOff className="h-6 w-6" />}
      title="Pa internet"
      text="Kjo listë ende nuk është ruajtur në këtë pajisje. Hape një herë me internet – pastaj hapet edhe pa internet."
    />
  )
}
