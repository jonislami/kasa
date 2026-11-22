import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/app/AuthProvider'
import { PublicFooter, PublicHeader } from '@/features/landing/LandingPage'
import { Button, Input } from '@/components/ui'
import { registerBusiness } from './api'
import { fetchActivities, nuiTaken, saveApplication, uploadDocument, type Activity } from './applicationApi'
import {
  CompanyStep,
  DocumentsBlock,
  EMPTY_APPLICATION,
  Review,
  STEPS,
  Section,
  Stepper,
  TaxStep,
  UnitsStep,
  validateStep,
  type ApplicationData,
  type DocItem,
  type Errors,
} from './ApplicationForm'

const DRAFT = 'kasa.register.v2'
// shown until migration 0041 serves the list from the database
const FALLBACK_ACTIVITIES: Activity[] = ['Tregti me pakicë', 'Tregti me shumicë', 'Gastronomi', 'Ndërtim', 'Shërbime', 'Automjete', 'Barnatore', 'Market', 'Autopjesë', 'Depo'].map(
  (name, i) => ({ id: name, name, sort: i, active: true }),
)

function loadDraft(): { d: ApplicationData; step: number; done: number } {
  try {
    const v = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null') as { d: ApplicationData; step: number; done: number } | null
    // a draft from before: Butik is now part of Tregti me pakicë
    if (v?.d?.company?.type === 'boutique') v.d.company.type = 'market'
    if (v?.d?.company && Array.isArray(v.d.units)) return { d: { ...EMPTY_APPLICATION, ...v.d, company: { ...EMPTY_APPLICATION.company, ...v.d.company }, tax: { ...EMPTY_APPLICATION.tax, ...v.d.tax } }, step: v.step || 1, done: v.done || 0 }
  } catch {
    /* a new form */
  }
  return { d: EMPTY_APPLICATION, step: 1, done: 0 }
}

