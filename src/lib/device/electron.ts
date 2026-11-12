import type { AppUpdates, DeviceAdapter, DeviceChooser, KeyStore } from './types'
import { createSecureStore, getDeviceId, keys as webKeys, printer } from './web'

/**
 * Windows app (Electron). Same Chromium as the web version, plus:
 *  - the key that seals local data (offline coupons, cache) is wrapped with Windows DPAPI
 *    (Electron safeStorage) – it cannot be read from another Windows account or machine
 *  - Bluetooth / USB device lists come from the main process (no system picker in Electron)
 *  - updates come from GitHub Releases
 *  - the ATK signing key is created and kept in the main process, sealed with DPAPI; the page only
 *    receives the public key and signatures (electron/main.cts, kasa:key-*)
 */
interface Bridge {
  onDeviceList: DeviceChooser['subscribe']
  selectDevice: DeviceChooser['select']
  safeEncrypt(text: string): Promise<string | null>
  safeDecrypt(b64: string): Promise<string | null>
  onUpdate: AppUpdates['subscribe']
  installUpdate(): void
  keyEnsure?(alias: string): Promise<string>
  keyHas?(alias: string): Promise<boolean>
  keyPublic?(alias: string): Promise<string | null>
  keySign?(alias: string, dataB64: string): Promise<string>
  keyDelete?(alias: string): Promise<void>
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

/** DPAPI key store in the main process; an older main process without it falls back to WebCrypto. */
const dpapiKeys: KeyStore | null = bridge.keySign
  ? {
      ensureKey: (alias) => bridge.keyEnsure!(alias),
      hasKey: (alias) => bridge.keyHas!(alias),
      getPublicKey: (alias) => bridge.keyPublic!(alias),
      sign: (alias, data) => bridge.keySign!(alias, b64(data)),
      deleteKey: (alias) => bridge.keyDelete!(alias),
    }
  : null

export const electronDevice: DeviceAdapter = {
  platform: 'electron',
  appVersion: __APP_VERSION__,
  getDeviceId,
  keys: dpapiKeys ?? webKeys,
  storage: createSecureStore(storageKey),
  printer,
  deviceChooser: { subscribe: (cb) => bridge.onDeviceList(cb), select: (kind, id) => bridge.selectDevice(kind, id) },
  appUpdates: { subscribe: (cb) => bridge.onUpdate(cb), install: () => bridge.installUpdate() },
}
