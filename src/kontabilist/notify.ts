// E-mails (0027 + Edge Function acc-notify, Resend).
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'

export type NotifyKind = 'request' | 'invoice' | 'report' | 'office_message' | 'client_message'

export class EmailNotConfigured extends Error {}

/** Sends one e-mail through the Edge Function; resolves with what happened. */
export async function sendNotify(kind: NotifyKind, id: string, month?: string): Promise<{ sent?: number; to?: string[]; skipped?: string }> {
  const { data, error } = await supabase.functions.invoke('acc-notify', { body: { kind, id, month } })
  if (error) {
    let msg = error.message
    let status = 0
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      status = ctx.status
      try {
        const b = (await ctx.json()) as { error?: string }
        if (b?.error) msg = b.error
      } catch {
        /* keep the generic message */
      }
    }
    if (status === 503 || /nuk janë konfiguruar/.test(msg)) throw new EmailNotConfigured(msg)
    if (/Failed to send|404/i.test(msg)) throw new EmailNotConfigured('Shërbimi i email-eve (Edge Function acc-notify) nuk është vendosur ende në Supabase.')
    throw new Error(msg)
  }
  return data as { sent?: number; to?: string[]; skipped?: string }
}

/** Notice about a new message – best effort, never blocks the conversation. */
export function notifyQuietly(kind: 'office_message' | 'client_message', clientId: string) {
  void sendNotify(kind, clientId).catch(() => undefined)
}

export interface NotifySettings {
  messages: boolean
  requests: boolean
  invoices: boolean
  reports: boolean
}
export async function fetchNotifySettings(): Promise<NotifySettings> {
  const { data, error } = await supabase.rpc('acc_notify_settings')
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) throw new AccountingNotMigrated()
    throw new Error(error.message)
  }
  return data as NotifySettings
}
export async function saveNotifySettings(p: Partial<NotifySettings>): Promise<void> {
  const { error } = await supabase.rpc('acc_notify_settings_save', { p })
  if (error) throw new Error(error.message)
}

export interface EmailLogRow {
  id: number
  kind: string
  client_name: string | null
  recipients: string[]
  subject: string
  status: 'queued' | 'sent' | 'failed' | 'skipped'
  error: string | null
  created_at: string
  sent_by_name: string | null
}
export async function fetchEmailLog(): Promise<EmailLogRow[]> {
  const { data, error } = await supabase.rpc('acc_email_log_list', { p_limit: 100 })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) throw new AccountingNotMigrated()
    throw new Error(error.message)
  }
  return (data as EmailLogRow[]) ?? []
}
export const EMAIL_KINDS: Record<string, string> = {
  request: 'Kërkesë për dokumente',
  invoice: 'Fatura e zyrës',
  report: 'Raporti mujor',
  office_message: 'Mesazh për klientin',
  client_message: 'Mesazh nga klienti',
  invite: 'Ftesë për portalin',
}
