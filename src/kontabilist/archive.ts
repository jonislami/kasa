// Archive of documents, backup, sign-ins and sessions, office logo (0025).
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'
import { prepareUpload } from './scan'

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) fail(error)
  return data as T
}

export type FileCategory = 'invoice' | 'contract' | 'declaration' | 'bank' | 'payroll' | 'correspondence' | 'other'
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  invoice: 'Fatura',
  contract: 'Kontrata',
  declaration: 'Deklarata',
  bank: 'Banka',
  payroll: 'Punëtorët dhe pagat',
  correspondence: 'Korrespondenca',
  other: 'Të tjera',
}

export interface ArchiveFile {
  id: string
  client_id: string
  client_name: string
  doc_id: string | null
  path: string
  file_name: string
  mime: string | null
  size_bytes: number | null
  created_at: string
  category: FileCategory
  title: string | null
  period: string | null
  note: string | null
  shared: boolean
  doc_no: string | null
  doc_date: string | null
  doc_kind: 'sale' | 'purchase' | 'proforma' | null
  partner_name: string | null
  sort_date: string
  uploaded_by_name: string | null
}

export const fetchArchive = (p: { clientId?: string | null; category?: FileCategory | null; year?: number | null; q?: string }) =>
  rpc<ArchiveFile[]>('acc_archive_list', { p_client: p.clientId ?? null, p_category: p.category ?? null, p_year: p.year ?? null, p_q: p.q || null }).then((r) => r ?? [])

export interface ArchiveMeta {
  category: FileCategory
  title?: string | null
  period?: string | null
  note?: string | null
  shared?: boolean
}
export const saveArchiveMeta = (id: string, m: ArchiveMeta) => rpc<string>('acc_archive_save', { p: { id, ...m } })

/** Uploads a file to the client folder and puts it in the archive (any document, not only invoices). */
export async function uploadToArchive(clientId: string, file: File, meta: ArchiveMeta): Promise<void> {
  const ready = file.type.startsWith('image/') ? await prepareUpload(file) : file
  if (ready.size > 20 * 1024 * 1024) throw new Error(`${file.name}: më i madh se 20 MB`)
  const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80)
  const name = ready === file ? safe : safe.replace(/\.[^.]+$/, '') + '.jpg'
  const mime = ready === file ? file.type || 'application/octet-stream' : 'image/jpeg'
  const path = `${clientId}/${crypto.randomUUID()}-${name}`
  const up = await supabase.storage.from('acc-files').upload(path, ready, { contentType: mime, upsert: false })
  if (up.error) throw new Error(`${file.name}: nuk u ngarkua (${up.error.message})`)
  const { error } = await supabase.rpc('acc_archive_save', { p: { client_id: clientId, path, file_name: file.name, mime, size_bytes: ready.size, ...meta } })
  if (error) {
    await supabase.storage.from('acc-files').remove([path])
    fail(error)
  }
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
export const fetchClientBackup = (clientId: string) => rpc<Record<string, unknown>>('acc_client_backup', { p_client: clientId })

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const slug = (s: string) => s.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'klienti'

// ---------------------------------------------------------------------------
// Sign-ins and sessions
// ---------------------------------------------------------------------------
export async function logLogin(): Promise<void> {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Shfletues'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  const { error } = await supabase.rpc('acc_log_login', { p_agent: `Hyrje · ${browser}${os ? ' në ' + os : ''}` })
  if (error && !['PGRST202', '42883'].includes(error.code ?? '')) console.warn(error.message)
}

export interface Session {
  id: string
  user_id: string
  user_name: string | null
  created_at: string
  last_used: string | null
  user_agent: string | null
  ip: string | null
  aal: string | null
  current: boolean
}
export const fetchSessions = () => rpc<Session[]>('acc_sessions_list').then((r) => r ?? [])
export const revokeSession = (id: string) => rpc<void>('acc_session_revoke', { p_id: id })

export function deviceOf(ua: string | null): string {
  if (!ua) return 'Pajisje e panjohur'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Electron\//.test(ua) ? 'Programi për Windows' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Shfletues'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} · ${os}` : browser
}

/** Logo for the office: square-ish, at most 256 px, PNG data URL (kept small in the database). */
export async function logoDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const url = canvas.toDataURL('image/png')
  if (url.length > 300000) throw new Error('Logoja është shumë e madhe')
  return url
}

// ---------------------------------------------------------------------------
// Restore (0028): a backup becomes a new client of the office
// ---------------------------------------------------------------------------
export interface RestoreResult {
  client_id: string
  name: string
  nui_kept: boolean
  counts: Record<string, number>
}
export async function restoreClient(backup: Record<string, unknown>, name?: string): Promise<RestoreResult> {
  const { data, error } = await supabase.rpc('acc_restore_client', { p: backup, p_name: name ?? null })
  if (error) fail(error)
  return data as RestoreResult
}

/** Reads a backup file: one client (acc_client_backup) or the whole office (list of clients). */
export async function readBackupFile(file: File): Promise<{ created_at: string | null; clients: Record<string, unknown>[] }> {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(await file.text())
  } catch {
    throw new Error('Skedari nuk është JSON i vlefshëm')
  }
  if (j.format === 'kasa-kontabilist-backup') return { created_at: (j.created_at as string) ?? null, clients: [j] }
  if (j.format === 'kasa-kontabilist-office-backup' && Array.isArray(j.clients)) return { created_at: (j.created_at as string) ?? null, clients: j.clients as Record<string, unknown>[] }
  throw new Error('Ky skedar nuk është backup i Kasa Kontabilist')
}
