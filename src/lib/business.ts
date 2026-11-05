import type { LucideIcon } from 'lucide-react'
import { ShoppingBasket, Coffee, Pill, Shirt, Scissors } from 'lucide-react'

export type BusinessType = 'market' | 'restaurant' | 'pharmacy' | 'boutique' | 'salon'
export type Role = 'admin' | 'manager' | 'worker'

/** Optional modules switched on per business type. */
export type Module =
  | 'barcode'
  | 'weight'
  | 'stock'
  | 'tables'
  | 'kitchen'
  | 'recipes'
  | 'lots'
  | 'variants'
  | 'appointments'
  | 'commission'

export interface BusinessTypeInfo {
  code: BusinessType
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  modules: Module[]
  terms: {
    catalog: string // label for /produktet
    item: string // singular
    items: string // plural
    worker: string // what a worker is called
    newItem: string // "Produkt i ri"
    itemOf: string // "produktit" (Emri i …)
  }
}

export const BUSINESS_TYPES: Record<BusinessType, BusinessTypeInfo> = {
  market: {
    code: 'market',
    label: 'Market',
    shortLabel: 'Market',
    description: 'Barkod, stok, furnitorë',
    icon: ShoppingBasket,
    modules: ['barcode', 'weight', 'stock'],
    terms: { catalog: 'Produktet', item: 'produkt', items: 'produkte', worker: 'Arkëtar', newItem: 'Produkt i ri', itemOf: 'produktit' },
  },
  restaurant: {
    code: 'restaurant',
    label: 'Kafiterie / Restorant',
    shortLabel: 'Kafiterie',
    description: 'Tavolina, kuzhinë',
    icon: Coffee,
    modules: ['tables', 'kitchen', 'recipes', 'stock'],
    terms: { catalog: 'Menuja', item: 'artikull', items: 'artikuj', worker: 'Kamarier', newItem: 'Artikull i ri', itemOf: 'artikullit' },
  },
  pharmacy: {
    code: 'pharmacy',
    label: 'Barnatore',
    shortLabel: 'Barnatore',
    description: 'Seri, afat skadimi',
    icon: Pill,
    modules: ['barcode', 'lots', 'stock'],
    terms: { catalog: 'Barnat', item: 'bar', items: 'barna', worker: 'Farmacist', newItem: 'Bar i ri', itemOf: 'barit' },
  },
  boutique: {
    code: 'boutique',
    label: 'Butik / Veshje & Këpucë',
    shortLabel: 'Butik',
    description: 'Madhësi, ngjyra',
    icon: Shirt,
    modules: ['barcode', 'variants', 'stock'],
    terms: { catalog: 'Artikujt', item: 'artikull', items: 'artikuj', worker: 'Shitës', newItem: 'Artikull i ri', itemOf: 'artikullit' },
  },
  salon: {
    code: 'salon',
    label: 'Sallon / Shërbime',
    shortLabel: 'Sallon',
    description: 'Termine, punëtorë',
    icon: Scissors,
    modules: ['appointments', 'commission'],
    terms: { catalog: 'Shërbimet', item: 'shërbim', items: 'shërbime', worker: 'Punëtor', newItem: 'Shërbim i ri', itemOf: 'shërbimit' },
  },
}

export const BUSINESS_TYPE_LIST: BusinessTypeInfo[] = Object.values(BUSINESS_TYPES)

export function businessType(code: BusinessType | null | undefined): BusinessTypeInfo {
  return BUSINESS_TYPES[code ?? 'market'] ?? BUSINESS_TYPES.market
}

export function hasModule(code: BusinessType | null | undefined, m: Module): boolean {
  return businessType(code).modules.includes(m)
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Pronari',
  manager: 'Menaxher',
  worker: 'Punëtor',
}

export function isManagerRole(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}
