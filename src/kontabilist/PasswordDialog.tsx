import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Dialog, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [done, setDone] = useState(false)
  const save = useMutation({
    mutationFn: async () => {
      if (a.length < 8) throw new Error('Fjalëkalimi duhet të ketë të paktën 8 shenja')
      if (a !== b) throw new Error('Fjalëkalimet nuk përputhen')
      const { error } = await supabase.auth.updateUser({ password: a })
      if (error) throw new Error(/different from the old/i.test(error.message) ? 'Zgjidh një fjalëkalim të ndryshëm nga i vjetri' : error.message)
    },
    onSuccess: () => {
      setA('')
      setB('')
      setDone(true)
    },
  })
  const close = () => {
    save.reset()
    setDone(false)
    setA('')
    setB('')
    onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Ndrysho fjalëkalimin"
      width="md:max-w-[440px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {done ? 'Mbyll' : 'Anulo'}
          </Button>
          {!done && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Ruaj
            </Button>
          )}
        </div>
      }
    >
      {done ? (
        <p className="rounded-ctl bg-brand-100 px-4 py-3 text-brand-600">Fjalëkalimi u ndryshua.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Input label="Fjalëkalimi i ri" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} hint="Të paktën 8 shenja" />
          <Input label="Përsërite" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} error={save.error ? (save.error as Error).message : null} />
          <button type="submit" className="hidden" />
        </form>
      )}
    </Dialog>
  )
}

