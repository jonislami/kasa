// Chart of accounts, journal, general ledger, trial balance, statements, fixed assets, month close (0019).
import { supabase } from '@/lib/supabase'
import { AccountingNotMigrated } from '@/features/accounting/api'

function fail(error: { code?: string; message: string }): never {
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(error.code ?? '')) throw new AccountingNotMigrated()
  throw new Error(error.message)
}
const n = (v: unknown) => (v == null ? 0 : Number(v))

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'
export const TYPE_LABELS: Record<AccountType, string> = { asset: 'Pasuri', liability: 'Detyrim', equity: 'Kapital', income: 'Të hyra', expense: 'Shpenzim' }

export interface CoaAccount {
  code: string
  name: string
  type: AccountType
  system: boolean
  active: boolean
}

export async function fetchCoa(clientId: string): Promise<CoaAccount[]> {
  const { data, error } = await supabase.rpc('acc_coa_list', { p_client: clientId })
  if (error) fail(error)
  return (data as CoaAccount[]) ?? []
}

export async function saveCoa(clientId: string, a: Omit<CoaAccount, 'system'> & { old_code?: string }): Promise<void> {
  const { error } = await supabase.rpc('acc_save_coa', { p: { ...a, client_id: clientId } })
  if (error) fail(error)
}

export async function deleteCoa(clientId: string, code: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_coa', { p_client: clientId, p_code: code })
  if (error) fail(error)
}

export type EntrySource = 'doc' | 'payment' | 'tx' | 'opening' | 'vat' | 'depreciation' | 'journal'
export const SOURCE_LABELS: Record<EntrySource, string> = {
  doc: 'Faturë',
  payment: 'Pagesë',
  tx: 'Lëvizje parash',
  opening: 'Gjendje fillestare',
  vat: 'Mbyllja e TVSH-së',
  depreciation: 'Amortizim',
  journal: 'Regjistrim manual',
}

export interface JournalGroup {
  date: string
  source: EntrySource
  source_id: string | null
  ref: string | null
  text: string
  lines: { account: string; name: string | null; debit: number; credit: number }[]
}

export async function fetchJournal(clientId: string, from: string, to: string): Promise<JournalGroup[]> {
  const { data, error } = await supabase.rpc('acc_journal', { p_client: clientId, p_from: from, p_to: to })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((g) => ({
    ...(g as unknown as JournalGroup),
    date: String(g.date).slice(0, 10),
    lines: ((g.lines as Record<string, unknown>[]) ?? []).map((l) => ({ ...(l as unknown as JournalGroup['lines'][number]), debit: n(l.debit), credit: n(l.credit) })),
  }))
}

export interface ManualEntry {
  id?: string
  entry_date: string
  kind: 'manual' | 'opening' | 'adjustment' | 'closing'
  description: string
  lines: { account: string; debit: number; credit: number; memo?: string | null }[]
}

export async function fetchManualEntry(id: string): Promise<ManualEntry> {
  const { data, error } = await supabase.rpc('acc_journal_entry', { p_id: id })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  return {
    id: r.id as string,
    entry_date: String(r.entry_date).slice(0, 10),
    kind: r.kind as ManualEntry['kind'],
    description: r.description as string,
    lines: ((r.lines as Record<string, unknown>[]) ?? []).map((l) => ({ account: l.account as string, debit: n(l.debit), credit: n(l.credit), memo: (l.memo as string) ?? null })),
  }
}

export async function saveManualEntry(clientId: string, e: ManualEntry): Promise<void> {
  const { error } = await supabase.rpc('acc_save_journal', { p: { ...e, client_id: clientId } })
  if (error) fail(error)
}

export async function deleteManualEntry(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_journal', { p_id: id })
  if (error) fail(error)
}

export interface LedgerLine {
  date: string
  source: EntrySource
  source_id: string | null
  ref: string | null
  text: string
  debit: number
  credit: number
  partner: string | null
}

export async function fetchGeneralLedger(clientId: string, account: string, from: string, to: string): Promise<{ opening: number; rows: LedgerLine[] }> {
  const { data, error } = await supabase.rpc('acc_general_ledger', { p_client: clientId, p_account: account, p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  return {
    opening: n(r.opening),
    rows: ((r.rows as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as LedgerLine), date: String(x.date).slice(0, 10), debit: n(x.debit), credit: n(x.credit) })),
  }
}

