import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { fetchUsers } from '@/features/settings/api'

interface Progress {
  products: boolean
  pins: boolean
  installed: boolean
  fiscal: boolean
}

/** What a new business has done of the first steps (read from its own data; RLS keeps it to the business). */
async function fetchProgress(): Promise<Progress> {
  const [products, users, registers] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
    fetchUsers().catch(() => []),
    supabase.from('registers').select('device_id, fiscal_status').eq('active', true),
  ])
  const regs = (registers.data ?? []) as { device_id: string | null; fiscal_status: string | null }[]
  return {
    products: (products.count ?? 0) > 0,
    pins: users.some((u) => u.active && u.has_pin),
    installed: regs.some((r) => Boolean(r.device_id)),
    fiscal: regs.some((r) => r.fiscal_status === 'registered'),
  }
}

const HIDE_KEY = (businessId: string) => `kasa.firststeps.hidden.${businessId}`

/**
 * "Hapat e parë" on the owner's panel: the steps before the first fiscal sale, each with a ✓ when done and a link to
 * where it is done. Disappears when everything is done, or when the owner hides it.
 */
export function FirstSteps({ businessId }: { businessId: string }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDE_KEY(businessId)) === '1')
  const q = useQuery({ queryKey: ['first-steps'], queryFn: fetchProgress, enabled: !hidden, staleTime: 60_000 })
  if (hidden || !q.data) return null
  const p = q.data
  const steps: { done: boolean; title: string; text: string; to: string; cta: string }[] = [
    { done: p.products, title: 'Shto produktet', text: 'Një nga një ose të gjitha njëherë nga Excel.', to: '/produktet', cta: 'Te produktet' },
    { done: p.pins, title: 'Krijo punëtorët dhe PIN-et', text: 'Çdo punëtor hyn në arkë me PIN-in e vet 4-shifror.', to: '/cilesimet', cta: 'Te përdoruesit' },
    { done: p.installed, title: 'Instalo programin e arkës', text: 'Shkarko KontoSef për Windows ose Android dhe aktivizoje me çelësin e arkës.', to: '/llogaria', cta: 'Çelësat e arkave' },
    { done: p.fiscal, title: 'Regjistro arkën në ATK', text: 'Plotëso njësinë dhe POS ID-në, pastaj në arkë shtyp “Regjistro arkën në ATK”.', to: '/fiskalizimi', cta: 'Te fiskalizimi' },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  const hide = () => {
    localStorage.setItem(HIDE_KEY(businessId), '1')
    setHidden(true)
  }

  return (
    <section aria-labelledby="first-steps-title" className="mx-4 mb-5 rounded-card border border-brand-600/30 bg-white p-5 shadow-card md:mx-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="first-steps-title" className="text-[18px] font-semibold tracking-[-0.015em]">
            Hapat e parë
          </h2>
          <p className="text-[15px] text-muted">
            {done} nga {steps.length} të kryera – pas tyre arka shet me kupon fiskal.
          </p>
        </div>
        <button type="button" onClick={hide} aria-label="Fshihe listën" title="Fshihe listën" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl text-muted hover:bg-bg">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg" aria-hidden="true">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className={cn('flex items-start gap-3 rounded-ctl border px-4 py-3', s.done ? 'border-line bg-bg' : 'border-field bg-white')}>
            {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok-700" aria-hidden="true" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <div className={cn('text-[15px] font-semibold', s.done && 'text-muted line-through')}>
                {i + 1}. {s.title}
                <span className="sr-only">{s.done ? ' – e kryer' : ' – e pakryer'}</span>
              </div>
              {!s.done && (
                <>
                  <p className="text-sm text-muted">{s.text}</p>
                  <Link to={s.to} className="mt-1 inline-block text-[15px] font-semibold text-brand-600 hover:underline">
                    {s.cta} →
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
