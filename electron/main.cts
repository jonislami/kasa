// Kasa for Windows – Electron main process. No business logic here: it serves the built web app
// (dist/) from a private app:// origin, lets the page use Web Bluetooth / Web Serial (with a
// device chooser in the app), keeps a secret key with Windows DPAPI (safeStorage) and installs
// updates from GitHub Releases (electron-updater).
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import tcp from 'node:net'

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
const TITLE = VARIANT === 'kontabilist' ? 'KontoSef Kontabilist' : 'KontoSef.app'

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
// Printing to a Windows printer without the print dialog (thermal printer installed in Windows, e.g. Xprinter).
// The page has already rendered the receipt for print (.print-root, @page 80mm); this prints it silently.
// ---------------------------------------------------------------------------
ipcMain.handle('kasa:printers', async (e) => {
  if (!trustedSender(e)) throw new Error('Kërkesë e palejuar')
  const list = await e.sender.getPrintersAsync()
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: Boolean((p as { isDefault?: boolean }).isDefault) }))
})
ipcMain.handle('kasa:print-silent', (e, deviceName: unknown) => {
  if (!trustedSender(e)) throw new Error('Kërkesë e palejuar')
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    e.sender.print(
      { silent: true, printBackground: true, margins: { marginType: 'none' }, ...(typeof deviceName === 'string' && deviceName ? { deviceName } : {}) },
      (ok, failureReason) => resolve({ ok, error: ok ? undefined : failureReason }),
    )
  })
})

// ---------------------------------------------------------------------------
// RAW printing: the ESC/POS bytes of the receipt go to the Windows printer as they are (datatype RAW), without the
// printer driver. Every thermal receipt printer understands them, also clones whose driver output they cannot read
// (that output prints as endless rows of symbols). Done with the Win32 spooler (winspool.drv) from PowerShell, so no
// native module is needed. A printer that Windows marks offline (USB unplugged) is refused instead of queued, so no
// job waits in the queue and prints later. Also: emptying a printer's queue.
// ---------------------------------------------------------------------------
const RAW_PS = String.raw`
param([string]$Printer, [string]$File, [string]$Action)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'clear') {
  Get-PrintJob -PrinterName $Printer | Remove-PrintJob
  exit 0
}
$p = Get-CimInstance Win32_Printer -Filter ("Name='" + $Printer.Replace("'", "''").Replace('\', '\\') + "'")
if (-not $p) { [Console]::Error.Write('NOPRINTER'); exit 2 }
if ($p.WorkOffline) { [Console]::Error.Write('OFFLINE'); exit 3 }
# what the driver reports (DetectedErrorState): 4 no paper, 7 door open, 8 jammed, 9 offline
switch ([int]$p.DetectedErrorState) {
  4 { [Console]::Error.Write('NOPAPER'); exit 5 }
  7 { [Console]::Error.Write('DOOROPEN'); exit 5 }
  8 { [Console]::Error.Write('JAMMED'); exit 5 }
  9 { [Console]::Error.Write('OFFLINE'); exit 3 }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KasaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static int Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter " + Marshal.GetLastWin32Error());
    try {
      int job = StartDocPrinter(h, 1, new DOCINFO { pDocName = "Kasa", pDataType = "RAW" });
      if (job == 0) throw new Exception("StartDoc " + Marshal.GetLastWin32Error());
      StartPagePrinter(h);
      int w;
      if (!WritePrinter(h, data, data.Length, out w) || w != data.Length) throw new Exception("WritePrinter " + Marshal.GetLastWin32Error());
      EndPagePrinter(h);
      EndDocPrinter(h);
      return job;
    } finally { ClosePrinter(h); }
  }
}
'@
$job = [KasaRaw]::Send($Printer, [IO.File]::ReadAllBytes($File))
# A receipt printer prints in a second or two. A job still waiting with an error (no paper, printer off, door open)
# is removed: left in the queue it would print later, out of place, when the printer comes back.
for ($i = 0; $i -lt 16; $i++) {
  Start-Sleep -Milliseconds 500
  $j = Get-PrintJob -PrinterName $Printer -ID $job -ErrorAction SilentlyContinue
  if (-not $j) { exit 0 }
  $st = [string]$j.JobStatus
  if ($st -match 'Error|PaperOut|Offline|UserIntervention|Blocked') {
    Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue
    [Console]::Error.Write('STUCK:' + $st); exit 4
  }
}
# still in the queue after 8 s without an error: left alone (a long receipt on a slow printer)
exit 0
`

