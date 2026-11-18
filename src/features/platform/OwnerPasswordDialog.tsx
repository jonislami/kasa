import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link2, Mail } from 'lucide-react'
import { Button, Dialog, Input, Tabs } from '@/components/ui'
import { copy, CopyField, type Credentials } from './CredentialsDialog'
import { generatePassword, MIN_PASSWORD, ownerPasswordLink, resetOwnerPassword, type PlatformBusiness } from './api'

type Mode = 'link' | 'set'

/**
 * The owner's password, from the platform admin:
 *  - "Dërgo link": a one-time link (WhatsApp, e-mail or copy); the owner opens it and chooses the password himself
 *  - "Vendos vetë": the admin types any password (Supabase's minimum is the only rule) and passes it on
 */
export function OwnerPasswordDialog({
  business,
  onClose,
  onSaved,
}: {
  business: PlatformBusiness | null
  onClose: () => void
  onSaved: (c: Credentials) => void
}) {
  const [mode, setMode] = useState<Mode>('link')
  const [sendEmail, setSendEmail] = useState(true)
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)

  const link = useMutation({ mutationFn: (b: PlatformBusiness) => ownerPasswordLink(b.id, sendEmail) })
  const save = useMutation({
    mutationFn: async (b: PlatformBusiness) => ({ b, res: await resetOwnerPassword(b.id, password) }),
    onSuccess: ({ b, res }) => onSaved({ title: `Fjalëkalim i ri për ${b.name}`, ownerName: b.owner_name ?? 'pronari', email: res.email, password }),
  })

  // a fresh start every time the dialog opens
  useEffect(() => {
    if (!business) return
    setMode('link')
    setSendEmail(true)
    setPassword(generatePassword())
    setCopied(false)
    link.reset()
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id])

  if (!business) return null
  const owner = business.owner_name ?? 'pronari'
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const message = link.data
    ? `Përshëndetje ${owner},\n\nHape këtë link dhe zgjidh fjalëkalimin e ri për KontoSef.app:\n${link.data.link}\n\nLinku vlen vetëm një herë dhe skadon pas pak kohe.`
    : ''

  return (
    <Dialog
      open
      onClose={onClose}
      width="md:max-w-[540px]"
      title="Fjalëkalimi i pronarit"
      subtitle={`${business.name} · ${business.owner_email ?? 'pa email'}`}
      footer={
        mode === 'link' ? (
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={onClose}>
              {link.data ? 'Mbyll' : 'Anulo'}
            </Button>
            {!link.data && (
              <Button loading={link.isPending} onClick={() => link.mutate(business)}>
                <Link2 className="h-4 w-4" /> Krijo linkun
              </Button>
            )}
          </div>
        ) : (
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={onClose}>
              Anulo
            </Button>
            <Button loading={save.isPending} disabled={password.length < MIN_PASSWORD} onClick={() => save.mutate(business)}>
              Ruaj fjalëkalimin
            </Button>
          </div>
        )
      }
    >
      <Tabs
        className="mb-5 w-full"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'link', label: 'Dërgo link' },
          { value: 'set', label: 'Vendos vetë' },
        ]}
      />

      {mode === 'link' ? (
        link.data ? (
          <div className="flex flex-col gap-4">
            {link.data.emailed ? (
              <p className="rounded-ctl border border-[#ABEFC6] bg-ok-100 px-4 py-3 text-sm text-ok-700">
                Linku u dërgua me email te <b>{link.data.email}</b>. Mund ta dërgosh edhe në WhatsApp.
              </p>
            ) : (
              sendEmail && (
                <p className="rounded-ctl border border-[#F1DFA8] bg-amber-100 px-4 py-3 text-sm text-amber-700">
                  Email-i nuk u dërgua (shërbimi i email-it nuk është vendosur). Dërgoje linkun në WhatsApp ose kopjoje.
                </p>
              )
            )}
            <CopyField label="Linku për fjalëkalimin e ri" value={link.data.link} compact />
            <p className="text-[13px] text-muted">
              Linku hapet vetëm një herë dhe skadon pas pak kohe (1 orë sipas cilësimit të Supabase). Fjalëkalimi i vjetër punon derisa
              pronari ta ndryshojë.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-btn items-center justify-center rounded-ctl bg-[#067647] px-4 text-[14px] font-semibold text-white hover:bg-[#05603A]"
              >
                WhatsApp
              </a>
              <a
                href={`mailto:${link.data.email}?subject=${encodeURIComponent('Fjalëkalimi i ri – KontoSef.app')}&body=${encodeURIComponent(message)}`}
                className="flex min-h-btn items-center justify-center gap-2 rounded-ctl border border-field bg-white px-4 text-[14px] font-semibold text-ink shadow-card hover:bg-[#F9FAFB]"
              >
                <Mail className="h-4 w-4" /> Email
              </a>
              <Button
                variant="secondary"
                onClick={async () => {
                  if (await copy(message)) {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }
                }}
              >
                {copied ? 'U kopjua' : 'Kopjo mesazhin'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[15px] text-muted">
              Pronari ({business.owner_email}) hap linkun dhe <b className="text-ink">zgjedh vetë fjalëkalimin e ri</b>. Ti nuk e sheh
              fjalëkalimin; i vjetri punon derisa ta ndryshojë.
            </p>
            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[#344054]">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4 rounded accent-brand-600" />
              Dërgoje edhe me email te {business.owner_email}
            </label>
            {link.error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{(link.error as Error).message}</p>}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <Input
            label="Fjalëkalimi i ri"
            mono
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={tooShort ? `Të paktën ${MIN_PASSWORD} shenja` : null}
            hint={`Shkruaj çfarëdo fjalëkalimi (të paktën ${MIN_PASSWORD} shenja), ose gjenero një.`}
            labelRight={
              <button type="button" className="text-[13px] font-medium text-brand-600 hover:underline" onClick={() => setPassword(generatePassword())}>
                Gjenero
              </button>
            }
          />
          <p className="text-[14px] text-muted">Fjalëkalimi i vjetër i pronarit nuk punon më pasi ta ruash. Pastaj ia dërgon të dhënat.</p>
          {save.error && <p className="rounded-ctl bg-warn-100 px-4 py-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
        </div>
      )}
    </Dialog>
  )
}
