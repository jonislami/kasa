// AI scanning of supplier invoices (0021 + Edge Function acc-scan).
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}

export type ScanStatus = 'pending' | 'read' | 'review' | 'confirmed' | 'failed'
export const SCAN_STATUS: Record<ScanStatus, { label: string; tone: 'neutral' | 'info' | 'amber' | 'success' | 'warn' }> = {
  pending: { label: 'Në pritje', tone: 'neutral' },
  read: { label: 'E lexuar', tone: 'info' },
  review: { label: 'Në verifikim', tone: 'amber' },
  confirmed: { label: 'E regjistruar', tone: 'success' },
  failed: { label: 'Nuk u lexua', tone: 'warn' },
}

export type VatLetter = 'E' | 'D' | 'C' | 'A'

/** What the AI read (schema of the Edge Function). */
export interface Extracted {
  is_invoice: boolean
  doc_type: 'invoice' | 'credit_note' | 'receipt'
  supplier_name: string | null
  supplier_nui: string | null
  supplier_fiscal_no: string | null
  supplier_vat_no: string | null
  supplier_address: string | null
  buyer_name: string | null
  buyer_nui: string | null
  doc_no: string | null
  doc_date: string | null
  due_date: string | null
  currency: string
  payment: 'cash' | 'card' | 'bank' | 'due' | 'unknown'
  lines: { description: string; quantity: number | null; unit: string | null; unit_price_net: number | null; vat_rate: VatLetter; total_gross: number | null }[]
  net_e: number
  vat_e: number
  net_d: number
  vat_d: number
  amt_c: number
  amt_a: number
  discount: number
  total: number
  category: string
  summary: string
  confidence: 'high' | 'medium' | 'low'
  warnings: string[]
}

export interface ScanSuggest {
  partner_id?: string
  partner_name?: string
  category?: string
  duplicate_doc_id?: string
  duplicate_doc_no?: string
  duplicate_doc_date?: string
  buyer_mismatch?: boolean
}

export interface Scan {
  id: string
  path: string
  file_name: string
  mime: string | null
  size_bytes: number | null
  status: ScanStatus
  extracted: Extracted | null
  suggest: ScanSuggest | null
  error: string | null
  model: string | null
  doc_id: string | null
  doc_no: string | null
  created_at: string
  read_at: string | null
  confirmed_at: string | null
  scanned_by_name: string | null
  confirmed_by_name: string | null
}

export async function fetchScans(clientId: string): Promise<Scan[]> {
  const { data, error } = await supabase.rpc('acc_scans_list', { p_client: clientId, p_status: null })
  if (error) fail(error)
  return (data as Scan[]) ?? []
}

const MAX_SIDE = 2400

/**
 * Photos from a phone are large: scale down to at most 2400 px on the long side as JPEG (enough for the AI
 * to read small print, and well under its image limit). PDFs and small images are kept as they are.
 */
async function prepare(file: File): Promise<Blob & { name?: string }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return file
  const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    if (heic) throw new Error(`${file.name}: formati HEIC nuk lexohet në këtë shfletues. Ruaje si JPG (ose bëj foto nga programi).`)
    throw new Error(`${file.name}: fotoja nuk u hap`)
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  if (scale === 1 && !heic && file.size < 3.5 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    bmp.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88))
  if (!blob) throw new Error(`${file.name}: fotoja nuk u përgatit`)
  return blob
}

/** Uploads one file to the client folder and registers it; returns the scan id. */
export async function uploadScan(clientId: string, file: File): Promise<string> {
  const ready = await prepare(file)
  if (ready.size > 20 * 1024 * 1024) throw new Error(`${file.name}: më i madh se 20 MB`)
  const pdf = ready.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const base = file.name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-60) || 'fature'
  const name = pdf ? `${base}.pdf` : ready === file ? file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-70) : `${base}.jpg`
  const mime = pdf ? 'application/pdf' : ready.type || 'image/jpeg'
  const path = `${clientId}/scan-${crypto.randomUUID()}-${name}`
  const up = await supabase.storage.from('acc-files').upload(path, ready, { contentType: mime, upsert: false })
  if (up.error) throw new Error(`${file.name}: nuk u ngarkua (${up.error.message})`)
  const { data, error } = await supabase.rpc('acc_scan_add', { p: { client_id: clientId, path, file_name: file.name, mime, size_bytes: ready.size } })
  if (error) {
    await supabase.storage.from('acc-files').remove([path])
    fail(error)
  }
  return data as string
}

/** Asks the Edge Function to read the scan with AI (fast, cheap model; strong = the more capable one). */
export async function readScan(scanId: string, strong = false): Promise<{ status: ScanStatus; error?: string }> {
  const { data, error } = await supabase.functions.invoke('acc-scan', { body: { scan_id: scanId, strong } })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: string }
        if (body?.error) msg = body.error
      } catch {
        /* keep the generic message */
      }
    }
    if (/Failed to send|not found|404/i.test(msg)) msg = 'Shërbimi i skanimit (Edge Function acc-scan) nuk është vendosur ende në Supabase.'
    return { status: 'failed', error: msg }
  }
  return data as { status: ScanStatus; error?: string }
}

export async function markReview(scanId: string): Promise<void> {
  const { error } = await supabase.rpc('acc_scan_review', { p_id: scanId })
  if (error) fail(error)
}

export async function confirmScan(scanId: string, docId: string): Promise<void> {
  const { error } = await supabase.rpc('acc_scan_confirm', { p_id: scanId, p_doc: docId })
  if (error) fail(error)
}

export async function deleteScan(scanId: string): Promise<void> {
  const { data, error } = await supabase.rpc('acc_scan_delete', { p_id: scanId })
  if (error) fail(error)
  await supabase.storage.from('acc-files').remove([data as string])
}
