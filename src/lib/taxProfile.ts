// The tax profile asked at registration (0041): legal form, tax category by legal form, VAT, tax centre.
// The categories follow the law on corporate / personal income tax in force (gross income up to 30 000 €: 3% for trade,
// transport and agriculture, 9% for services; real income otherwise or by voluntary choice). Change them here when the
// rules change: the form, the owner's page and the admin page all read this file.

export type LegalForm = 'bi' | 'shpk' | 'sha' | 'op' | 'ok' | 'other'

export const LEGAL_FORMS: { value: LegalForm; label: string; short: string }[] = [
  { value: 'bi', label: 'Biznes individual', short: 'B.I.' },
  { value: 'shpk', label: 'Shoqëri me përgjegjësi të kufizuar', short: 'SH.P.K.' },
  { value: 'sha', label: 'Shoqëri aksionare', short: 'SH.A.' },
  { value: 'op', label: 'Ortakëri e përgjithshme', short: 'O.P.' },
  { value: 'ok', label: 'Ortakëri e kufizuar', short: 'O.K.' },
  { value: 'other', label: 'Formë tjetër (OJQ, kooperativë, ndërmarrje publike…)', short: 'Tjetër' },
]

export interface TaxCategory {
  value: string
  label: string
  hint?: string
  /** the business may choose real income instead (voluntary) */
  realOption?: boolean
}

const GROSS: TaxCategory[] = [
  { value: 'gross_3', label: 'Të ardhura bruto – 3%', hint: 'Qarkullim deri 30 000 € në vit: tregti, transport, bujqësi', realOption: true },
  { value: 'gross_9', label: 'Të ardhura bruto – 9%', hint: 'Qarkullim deri 30 000 € në vit: shërbime, profesione, argëtim', realOption: true },
]

export const TAX_CATEGORIES: Record<LegalForm, TaxCategory[]> = {
  bi: [...GROSS, { value: 'real_pit', label: 'Të ardhura reale – tatim progresiv', hint: 'Qarkullim mbi 30 000 € ose libra të plotë kontabël' }],
  op: [...GROSS, { value: 'real_pit', label: 'Të ardhura reale – ortakët tatohen individualisht', hint: 'Qarkullim mbi 30 000 € ose libra të plotë kontabël' }],
  ok: [...GROSS, { value: 'real_pit', label: 'Të ardhura reale – ortakët tatohen individualisht', hint: 'Qarkullim mbi 30 000 € ose libra të plotë kontabël' }],
  shpk: [...GROSS, { value: 'real_cit', label: 'Të ardhura reale – tatim në fitim 10%', hint: 'Qarkullim mbi 30 000 € ose libra të plotë kontabël' }],
  sha: [{ value: 'real_cit', label: 'Të ardhura reale – tatim në fitim 10%' }],
  other: [
    { value: 'real_cit', label: 'Të ardhura reale – tatim në fitim 10%' },
    { value: 'exempt', label: 'I liruar nga tatimi në fitim', hint: 'P.sh. OJQ me status të përfitimit publik' },
  ],
}

export const taxCategoryLabel = (form: string | null | undefined, cat: string | null | undefined) =>
  (TAX_CATEGORIES[(form as LegalForm) ?? 'other'] ?? []).find((c) => c.value === cat)?.label ?? cat ?? ''
export const legalFormLabel = (v: string | null | undefined) => LEGAL_FORMS.find((f) => f.value === v)?.label ?? v ?? ''

/** ATK regional tax offices. */
export const TAX_CENTERS = ['Prishtinë', 'Prizren', 'Pejë', 'Gjakovë', 'Mitrovicë', 'Gjilan', 'Ferizaj', 'Tatimpaguesit e mëdhenj']

export const COUNTRIES = ['Kosovë', 'Shqipëri', 'Maqedoni e Veriut', 'Mal i Zi', 'Serbi', 'Tjetër']

/** Municipalities of Kosovo, for the city suggestions. */
export const KOSOVO_CITIES = [
  'Prishtinë', 'Prizren', 'Ferizaj', 'Pejë', 'Gjakovë', 'Gjilan', 'Mitrovicë', 'Podujevë', 'Vushtrri', 'Suharekë', 'Rahovec', 'Drenas',
  'Lipjan', 'Malishevë', 'Kamenicë', 'Viti', 'Deçan', 'Istog', 'Klinë', 'Skenderaj', 'Dragash', 'Fushë Kosovë', 'Kaçanik', 'Shtime',
  'Obiliq', 'Novobërdë', 'Shtërpcë', 'Junik', 'Mamushë', 'Hani i Elezit', 'Graçanicë', 'Ranillug', 'Kllokot', 'Partesh', 'Leposaviq',
  'Zubin Potok', 'Zveçan', 'Mitrovicë e Veriut',
]