function runRawPs(args: string[]): Promise<{ ok: boolean; error?: string }> {
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'kasa-print-'))
  const script = path.join(dir, 'raw.ps1')
  fs.writeFileSync(script, RAW_PS, 'utf-8')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { windowsHide: true, timeout: 30_000 },
      (err, _stdout, stderr) => {
        fs.rmSync(dir, { recursive: true, force: true })
        if (!err) return resolve({ ok: true })
        const s = String(stderr || err.message)
        resolve({
          ok: false,
          // "kind:" in front tells the page what happened (lib/printer/errors.ts)
          error: s.includes('NOPAPER')
            ? 'paper:Printeri ka mbetur pa letër. Vendos një rrotull të re.'
            : s.includes('DOOROPEN')
              ? 'paper:Kapaku i printerit është i hapur.'
              : s.includes('JAMMED')
                ? 'paper:Letra ka ngecur në printer.'
                : s.includes('STUCK')
                  ? 'stuck:Printeri nuk e printoi kuponin (i fikur, pa letër ose kapaku i hapur). Kuponi u hoq nga radha.'
                  : s.includes('OFFLINE')
                    ? 'offline:Printeri nuk është i lidhur. Kontrollo kabllon USB dhe që është i ndezur.'
                    : s.includes('NOPRINTER')
                      ? 'offline:Printeri nuk u gjet në Windows.'
                      : 'failed:Printimi dështoi: ' + s.trim().split('\n')[0].slice(0, 200),
        })
      },
    )
  })
}