export interface TbRow {
  code: string
  name: string
  type: AccountType
  opening: number
  debit: number
  credit: number
  closing: number
}

export async function fetchTrialBalance(clientId: string, from: string, to: string): Promise<TbRow[]> {
  const { data, error } = await supabase.rpc('acc_trial_balance', { p_client: clientId, p_from: from, p_to: to })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as TbRow), opening: n(x.opening), debit: n(x.debit), credit: n(x.credit), closing: n(x.closing) }))
}

export interface StatementLine {
  code: string
  name: string
  amount: number
}

export interface Statements {
  as_of: string
  from: string
  assets: StatementLine[]
  liabilities: StatementLine[]
  equity: StatementLine[]
  result_to_date: number
  income: StatementLine[]
  expenses: StatementLine[]
}

export async function fetchStatements(clientId: string, from: string, to: string): Promise<Statements> {
  const { data, error } = await supabase.rpc('acc_financial_statements', { p_client: clientId, p_from: from, p_to: to })
  if (error) fail(error)
  const r = data as Record<string, unknown>
  const list = (k: string) => ((r[k] as Record<string, unknown>[]) ?? []).map((x) => ({ ...(x as unknown as StatementLine), amount: n(x.amount) }))
  return {
    as_of: String(r.as_of).slice(0, 10),
    from: String(r.from).slice(0, 10),
    assets: list('assets'),
    liabilities: list('liabilities'),
    equity: list('equity'),
    result_to_date: n(r.result_to_date),
    income: list('income'),
    expenses: list('expenses'),
  }
}

export type AssetCategory = 'buildings' | 'vehicles' | 'equipment' | 'computers' | 'furniture' | 'machinery' | 'other'
export const ASSET_CATEGORIES: Record<AssetCategory, { label: string; rate: number }> = {
  buildings: { label: 'Ndërtesat', rate: 5 },
  vehicles: { label: 'Automjetet', rate: 20 },
  equipment: { label: 'Pajisjet', rate: 20 },
  computers: { label: 'Kompjuterët dhe IT', rate: 20 },
  furniture: { label: 'Mobiliet', rate: 10 },
  machinery: { label: 'Makineritë', rate: 20 },
  other: { label: 'Të tjera', rate: 10 },
}

export interface Asset {
  id: string
  name: string
  category: AssetCategory
  acquired_on: string
  cost: number
  salvage: number
  rate_pct: number
  doc_id: string | null
  disposed_on: string | null
  disposal_value: number | null
  note: string | null
  depreciated: number
  monthly: number
  year_dep: number
}

export async function fetchAssets(clientId: string, asOf?: string): Promise<Asset[]> {
  const { data, error } = await supabase.rpc('acc_assets_list', { p_client: clientId, p_as_of: asOf ?? null })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((a) => ({
    ...(a as unknown as Asset),
    cost: n(a.cost),
    salvage: n(a.salvage),
    rate_pct: n(a.rate_pct),
    depreciated: n(a.depreciated),
    monthly: n(a.monthly),
    year_dep: n(a.year_dep),
    disposal_value: a.disposal_value == null ? null : n(a.disposal_value),
  }))
}

export async function saveAsset(clientId: string, a: Partial<Asset>): Promise<void> {
  const { error } = await supabase.rpc('acc_save_asset', { p: { ...a, client_id: clientId } })
  if (error) fail(error)
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await supabase.rpc('acc_delete_asset', { p_id: id })
  if (error) fail(error)
}

export interface PeriodRow {
  month: string
  locked: boolean
  vat_status: 'open' | 'draft' | 'filed'
  docs: number
  unmatched: number
  no_partner: number
}

export async function fetchPeriods(clientId: string, year: number): Promise<PeriodRow[]> {
  const { data, error } = await supabase.rpc('acc_periods_list', { p_client: clientId, p_year: year })
  if (error) fail(error)
  return ((data as Record<string, unknown>[]) ?? []).map((p) => ({ ...(p as unknown as PeriodRow), month: String(p.month).slice(0, 10), docs: n(p.docs), unmatched: n(p.unmatched), no_partner: n(p.no_partner) }))
}

export async function lockMonth(clientId: string, month: string, locked: boolean): Promise<void> {
  const { error } = await supabase.rpc('acc_lock_month', { p_client: clientId, p_month: month, p_locked: locked })
  if (error) fail(error)
}
