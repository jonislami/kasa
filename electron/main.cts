// Kasa for Windows – Electron main process. No business logic here: it serves the built web app
// (dist/) from a private app:// origin, lets the page use Web Bluetooth / Web Serial (with a
// device chooser in the app), keeps a secret key with Windows DPAPI (safeStorage) and installs
// updates from GitHub Releases (electron-updater).
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

// The same main process runs two programs: Kasa (the till) and Kasa Kontabilist (the accountant's
// program). electron-builder.kontabilist.yml writes "kasaApp": "kontabilist" into package.json;
// while developing, KASA_APP=kontabilist does the same.
function appVariant(): 'kasa' | 'kontabilist' {
  if (process.env.KASA_APP === 'kontabilist') return 'kontabilist'
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')) as { kasaApp?: string }
    return pkg.kasaApp === 'kontabilist' ? 'kontabilist' : 'kasa'
  } catch {
    return 'kasa'
  }
}
const VARIANT = appVariant()
const TITLE = VARIANT === 'kontabilist' ? 'Kasa Kontabilist' : 'Kasa'

const SCHEME = 'app'
const HOST = VARIANT === 'kontabilist' ? 'kontabilist' : 'kasa'
const ORIGIN = `${SCHEME}://${HOST}`
const DIST = path.join(__dirname, '..', VARIANT === 'kontabilist' ? 'dist-kontabilist' : 'dist')

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

let win: BrowserWindow | null = null

// ---------------------------------------------------------------------------
// Single instance: a second start focuses the open window.
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function serveApp() {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url)
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)))
    // Never serve anything outside dist/; unknown paths are app routes → index.html (SPA).
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html')
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

// ---------------------------------------------------------------------------
// Bluetooth / Serial device choosers: Chromium asks the embedder to pick a device;
// the list goes to the page (window.kasaElectron.onDeviceList) and the page answers.
// ---------------------------------------------------------------------------
let btCallback: ((deviceId: string) => void) | null = null
let serialCallback: ((portId: string) => void) | null = null

function wireDeviceChoosers(w: BrowserWindow) {
  w.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    btCallback = callback
    w.webContents.send('kasa:device-list', {
      kind: 'bluetooth',
      devices: devices.map((d) => ({ id: d.deviceId, name: d.deviceName || 'Pajisje pa emër' })),
    })
  })
  w.webContents.session.on('select-serial-port', (event, ports, _wc, callback) => {
    event.preventDefault()
    serialCallback = callback
    w.webContents.send('kasa:device-list', {
      kind: 'serial',
      devices: ports.map((p) => ({ id: p.portId, name: p.displayName || p.portName || 'Port USB' })),
    })
  })
  // Allow Bluetooth / Serial for the app origin only.
  w.webContents.session.setPermissionCheckHandler((_wc, permission, origin) => {
    if (!origin.startsWith(ORIGIN)) return false
    return ['serial', 'bluetooth', 'clipboard-sanitized-write', 'media'].includes(permission) || permission === 'notifications'
  })
  w.webContents.session.setDevicePermissionHandler((details) => details.origin.startsWith(ORIGIN))
}

ipcMain.on('kasa:device-select', (_e, msg: { kind: 'bluetooth' | 'serial'; id: string | null }) => {
  if (msg.kind === 'bluetooth' && btCallback) {
    btCallback(msg.id ?? '') // '' cancels the request
    btCallback = null
  }
  if (msg.kind === 'serial' && serialCallback) {
    serialCallback(msg.id ?? '')
    serialCallback = null
  }
})

// ---------------------------------------------------------------------------
// DPAPI (safeStorage): encrypts a small secret for the renderer (the key that seals local data).
// ---------------------------------------------------------------------------
ipcMain.handle('kasa:safe-encrypt', (_e, text: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(text).toString('base64')
})
ipcMain.handle('kasa:safe-decrypt', (_e, b64: string) => {
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(Buffer.from(b64, 'base64'))
})

// ---------------------------------------------------------------------------
// Updates from GitHub Releases: download in the background, install when the user agrees
// (never in the middle of a sale) or on the next start.
// ---------------------------------------------------------------------------
function wireUpdates(w: BrowserWindow) {
  if (!app.isPackaged) return
  // Both programs publish to the same GitHub Releases; the accountant program reads kontabilist.yml.
  if (VARIANT === 'kontabilist') autoUpdater.channel = 'kontabilist'
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => w.webContents.send('kasa:update', { state: 'ready', version: info.version }))
  autoUpdater.on('error', () => undefined)
  void autoUpdater.checkForUpdates().catch(() => undefined)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), 60 * 60 * 1000)
}
ipcMain.on('kasa:update-install', () => autoUpdater.quitAndInstall(false, true))

// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: TITLE,
    backgroundColor: '#F4F6F3',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  wireDeviceChoosers(win)
  wireUpdates(win)

  // Links to other sites open in the normal browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  const dev = process.env.KASA_DEV_URL // e.g. http://localhost:5173 while developing
  void win.loadURL(dev || `${ORIGIN}/`)
  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  serveApp()
  // The app origin talks only to Supabase over HTTPS; nothing else needs extra permissions.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(wc.getURL().startsWith(ORIGIN) && ['media', 'clipboard-sanitized-write', 'notifications'].includes(permission))
  })
  createWindow()
})

app.on('window-all-closed', () => app.quit())
