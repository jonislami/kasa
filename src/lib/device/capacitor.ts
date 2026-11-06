import type { DeviceAdapter, PrinterTransport } from './types'
import { getDeviceId, keys, storage } from './web'

/**
 * Android / iPhone app (Capacitor). The page runs in the system WebView; Bluetooth printing goes
 * through the native BLE plugin (@capacitor-community/bluetooth-le), which also works on iPhone
 * where Safari has no Web Bluetooth. Keys and the sealed store use the WebView's WebCrypto +
 * IndexedDB (app-private storage); phase 9 moves the ATK key into Android Keystore / iOS Keychain.
 */
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

export const capacitorDevice: DeviceAdapter = {
  platform: 'capacitor',
  appVersion: __APP_VERSION__,
  getDeviceId,
  keys,
  storage,
  printer,
}
