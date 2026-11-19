import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Button, Dialog, Input } from '@/components/ui'
import { BUSINESS_TYPE_LIST, businessType, type BusinessType } from '@/lib/business'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'

async function setBusinessType(id: string, type: BusinessType, note: string) {
  const { data, error } = await supabase.rpc('platform_set_business_type', { p_business: id, p_type: type, p_note: note || null })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) throw new Error('Ndryshimi i llojit kërkon migrimin 0043 në Supabase.')
    throw new Error(error.message)
  }
  return data as { type: BusinessType; changed: boolean; products_recategorized?: number; sales?: number }
}

/**
 * Platform admin: corrects the type of a business (e.g. "Market" chosen instead of "Kafiterie / Restorant").
 * Sales and stock stay; the modules of the program follow the new type; products with the old type's default ATK
 * category get the new default (0043).
 */
export function BusinessTypeDialog({ open, businessId, current, onClose, onDone }: { open: boolean; businessId: string; current: BusinessType; onClose: () => void; onDone: (msg: string) => void }) {
  const [type, setType] = useState<BusinessType>(current)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open) {
      setType(current)
      setNote('')
    }
  }, [open, current])
  const save = useMutation({
    mutationFn: () => setBusinessType(businessId, type, note.trim()),
    onSuccess: (r) =>
      onDone(
        r.changed
          ? `Lloji u ndryshua në “${businessType(r.type).label}”${r.products_recategorized ? ` · ${r.products_recategorized} produkte morën kategorinë ATK të llojit të ri` : ''}.`
          : 'Lloji ishte i njëjtë.',
      ),
  })
  return (
    <Dialog
      open={open}
      onClose={() => !save.isPending && onClose()}
      title="Ndrysho llojin e biznesit"
      subtitle={`Tani: ${businessType(current).label}`}
      width="md:max-w-[560px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} disabled={type === current} onClick={() => save.mutate()}>
            Ndrysho llojin
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {BUSINESS_TYPE_LIST.map((t) => (
          <button
            key={t.code}
            type="button"
            onClick={() => setType(t.code as BusinessType)}
            aria-pressed={type === t.code}
            className={cn('flex min-h-[64px] flex-col items-start justify-center rounded-ctl border px-3 py-2 text-left', type === t.code ? 'border-brand-600 bg-brand-100/60' : 'border-line hover:border-field')}
          >
            <span className="text-sm font-semibold text-ink">{t.label}</span>
            <span className="text-[12px] leading-tight text-muted">{t.description}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <Input label="Arsyeja (shkruhet në historik)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="p.sh. klienti zgjodhi gabim llojin" />
      </div>
      <p className="mt-4 flex gap-2 rounded-ctl bg-amber-100 px-4 py-3 text-sm text-amber-700">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Ndryshojnë modulet e programit (p.sh. tavolinat dhe kuzhina për restorantin). Produktet, shitjet, stoku dhe kuponët mbeten. Arkat e
          hapura e marrin llojin e ri kur rifreskohen ose shtypin “Sinkronizo”.
        </span>
      </p>
      {save.error && <p className="mt-3 text-sm text-warn-700">{(save.error as Error).message}</p>}
    </Dialog>
  )
}
