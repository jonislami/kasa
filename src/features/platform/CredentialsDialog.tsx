import { useState } from 'react'
import { Check, KeyRound } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface Credentials {
  title: string // "Market Lisi u krijua" / "Fjalëkalim i ri"
  ownerName: string
  email: string
  password: string
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl border py-1.5 pl-4 pr-1.5',
          highlight ? 'border-brand-600 bg-[#F0F7F3]' : 'border-line bg-[#F6F8F6]',
        )}
      >
        <span className={cn('min-w-0 flex-1 break-all font-mono font-semibold', highlight ? 'text-xl' : 'text-[16px]')}>{value}</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-10 shrink-0"
          onClick={async () => {
            if (await copy(value)) {
              setDone(true)
              setTimeout(() => setDone(false), 1500)
            }
          }}
        >
          {done ? <Check className="h-4 w-4 text-brand-600" /> : 'Kopjo'}
        </Button>
      </div>
    </div>
  )
}

/** Shown once after creating a business or setting a new password. The password is never shown again. */
export function CredentialsDialog({ data, onClose }: { data: Credentials | null; onClose: () => void }) {
  const [copiedAll, setCopiedAll] = useState(false)
  if (!data) return null
  const address = `${window.location.origin}/login`
  const message =
    `Përshëndetje ${data.ownerName},\n\nTë dhënat për hyrje në Kasa:\n` +
    `Adresa: ${address}\nEmail-i: ${data.email}\nFjalëkalimi: ${data.password}\n\n` +
    `Mund të hysh nga çdo pajisje (kompjuter, telefon).`

  return (
    <Dialog open onClose={onClose} dismissable={false} width="md:max-w-[560px]">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <KeyRound className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-[22px] font-semibold">{data.title}</h2>
        <p className="mt-1.5 text-[15px] text-muted">
          Dërgoja këto të dhëna pronarit, {data.ownerName}. Me to hyn në çdo pajisje.
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-4">
        <CopyField label="Adresa" value={address} />
        <CopyField label="Email-i" value={data.email} />
        <CopyField label="Fjalëkalimi" value={data.password} highlight />
      </div>
      <div className="mt-5 rounded-xl bg-warn-100 px-5 py-4 text-sm text-warn-700">
        <strong>Fjalëkalimi nuk shfaqet më</strong> pasi ta mbyllësh këtë dritare. Kopjoje ose dërgoje tani. Nëse humbet, krijo një të ri
        nga "Fjalëkalim i ri".
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-[52px] items-center justify-center rounded-xl bg-[#0F7A43] font-semibold text-white hover:brightness-110"
        >
          Dërgo në WhatsApp
        </a>
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            variant="secondary"
            size="lg"
            onClick={async () => {
              if (await copy(message)) {
                setCopiedAll(true)
                setTimeout(() => setCopiedAll(false), 1500)
              }
            }}
          >
            {copiedAll ? 'U kopjuan' : 'Kopjo të gjitha'}
          </Button>
          <Button variant="dark" size="lg" onClick={onClose}>
            Mbyll
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