interface LocalFile {
  key: string
  file: File
  url: string
}
const local = (f: File): LocalFile => ({ key: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`, file: f, url: URL.createObjectURL(f) })

/** /regjistrohu – the application of a new business in four steps; the admin approves it. */
export function RegisterPage() {
  const { status, signIn } = useAuth()
  const navigate = useNavigate()
  const first = useMemo(loadDraft, [])
  const [d, setD] = useState<ApplicationData>(first.d)
  const [step, setStep] = useState(first.step)
  const [done, setDone] = useState(first.done)
  const [errors, setErrors] = useState<Errors>({})
  const [nuiState, setNuiState] = useState<'checking' | 'taken' | 'free' | null>(null)
  const [cert, setCert] = useState<LocalFile | null>(null)
  const [others, setOthers] = useState<LocalFile[]>([])
  const [docError, setDocError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [accept, setAccept] = useState(false)
  const [website, setWebsite] = useState('') // honeypot
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form')
  const [sendError, setSendError] = useState<string | null>(null)
  const [afterError, setAfterError] = useState<string | null>(null)
  const acts = useQuery({ queryKey: ['business-activities'], queryFn: fetchActivities, retry: false, staleTime: 5 * 60_000 })
  const activities = acts.data?.length ? acts.data.filter((a) => a.active) : FALLBACK_ACTIVITIES

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify({ d, step, done }))
    } catch {
      /* storage unavailable */
    }
  }, [d, step, done])
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  if (status === 'ready' && phase === 'form') return <Navigate to="/" replace />

  // a corrected field loses its error
  const clear = (keys: string[]) => setErrors((e) => (keys.some((k) => k in e) ? Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))) : e))
  const setCompany = (p: Partial<ApplicationData['company']>) => {
    clear(Object.keys(p))
    if ('nui' in p) setNuiState(null)
    setD((x) => {
      const company = { ...x.company, ...p }
      // the first unit follows the company's address until it is changed
      const u0 = x.units[0]
      const follow = u0 && !u0.name && (u0.address === x.company.address || !u0.address) && (u0.city === x.company.city || !u0.city)
      const units = follow ? [{ ...u0, address: company.address, city: company.city, country: company.country }, ...x.units.slice(1)] : x.units
      return { ...x, company, units }
    })
  }
  const setTax = (p: Partial<ApplicationData['tax']>) => {
    clear(Object.keys(p))
    setD((x) => ({ ...x, tax: { ...x.tax, ...p } }))
  }

  const checkNui = async (): Promise<boolean> => {
    if (!/^\d{9}$/.test(d.company.nui)) return true
    setNuiState('checking')
    const taken = await nuiTaken(d.company.nui)
    setNuiState(taken ? 'taken' : taken === false ? 'free' : null)
    return !taken
  }

  const next = async () => {
    const e = validateStep(step, d, { account: true })
    setErrors(e)
    if (Object.keys(e).length) return
    if (step === 1 && !(await checkNui())) return
    setDone(Math.max(done, step))
    setStep(step + 1)
  }
  const go = (s: number) => {
    setErrors({})
    setStep(s)
  }

  const submit = async () => {
    setSendError(null)
    for (const s of [1, 2, 3]) {
      const e = validateStep(s, d, { account: true })
      if (Object.keys(e).length) {
        setErrors(e)
        setStep(s)
        return
      }
    }
    if (!cert) return setDocError('Ngarko certifikatën e regjistrimit të biznesit')
    if (password.length < 8) return setSendError('Fjalëkalimi duhet të ketë të paktën 8 shenja')
    if (password !== password2) return setSendError('Fjalëkalimet nuk përputhen')
    if (!accept) return setSendError('Prano kushtet e përdorimit')
    setPhase('sending')
    const c = d.company
    const email = c.email.trim().toLowerCase()
    let businessId: string | null
    try {
      businessId = await registerBusiness({
        owner_name: c.owner_name.trim(),
        business_name: c.name.trim(),
        type: c.type,
        nui: c.nui,
        fiscal_number: c.nui,
        vat_number: d.tax.vat_registered ? d.tax.vat_number.trim() : '',
        address: c.address.trim(),
        city: c.city.trim(),
        phone: c.phone.trim(),
        email,
        password,
        activity: [...new Set(d.units.flatMap((u) => u.activities))].join(', ').slice(0, 200),
        registers: Math.min(20, d.units.reduce((n, u) => n + u.registers, 0)),
        note: d.partner_code.trim() ? `Kodi i partnerit: ${d.partner_code.trim()}` : '',
        website,
      })
    } catch (err) {
      setPhase('form')
      setSendError((err as Error).message)
      return
    }
    // the account exists: sign in, then the units, the tax profile and the documents
    const problems: string[] = []
    let err = await signIn(email, password, true)
    if (err) {
      await new Promise((r) => setTimeout(r, 1500))
      err = await signIn(email, password, true)
    }
    if (err) problems.push('Hyrja nuk u krye – hyr me email-in dhe fjalëkalimin dhe plotëso aplikimin te llogaria.')
    else {
      try {
        await saveApplication({
          name: c.name.trim(),
          nui: c.nui,
          address: c.address.trim(),
          country: c.country,
          city: c.city.trim(),
          owner_name: c.owner_name.trim(),
          phone: c.phone.trim(),
          partner_code: d.partner_code.trim(),
          tax: d.tax,
          units: d.units,
          initial: true,
        })
      } catch (e) {
        problems.push(`Njësitë dhe të dhënat tatimore: ${(e as Error).message}`)
      }
      if (businessId) {
        for (const [kind, f] of [['certificate', cert.file], ...others.map((o) => ['other', o.file] as const)] as const) {
          try {
            await uploadDocument(businessId, kind, f)
          } catch (e) {
            problems.push(`Dokumenti ${f.name}: ${(e as Error).message}`)
          }
        }
      }
    }
    try {
      sessionStorage.removeItem(DRAFT)
    } catch {
      /* ignore */
    }
    setPhase('sent')
    if (problems.length) setAfterError(problems.join(' '))
    else navigate('/llogaria', { replace: true })
  }

  const docItems = (): { certificate: DocItem | null; others: DocItem[] } => ({
    certificate: cert ? { key: cert.key, name: cert.file.name, size: cert.file.size, open: () => void window.open(cert.url, '_blank', 'noopener'), remove: () => setCert(null) } : null,
    others: others.map((o) => ({ key: o.key, name: o.file.name, size: o.file.size, open: () => void window.open(o.url, '_blank', 'noopener'), remove: () => setOthers((x) => x.filter((y) => y.key !== o.key)) })),
  })

  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <main className="mx-auto max-w-[880px] px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink md:text-[34px]">Regjistro biznesin</h1>
        <p className="mt-2 max-w-xl text-[15px] text-muted">Katër hapa të shkurtër. Pas aprovimit merr çelësat e arkave te llogaria jote dhe instalon KontoSef.</p>

        {phase === 'sent' ? (
          <div className="mt-8 rounded-card border border-line bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto h-11 w-11 text-brand-600" />
            <h2 className="mt-3 text-[21px] font-semibold tracking-[-0.015em]">Aplikimi u dërgua</h2>
            <p className="mt-2 text-muted">Statusi i aplikimit shihet te llogaria jote. Të njoftojmë kur të aprovohet.</p>
            {afterError && <p className="mx-auto mt-4 max-w-lg rounded-ctl bg-amber-100 px-4 py-3 text-left text-sm text-amber-700">{afterError}</p>}
            <Link to="/llogaria" className="mt-5 inline-block">
              <Button size="lg">Shko te llogaria</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-7">
              <Stepper step={step} done={done} onGo={go} />
            </div>
            <div className="mt-5 rounded-card border border-line bg-white p-5 md:p-8">
              <div className="mb-6">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">Hapi {step} nga 4</div>
                <h2 className="mt-1 text-[21px] font-semibold tracking-[-0.015em]">{STEPS[step - 1]}</h2>
              </div>
              {step === 1 && <CompanyStep d={d} setCompany={setCompany} setTax={setTax} errors={errors} account nuiState={nuiState} onNuiBlur={() => void checkNui()} />}
              {step === 2 && <TaxStep d={d} setTax={setTax} errors={errors} />}
              {step === 3 && <UnitsStep d={d} setUnits={(units) => (setErrors({}), setD((x) => ({ ...x, units })))} activities={activities} errors={errors} />}
              {step === 4 && (
                <div className="flex flex-col gap-6">
                  <DocumentsBlock
                    {...docItems()}
                    onCertificate={(f) => setCert(local(f))}
                    onOthers={(fs) => setOthers((x) => [...x, ...fs.map(local)].slice(0, 19))}
                    error={docError}
                    setError={setDocError}
                    busy={phase === 'sending'}
                  />
                  <Section title="Kodi i partnerit" hint="Opsionale – nëse të ka rekomanduar një partner i KontoSef">
                    <div className="max-w-xs">
                      <Input value={d.partner_code} onChange={(e) => setD((x) => ({ ...x, partner_code: e.target.value }))} />
                    </div>
                  </Section>
                  <Section title="Kontrollo të dhënat">
                    <Review d={d} onEdit={go} docs={(cert ? 1 : 0) + others.length} />
                  </Section>
                  <Section title="Fjalëkalimi i llogarisë" hint={`Hyrja: ${d.company.email || 'email-i yt'}`}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input label="Fjalëkalimi (të paktën 8 shenja)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      <Input label="Përsërite fjalëkalimin" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
                    </div>
                    <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
                    <label className="mt-5 flex items-start gap-3 text-[14px]">
                      <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] accent-brand-600" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                      <span>Pranoj kushtet e përdorimit dhe që të dhënat të përdoren për aktivizimin e arkës dhe fiskalizimin në ATK.</span>
                    </label>
                  </Section>
                  {sendError && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{sendError}</p>}
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                {step > 1 ? (
                  <Button variant="secondary" onClick={() => go(step - 1)} disabled={phase === 'sending'}>
                    <ArrowLeft className="h-4 w-4" /> Kthehu
                  </Button>
                ) : (
                  <span className="text-sm text-muted">
                    Ke llogari?{' '}
                    <Link to="/login" className="font-semibold text-brand-600 hover:underline">
                      Hyr
                    </Link>
                  </span>
                )}
                {step < 4 ? (
                  <Button onClick={() => void next()} loading={nuiState === 'checking'}>
                    Vazhdo <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="lg" loading={phase === 'sending'} onClick={() => void submit()}>
                    Dërgo aplikimin
                  </Button>
                )}
              </div>
            </div>
            {Object.keys(errors).length > 0 && <p className="mt-3 text-center text-sm text-warn-700">Plotëso fushat e shënuara me të kuqe.</p>}
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}
