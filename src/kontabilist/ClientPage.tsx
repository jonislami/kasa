import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Download, Link2, Pencil, Unlink } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { Button, Card, Dialog, EmptyState, Input, StatCard } from '@/components/ui'
import { formatKosovoDateTime, kosovoDateISO } from '@/lib/clock'
import { formatEUR } from '@/lib/money'
import { VAT_LABELS } from '@/lib/vat'
import { AccountingNotMigrated, fetchPurchases, fetchStockList, formatDay, PAYMENT_LABELS, periodOf, periodRange, setActiveBusiness, shiftPeriod, type Period } from '@/features/accounting/api'
import { BooksScopeProvider, CashTab, OverviewTab, PeriodPicker, ProfitTab, VatTab, type BooksScope } from '@/features/accounting/AccountingPage'
import { PurchasesTab, SalesTab, StockTab } from '@/features/accounting/BooksTabs'
import { downloadWorkbook, profitSheet, purchasesSheet, salesDailySheet, stockSheet, vatSheet, type Cell, type Sheet } from '@/features/accounting/export'
import { cancelLink, categoryLabel, deleteClient, docNet, fetchClientBooks, fetchDocs, PAY_STATUS_LABELS, requestLink, saveClient, setClientPeriod, type AccMe, type Client, type Doc, type DocKind } from './api'
import { BankTab } from './BankTab'
import { DashboardTab } from './DashboardTab'
import { DebtsTab } from './DebtsTab'
import { TaxesTab } from './TaxesTab'
import { VatFormTab } from './VatFormTab'
import { PartnersTab } from './PartnersTab'
import { CompanyShell } from './CompanyShell'
import { ClientDialog } from './ClientDialog'
import { DocumentsTab } from './DocumentsTab'

type TabKey = 'paneli' | 'pasqyra' | 'banka' | 'tatimet' | 'tvsh_permbledhje' | 'shitjet' | 'proformat' | 'blerjet' | 'partneret' | 'borxhet' | 'tvsh' | 'fitimi' | 'arka' | 'stoku' | 'klienti'
const TABS: { key: TabKey; label: string; kasaOnly?: boolean }[] = [
  { key: 'paneli', label: 'Paneli' },
  { key: 'pasqyra', label: 'Pasqyra' },
  { key: 'shitjet', label: 'Shitjet' },
  { key: 'proformat', label: 'Proformat' },
  { key: 'blerjet', label: 'Blerjet & shpenzimet' },
  { key: 'partneret', label: 'Partnerët' },
  { key: 'borxhet', label: 'Borxhet' },
  { key: 'banka', label: 'Arka & banka' },
  { key: 'tatimet', label: 'Tatimet e tjera dhe afatet' },
  { key: 'tvsh_permbledhje', label: 'TVSH sipas normave' },
  { key: 'tvsh', label: 'TVSH' },
  { key: 'fitimi', label: 'Fitimi' },
  { key: 'arka', label: 'Arka', kasaOnly: true },
  { key: 'stoku', label: 'Stoku', kasaOnly: true },
  { key: 'klienti', label: 'Të dhënat' },
]

const PERIOD_KEY = 'kasa.kontabilist.period'
function initialPeriod(): Period {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PERIOD_KEY) ?? 'null') as Period | null
    if (saved && ['month', 'quarter', 'year'].includes(saved.kind) && /^\d{4}-\d{2}-01$/.test(saved.start)) return saved
  } catch {
    /* fall through */
  }
  return shiftPeriod(periodOf('month'), -1)
}

