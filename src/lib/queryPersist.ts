import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { Query } from '@tanstack/react-query'
import { device } from '@/lib/device'

/**
 * The last data of every screen (products, stock, reports…) is kept on the device, encrypted
 * (device.storage = AES-GCM with a non-extractable key), so the app shows it without internet.
 * Editing still needs the server; only sales are queued offline.
 */
const KEY = 'query-cache'
const OWNER_KEY = 'kasa.cacheOwner'

export const persister = createAsyncStoragePersister({
  key: KEY,
  throttleTime: 2000,
  storage: {
    getItem: async (k) => {
      try {
        return (await device.storage.get<string>(k)) ?? null
      } catch {
        return null
      }
    },
    setItem: async (k, v) => {
      try {
        await device.storage.set(k, v)
      } catch {
        /* storage full / unavailable – the app still works online */
      }
    },
    removeItem: async (k) => {
      try {
        await device.storage.remove(k)
      } catch {
        /* ignore */
      }
    },
  },
})

export const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000

/** Only finished, successful reads are stored – never a half-loaded or failed one. */
export function shouldPersist(q: Query): boolean {
  return q.state.status === 'success' && q.state.data !== undefined
}

/** The cache belongs to one signed-in person; another person on the same device starts clean. */
export function cacheOwnerChanged(userId: string): boolean {
  try {
    const prev = localStorage.getItem(OWNER_KEY)
    localStorage.setItem(OWNER_KEY, userId)
    return prev !== null && prev !== userId
  } catch {
    return false
  }
}

export async function forgetCache(): Promise<void> {
  try {
    localStorage.removeItem(OWNER_KEY)
  } catch {
    /* ignore */
  }
  await persister.removeClient()
}
