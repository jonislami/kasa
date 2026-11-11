import type { DeviceAdapter, DevicePlatform } from './types'
import { webDevice } from './web'
import { electronDevice } from './electron'
import { capacitorDevice } from './capacitor'

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
    case 'electron':
      return electronDevice // DPAPI-sealed storage, Bluetooth/USB chooser, GitHub updates
    case 'capacitor':
      return capacitorDevice // native BLE printing (Android, iPhone)
    default:
      return webDevice
  }
}

export const device: DeviceAdapter = pick()

/**
 * The installed app (Windows, Android, iPhone) is the SEF till: activated with a key from the platform admin,
 * workers sign in with PIN, and it only sells and prints. Products, stock, PINs and reports stay in the web app.
 * In development the browser can act as the installed app: localStorage 'kasa.sefMode' = '1'.
 */
export const isSefApp: boolean =
  detectPlatform() !== 'web' || (import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('kasa.sefMode') === '1')
