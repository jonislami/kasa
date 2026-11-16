// Official ATK lists "Kategoritë e mallrave dhe shërbimeve" and "Njësitë matëse" (SEF documents, pages 87–88).
// Built in and fixed: used by the Kasa till (CouponItem.Type / Unit) and the accountant program.

export interface AtkCategory {
  nr: number
  code: string
  /** "Emri i kategorisë" – the short name. */
  name: string
  /** "Përshkrimi i kategorisë". */
  description: string
}

export const ATK_CATEGORIES: AtkCategory[] = [
  { nr: 1, code: 'TT', name: 'Të tjera', description: 'Të tjera' },
  { nr: 2, code: 'UR', name: 'Ushqime restoranti', description: 'Ushqime të përgatitura në restorante dhe kuzhina' },
  { nr: 3, code: 'AU', name: 'Artikuj ushqimorë', description: 'Artikuj ushqimorë nga dyqanet me pakicë' },
  // Row 4 is hard to read in the copy received: check the wording against the ATK original.
  { nr: 4, code: 'VM', name: 'Vreshtari', description: 'Prodhime të vreshtarisë' },
  { nr: 5, code: 'KO', name: 'Kozmetikë', description: 'Produkte kozmetike dhe materiale për zbukurim' },
  { nr: 6, code: 'AP', name: 'Autopjesë', description: 'Autopjesë nga autoservise dhe dyqane e autopjesëve' },
  { nr: 7, code: 'BM', name: 'Barna mjekësore', description: 'Barna dhe pajisje mjekësore' },
  { nr: 8, code: 'PM', name: 'Pajisje mjekësore', description: 'Pajisje dhe aparatura të ndryshme mjekësore' },
  { nr: 9, code: 'PP', name: 'Pemë dhe perime', description: 'Pemë dhe perime' },
  { nr: 10, code: 'PE', name: 'Pajisje elektronike', description: 'Pajisje elektronike, audio dhe video' },
  { nr: 11, code: 'PS', name: 'Pajisje shtëpiake', description: 'Pajisje shtëpiake si frigoriferë, friza, fshesa elektrike, shporetë, pajisje kuzhine etj.' },
  { nr: 12, code: 'PB', name: 'Pajisje bujqësore', description: 'Pajisje dhe makineri bujqësore' },
  { nr: 13, code: 'BB', name: 'Barna bujqësore', description: 'Barna bujqësore' },
  { nr: 14, code: 'KB', name: 'Karburante', description: 'Karburantë, përfshirë të gjitha llojet e naftës dhe benzinës' },
  { nr: 15, code: 'EE', name: 'Energji elektrike', description: 'Energji elektrike' },
  { nr: 16, code: 'PSE', name: 'Pajisje speciale elektrike', description: 'Pajisje speciale elektrike' },
  { nr: 17, code: 'SM', name: 'Shërbime mjekësore', description: 'Shërbime mjekësore' },
  { nr: 18, code: 'SJ', name: 'Shërbime juridike', description: 'Shërbime juridike' },
  { nr: 19, code: 'ST', name: 'Shërbime të tjera', description: 'Shërbime të tjera' },
  { nr: 20, code: 'SK', name: 'Shërbime të kontabilitetit', description: 'Shërbime të kontabilitetit' },
  { nr: 21, code: 'SMK', name: 'Shërbime mekanike', description: 'Shërbime mekanike' },
  { nr: 22, code: 'STR', name: 'Shërbime transporti', description: 'Shërbime transporti' },
  { nr: 23, code: 'PI', name: 'Pajisje industriale', description: 'Pajisje dhe makineri industriale' },
  { nr: 24, code: 'PT', name: 'Mjete transporti', description: 'Mjete transporti si automobil, kamionë dhe vetura' },
  { nr: 25, code: 'SEA', name: 'Shërbime edukative dhe arsimore', description: 'Shërbime edukative dhe arsimore' },
  { nr: 26, code: 'KS', name: 'Klube sportive', description: 'Klube sportive' },
  { nr: 27, code: 'MN', name: 'Materiale ndërtimore', description: 'Tregtia me pakicë e materialeve ndërtimore' },
  { nr: 28, code: 'SHN', name: 'Shërbime ndërtimore', description: 'Shërbime ndërtimore' },
  { nr: 29, code: 'SDG', name: 'Shtyp dhe dizajn grafik', description: 'Shtyp dhe dizajn grafik' },
  { nr: 30, code: 'HT', name: 'Hotelet dhe turizëm', description: 'Hotelet dhe turizëm' },
  { nr: 31, code: 'SHB', name: 'Shërbime bankare', description: 'Shërbime bankare' },
  { nr: 32, code: 'STI', name: 'Shërbime të TI-së', description: 'Shërbime të teknologjisë informative' },
  { nr: 33, code: 'SHT', name: 'Shërbime të telekomunikimit', description: 'Shërbime të telekomunikimit' },
  { nr: 34, code: 'PBS', name: 'Produkte bimore dhe shtazore', description: 'Tregtia me pakicë e lulëve, bimëve, farërave, plehrave artificiale, kafshëve shtëpiake dhe ushqimit për to' },
  { nr: 35, code: 'MPM', name: 'Mish dhe produkte të mishit', description: 'Tregtia me pakicë e mishit dhe produkteve të mishit në dyqane të specializuara' },
  // Printed as "PM" in the ATK table, the same as nr. 8 – kept as printed; the two are told apart by the number.
  { nr: 36, code: 'PM', name: 'Produkte të miellit', description: 'Miell dhe produkte të miellit si bukë, byrek etj.' },
  { nr: 37, code: 'PPD', name: 'Produkte të drurit', description: 'Prodhimi i produkteve të drurit' },
  { nr: 38, code: 'PPH', name: 'Produkte të hekurit', description: 'Prodhimi i produkteve të hekurit' },
  { nr: 39, code: 'PPP', name: 'Produkte të plastikës', description: 'Prodhimi i produkteve të plastikës' },
  { nr: 40, code: 'PPA', name: 'Produkte të aluminit', description: 'Prodhimi i produkteve të aluminit' },
  { nr: 41, code: 'PHN', name: 'Pajisje hidraulike dhe të ngrohjes', description: 'Pajisje hidraulike dhe të ngrohjes' },
  { nr: 42, code: 'SHH', name: 'Shërbime hidraulike', description: 'Shërbime hidraulike' },
  { nr: 43, code: 'SUA', name: 'Shërbime udhëtimi dhe akomodimi', description: 'Agjenci udhëtimi, shërbime udhëtimi dhe akomodimi' },
  { nr: 44, code: 'SHZ', name: 'Shërbime të zbukurimit', description: 'Sallone floktarie dhe trajtime të tjera të bukurisë' },
  { nr: 45, code: 'PJA', name: 'Pije joalkoolike', description: 'Pije joalkoolike' },
  { nr: 46, code: 'PAL', name: 'Pije alkoolike', description: 'Pije alkoolike' },
  { nr: 47, code: 'DUH', name: 'Duhan', description: 'Duhan' },
  { nr: 48, code: 'SHM', name: 'Shërbime marketingu', description: 'Agjenci të publicitetit dhe marketingut' },
  { nr: 49, code: 'PRO', name: 'Prodhimtari', description: 'Veprimtari prodhuese' },
  { nr: 50, code: 'SFV', name: 'Shpërndarje filmash, videosh dhe programesh televizive', description: 'Shpërndarja e filmave, videove dhe programeve televizive' },
  { nr: 51, code: 'BSH', name: 'Blegtori dhe shpezëtari', description: 'Blegtori dhe shpezëtari' },
  { nr: 52, code: 'RPK', name: 'Riparimi i pajisjeve të komunikimit', description: 'Riparimi i pajisjeve të komunikimit' },
  { nr: 53, code: 'PTI', name: 'Pajisje të teknologjisë informative', description: 'Pajisje të teknologjisë informative si PC dhe laptop' },
]

