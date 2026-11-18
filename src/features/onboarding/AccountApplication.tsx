import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Button, Card, Input } from '@/components/ui'
import type { LegalForm } from '@/lib/taxProfile'
import type { OnboardingState } from './api'
import {
  ApplicationNotMigrated,
  documentUrl,
  fetchActivities,
  fetchOwnerApplication,
  removeDocument,
  saveApplication,
  uploadDocument,
  type OwnerApplication,
} from './applicationApi'
import { CompanyStep, DocumentsBlock, EMPTY_APPLICATION, STEPS, Stepper, TaxStep, UnitsStep, emptyUnit, validateStep, type ApplicationData, type Errors } from './ApplicationForm'

type Reg = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

function fromState(s: OnboardingState, app: OwnerApplication): ApplicationData {
  const b = s.business
  const r = (b.registration ?? {}) as Reg
  const company = {
    ...EMPTY_APPLICATION.company,
    name: b.name ?? '',
    nui: b.nui ?? '',
    address: b.address ?? '',
    country: str(r.country) || 'Kosovë',
    city: b.city ?? '',
    owner_name: b.owner_name ?? '',
    phone: b.phone ?? '',
    email: b.owner_email ?? '',
    type: b.type,
  }
  const vat = typeof r.vat_registered === 'boolean' ? r.vat_registered : b.vat_number ? true : null
  return {
    company,
    tax: {
      legal_form: (str(r.legal_form) as LegalForm) || '',
      tax_category: str(r.tax_category),
      real_income: r.real_income === true,
      vat_registered: vat,
      vat_number: b.vat_number ?? '',
      vat_date: str(r.vat_date),
      tax_center: str(r.tax_center),
    },
    units: app.units.length
      ? app.units.map((u) => ({ name: u.name, unit_no: u.unit_no ?? '', country: u.country, city: u.city, address: u.address, activities: u.activities ?? [], registers: u.registers ?? 1, status: u.status }))
      : [{ ...emptyUnit(company), name: b.name ?? '', activities: [] }],
    partner_code: str(r.partner_code),
  }
}

/**
 * The application while it waits for the approval: the same four steps as the registration; the owner corrects
 * anything and sends it again. Documents are uploaded and removed right away. `fallback` is shown before 0041.
 */
