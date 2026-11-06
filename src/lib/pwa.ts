import { useSyncExternalStore } from 'react'

/**
 * "Install the app" support for the web/PWA version.
 * Chrome/Edge/Android fire `beforeinstallprompt`; iPhone/iPad need Share → "Add to Home Screen".
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export type InstallState = 'installed' | 'available' | 'ios' | 'unavailable'

function current(): InstallState {
  if (installed || isStandalone()) return 'installed'
  if (deferred) return 'available'
  if (isIOS()) return 'ios'
  return 'unavailable'
}

let snapshot: InstallState = typeof window === 'undefined' ? 'unavailable' : current()
listeners.add(() => {
  snapshot = current()
})

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}

/** Opens the browser's install dialog. Returns true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  emit()
  return outcome === 'accepted'
}
