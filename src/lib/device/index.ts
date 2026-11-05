import type { DeviceAdapter, DevicePlatform } from './types'
import { webDevice } from './web'

export type * from './types'

/** Detects where the app runs. The only place in the code that knows about Electron/Capacitor. */
export function detectPlatform(): DevicePlatform {
  const w = window as unknown as { kasaElectron?: unknown; Capacitor?: { isNativePlatform?: () => boolean } }
  if (w.kasaElectron) return 'electron'
  if (w.Capacitor?.isNativePlatform?.()) return 'capacitor'
  return 'web'
}

function pick(): DeviceAdapter {
  switch (detectPlatform()) {
    // electron: safeStorage/DPAPI + USB/Serial – phase 7b
    // capacitor: Keystore/Keychain + BLE plugin – phase 7b
    // Until then both fall back to the web implementation (WebCrypto + IndexedDB + Web Bluetooth).
    default:
      return webDevice
  }
}

export const device: DeviceAdapter = pick()
