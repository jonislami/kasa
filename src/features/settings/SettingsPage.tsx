import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { PageHeader } from '@/app/layout/AppLayout'
import { Badge, Button, Card, Input, Select } from '@/components/ui'
import { isManagerRole } from '@/lib/business'
import { cn } from '@/lib/cn'
import { device } from '@/lib/device'
import { myPinStatus, setOwnPin } from '@/features/pos/api'
import { BackupSection } from './BackupSection'
import { BusinessSection } from './BusinessSection'
import { PrinterSection } from './PrinterSection'
import { RegistersSection } from './RegistersSection'
import { UsersSection } from './UsersSection'
import { InstallCard } from '@/app/AppStatus'

type Section = 'biznesi' | 'printeri' | 'perdoruesit' | 'arkat' | 'tvsh' | 'backup'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'biznesi', label: 'Të dhënat e biznesit' },
  { value: 'printeri', label: 'Printeri & Fatura' },
  { value: 'perdoruesit', label: 'Përdoruesit & PIN-et' },
  { value: 'arkat', label: 'Arkat & pajisjet' },
  { value: 'tvsh', label: 'TVSH & Taksat' },
  { value: 'backup', label: 'Kopje rezervë (Backup)' },
]

export function SettingsPage() {
  const { profile } = useBusiness()
  const manager = isManagerRole(profile.role)
  const [params, setParams] = useSearchParams()
  const section = (SECTIONS.some((s) => s.value === params.get('s')) ? params.get('s') : manager ? 'biznesi' : 'printeri') as Section

  if (!manager) {
    return (
      <>
        <PageHeader title="Printeri" />
        <div className="px-4 py-5 md:px-8 md:py-0 md:pb-8">
          <InstallCard className="mb-5" />
          <PrinterSection />
          <p className="mt-6 text-center text-sm text-muted">Kasa v{device.appVersion}</p>
        </div>
      </>
    )
  }

  const go = (s: Section) => setParams({ s }, { replace: true })

  return (
    <>
      <PageHeader title="Cilësimet" />
      <p className="-mt-5 hidden px-8 pb-5 text-muted md:block">Menaxho biznesin, printerin, faturën dhe përdoruesit</p>
      <div className="flex flex-col gap-5 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-0 lg:flex-row lg:items-start">
        <nav className="hidden w-[220px] shrink-0 flex-col gap-1 lg:flex" aria-label="Seksionet">
          {SECTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => go(s.value)}
              className={cn('rounded-ctl px-4 py-3 text-left text-[15px]', section === s.value ? 'bg-white font-semibold shadow-sm' : 'text-muted hover:bg-white/60 hover:text-ink')}
            >
              {s.label}
            </button>
          ))}
          <p className="mt-4 px-4 text-xs text-muted">Kasa v{device.appVersion}</p>
        </nav>
        <div className="lg:hidden">
          <Select aria-label="Seksioni" value={section} onChange={(e) => go(e.target.value as Section)} options={SECTIONS} />
        </div>
        <div className="min-w-0 flex-1">
          <InstallCard className="mb-5" />
          {section === 'biznesi' && <BusinessSection />}
          {section === 'printeri' && <PrinterSection />}
          {section === 'perdoruesit' && (
            <div className="flex flex-col gap-5">
              <PinCard />
              <UsersSection />
            </div>
          )}
          {section === 'arkat' && <RegistersSection />}
          {section === 'tvsh' && <VatSection />}
          {section === 'backup' && <BackupSection />}
        </div>
      </div>
    </>
  )
}

function VatSection() {
  const rows = [
    ['E', '18%', 'Norma standarde – shumica e mallrave dhe shërbimeve'],
    ['D', '8%', 'Norma e reduktuar – ushqime bazë, ujë, barna, etj. (Ligji 05/L-037)'],
    ['C', '0%', 'Furnizime me normë zero (eksport, raste të veçanta)'],
    ['A', 'e liruar', 'Furnizime të liruara nga TVSH-ja'],
  ]
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5">
        <h2 className="text-[17px] font-semibold">TVSH & Taksat</h2>
        <p className="mt-1 text-sm text-muted">
          Shkronjat sipas ATK-së. Çmimet e shitjes janë me TVSH të përfshirë; TVSH llogaritet një herë për normë mbi shumën e asaj norme. Norma caktohet te çdo produkt.
        </p>
      </div>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {rows.map(([code, rate, text]) => (
            <tr key={code} className="border-t border-line">
              <td className="w-14 px-5 py-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#EEF1EE] font-bold">{code}</span>
              </td>
              <td className="w-24 py-3 font-semibold">{rate}</td>
              <td className="py-3 pr-5 text-muted">{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function PinCard() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['my-pin'], queryFn: myPinStatus, retry: false })
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const save = async () => {
    if (!/^\d{4}$/.test(pin)) return setMsg({ ok: false, text: 'PIN-i duhet të ketë 4 shifra' })
    if (pin !== pin2) return setMsg({ ok: false, text: 'PIN-et nuk përputhen' })
    setBusy(true)
    setMsg(null)
    try {
      await setOwnPin(pin)
      setPin('')
      setPin2('')
      setMsg({ ok: true, text: 'PIN-i u ruajt' })
      void qc.invalidateQueries({ queryKey: ['my-pin'] })
      void qc.invalidateQueries({ queryKey: ['approvers'] })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold">PIN-i im</h2>
            <p className="text-sm text-muted">Me të miraton anulimet dhe kthimet që kërkojnë punëtorët.</p>
          </div>
        </div>
        {status.data !== undefined && <Badge tone={status.data ? 'success' : 'amber'}>{status.data ? 'I vendosur' : 'Pa PIN'}</Badge>}
      </div>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Input label={status.data ? 'PIN i ri' : 'PIN (4 shifra)'} type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <Input label="Përsërite" type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
        <Button type="submit" className="h-[46px]" loading={busy}>
          Ruaj PIN-in
        </Button>
      </form>
      {msg && <p className={`mt-3 rounded-ctl px-4 py-2.5 text-sm ${msg.ok ? 'bg-brand-100 text-brand-600' : 'bg-warn-100 text-warn-700'}`}>{msg.text}</p>}
    </Card>
  )
}