ipcMain.handle('kasa:print-raw', async (e, deviceName: unknown, data: unknown) => {
  if (!trustedSender(e)) throw new Error('Kërkesë e palejuar')
  if (process.platform !== 'win32') return { ok: false, error: 'Vetëm në Windows' }
  if (typeof deviceName !== 'string' || !deviceName || !(data instanceof Uint8Array) || data.length === 0 || data.length > 2_000_000) {
    return { ok: false, error: 'Kërkesë e pavlefshme' }
  }
  const file = path.join(app.getPath('temp'), `kasa-${crypto.randomUUID()}.bin`)
  fs.writeFileSync(file, data)
  try {
    return await runRawPs(['-Printer', deviceName, '-File', file])
  } finally {
    fs.rmSync(file, { force: true })
  }
})
// Network receipt / kitchen printers (Ethernet or Wi-Fi): ESC/POS straight to the printer's port (9100 by default).
const HOST_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i
ipcMain.handle('kasa:print-tcp', async (e, host: unknown, port: unknown, data: unknown) => {
  if (!trustedSender(e)) throw new Error('Kërkesë e palejuar')
  if (typeof host !== 'string' || !HOST_RE.test(host) || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Adresa e printerit nuk është e saktë' }
  }
  if (!(data instanceof Uint8Array) || data.length === 0 || data.length > 2_000_000) return { ok: false, error: 'Kërkesë e pavlefshme' }
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let settled = false
    const done = (r: { ok: boolean; error?: string }) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }
    const socket = tcp.createConnection({ host, port })
    socket.setTimeout(6000)
    socket.on('connect', () => socket.end(Buffer.from(data), () => done({ ok: true })))
    socket.on('timeout', () => done({ ok: false, error: `offline:Printeri ${host}:${port} nuk përgjigjet` }))
    socket.on('error', (err) => done({ ok: false, error: `offline:Printeri ${host}:${port} nuk u gjet (${(err as NodeJS.ErrnoException).code ?? err.message})` }))
  })
})
ipcMain.handle('kasa:print-clear', async (e, deviceName: unknown) => {
  if (!trustedSender(e)) throw new Error('Kërkesë e palejuar')
  if (process.platform !== 'win32' || typeof deviceName !== 'string' || !deviceName) return { ok: false, error: 'Kërkesë e pavlefshme' }
  return runRawPs(['-Printer', deviceName, '-Action', 'clear'])
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
// ATK signing key of the till (fiscalization). ECDSA P-256 created here, in the main process; the
// private key is stored only encrypted with Windows DPAPI (safeStorage) in the user's app data and
// never reaches the page – the page asks for a public key or a signature.
// ---------------------------------------------------------------------------
const ATK_ALIAS = /^atk:[0-9a-f-]{36}$/i
const atkKeyFile = () => path.join(app.getPath('userData'), 'atk-keys.json')

function trustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  const dev = process.env.KASA_DEV_URL
  return url.startsWith(ORIGIN + '/') || url === ORIGIN || Boolean(dev && url.startsWith(dev))
}
function readAtkKeys(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(atkKeyFile(), 'utf-8')) as Record<string, string>
  } catch {
    return {}
  }
}
function writeAtkKeys(keys: Record<string, string>) {
  const tmp = atkKeyFile() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(keys), { mode: 0o600 })
  fs.renameSync(tmp, atkKeyFile())
}
function atkCheck(e: Electron.IpcMainInvokeEvent, alias: unknown): string {
  if (!trustedSender(e)) throw new Error('Kërkesë e palejuar')
  if (typeof alias !== 'string' || !ATK_ALIAS.test(alias)) throw new Error('Emër i pavlefshëm i çelësit')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows nuk lejon ruajtjen e sigurt të çelësit (DPAPI)')
  return alias
}
function atkPrivate(alias: string): crypto.KeyObject | null {
  const sealed = readAtkKeys()[alias]
  if (!sealed) return null
  return crypto.createPrivateKey(safeStorage.decryptString(Buffer.from(sealed, 'base64')))
}
const atkSpki = (priv: crypto.KeyObject) => (crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }) as Buffer).toString('base64')

ipcMain.handle('kasa:key-ensure', (e, alias: unknown) => {
  const a = atkCheck(e, alias)
  const existing = atkPrivate(a)
  if (existing) return atkSpki(existing)
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const keys = readAtkKeys()
  keys[a] = safeStorage.encryptString(pem).toString('base64')
  writeAtkKeys(keys)
  return atkSpki(privateKey)
})
ipcMain.handle('kasa:key-has', (e, alias: unknown) => Boolean(readAtkKeys()[atkCheck(e, alias)]))
ipcMain.handle('kasa:key-public', (e, alias: unknown) => {
  const priv = atkPrivate(atkCheck(e, alias))
  return priv ? atkSpki(priv) : null
})
// SHA-256 + ECDSA over the bytes; raw r||s (IEEE P1363), the same format WebCrypto returns.
ipcMain.handle('kasa:key-sign', (e, alias: unknown, dataB64: unknown) => {
  const priv = atkPrivate(atkCheck(e, alias))
  if (!priv) throw new Error('Çelësi i arkës nuk ekziston në këtë pajisje')
  if (typeof dataB64 !== 'string') throw new Error('Të dhëna të pavlefshme')
  return crypto.sign('sha256', Buffer.from(dataB64, 'base64'), { key: priv, dsaEncoding: 'ieee-p1363' }).toString('base64')
})
ipcMain.handle('kasa:key-delete', (e, alias: unknown) => {
  const a = atkCheck(e, alias)
  const keys = readAtkKeys()
  if (keys[a]) {
    delete keys[a]
    writeAtkKeys(keys)
  }
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
