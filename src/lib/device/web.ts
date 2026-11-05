import type { DeviceAdapter, KeyStore, PrinterTransport, SecureStore } from './types'
import { idb } from './idb'

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

// ---------------------------------------------------------------------------
// Device ID
// ---------------------------------------------------------------------------
async function getDeviceId(): Promise<string> {
  const existing = await idb.get<string>('meta', 'device-id')
  if (existing) return existing
  const id = crypto.randomUUID()
  await idb.set('meta', 'device-id', id)
  return id
}

// ---------------------------------------------------------------------------
// ATK key: WebCrypto ECDSA P-256, extractable = false, CryptoKey objects kept in IndexedDB
// ---------------------------------------------------------------------------
interface StoredPair {
  privateKey: CryptoKey
  publicKey: CryptoKey
}

const keyId = (alias: string) => `ecdsa:${alias}`

const keys: KeyStore = {
  async ensureKey(alias) {
    const existing = await idb.get<StoredPair>('keys', keyId(alias))
    if (existing) return toB64(await crypto.subtle.exportKey('spki', existing.publicKey))
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair
    await idb.set('keys', keyId(alias), { privateKey: pair.privateKey, publicKey: pair.publicKey } satisfies StoredPair)
    return toB64(await crypto.subtle.exportKey('spki', pair.publicKey))
  },
  async hasKey(alias) {
    return Boolean(await idb.get<StoredPair>('keys', keyId(alias)))
  },
  async getPublicKey(alias) {
    const pair = await idb.get<StoredPair>('keys', keyId(alias))
    return pair ? toB64(await crypto.subtle.exportKey('spki', pair.publicKey)) : null
  },
  async sign(alias, data) {
    const pair = await idb.get<StoredPair>('keys', keyId(alias))
    if (!pair) throw new Error('Çelësi i arkës nuk ekziston në këtë pajisje')
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data as BufferSource)
    return toB64(sig)
  },
  async deleteKey(alias) {
    await idb.del('keys', keyId(alias))
  },
}

// ---------------------------------------------------------------------------
// Secure storage: AES-GCM with a non-extractable key kept in IndexedDB
// ---------------------------------------------------------------------------
async function storageKey(): Promise<CryptoKey> {
  const existing = await idb.get<CryptoKey>('keys', 'aes:storage')
  if (existing) return existing
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await idb.set('keys', 'aes:storage', k)
  return k
}

interface Sealed {
  iv: Uint8Array
  data: ArrayBuffer
}

const storage: SecureStore = {
  async get<T>(key: string) {
    const sealed = await idb.get<Sealed>('secure', key)
    if (!sealed) return null
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv as BufferSource }, await storageKey(), sealed.data)
    return JSON.parse(new TextDecoder().decode(plain)) as T
  },
  async set<T>(key: string, value: T) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await storageKey(),
      new TextEncoder().encode(JSON.stringify(value)),
    )
    await idb.set('secure', key, { iv, data } satisfies Sealed)
  },
  async remove(key) {
    await idb.del('secure', key)
  },
  async keys(prefix) {
    const all = await idb.keys('secure')
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all
  },
}

// ---------------------------------------------------------------------------
// Printer: Web Bluetooth (Chrome/Edge on desktop & Android). Full ESC/POS in phase 6.
// ---------------------------------------------------------------------------
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
]

/* Minimal typings – Web Bluetooth is not in TypeScript's DOM lib. */
interface BtCharacteristic {
  properties: { write: boolean; writeWithoutResponse: boolean }
  writeValueWithoutResponse?(v: BufferSource): Promise<void>
  writeValue(v: BufferSource): Promise<void>
}
interface BtDevice {
  name?: string
  gatt?: {
    connected: boolean
    connect(): Promise<{ getPrimaryServices(): Promise<{ getCharacteristics(): Promise<BtCharacteristic[]> }[]> }>
    disconnect(): void
  }
}
interface BtNavigator {
  bluetooth?: {
    requestDevice(o: unknown): Promise<BtDevice>
    getDevices?(): Promise<BtDevice[]>
  }
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

let btDevice: BtDevice | null = null
let btChar: BtCharacteristic | null = null

async function openCharacteristic(device: BtDevice): Promise<BtCharacteristic> {
  const server = await device.gatt!.connect()
  for (const service of await server.getPrimaryServices()) {
    for (const c of await service.getCharacteristics()) {
      if (c.properties.write || c.properties.writeWithoutResponse) return c
    }
  }
  throw new Error('Printeri nuk ka kanal për shkrim')
}

const printer: PrinterTransport = {
  support() {
    const bluetooth = Boolean((navigator as BtNavigator).bluetooth)
    const usbSerial = 'serial' in navigator
    let reason: string | undefined
    if (!bluetooth) {
      reason = isIOS()
        ? 'iPhone/iPad nuk lejon Bluetooth në shfletues. Përdor aplikacionin Kasa nga App Store, ose printo nga shfletuesi.'
        : 'Ky shfletues nuk e mbështet Bluetooth-in. Përdor Chrome ose Edge, ose printo nga shfletuesi.'
    }
    return { bluetooth, usbSerial, reason }
  },
  async connect() {
    const bt = (navigator as BtNavigator).bluetooth
    if (!bt) throw new Error(this.support().reason)
    const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES })
    btChar = await openCharacteristic(device)
    btDevice = device
    localStorage.setItem('kasa.printer.name', device.name ?? '')
    return device.name ?? 'Printer'
  },
  async reconnect() {
    const bt = (navigator as BtNavigator).bluetooth
    const last = localStorage.getItem('kasa.printer.name')
    if (!bt?.getDevices || last === null) return null
    const device = (await bt.getDevices()).find((d) => (d.name ?? '') === last)
    if (!device) return null
    btChar = await openCharacteristic(device)
    btDevice = device
    return device.name ?? 'Printer'
  },
  isConnected() {
    return Boolean(btDevice?.gatt?.connected && btChar)
  },
  async write(bytes, chunkSize = 180) {
    if (!btChar) throw new Error('Printeri nuk është i lidhur')
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize)
      if (btChar.properties.writeWithoutResponse && btChar.writeValueWithoutResponse) await btChar.writeValueWithoutResponse(chunk)
      else await btChar.writeValue(chunk)
    }
  },
  async disconnect() {
    btDevice?.gatt?.disconnect()
    btDevice = null
    btChar = null
  },
}

export const webDevice: DeviceAdapter = {
  platform: 'web',
  appVersion: __APP_VERSION__,
  getDeviceId,
  keys,
  storage,
  printer,
}
