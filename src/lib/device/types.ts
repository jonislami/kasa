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
  /** Opens the system picker and connects (Bluetooth). Returns the device name. */
  connect(): Promise<string>
  /** USB / serial thermal printer (Web Serial – Chrome/Edge on a computer, Windows app). */
  connectSerial?(): Promise<string>
  /**
   * Printers already paired with the phone over classic Bluetooth (SPP – most 58/80 mm printers), Android app only.
   * `printer` is a hint from the device class; the list is shown with the likely printers first.
   */
  paired?(): Promise<{ id: string; name: string; printer: boolean }[]>
  /** Connects to one of `paired()`. Returns the device name. */
  connectTo?(id: string): Promise<string>
  /** Opens the phone's Bluetooth settings to pair a new printer. */
  openBluetoothSettings?(): Promise<void>
  /** Reconnects to the last used printer without the picker, if possible. */
  reconnect(): Promise<string | null>
  isConnected(): boolean
  write(bytes: Uint8Array, chunkSize?: number): Promise<void>
  disconnect(): Promise<void>
}

/** Bluetooth/USB device list shown by the app when the platform has no system picker (Windows app). */
export interface DeviceChooser {
  subscribe(cb: (list: { kind: 'bluetooth' | 'serial'; devices: { id: string; name: string }[] }) => void): () => void
  select(kind: 'bluetooth' | 'serial', id: string | null): void
}

/**
 * Updates of an installed app from GitHub Releases. The web version uses the service worker.
 *  - Windows: downloaded in the background, installed on "Instalo" or when the program closes (mode 'install')
 *  - Android (APK outside Play Store): the app finds the newer APK and opens its download (mode 'download')
 */
export interface AppUpdates {
  subscribe(cb: (info: { state: 'ready'; version: string; mode?: 'install' | 'download' }) => void): () => void
  install(): void
}

/** Windows app: printers installed in Windows, printed to without the print dialog. */
export interface SystemPrint {
  list(): Promise<{ name: string; displayName: string; isDefault: boolean }[]>
  /** Prints the page as rendered for print (the receipt) on that printer (default printer when empty). */
  print(deviceName?: string): Promise<void>
  /** ESC/POS bytes straight to that printer (RAW, without its driver); refused when Windows marks it offline. */
  printRaw?(deviceName: string, data: Uint8Array): Promise<void>
  /** Removes the waiting jobs of that printer (a stuck job would print later). */
  clearQueue?(deviceName: string): Promise<void>
}

export interface DeviceAdapter {
  platform: DevicePlatform
  systemPrint?: SystemPrint
  deviceChooser?: DeviceChooser
  appUpdates?: AppUpdates
  /** Stable ID for this installation (links the device to a register and ATK POS ID). */
  getDeviceId(): Promise<string>
  /** App version from package.json – shown in settings and sent with every fiscal coupon. */
  appVersion: string
  keys: KeyStore
  storage: SecureStore
  printer: PrinterTransport
}
