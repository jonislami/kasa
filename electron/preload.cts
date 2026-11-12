// Bridge between the Windows app and the page. Only these few calls are exposed (contextIsolation).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

type DeviceList = { kind: 'bluetooth' | 'serial'; devices: { id: string; name: string }[] }
type UpdateInfo = { state: 'ready'; version: string }

contextBridge.exposeInMainWorld('kasaElectron', {
  platform: 'windows',
  onDeviceList(cb: (list: DeviceList) => void) {
    const h = (_e: IpcRendererEvent, list: DeviceList) => cb(list)
    ipcRenderer.on('kasa:device-list', h)
    return () => ipcRenderer.removeListener('kasa:device-list', h)
  },
  selectDevice(kind: 'bluetooth' | 'serial', id: string | null) {
    ipcRenderer.send('kasa:device-select', { kind, id })
  },
  safeEncrypt: (text: string) => ipcRenderer.invoke('kasa:safe-encrypt', text) as Promise<string | null>,
  safeDecrypt: (b64: string) => ipcRenderer.invoke('kasa:safe-decrypt', b64) as Promise<string | null>,
  // ATK key: created and kept (DPAPI) in the main process; the page only gets the public key and signatures
  keyEnsure: (alias: string) => ipcRenderer.invoke('kasa:key-ensure', alias) as Promise<string>,
  keyHas: (alias: string) => ipcRenderer.invoke('kasa:key-has', alias) as Promise<boolean>,
  keyPublic: (alias: string) => ipcRenderer.invoke('kasa:key-public', alias) as Promise<string | null>,
  keySign: (alias: string, dataB64: string) => ipcRenderer.invoke('kasa:key-sign', alias, dataB64) as Promise<string>,
  keyDelete: (alias: string) => ipcRenderer.invoke('kasa:key-delete', alias) as Promise<void>,
  onUpdate(cb: (info: UpdateInfo) => void) {
    const h = (_e: IpcRendererEvent, info: UpdateInfo) => cb(info)
    ipcRenderer.on('kasa:update', h)
    return () => ipcRenderer.removeListener('kasa:update', h)
  },
  installUpdate: () => ipcRenderer.send('kasa:update-install'),
})
