import { Capacitor, registerPlugin } from '@capacitor/core'
import type { AppUpdates, DeviceAdapter, KeyStore, PrinterTransport } from './types'
import { getDeviceId, keys as webKeys, storage } from './web'

/**
 * Android / iPhone app (Capacitor). The page runs in the system WebView; Bluetooth printing goes
 * through the native BLE plugin (@capacitor-community/bluetooth-le), which also works on iPhone
 * where Safari has no Web Bluetooth. The sealed store uses the WebView's WebCrypto + IndexedDB
 * (app-private storage). The ATK key lives in the Android Keystore (AtkKeyPlugin.java); where the
 * native plugin is missing (iPhone for now) it stays a non-extractable WebCrypto key.
 */

interface AtkKeyNative {
  ensureKey(o: { alias: string }): Promise<{ publicKey: string }>
  hasKey(o: { alias: string }): Promise<{ value: boolean }>
  getPublicKey(o: { alias: string }): Promise<{ publicKey: string | null }>
  sign(o: { alias: string; data: string }): Promise<{ signature: string }>
  deleteKey(o: { alias: string }): Promise<void>
}
const AtkKey = registerPlugin<AtkKeyNative>('AtkKey')
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

const nativeKeys: KeyStore = {
  ensureKey: async (alias) => (await AtkKey.ensureKey({ alias })).publicKey,
  hasKey: async (alias) => (await AtkKey.hasKey({ alias })).value,
  getPublicKey: async (alias) => (await AtkKey.getPublicKey({ alias })).publicKey,
  sign: async (alias, data) => (await AtkKey.sign({ alias, data: b64(data) })).signature,
  deleteKey: (alias) => AtkKey.deleteKey({ alias }),
}
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
]

type Ble = typeof import('@capacitor-community/bluetooth-le')
let ble: Ble | null = null
async function lib(): Promise<Ble> {
  if (!ble) {
    ble = await import('@capacitor-community/bluetooth-le')
    await ble.BleClient.initialize({ androidNeverForLocation: true })
  }
  return ble
}

let current: { deviceId: string; service: string; characteristic: string; noResponse: boolean; name: string } | null = null

async function openWritable(deviceId: string, name: string) {
  const { BleClient } = await lib()
  await BleClient.connect(deviceId, () => {
    current = null
  })
  for (const s of await BleClient.getServices(deviceId)) {
    for (const c of s.characteristics) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        current = { deviceId, service: s.uuid, characteristic: c.uuid, noResponse: !c.properties.write, name }
        localStorage.setItem('kasa.printer.name', name)
        localStorage.setItem('kasa.printer.ble', deviceId)
        return name
      }
    }
  }
  await BleClient.disconnect(deviceId)
  throw new Error('Printeri nuk ka kanal për shkrim')
}

const printer: PrinterTransport = {
  support() {
    return { bluetooth: true, usbSerial: false }
  },
  async connect() {
    const { BleClient } = await lib()
    const d = await BleClient.requestDevice({ optionalServices: PRINTER_SERVICES })
    return openWritable(d.deviceId, d.name || 'Printer')
  },
  async reconnect() {
    const id = localStorage.getItem('kasa.printer.ble')
    if (!id) return null
    try {
      return await openWritable(id, localStorage.getItem('kasa.printer.name') || 'Printer')
    } catch {
      return null
    }
  },
  isConnected() {
    return current !== null
  },
  async write(bytes, chunkSize = 180) {
    if (!current) throw new Error('Printeri nuk është i lidhur')
    const { BleClient } = await lib()
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize)
      const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      if (current.noResponse) await BleClient.writeWithoutResponse(current.deviceId, current.service, current.characteristic, view)
      else await BleClient.write(current.deviceId, current.service, current.characteristic, view)
    }
  },
  async disconnect() {
    if (!current) return
    const { BleClient } = await lib()
    await BleClient.disconnect(current.deviceId).catch(() => undefined)
    current = null
  },
}

// ---------------------------------------------------------------------------
// Android APK updates: the APK installed from the website cannot update itself, so the app looks for a
// newer release on GitHub (at start and every 6 hours) and offers its APK; the system installs it over
// the current one and keeps the data. Play Store / App Store builds update through the store instead.
// ---------------------------------------------------------------------------
const RELEASES = 'https://api.github.com/repos/jonislami/kasa/releases/latest'

/** true when version a (e.g. "0.3.2") is newer than b. */
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa.at(i) ?? 0) - (pb.at(i) ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

let apkUrl: string | null = null
const apkUpdates: AppUpdates = {
  subscribe(cb) {
    let stopped = false
    const check = async () => {
      if (!navigator.onLine) return
      try {
        const r = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } })
        if (!r.ok) return
        const rel = (await r.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] }
        const version = rel.tag_name.replace(/^v/, '')
        const apk = rel.assets.find((a) => /\.apk$/i.test(a.name))
        if (stopped || !apk || !newer(version, __APP_VERSION__)) return
        apkUrl = apk.browser_download_url
        cb({ state: 'ready', version, mode: 'download' })
      } catch {
        /* offline or GitHub unreachable: try again later */
      }
    }
    void check()
    const t = window.setInterval(check, 6 * 3600_000)
    return () => {
      stopped = true
      window.clearInterval(t)
    }
  },
  install() {
    // An address outside the app opens in the phone's browser, which downloads the APK.
    if (apkUrl) window.location.assign(apkUrl)
  },
}

export const capacitorDevice: DeviceAdapter = {
  platform: 'capacitor',
  appVersion: __APP_VERSION__,
  getDeviceId,
  keys: Capacitor.isPluginAvailable('AtkKey') ? nativeKeys : webKeys,
  storage,
  printer,
  // iPhone gets its updates from the App Store
  appUpdates: Capacitor.getPlatform() === 'android' ? apkUpdates : undefined,
}
