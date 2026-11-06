import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth, useBusiness } from '@/app/AuthProvider'
import { Button, Card, Input } from '@/components/ui'
import { businessType } from '@/lib/business'
import { fetchBusinessInfo, saveBusinessInfo, type BusinessInfo } from './api'

export function BusinessSection() {
  const { business } = useBusiness()
  const { refresh } = useAuth()
  const info = useQuery({ queryKey: ['business-info', business.id], queryFn: () => fetchBusinessInfo(business.id) })
  const [form, setForm] = useState<BusinessInfo | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (info.data) setForm(info.data)
  }, [info.data])

  const save = useMutation({
    mutationFn: () => saveBusinessInfo(form!),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Të dhënat u ruajtën' })
      refresh()
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  })

  if (!form) return <Card className="p-5 text-muted">{info.isError ? (info.error as Error).message : 'Duke ngarkuar…'}</Card>
  const set = (k: keyof BusinessInfo) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f))

  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">Të dhënat e biznesit</h2>
      <p className="mt-1 text-sm text-muted">Dalin në faturë dhe dërgohen te ATK me çdo kupon fiskal. Lloji: {businessType(business.type).label} (nuk ndryshohet).</p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="sm:col-span-2">
          <Input label="Emri i biznesit" value={form.name} onChange={set('name')} />
        </div>
        <Input label="NUI (Numri Unik Identifikues)" inputMode="numeric" maxLength={9} value={form.nui ?? ''} onChange={set('nui')} placeholder="811234567" />
        <Input label="Nr. i TVSH-së" value={form.vat_number ?? ''} onChange={set('vat_number')} placeholder="330123456" />
        <Input label="Nr. fiskal (ATK)" value={form.fiscal_number ?? ''} onChange={set('fiscal_number')} hint="Nga aplikimi për fiskalizim (Faza 9)" />
        <Input label="Telefoni" inputMode="tel" value={form.phone ?? ''} onChange={set('phone')} placeholder="+383 4X XXX XXX" />
        <Input label="Adresa" value={form.address ?? ''} onChange={set('address')} placeholder="Rr. Nëna Terezë 21" />
        <Input label="Qyteti" value={form.city ?? ''} onChange={set('city')} placeholder="Prishtinë" />
        <div className="flex items-center justify-end gap-3 sm:col-span-2">
          {msg && <span className={`text-sm ${msg.ok ? 'text-brand-600' : 'text-warn-700'}`}>{msg.text}</span>}
          <Button type="submit" loading={save.isPending}>
            Ruaj
          </Button>
        </div>
      </form>
    </Card>
  )
}