export interface AtkUnit {
  nr: number
  code: string
  /** "Emërtimi". */
  name: string
  /** "Sqarimi". */
  description: string
}

export const ATK_UNITS: AtkUnit[] = [
  { nr: 1, code: 'EA', name: 'Një (njësi)', description: 'Pjesë individuale' },
  { nr: 2, code: 'CP', name: 'Copë', description: 'Pjesë identike' },
  { nr: 3, code: 'LTR', name: 'Litër', description: 'Matje e lëndës në gjendje të lëngët' },
  { nr: 4, code: 'SEC', name: 'Sekondë', description: 'Njësi matëse e kohës' },
  { nr: 5, code: 'MIN', name: 'Minutë', description: 'Njësi matëse e kohës' },
  { nr: 6, code: 'HUR', name: 'Orë', description: 'Njësi matëse e kohës' },
  { nr: 7, code: 'DAY', name: 'Ditë', description: 'Njësi matëse e kohës' },
  { nr: 8, code: 'MON', name: 'Muaj', description: 'Njësi matëse e kohës' },
  { nr: 9, code: 'ANN', name: 'Vite', description: 'Njësi matëse e kohës' },
  { nr: 10, code: 'KGB', name: 'Kilogram bruto', description: 'Njësi matëse e peshës me paketim' },
  { nr: 11, code: 'KGN', name: 'Kilogram neto', description: 'Njësi matëse e peshës vetëm përmbajtja' },
  { nr: 12, code: 'TN', name: 'Ton', description: 'Njësi matëse e peshës' },
  { nr: 13, code: 'GRM', name: 'Gram', description: 'Njësi matëse e peshës' },
  { nr: 14, code: 'M4', name: 'Vlerë monetare', description: 'Njësi valutore' },
  { nr: 15, code: 'UDH', name: 'Udhëtim', description: 'Udhëtim nga një vend në vendin tjetër' },
  { nr: 16, code: 'KMT', name: 'Km', description: 'Njësi matëse e largësisë' },
  { nr: 17, code: 'LM', name: 'Metër linear', description: 'Njësi matëse e gjatësisë' },
  { nr: 18, code: 'MTS', name: 'M2', description: 'Njësi matëse e sipërfaqes' },
  { nr: 19, code: 'MTV', name: 'M3', description: 'Njësi matëse e vëllimit' },
  { nr: 20, code: 'MSK', name: 'M/S2', description: 'Njësi matëse e largësisë' },
  { nr: 21, code: 'KËH', name: 'Këh', description: 'Njësi matëse e Fuqisë' },
  { nr: 22, code: 'NFJ', name: 'Numri i fjalëve', description: 'Njësi matëse e tekstit' },
  { nr: 23, code: 'NFQ', name: 'Numri i faqeve', description: 'Njësi matëse e largësisë' },
  { nr: 24, code: 'PRQ', name: 'Përqindje për njëqind', description: '%' },
  { nr: 25, code: 'DP', name: 'Ditë pune', description: 'Njësi matëse e kohës' },
  { nr: 26, code: 'OP', name: 'Orë pune', description: 'Njësi matëse e kohës' },
  { nr: 27, code: 'PRD', name: 'Përdorim', description: 'Njësi matëse për numrin e përdorimeve' },
  { nr: 28, code: 'PAL', name: 'Palë', description: 'Njësi matëse' },
  { nr: 29, code: 'XBX', name: 'Kuti', description: 'Njësi matëse' },
  { nr: 30, code: 'PK', name: 'Pako', description: 'Njësi matëse' },
  { nr: 31, code: 'SET', name: 'Set', description: 'Njësi matëse' },
]