export function ClientPage({ me }: { me: AccMe }) {
  const { id = '', tab: tabParam } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { ctx } = useAuth()
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const range = periodRange(period)

  useEffect(() => {
    try {
      sessionStorage.setItem(PERIOD_KEY, JSON.stringify(period))
    } catch {
      /* storage unavailable */
    }
  }, [period])

  const books = useQuery({
    queryKey: ['client', id, 'books', range.from, range.to],
    queryFn: () => fetchClientBooks(id, range.from, range.to),
    retry: (count, e) => !(e instanceof AccountingNotMigrated) && count < 1,
  })
  const client = books.data?.client
  const linked = Boolean(books.data?.kasa && client?.kasa_business_id)

  // A client linked with Kasa: open that business so its documents can be read (RLS).
  const kasaId = linked ? client!.kasa_business_id! : null
  const kasaOpen = Boolean(kasaId && ctx?.business?.id === kasaId && ctx.profile?.role === 'accountant')
  useEffect(() => {
    if (!kasaId || kasaOpen) return
    let cancelled = false
    void setActiveBusiness(kasaId)
      .then(() => {
        if (!cancelled) {
          qc.removeQueries({ queryKey: ['acc'] }) // never show another business's cached documents
          void qc.refetchQueries({ queryKey: ['session-context'] })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [kasaId, kasaOpen, qc])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['client', id] })
    void qc.invalidateQueries({ queryKey: ['clients'] })
  }

  const scope = useMemo<BooksScope>(
    () => ({
      link: (t) => (t === 'paneli' ? `/klient/${id}` : `/klient/${id}/${t === 'arka' && !linked ? 'pasqyra' : t}`),
      setStatus: (month, status) => setClientPeriod(id, month, status),
      invalidate: refresh,
      kasa: linked,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, linked],
  )

  const tab = TABS.find((t) => t.key === (tabParam ?? 'paneli'))
  if (!tab || (tab.kasaOnly && books.data && !linked)) return <Navigate to={`/klient/${id}`} replace />

  const s = books.data?.summary
  const isCurrent = range.to >= kosovoDateISO()

  const exportAll = async () => {
    if (!s || !client) return
    setExporting(true)
    setExportError(null)
    try {
      const [sales, purchases] = await Promise.all([fetchDocs(id, 'sale', range.from, range.to), fetchDocs(id, 'purchase', range.from, range.to)])
      const sheets: Sheet[] = [salesDailySheet(s), docsSheet(s, 'sale', sales), docsSheet(s, 'purchase', purchases), vatSheet(s), profitSheet(s)]
      if (kasaOpen && books.data?.kasa) {
        const [kasaPurchases, stock] = await Promise.all([fetchPurchases(kasaId!, range.from, range.to), fetchStockList(kasaId!)])
        sheets.splice(3, 0, { ...purchasesSheet(books.data.kasa, kasaPurchases), name: 'Hyrjet e mallit (Kasa)' })
        sheets.push(stockSheet(books.data.kasa, stock))
      }
      await downloadWorkbook(`${client.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${range.from}-${range.to}.xlsx`, sheets)
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const toolbar =
    ['klienti', 'paneli', 'tvsh', 'tatimet', 'borxhet'].includes(tab.key) ? undefined : (
      <>
        <PeriodPicker period={period} onChange={setPeriod} disableNext={isCurrent} />
        <Button variant="secondary" onClick={() => void exportAll()} disabled={!s} loading={exporting}>
          <Download className="h-4 w-4" /> Excel
        </Button>
      </>
    )

  if (books.error) {
    return (
      <CompanyShell me={me} client={null} linked={false} active={tab.key}>
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={books.error instanceof AccountingNotMigrated ? 'Programi nuk është aktivizuar ende' : 'Kompania nuk u hap'}
            text={(books.error as Error).message}
            action={<Button onClick={() => navigate('/')}>Te kompanitë</Button>}
          />
        </Card>
      </CompanyShell>
    )
  }

  return (
    <CompanyShell me={me} client={client ?? null} linked={linked} active={tab.key} toolbar={toolbar}>
      {!['klienti', 'paneli', 'tvsh', 'tatimet', 'borxhet'].includes(tab.key) && (
        <p className="-mt-1 mb-3 text-sm text-muted">
          {TABS.find((t) => t.key === tab.key)?.label} · {formatDay(range.from)} – {formatDay(range.to)}
        </p>
      )}
      {exportError && <p className="mb-3 rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{exportError}</p>}

      {!s || !client ? (
        <p className="py-16 text-center text-muted">Duke ngarkuar…</p>
      ) : (
        <BooksScopeProvider value={scope}>
          <div className="flex flex-col gap-4 md:gap-5">
            {tab.key === 'paneli' && <DashboardTab client={client} onGo={(t) => navigate(`/klient/${id}/${t}`)} />}
            {tab.key === 'pasqyra' && <OverviewTab s={s} period={period} />}
            {tab.key === 'banka' && <BankTab client={client} from={range.from} to={range.to} onChanged={refresh} />}
            {tab.key === 'shitjet' && (
              <>
                <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
                  <StatCard label="Shitjet (me TVSH)" value={formatEUR(s.sales.gross)} sub={`${s.sales.docs} dokumente`} />
                  <StatCard label="Baza (pa TVSH)" value={formatEUR(s.sales.net)} />
                  <StatCard label="TVSH e mbledhur" value={formatEUR(s.sales.vat)} />
                  {books.data?.kasa ? (
                    <StatCard label="Nga arka Kasa" value={formatEUR(books.data.kasa.sales.gross)} sub={`${books.data.kasa.sales.docs} kuponë`} />
                  ) : (
                    <StatCard label="Pa arkëtuar (sot)" value={formatEUR(books.data?.receivable ?? 0)} tone={(books.data?.receivable ?? 0) > 0 ? 'warn' : 'default'} sub="nga të gjitha periudhat" />
                  )}
                </div>
                <DocumentsTab client={client} kind="sale" from={range.from} to={range.to} onChanged={refresh} />
                {kasaOpen && books.data?.kasa && (
                  <>
                    <h2 className="mt-2 text-[19px] font-semibold">Nga arka Kasa · {books.data.kasa.business.name}</h2>
                    <SalesTab s={books.data.kasa} />
                  </>
                )}
              </>
            )}
            {tab.key === 'blerjet' && (
              <>
                <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
                  <StatCard label="Blerjet e mallit dhe mjeteve" value={formatEUR(s.purchases.gross)} sub={`${s.purchases.docs} fatura`} />
                  <StatCard label="Shpenzimet" value={formatEUR(s.expenses.gross)} sub={`${s.expenses.docs} dokumente`} />
                  <StatCard label="TVSH e zbritshme" value={formatEUR(s.purchases.vat + s.expenses.vat)} />
                  <StatCard label="Pa paguar furnitorëve (sot)" value={formatEUR(books.data?.payable ?? 0)} tone={(books.data?.payable ?? 0) > 0 ? 'warn' : 'default'} sub="nga të gjitha periudhat" />
                </div>
                <DocumentsTab client={client} kind="purchase" from={range.from} to={range.to} onChanged={refresh} />
                {kasaOpen && books.data?.kasa && (
                  <>
                    <h2 className="mt-2 text-[19px] font-semibold">Hyrjet e mallit në Kasa · {books.data.kasa.business.name}</h2>
                    <PurchasesTab s={books.data.kasa} />
                  </>
                )}
              </>
            )}
            {tab.key === 'proformat' && <DocumentsTab client={client} kind="proforma" from={range.from} to={range.to} onChanged={refresh} />}
            {tab.key === 'partneret' && <PartnersTab clientId={client.id} clientName={client.name} from={range.from} to={range.to} />}
            {tab.key === 'borxhet' && <DebtsTab client={client} onChanged={refresh} />}
            {tab.key === 'tvsh' && <VatFormTab client={client} />}
            {tab.key === 'tvsh_permbledhje' && <VatTab s={s} period={period} />}
            {tab.key === 'tatimet' && <TaxesTab client={client} onGo={(t) => navigate(`/klient/${id}/${t}`)} />}
            {tab.key === 'fitimi' && <ProfitTab s={s} />}
            {tab.key === 'arka' && linked && <CashTab s={s} />}
            {tab.key === 'stoku' && linked && (kasaOpen && books.data?.kasa ? <StockTab s={books.data.kasa} /> : <p className="py-10 text-center text-muted">Duke hapur të dhënat e Kasa-s…</p>)}
            {tab.key === 'klienti' && <ClientTab client={client} kasaName={books.data?.kasa?.business.name ?? null} onChanged={refresh} />}
          </div>
        </BooksScopeProvider>
      )}
    </CompanyShell>
  )
}

// ---------------------------------------------------------------------------
// The accountant's documents as a sheet
// ---------------------------------------------------------------------------
function docsSheet(s: { business: { name: string; nui: string | null }; from: string; to: string }, kind: DocKind, docs: Doc[]): Sheet {
  const b = (v: string): Cell => ({ value: v, fontWeight: 'bold' })
  const str = (v: string | null | undefined): Cell => ({ value: v ?? '', type: String })
  const num = (v: number): Cell => ({ value: Math.round(v * 100) / 100, type: Number, format: '0.00' })
  const sum = (f: (d: Doc) => number) => docs.reduce((a, d) => a + f(d), 0)
  return {
    name: kind === 'sale' ? 'Faturat e shitjes' : 'Blerjet dhe shpenzimet',
    widths: [12, 14, 26, 13, 13, 22, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
    rows: [
      [b(kind === 'sale' ? 'Faturat e shitjes (të regjistruara nga kontabilisti)' : 'Faturat e blerjes dhe shpenzimet')],
      [str(s.business.name), str(s.business.nui ? `NUI ${s.business.nui}` : '')],
      [str(`Periudha: ${formatDay(s.from)} – ${formatDay(s.to)}`)],
      [],
      [b('Data'), b('Nr.'), b(kind === 'sale' ? 'Blerësi' : 'Furnitori'), b('NUI'), b('Nr. TVSH'), b('Kategoria'), b('Statusi'), b('Baza 18%'), b('TVSH 18%'), b('Baza 8%'), b('TVSH 8%'), b('0%'), b('E liruar'), b('TVSH e pazbritshme'), b('Totali'), b('Mbetet')],
      ...[...docs].reverse().map((d) => [
        str(formatDay(d.doc_date)),
        str(d.doc_no),
        str(d.partner_name),
        str(d.partner_nui),
        str(d.partner_vat),
        str(categoryLabel(kind, d.category)),
        str(d.pay_status ? PAY_STATUS_LABELS[d.pay_status] : PAYMENT_LABELS[d.payment]),
        num(d.net_e),
        num(d.vat_e),
        num(d.net_d),
        num(d.vat_d),
        num(d.amt_c),
        num(d.amt_a),
        num(d.vat_nd),
        num(d.total),
        num(d.open),
      ]),
      [b('Gjithsej'), null, null, null, null, null, null, num(sum((d) => d.net_e)), num(sum((d) => d.vat_e)), num(sum((d) => d.net_d)), num(sum((d) => d.vat_d)), num(sum((d) => d.amt_c)), num(sum((d) => d.amt_a)), num(sum((d) => d.vat_nd)), num(sum((d) => d.total)), num(sum((d) => d.open))],
      [str(`Baza gjithsej ${formatEUR(sum(docNet))} · ${VAT_LABELS.E} / ${VAT_LABELS.D}`)],
    ],
  }
}

// ---------------------------------------------------------------------------
// Client data, Kasa link, archive / delete
// ---------------------------------------------------------------------------
function ClientTab({ client, kasaName, onChanged }: { client: Client; kasaName: string | null; onChanged: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [nui, setNui] = useState(client.nui ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const link = useMutation({ mutationFn: () => requestLink(client.id, nui), onSuccess: onChanged })
  const unlink = useMutation({
    mutationFn: async () => {
      await cancelLink(client.id)
      await setActiveBusiness(null).catch(() => undefined)
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['acc'] })
      void qc.refetchQueries({ queryKey: ['session-context'] })
      onChanged()
    },
  })
  const archive = useMutation({ mutationFn: () => saveClient({ ...client, active: !client.active }), onSuccess: onChanged })
  const remove = useMutation({
    mutationFn: () => deleteClient(client.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] })
      navigate('/', { replace: true })
    },
  })

  const row = (label: string, value: string | null | undefined) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value || '—'}</span>
    </div>
  )

  return (
    <div className="grid gap-4 md:gap-5 lg:grid-cols-2 lg:items-start">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold">Të dhënat e klientit</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Ndrysho
          </Button>
        </div>
        <div className="mt-2">
          {row('Emri', client.name)}
          {row('NUI', client.nui)}
          {row('Nr. i TVSH-së', client.vat_number)}
          {row('TVSH', client.vat_registered ? 'Në sistemin e TVSH-së' : 'Jo në TVSH')}
          {row('Nr. fiskal', client.fiscal_number)}
          {row('Forma juridike', client.legal_form)}
          {row('Përfaqësuesi', client.representative)}
          {row('Regjistruar më', client.registration_date ? formatDay(client.registration_date) : null)}
          {row('Banka / IBAN', [client.bank_name, client.iban].filter(Boolean).join(' · '))}
          {row('Veprimtaria', client.activity)}
          {row('Adresa', [client.address, client.city].filter(Boolean).join(', '))}
          {row('Telefoni', client.phone)}
          {row('Email-i', client.email)}
          {row('Shënim', client.note)}
        </div>
      </Card>

      <div className="flex flex-col gap-4 md:gap-5">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold">Lidhja me arkën Kasa</h2>
              <p className="text-sm text-muted">Nëse klienti përdor Kasa, shitjet, hyrjet e mallit, arka dhe stoku dalin vetë.</p>
            </div>
          </div>
          {client.link_status === 'approved' ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="rounded-ctl bg-brand-100 px-4 py-3 text-sm text-brand-600">
                E lidhur me <strong>{kasaName ?? 'biznesin në Kasa'}</strong>
                {client.link_responded_at && ` · miratuar më ${formatKosovoDateTime(client.link_responded_at)}`}. Vetëm lexim.
              </p>
              <Button variant="danger" className="self-start" loading={unlink.isPending} onClick={() => unlink.mutate()}>
                <Unlink className="h-4 w-4" /> Shkëpute nga Kasa
              </Button>
            </div>
          ) : client.link_status === 'pending' ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
                Kërkesa u dërgua{client.link_requested_at && ` më ${formatKosovoDateTime(client.link_requested_at)}`}. Pronari e miraton te Kasa → Cilësimet → Kontabilisti.
              </p>
              <Button variant="secondary" className="self-start" loading={unlink.isPending} onClick={() => unlink.mutate()}>
                Anulo kërkesën
              </Button>
            </div>
          ) : (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                link.mutate()
              }}
            >
              {client.link_status === 'rejected' && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">Pronari e refuzoi kërkesën e fundit.</p>}
              {client.link_status === 'revoked' && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">Pronari e hoqi qasjen. Mund të kërkosh përsëri.</p>}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Input label="NUI e biznesit në Kasa" inputMode="numeric" maxLength={9} value={nui} onChange={(e) => setNui(e.target.value.replace(/\D/g, ''))} error={link.error ? (link.error as Error).message : null} />
                </div>
                <Button type="submit" className="h-[46px]" loading={link.isPending}>
                  Kërko qasje
                </Button>
              </div>
            </form>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-[17px] font-semibold">Klienti</h2>
          <p className="mt-1 text-sm text-muted">
            {client.active ? 'Arkivo klientin kur nuk punon më me të – të dhënat ruhen dhe mund ta rikthesh.' : 'Klienti është i arkivuar dhe nuk del te lista kryesore.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" loading={archive.isPending} onClick={() => archive.mutate()}>
              {client.active ? 'Arkivo' : 'Rikthe nga arkivi'}
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Fshi klientin
            </Button>
          </div>
          {(archive.error || unlink.error) && <p className="mt-3 text-sm text-warn-700">{((archive.error ?? unlink.error) as Error).message}</p>}
        </Card>
      </div>

      <ClientDialog
        value={editing ? { ...client } : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          onChanged()
        }}
      />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Të fshihet ${client.name}?`}
        width="md:max-w-[460px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Anulo
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Fshije përgjithmonë
            </Button>
          </div>
        }
      >
        <p className="text-[15px]">
          Fshihen klienti dhe <strong>të gjitha faturat që ke regjistruar</strong> për të. Kjo nuk kthehet. Të dhënat në arkën Kasa të biznesit nuk preken. Nëse vetëm nuk punon më me
          të, përdor "Arkivo".
        </p>
        {remove.error && <p className="mt-3 text-sm text-warn-700">{(remove.error as Error).message}</p>}
      </Dialog>
    </div>
  )
}
