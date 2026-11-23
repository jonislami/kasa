import type { BusinessUnit } from '@/lib/businessUnits'
import { cn } from '@/lib/cn'

/**
 * "Të gjitha njësitë" or some of them. Nothing ticked = every unit (as before), so a new unit needs no change here.
 * Shown only when the business has two or more units.
 */
export function UnitPicker({ label, units, value, onChange, hint }: { label: string; units: BusinessUnit[]; value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  if (units.length < 2) return null
  const all = value.length === 0
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-[#344054]">{label}</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={all}
          onClick={() => onChange([])}
          className={cn('min-h-[40px] rounded-full border px-3.5 text-sm font-medium', all ? 'border-brand-600 bg-brand-100 text-brand-600' : 'border-field bg-white hover:bg-bg')}
        >
          Të gjitha njësitë
        </button>
        {units.map((u) => {
          const on = value.includes(u.id)
          return (
            <button
              key={u.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(u.id)}
              className={cn('min-h-[40px] rounded-full border px-3.5 text-sm font-medium', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-field bg-white hover:bg-bg')}
            >
              {u.name}
            </button>
          )
        })}
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-muted">{hint}</p>}
    </fieldset>
  )
}