/** A category as stored on items / documents: "PM" alone is ambiguous (nr. 8 and 36), so the number is kept as "PM#36". */
export const categoryKey = (c: AtkCategory) => (ATK_CATEGORIES.filter((x) => x.code === c.code).length > 1 ? `${c.code}#${c.nr}` : c.code)

/** Official categories as select options; value = stored key. The lists are fixed (not editable). */
export function categoryOptions(): { value: string; label: string }[] {
  return ATK_CATEGORIES.map((c) => ({ value: categoryKey(c), label: `${c.code} – ${c.name}` }))
}

export function categoryName(key: string | null | undefined): string {
  if (!key) return ''
  const off = ATK_CATEGORIES.find((c) => categoryKey(c) === key)
  return off ? `${off.code} – ${off.name}` : key
}

/** The code sent to ATK (CouponItem.Type): "PM#36" → "PM". */
export const categoryCode = (key: string | null | undefined) => (key ? key.split('#')[0] : 'TT')

/** Unit names of the official list (the label is stored, like before: "Copë", "Kilogram neto", …). */
export const unitOptions = (): string[] => ATK_UNITS.map((u) => u.name)

export function unitCode(label: string | null | undefined): string | null {
  if (!label) return null
  const l = label.trim().toLowerCase()
  const aliases: Record<string, string> = { copë: 'CP', cope: 'CP', copa: 'CP', kg: 'KGN', kilogram: 'KGN', l: 'LTR', litër: 'LTR', liter: 'LTR', pako: 'PK', m2: 'MTS', 'm²': 'MTS', m3: 'MTV', 'm³': 'MTV', orë: 'HUR', ditë: 'DAY', muaj: 'MON', kuti: 'XBX', m: 'LM' }
  return ATK_UNITS.find((u) => u.name.toLowerCase() === l || u.code.toLowerCase() === l)?.code ?? aliases[l] ?? null
}

/** Default ATK category of a Kasa business type, used when a product gets none. */
export const DEFAULT_CATEGORY: Record<string, string> = { market: 'AU', restaurant: 'UR', pharmacy: 'BM', boutique: 'TT', salon: 'SHZ' }
