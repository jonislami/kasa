import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Card } from '@/components/ui'
import { isManagerRole } from '@/lib/business'
import { device } from '@/lib/device'
import { fetchFiscalContext, isFiscalHere, registerOnDevice, type FiscalContext } from '@/lib/fiscal'

/**
 * ATK gives a verification code only once per POS ID: asking again for the same POS answers 404.
 * The till then needs another POS ID (set on the web, Fiskalizimi → POS ID).
 */
export function explainAtkError(message: string): string {
  if (/verify request/i.test(message) && /404/.test(message))
    return `${message}. ATK nuk e verifikon dy herë të njëjtën POS ID (ose të dhënat nuk përputhen me ATK-në). Vendos një POS ID tjetër për këtë arkë te Fiskalizimi në web dhe provo përsëri.`
  return message
}

/** The register this till works on (chosen at the till, or set by the activation key / the admin). */
export const tillRegisterId = (businessId: string) => localStorage.getItem(`kasa.register.${businessId}`)

export interface TillFiscalState {
  ctx: FiscalContext | null
  here: boolean
  /** What is still missing before this till can be registered at ATK (empty = ready). */
  missing: string[]
  /** Registered at ATK, but on another device. */
  elsewhere: boolean
}

export async function tillFiscalState(registerId: string): Promise<TillFiscalState | null> {
  const ctx = await fetchFiscalContext(registerId)
  if (!ctx) return null // fiscalization not set up on the server yet
  const here = await isFiscalHere(ctx)
  const r = ctx.register
  const elsewhere = Boolean(r?.status === 'registered' && r.device_id && r.device_id !== (await device.getDeviceId()))
  const missing: string[] = []
  if (!ctx.nui || !ctx.fiscal_number || !ctx.branch_id) missing.push('njësia fiskale (NUI, numri i fiskalizimit, numri i njësisë) te Fiskalizimi në web')
  if (!r?.pos_id) missing.push('POS ID-ja e kësaj arke te Fiskalizimi në web')
  if (!ctx.application_id) missing.push('kodi i SEF-it nga ATK (Application ID) – e vendos administratori i Kasa-s')
  return { ctx, here, missing, elsewhere }
}

/**
 * SEF app: fiscal state of this till and, for the owner / manager signed in with PIN, the button that
 * registers it at ATK. The key is created here, on the till, and never leaves it.
 */
export function TillFiscalCard() {
  const { business, profile } = useBusiness()
  const qc = useQueryClient()
  const registerId = tillRegisterId(business.id)
  const canRegister = isManagerRole(profile.actual_role ?? profile.role)
  const state = useQuery({
    queryKey: ['till-fiscal', registerId],
    queryFn: () => tillFiscalState(registerId!),
    enabled: Boolean(registerId),
    retry: false,
  })
  const [step, setStep] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () => registerOnDevice(registerId!, setStep),
    onSettled: () => {
      setStep(null)
      void qc.invalidateQueries({ queryKey: ['till-fiscal'] })
      void qc.invalidateQueries({ queryKey: ['fiscal-context'] })
    },
  })

  if (!registerId)
    return (
      <Card className="p-5 text-sm text-muted">
        <b className="text-ink">Fiskalizimi:</b> hap arkën njëherë që të zgjidhet arka e kësaj pajisjeje.
      </Card>
    )
  if (state.isLoading) return null
  if (state.error) return <Card className="p-5 text-sm text-warn-700">{(state.error as Error).message}</Card>
  const s = state.data
  if (!s) return null
  const r = s.ctx?.register

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-brand-600" />
        <h2 className="flex-1 text-[17px] font-semibold">Fiskalizimi i kësaj arke{r ? ` · ${r.name}` : ''}</h2>
        {s.here ? <Badge tone="success">E regjistruar në ATK</Badge> : <Badge>Pa regjistruar</Badge>}
        {s.here && r?.env === 'test' && <Badge tone="info">Test</Badge>}
      </div>

      {s.here ? (
        <p className="mt-3 flex items-start gap-2 text-[15px]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          Çdo shitje në këtë arkë nënshkruhet dhe dërgohet në ATK para printimit{r?.pos_id ? ` (POS ID ${r.pos_id})` : ''}.
        </p>
      ) : s.elsewhere ? (
        <p className="mt-3 flex items-start gap-2 text-[15px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          Kjo arkë është e regjistruar në një pajisje tjetër. Pronari e çregjistron te Fiskalizimi në web, pastaj regjistrohet këtu.
        </p>
      ) : s.missing.length > 0 ? (
        <div className="mt-3 text-[15px]">
          <p>Para regjistrimit në ATK mungon:</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {s.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : canRegister ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[15px]">
            Arka është gati për ATK. Regjistrimi krijon çelësin e arkës <b>në këtë pajisje</b> (nuk kopjohet dot) dhe merr certifikatën nga ATK.
          </p>
          {step && <p className="rounded-ctl bg-[#F2F5F2] px-4 py-2.5 text-sm">{step}</p>}
          {run.error && <p className="rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{explainAtkError((run.error as Error).message)}</p>}
          <div>
            <Button loading={run.isPending} onClick={() => run.mutate()}>
              <ShieldCheck className="h-4 w-4" /> Regjistro arkën në ATK
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[15px] text-muted">Arka është gati për ATK. Pronari ose menaxheri hyn me PIN-in e vet në këtë arkë dhe e regjistron këtu.</p>
      )}
    </Card>
  )
}

/** Strip in the till for the owner / manager while this till is not registered at ATK yet. */
export function TillFiscalBanner() {
  const { business, profile } = useBusiness()
  const registerId = tillRegisterId(business.id)
  const manager = isManagerRole(profile.actual_role ?? profile.role)
  const state = useQuery({
    queryKey: ['till-fiscal', registerId],
    queryFn: () => tillFiscalState(registerId!),
    enabled: Boolean(registerId) && manager,
    retry: false,
    staleTime: 10 * 60_000,
  })
  const s = state.data
  if (!manager || !s || s.here || s.elsewhere || s.missing.length > 0) return null
  return (
    <div className="px-4 pt-3 md:px-8 md:pt-5 print:hidden">
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-[#F5D98B] bg-amber-100 px-4 py-3 text-sm text-amber-700">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 font-semibold">Kjo arkë nuk është regjistruar ende në ATK.</span>
        <Link to="/cilesimet" className="font-semibold underline">
          Regjistroje
        </Link>
      </div>
    </div>
  )
}
