// Navigation of KontoSef Kontabilist: the office pages and the menu of one company, grouped the way an
// accountant closes a month (documents → money → ledger → reports → taxes → payroll).
import {
  Archive,
  BookOpen,
  BookText,
  Boxes,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Landmark,
  LayoutGrid,
  ListTree,
  Lock,
  Package,
  Percent,
  Receipt,
  Scale,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  Store,
  TrendingUp,
  UserCog,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'

export interface MenuItem {
  key: string
  label: string
  icon: LucideIcon
  kasaOnly?: boolean
  /** Extra words the global search matches (abbreviations, ATK form codes). */
  keywords?: string
}

export interface MenuGroup {
  group: string
  items: MenuItem[]
}

export const MENU: MenuGroup[] = [
  {
    group: 'Përmbledhje',
    items: [
      { key: 'paneli', label: 'Paneli', icon: LayoutGrid, keywords: 'dashboard ballina' },
      { key: 'pasqyra', label: 'Pasqyra e periudhës', icon: FileBarChart },
    ],
  },
  {
    group: 'Dokumentet',
    items: [
      { key: 'shitjet', label: 'Faturat e shitjes', icon: Receipt, keywords: 'fatura shitje' },
      { key: 'blerjet', label: 'Blerjet dhe shpenzimet', icon: ShoppingCart, keywords: 'fatura blerje shpenzim' },
      { key: 'proformat', label: 'Proformat', icon: FileText },
      { key: 'skanimi', label: 'Skanimi me AI', icon: ScanLine, keywords: 'ocr skano' },
      { key: 'partneret', label: 'Klientët dhe furnitorët', icon: Users, keywords: 'partner furnitor bleres' },
    ],
  },
  {
    group: 'Thesari',
    items: [
      { key: 'banka', label: 'Arka dhe banka', icon: Landmark, keywords: 'ekstrakt rakordim kesh' },
      { key: 'borxhet', label: 'Borxhet dhe detyrimet', icon: HandCoins, keywords: 'borxhet detyrimet vjetersia' },
    ],
  },
  {
    group: 'Libri kontabël',
    items: [
      { key: 'ditari', label: 'Ditari', icon: BookOpen, keywords: 'journal regjistrim' },
      { key: 'libri', label: 'Libri kryesor', icon: BookText, keywords: 'ledger kartela' },
      { key: 'bilanci', label: 'Bilanci provues', icon: Scale },
      { key: 'konto', label: 'Plani kontabël', icon: ListTree, keywords: 'kontot' },
      { key: 'asetet', label: 'Mjetet themelore', icon: Boxes, keywords: 'amortizimi asetet' },
      { key: 'mbyllja', label: 'Mbyllja e muajit', icon: Lock },
    ],
  },
  {
    group: 'Raportet',
    items: [
      { key: 'pasqyrat', label: 'Pasqyrat financiare', icon: FileBarChart, keywords: 'bilanci i gjendjes pf' },
      { key: 'fitimi', label: 'Fitimi dhe humbja', icon: TrendingUp },
      { key: 'tvsh_permbledhje', label: 'TVSH sipas normave', icon: FileBarChart },
    ],
  },
  {
    group: 'Tatimet – ATK',
    items: [
      { key: 'kontrolli', label: 'Kontrolli para dorëzimit', icon: ShieldCheck, keywords: 'validimi gabimet' },
      { key: 'tvsh', label: 'Deklarata e TVSH-së', icon: Percent, keywords: 'tv formulari' },
      { key: 'librat_atk', label: 'Libri i shitjes dhe blerjes', icon: BookOpen, keywords: 'lsh lb edi' },
      { key: 'wr', label: 'Formulari WR', icon: FileSpreadsheet, keywords: 'tatimi ne burim qira' },
      { key: 'rb', label: 'Blerjet mbi 500 €', icon: ClipboardList, keywords: 'rb raporti' },
      { key: 'tatimet', label: 'Tatimet e tjera dhe afatet', icon: CalendarDays, keywords: 'qs ql is il tremujor vjetor kalendari' },
    ],
  },
  {
    group: 'Pagat dhe personeli',
    items: [
      { key: 'pagat', label: 'Pagat', icon: UserCog, keywords: 'wm cm wpk kontributet' },
      { key: 'punonjesit', label: 'Punonjësit dhe kontratat', icon: Users, keywords: 'hr' },
      { key: 'vijueshmeria', label: 'Orari dhe vijueshmëria', icon: CalendarDays },
      { key: 'pushimet', label: 'Pushimet dhe vendimet', icon: FileText },
    ],
  },
  { group: 'Inventari', items: [{ key: 'inventari', label: 'Artikujt dhe depot', icon: Warehouse, keywords: 'stoku' }] },
  {
    group: 'Arka KontoSef',
    items: [
      { key: 'arka', label: 'Shitjet e arkës', icon: Store, kasaOnly: true },
      { key: 'stoku', label: 'Stoku i arkës', icon: Package, kasaOnly: true },
    ],
  },
  {
    group: 'Kompania',
    items: [
      { key: 'klienti', label: 'Të dhënat e kompanisë', icon: Building2 },
      { key: 'zyra', label: 'Kontrata, detyrat, kërkesat', icon: Briefcase },
      { key: 'arkiva', label: 'Arkiva e dokumenteve', icon: Archive },
    ],
  },
]

/** Pages of the office (outside a company). */
export const OFFICE_NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Kompanitë', icon: Building2, end: true },
  { to: '/puna', label: 'Puna dhe afatet', icon: Briefcase },
  { to: '/arkiva', label: 'Arkiva', icon: Archive },
  { to: '/zyra', label: 'Zyra dhe ekipi', icon: Users },
]

export function menuItem(key: string): { item: MenuItem; group: string } | null {
  for (const g of MENU) {
    const item = g.items.find((i) => i.key === key)
    if (item) return { item, group: g.group }
  }
  return null
}
