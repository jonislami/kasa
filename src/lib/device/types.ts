/**
 * Everything that depends on the device goes through this interface.
 * Implementations: web (now), electron (Windows, phase 7b), capacitor (Android/iOS, phase 7b).
 * UI code never checks the platform itself – it uses `device` from `@/lib/device`.
 */

export type DevicePlatform = 'web' | 'electron' | 'capacitor'

/** ATK signing key: ECDSA P-256, generated on the device, never exported. */
export interface KeyStore {
  /** Creates the key pair if it does not exist yet; returns the public key (SPKI, base64). */
  ensureKey(alias: string): Promise<string>
  hasKey(alias: string): Promise<boolean>
  /** Public key as SPKI base64 (for the CSR / registration at ATK). */
  getPublicKey(alias: string): Promise<string | null>
  /** ECDSA P-256 / SHA-256 signature over `data`, returned as base64 (raw r||s). */
  sign(alias: string, data: Uint8Array): Promise<string>
  deleteKey(alias: string): Promise<void>
}

/** Encrypted local storage (offline coupons, queue). Values are JSON-serialisable. */
export interface SecureStore {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

export interface PrinterSupport {
  bluetooth: boolean
  usbSerial: boolean
  /** Shown to the user when Bluetooth is not available (e.g. iPhone Safari). */
  reason?: string
}

export interface PrinterTransport {
  support(): PrinterSupport
  /** Opens the system picker and connects. Returns the device name. */
  connect(): Promise<string>
  /** Reconnects to the last used printer without the picker, if possible. */
  reconnect(): Promise<string | null>
  isConnected(): boolean
  write(bytes: Uint8Array, chunkSize?: number): Promise<void>
  disconnect(): Promise<void>
}

export interface DeviceAdapter {
  platform: DevicePlatform
  /** Stable ID for this installation (links the device to a register and ATK POS ID). */
  getDeviceId(): Promise<string>
  /** App version from package.json – shown in settings and sent with every fiscal coupon. */
  appVersion: string
  keys: KeyStore
  storage: SecureStore
  printer: PrinterTransport
}
