import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Dialog, Input, Toggle } from '@/components/ui'
import { saveClient, type ClientInput } from './api'

export const EMPTY_CLIENT: ClientInput = {
  name: '',
  nui: '',
  vat_number: '',
  fiscal_number: '',
  vat_registered: false,
  activity: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  note: '',
}

/** New client / edit client of the accountant (any business, in Kasa or not). */
export function ClientDialog({ value, onClose, onSaved }: { value: ClientInput | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [form, setForm] = useState<ClientInput | null>(null)
  const [seed, setSeed] = useState<ClientInput | null>(null)
  if (value !== seed) {
    setSeed(value)
    setForm(value)
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!form?.name.trim()) throw new Error('Shkruaj emrin e klientit')
      if (form.nui && !/^\d{9}$/.test(form.nui)) throw new Error('NUI ka 9 shifra')
      return saveClient(form)
    },
    onSuccess: (id) => onSaved(id),
  })
  if (!value || !form) return null
  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  return (
    <Dialog
      open
      onClose={() => {
        save.reset()
        onClose()
      }}
      title={form.id ? 'Të dhënat e klientit' : 'Klient i ri'}
      subtitle={form.id ? undefined : 'Çdo biznes – edhe ata që nuk përdorin Kasa. Lidhjen me Kasa e bën pastaj te klienti.'}
      width="md:max-w-[620px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          {save.error && <span className="mr-auto text-sm text-warn-700">{(save.error as Error).message}</span>}
          <Button variant="secondary" onClick={onClose}>
            Anulo
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Ruaj
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="sm:col-span-2">
          <Input label="Emri i biznesit" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="p.sh. Market Lisi SH.P.K." />
        </div>
        <Input label="NUI" inputMode="numeric" maxLength={9} value={form.nui ?? ''} onChange={(e) => set('nui', e.target.value.replace(/\D/g, ''))} placeholder="811234567" />
        <Input
          label="Nr. i TVSH-së"
          value={form.vat_number ?? ''}
          onChange={(e) => {
            const v = e.target.value
            setForm((f) => (f ? { ...f, vat_number: v, vat_registered: v.trim() ? true : f.vat_registered } : f))
          }}
          placeholder="330123456"
        />
        <div className="flex min-h-[46px] items-center justify-between gap-3 rounded-ctl border border-line px-4 sm:col-span-2">
          <div>
            <div className="text-sm font-medium">Në sistemin e TVSH-së</div>
            <div className="text-xs text-muted">Deklaron TVSH çdo muaj; shumat e fitimit llogariten pa TVSH.</div>
          </div>
          <Toggle checked={form.vat_registered} onChange={(v) => set('vat_registered', v)} />
        </div>
        <Input label="Nr. fiskal" value={form.fiscal_number ?? ''} onChange={(e) => set('fiscal_number', e.target.value)} />
        <Input label="Veprimtaria" value={form.activity ?? ''} onChange={(e) => set('activity', e.target.value)} placeholder="p.sh. Tregti me pakicë" />
        <Input label="Adresa" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        <Input label="Qyteti" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        <Input label="Telefoni" inputMode="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        <Input label="Email-i" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        <div className="sm:col-span-2">
          <Input label="Shënim (e sheh vetëm ti)" value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="p.sh. Faturat i sjell të hënën" />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  )
}
