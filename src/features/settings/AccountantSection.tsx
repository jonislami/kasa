import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, UserPlus } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Card, Dialog, EmptyState, Input } from '@/components/ui'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { formatKosovoDateTime } from '@/lib/clock'
import { AccountingNotMigrated, addAccountantByEmail, fetchAccountants, respondAccountantRequest, revokeAccountant, type BusinessAccountant } from '@/features/accounting/api'

/**
 * Cilësimet → Kontabilisti. The accountant works in the separate "Kasa Kontabilist" program. Two ways in:
 *  - the owner adds the accountant here with the accountant's email → the business appears at once among
 *    the accountant's clients (already approved);
 *  - the accountant asks for access with this business's NUI → the owner approves here.
 * The owner can take the access away at any time.
 */
export function AccountantSection() {
  const { business, profile } = useBusiness()
  const owner = profile.role === 'admin'
  const qc = useQueryClient()
  const [revoking, setRevoking] = useState<BusinessAccountant | null>(null)
  const [email, setEmail] = useState('')
  const [added, setAdded] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['accountants', business.id],
    queryFn: fetchAccountants,
    retry: (count, e) => !(e instanceof AccountingNotMigrated) && count < 1,
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['accountants', business.id] })

  const respond = useMutation({
    mutationFn: ({ a, approve }: { a: BusinessAccountant; approve: boolean }) => respondAccountantRequest(a.client_id, approve),
    onSuccess: refresh,
  })
  const add = useMutation({
    mutationFn: () => addAccountantByEmail(email),
    onSuccess: (a) => {
      setAdded([a.full_name, a.office_name].filter(Boolean).join(' · ') || email.trim())
      setEmail('')
      refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (a: BusinessAccountant) => revokeAccountant(a.user_id),
    onSuccess: () => {
      setRevoking(null)
      refresh()
    },
  })

  if (list.error instanceof AccountingNotMigrated) {
    return (
      <Card>
        <EmptyState icon={<Calculator className="h-6 w-6" />} title="Kontabilisti nuk është aktivizuar ende" text="Administratori duhet të ekzekutojë migrimin supabase/migrations/0013_accountant_app.sql në Supabase." />
      </Card>
    )
  }

  const rows = list.data ?? []
  const pending = rows.filter((a) => a.status === 'pending')
  const approved = rows.filter((a) => a.status === 'approved')

  const person = (a: BusinessAccountant) => (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{a.full_name || a.email}</span>
        {a.office_name && <span className="text-sm text-muted">· {a.office_name}</span>}
      </div>
      <div className="truncate text-sm text-muted">{[a.email, a.phone].filter(Boolean).join(' · ')}</div>
    </div>
  )

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-[17px] font-semibold">Kontabilisti</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Kontabilisti punon me programin <strong>Kasa Kontabilist</strong>. Shtoje këtu me email-in e tij, ose ai kërkon qasje me NUI-n e biznesit tënd dhe ti e miraton. Me
            qasje, ai sheh shitjet, blerjet, stokun, raportet dhe TVSH-në – vetëm lexim. Nuk shet, nuk ndryshon çmime apo stok dhe nuk i sheh punëtorët, PIN-et, arkat e cilësimet.
          </p>
          {!business.nui && (
            <p className="mt-3 rounded-ctl bg-amber-100 px-4 py-2.5 text-sm text-amber-700">
              Biznesi nuk ka NUI te "Të dhënat e biznesit". Pa NUI kontabilisti nuk mund ta kërkojë qasjen vetë – shtoje me email.
            </p>
          )}
          {owner && (
            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                setAdded(null)
                if (email.trim()) add.mutate()
              }}
            >
              <div className="flex-1 sm:max-w-sm">
                <Input
                  type="email"
                  label="Shto kontabilistin me email"
                  placeholder="email-i i kontabilistit"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    add.reset()
                  }}
                />
              </div>
              <Button type="submit" className="h-[46px]" loading={add.isPending} disabled={!email.trim()}>
                <UserPlus className="h-4 w-4" />
                Shto
              </Button>
            </form>
          )}
          {add.error && <p className="mt-2 rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{(add.error as Error).message}</p>}
          {added && (
            <p className="mt-2 rounded-ctl bg-brand-100 px-4 py-2.5 text-sm text-brand-600">
              U shtua: <strong>{added}</strong>. Biznesi i del menjëherë te klientët në programin Kasa Kontabilist.
            </p>
          )}
        </div>

        {(respond.error || revoke.error) && <p className="mx-5 mt-4 rounded-ctl bg-warn-100 px-4 py-2.5 text-sm text-warn-700">{((respond.error ?? revoke.error) as Error).message}</p>}

        {loadState(list) === 'offline' ? (
          <OfflineEmpty />
        ) : loadState(list) === 'loading' ? (
          <p className="px-5 py-8 text-center text-muted">Duke ngarkuar…</p>
        ) : loadState(list) === 'error' ? (
          <p className="px-5 py-6 text-sm text-warn-700">{(list.error as Error).message}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Calculator className="h-6 w-6" />}
            title="Asnjë kontabilist"
            text={business.nui ? `Shtoje me email më lart, ose jepja kontabilistit NUI-n ${business.nui} – kërkesa e tij del këtu.` : 'Shtoje me email më lart, ose shkruaj NUI-n te "Të dhënat e biznesit" që ai ta kërkojë qasjen.'}
          />
        ) : (
          <div className="mt-4 border-t border-line">
            {pending.length > 0 && (
              <>
                <div className="bg-[#F8FAF8] px-5 py-2 text-[13px] font-semibold text-muted">Kërkesa për qasje</div>
                <ul className="divide-y divide-line">
                  {pending.map((a) => (
                    <li key={a.client_id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      {person(a)}
                      <span className="text-sm text-muted">{a.requested_at ? formatKosovoDateTime(a.requested_at) : ''}</span>
                      {owner ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" disabled={respond.isPending} onClick={() => respond.mutate({ a, approve: false })}>
                            Refuzo
                          </Button>
                          <Button size="sm" className="h-9" loading={respond.isPending && respond.variables?.a.client_id === a.client_id} onClick={() => respond.mutate({ a, approve: true })}>
                            Mirato
                          </Button>
                        </div>
                      ) : (
                        <Badge tone="amber">Pret pronarin</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {approved.length > 0 && (
              <>
                <div className="border-t border-line bg-[#F8FAF8] px-5 py-2 text-[13px] font-semibold text-muted">Me qasje</div>
                <ul className="divide-y divide-line">
                  {approved.map((a) => (
                    <li key={a.client_id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      {person(a)}
                      <span className="text-sm text-muted">{a.last_opened_at ? `hapi librat ${formatKosovoDateTime(a.last_opened_at)}` : 'ende pa i hapur librat'}</span>
                      <Badge tone="success">Ka qasje</Badge>
                      {owner && (
                        <Button size="sm" variant="danger" onClick={() => setRevoking(a)}>
                          Hiq qasjen
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {!owner && rows.length > 0 && <p className="border-t border-line px-5 py-3 text-sm text-muted">Vetëm pronari i miraton kërkesat dhe e heq qasjen.</p>}
      </Card>

      <Dialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title="Të hiqet qasja?"
        width="md:max-w-[440px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              Anulo
            </Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)}>
              Hiq qasjen
            </Button>
          </div>
        }
      >
        {revoking && (
          <p className="text-[15px]">
            <strong>{revoking.full_name || revoking.email}</strong> nuk do t'i shohë më të dhënat e këtij biznesi. Mund ta shtosh përsëri kur të duash.
          </p>
        )}
      </Dialog>
    </>
  )
}
