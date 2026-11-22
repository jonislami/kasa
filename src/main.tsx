import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { CACHE_MAX_AGE, persister, shouldPersist } from '@/lib/queryPersist'
import { device } from '@/lib/device'
import { AuthProvider } from '@/app/AuthProvider'
import { AppRoutes } from '@/app/routes'
import { DeviceChooserDialog, UpdatePrompt } from '@/app/AppStatus'
import { startScreenTranslation } from '@/lib/i18nDom'
import { applyTextSize } from '@/lib/textSize'
import '@fontsource/lato/400.css'
import '@fontsource/lato/400-italic.css'
import '@fontsource/lato/700.css'
import './index.css'

const queryClient = new QueryClient({
  // Without internet, screens show the last data kept on the device (queries pause instead of failing).
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: CACHE_MAX_AGE, retry: 1, refetchOnWindowFocus: false },
    mutations: { networkMode: 'always' },
  },
})

// Serbian on screen for the SEF program (the language is chosen on the device, Printeri → Gjuha / Jezik)
applyTextSize()
startScreenTranslation()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE, buster: device.appVersion, dehydrateOptions: { shouldDehydrateQuery: shouldPersist } }}
    >
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <UpdatePrompt />
          <DeviceChooserDialog />
        </AuthProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
)