export function AccountApplication({ s, onSaved, fallback }: { s: OnboardingState; onSaved: () => void; fallback: ReactNode }) {
  const qc = useQueryClient()
  const app = useQuery({ queryKey: ['owner-application'], queryFn: fetchOwnerApplication, retry: false })
  const acts = useQuery({ queryKey: ['business-activities'], queryFn: fetchActivities, retry: false, staleTime: 5 * 60_000 })
  const [d, setD] = useState<ApplicationData | null>(null)
  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState<Errors>({})
  const [message, setMessage] = useState('')
  const [docError, setDocError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (app.data && !d) setD(fromState(s, app.data))
  }, [app.data, d, s])

  const refreshDocs = () => void qc.invalidateQueries({ queryKey: ['owner-application'] })
  const upload = useMutation({
    mutationFn: async (p: { kind: 'certificate' | 'other'; files: File[] }) => {
      for (const f of p.files) await uploadDocument(s.business.id, p.kind, f)
    },
    onSuccess: refreshDocs,
    onError: (e: Error) => setDocError(e.message),
  })
  const remove = useMutation({ mutationFn: removeDocument, onSuccess: refreshDocs, onError: (e: Error) => setDocError(e.message) })
  const save = useMutation({
    mutationFn: () => {
      const x = d!
      return saveApplication({
        name: x.company.name.trim(),
        nui: x.company.nui,
        address: x.company.address.trim(),
        country: x.company.country,
        city: x.company.city.trim(),
        owner_name: x.company.owner_name.trim(),
        phone: x.company.phone.trim(),
        partner_code: x.partner_code.trim(),
        tax: x.tax,
        units: x.units,
        message: message.trim(),
      })
    },
    onSuccess: () => {
      setOk(true)
      setMessage('')
      refreshDocs()
      onSaved()
    },
  })

  if (app.error instanceof ApplicationNotMigrated) return <>{fallback}</>
  if (app.isLoading || !d) return <Card className="p-6 text-center text-muted">Duke ngarkuar aplikimin…</Card>
  if (app.error) return <Card className="p-6 text-sm text-warn-700">{(app.error as Error).message}</Card>

  const docs = app.data?.documents ?? []
  const certDoc = docs.find((x) => x.kind === 'certificate') ?? null
  const open = async (path: string) => {
    const w = window.open('', '_blank')
    try {
      const url = await documentUrl(path)
      if (w) w.location.href = url
      else window.open(url, '_blank', 'noopener')
    } catch (e) {
      w?.close()
      setDocError((e as Error).message)
    }
  }
  const setCompany = (p: Partial<ApplicationData['company']>) => (setOk(false), setD((x) => x && { ...x, company: { ...x.company, ...p } }))
  const setTax = (p: Partial<ApplicationData['tax']>) => (setOk(false), setD((x) => x && { ...x, tax: { ...x.tax, ...p } }))
  const submit = () => {
    for (const st of [1, 2, 3]) {
      const e = validateStep(st, d, { account: false })
      if (Object.keys(e).length) {
        setErrors(e)
        setStep(st)
        return
      }
    }
    setErrors({})
    save.mutate()
  }
  const needsInfo = s.business.status === 'needs_info'

  return (
    <Card className="p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-semibold tracking-[-0.015em]">Aplikimi</h2>
          <p className="text-sm text-muted">Mund ta ndryshosh derisa të aprovohet. {needsInfo ? 'Korrigjo çka kërkoi administratori dhe dërgoje përsëri.' : ''}</p>
        </div>
      </div>
      {!certDoc && (
        <p className="mb-5 flex gap-2 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Mungon certifikata e regjistrimit të biznesit – ngarkoje te hapi “Dokumentet”.
        </p>
      )}
      <Stepper step={step} done={4} onGo={(n) => (setErrors({}), setStep(n))} />
      <div className="mt-6">
        <h3 className="mb-5 text-[17px] font-semibold">{STEPS[step - 1]}</h3>
        {step === 1 && <CompanyStep d={d} setCompany={setCompany} setTax={setTax} errors={errors} account={false} />}
        {step === 2 && <TaxStep d={d} setTax={setTax} errors={errors} />}
        {step === 3 && <UnitsStep d={d} setUnits={(units) => (setOk(false), setD((x) => x && { ...x, units }))} activities={acts.data ?? []} errors={errors} />}
        {step === 4 && (
          <DocumentsBlock
            certificate={certDoc && { key: certDoc.id, name: certDoc.file_name, size: certDoc.size_bytes, open: () => open(certDoc.path), remove: () => remove.mutate(certDoc.id) }}
            others={docs.filter((x) => x.kind === 'other').map((o) => ({ key: o.id, name: o.file_name, size: o.size_bytes, open: () => open(o.path), remove: () => remove.mutate(o.id) }))}
            onCertificate={(f) => upload.mutate({ kind: 'certificate', files: [f] })}
            onOthers={(files) => upload.mutate({ kind: 'other', files })}
            busy={upload.isPending || remove.isPending}
            error={docError}
            setError={setDocError}
            locked={!app.data?.open}
          />
        )}
      </div>
      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
        <Input label={needsInfo ? 'Përgjigje për administratorin' : 'Shënim (opsional)'} value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={save.isPending} onClick={submit}>
            {needsInfo ? 'Dërgo korrigjimet' : 'Ruaj ndryshimet'}
          </Button>
          {ok && <span className="text-sm text-brand-600">U ruajt.</span>}
          {save.error && <span className="text-sm text-warn-700">{(save.error as Error).message}</span>}
          {Object.keys(errors).length > 0 && <span className="text-sm text-warn-700">Plotëso fushat e shënuara me të kuqe.</span>}
        </div>
      </div>
    </Card>
  )
}
