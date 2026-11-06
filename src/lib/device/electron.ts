import type { AppUpdates, DeviceAdapter, DeviceChooser } from './types'
import { createSecureStore, getDeviceId, keys, printer } from './web'

/**
 * Windows app (Electron). Same Chromium as the web version, plus:
 *  - the key that seals local data (offline coupons, cache) is wrapped with Windows DPAPI
 *    (Electron safeStorage) – it cannot be read from another Windows account or machine
 *  - Bluetooth / USB device lists come from the main process (no system picker in Electron)
 *  - updates come from GitHub Releases
 * The ATK signing key stays a non-extractable WebCrypto key (same as web); phase 9 may move it
 * behind DPAPI as well.
 */
interface Bridge {
  onDeviceList: DeviceChooser['subscribe']
  selectDevice: DeviceChooser['select']
  safeEncrypt(text: string): Promise<string | null>
  safeDecrypt(b64: string): Promise<string | null>
  onUpdate: AppUpdates['subscribe']
  installUpdate(): void
}

const bridge = (window as unknown as { kasaElectron: Bridge }).kasaElectron
const WRAPPED_KEY = 'kasa.dpapiStorageKey'

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

let keyPromise: Promise<CryptoKey> | null = null

/** AES-256 key: random once, stored only encrypted by DPAPI, imported as non-extractable. */
function storageKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      let raw: Uint8Array | null = null
      const wrapped = localStorage.getItem(WRAPPED_KEY)
      if (wrapped) {
        const plain = await bridge.safeDecrypt(wrapped)
        if (plain) raw = unb64(plain)
      }
      if (!raw) {
        raw = crypto.getRandomValues(new Uint8Array(32))
        const sealed = await bridge.safeEncrypt(b64(raw))
        if (!sealed) throw new Error('Windows nuk lejon ruajtjen e sigurt (DPAPI)')
        localStorage.setItem(WRAPPED_KEY, sealed)
      }
      return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    })()
  }
  return keyPromise
}

export const electronDevice: DeviceAdapter = {
  platform: 'electron',
  appVersion: __APP_VERSION__,
  getDeviceId,
  keys,
  storage: createSecureStore(storageKey),
  printer,
  deviceChooser: { subscribe: (cb) => bridge.onDeviceList(cb), select: (kind, id) => bridge.selectDevice(kind, id) },
  appUpdates: { subscribe: (cb) => bridge.onUpdate(cb), install: () => bridge.installUpdate() },
}
