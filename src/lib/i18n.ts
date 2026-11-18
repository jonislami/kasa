// Languages of the SEF program (ATK neni 25 pika 14, UA neni 32 pika 2.9): the official languages of Kosovo,
// Latin letters. Albanian is the base; Serbian (Latin) covers the till: PIN sign-in, menu, sale, payment and the
// fiscal coupon. The choice is kept on the device (each till can have its own).
import { useSyncExternalStore } from 'react'

export type Lang = 'sq' | 'sr'
export const LANG_LABELS: Record<Lang, string> = { sq: 'Shqip', sr: 'Srpski (latinica)' }

const KEY = 'kasa.lang'
const listeners = new Set<() => void>()

export function getLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'sr' ? 'sr' : 'sq'
  } catch {
    return 'sq'
  }
}

export function setLang(l: Lang) {
  localStorage.setItem(KEY, l)
  listeners.forEach((f) => f())
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    getLang,
    () => 'sq',
  )
}

/** Serbian (Latin) for the Albanian texts of the till and the coupon; a text without a translation stays Albanian. */
const SR: Record<string, string> = {
  // fiscal coupon
  TATIMPAGUESI: 'PORESKI OBVEZNIK',
  'EMRI I NJËSISË': 'NAZIV JEDINICE',
  'NUMRI I NJËSISË': 'BROJ JEDINICE',
  'ADRESA E NJËSISË': 'ADRESA JEDINICE',
  VENDI: 'MESTO',
  TELEFONI: 'TELEFON',
  'NF-NUI': 'FB-JIB',
  'NUMRI I TVSH-SË': 'PDV BROJ',
  'EMRI I PUNËTORIT': 'IME RADNIKA',
  'KUPON FISKAL': 'FISKALNI KUPON',
  'KUPON FISKAL I ANULUAR': 'PONIŠTENI FISKALNI KUPON',
  'KUPON FISKAL KTHIMI': 'FISKALNI KUPON POVRATA',
  'KUPON JO-FISKAL': 'NEFISKALNI KUPON',
  'KUPON I ANULUAR': 'PONIŠTENI KUPON',
  'KUPON KTHIMI': 'KUPON POVRATA',
  'JO-FISKAL': 'NEFISKALNI',
  'KOPJE E KUPONIT': 'KOPIJA KUPONA',
  'TEST – PA VLERË FISKALE': 'TEST – BEZ FISKALNE VREDNOSTI',
  'KUPON FISKAL NR.': 'FISKALNI KUPON BR.',
  'DATË:': 'DATUM:',
  'ARSYEJA E ANULIMIT': 'RAZLOG PONIŠTENJA',
  ARSYEJA: 'RAZLOG',
  ARTIKULLI: 'ARTIKAL',
  'SASIA X ÇMIMI': 'KOL. X CENA',
  SHUMA: 'IZNOS',
  Ulje: 'Popust',
  ULJE: 'POPUST',
  NËNTOTALI: 'MEĐUZBIR',
  'TOTALI PËR PAGESË': 'UKUPNO ZA PLAĆANJE',
  'MËNYRA E PAGESËS': 'NAČIN PLAĆANJA',
  KESH: 'GOTOVINA',
  KARTELË: 'KARTICA',
  'TRANSFER BANKAR': 'BANKOVNI TRANSFER',
  VAUÇER: 'VAUČER',
  ÇEK: 'ČEK',
  PAGUAR: 'PLAĆENO',
  KUSURI: 'KUSUR',
  TVSH: 'PDV',
  'TOTALI PA TVSH': 'UKUPNO BEZ PDV',
  'KTHIMI I ARTIKUJVE': 'POVRAT ARTIKALA',
  'TOTALI I KTHIMIT': 'UKUPNO POVRAT',
  'TOTALI I MBETUR': 'PREOSTALI IZNOS',
  ARTIKUJ: 'ARTIKLI',
  'ARTIKUJ TË KTHYER': 'VRAĆENI ARTIKLI',
  'DATA DHE ORA': 'DATUM I VREME',
  'NR. IDENTIFIKUES I SEF': 'IDENT. BROJ SEF',
  'KUPON FISKAL DITOR NR.': 'DNEVNI FISKALNI KUPON BR.',
  'KUPON DITOR NR.': 'DNEVNI KUPON BR.',
  'Ky kupon nuk është fiskal.': 'Ovaj kupon nije fiskalni.',
  'Mundësuar nga KontoSef.app': 'Omogućeno od KontoSef.app',
  'ATK e refuzoi': 'ATK je odbio',
  'BLLOKU I VEÇANTË I KUPONËVE – NR.': 'POSEBNI BLOK KUPONA – BR.',
  // till
  'Faturë e re': 'Novi račun',
  'Kërko ose skano barkodin': 'Traži ili skeniraj barkod',
  'Skano barkodin ose shkruaj emrin e produktit…': 'Skeniraj barkod ili upiši naziv proizvoda…',
  'Kërko produktin…': 'Traži proizvod…',
  'Ekrani i kuzhinës / barit': 'Ekran kuhinje / bara',
  'Të gjitha': 'Sve',
  Totali: 'Ukupno',
  Kesh: 'Gotovina',
  Kartelë: 'Kartica',
  'Të kombinuara': 'Kombinovano',
  'Transfer bankar': 'Bankovni transfer',
  Vauçer: 'Vaučer',
  Çek: 'Ček',
  Paguaj: 'Plati',
  'Paguaj kesh': 'Plati gotovinom',
  'Pagesa u krye': 'Plaćanje izvršeno',
  Printo: 'Štampaj',
  'Shitje e re': 'Nova prodaja',
  'Pa TVSH': 'Bez PDV',
  Paguar: 'Plaćeno',
  Kusuri: 'Kusur',
  'Skano një barkod ose kliko një produkt': 'Skeniraj barkod ili klikni proizvod',
  // shell and sign-in
  Arka: 'Kasa',
  'Puna ime sot': 'Moj rad danas',
  Printeri: 'Štampač',
  'Mbyll ditën': 'Zatvori dan',
  Dil: 'Odjava',
  'Më shumë': 'Više',
  'Mirë se erdhe': 'Dobrodošli',
  'Hyr me PIN-in tënd për të shitur': 'Prijavi se svojim PIN-om za prodaju',
  'PIN i gabuar': 'Pogrešan PIN',
  Gjuha: 'Jezik',
}

/** The text in the language of this till. */
export function t(sq: string, lang: Lang = getLang()): string {
  return lang === 'sr' ? SR[sq] ?? sq : sq
}
