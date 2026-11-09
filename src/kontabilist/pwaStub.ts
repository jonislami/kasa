// The accountant program is not a PWA: Kasa's shared layout imports the service-worker hook,
// which resolves to this no-op in the Kasa Kontabilist build (vite.kontabilist.config.ts).
import { useState } from 'react'

export function useRegisterSW(_options?: unknown) {
  const needRefresh = useState(false)
  const offlineReady = useState(false)
  return { needRefresh, offlineReady, updateServiceWorker: async () => undefined }
}
