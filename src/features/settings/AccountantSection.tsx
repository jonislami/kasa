import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator } from 'lucide-react'
import { useBusiness } from '@/app/AuthProvider'
import { Badge, Button, Card, Dialog, EmptyState } from '@/components/ui'
import { loadState, OfflineEmpty } from '@/components/ui/LoadState'
import { formatKosovoDateTime } from '@/lib/clock'
import { AccountingNotMigrated, fetchAccountants, respondAccountantRequest, revokeAccountant, type BusinessAccountant } from '@/features/accounting/api'

/**
 * Cilësimet → Kontabilisti. The accountant works in the separate "Kasa Kontabilist" program and asks
 * for access with this business's NUI; the owner approves here and can take the access away.
 */
export function AccountantSection() {
  const { business, profile } = useBusiness()
  const owner = profile.role === 'admin'
  const qc = useQueryClient()
  const [revoking, setRevoking] = useState<BusinessAccountant | null>(null)

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
            Kontabilisti punon me programin <strong>Kasa Kontabilist</strong> dhe kërkon qasje me NUI-n e biznesit tënd. Pasi ta miratosh, ai sheh shitjet, blerjet, stokun, raportet
            dhe TVSH-në – vetëm lexim. Nuk shet, nuk ndryshon çmime apo stok dhe nuk i sheh punëtorët, PIN-et, arkat e cilësimet.
          </p>
          {!business.nui && (
            <p className="mt-3 rounded-ctl bg-amber-100 px-4 py-2.5 text-sm text-amber-700">
              Biznesi nuk ka NUI te "Të dhënat e biznesit". Pa NUI kontabilisti nuk mund ta gjejë biznesin.
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
            text={business.nui ? `Jepja kontabilistit NUI-n ${business.nui}. Kur ta kërkojë qasjen, kërkesa del këtu.` : 'Shkruaj NUI-n te "Të dhënat e biznesit", pastaj jepja kontabilistit.'}
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
            <strong>{revoking.full_name || revoking.email}</strong> nuk do t'i shohë më të dhënat e këtij biznesi. Nëse kërkon qasje përsëri, kërkesa del këtu.
          </p>
        )}
      </Dialog>
    </>
  )
}
