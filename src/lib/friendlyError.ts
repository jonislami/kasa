// Messages for the people who use the program: no database, network or server terms. The messages written for them
// (in Albanian, from the SQL functions: "Shkruaj emrin", "PIN-i nuk është i saktë" …) pass as they are; a technical
// message becomes a short sentence that says what to do.

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|timeout|timed out/i
const TECHNICAL =
  /PGRST|JWT|jwt|schema cache|relation "|column "|function |does not exist|permission denied|violates|duplicate key|syntax error|invalid input|null value|row-level security|RLS|Edge Function|supabase|migrim|\.sql|stack|undefined|TypeError|ReferenceError/i

export const NOT_READY = 'Ky funksion po aktivizohet nga KontoSef. Provo përsëri më vonë ose kontakto mbështetjen.'
const SERVER = 'Diçka nuk shkoi në server. Provo përsëri pas pak; nëse përsëritet, kontakto mbështetjen e KontoSef.'
const OFFLINE = 'Nuk ka lidhje me internetin. Kontrollo lidhjen dhe provo përsëri.'

/** A message the user can act on. */
export function friendlyMessage(message: string | null | undefined): string {
  const m = (message ?? '').trim()
  if (!m) return SERVER
  if (NETWORK.test(m)) return OFFLINE
  if (/migrim|\.sql|aktivizohet pasi|nuk është aktivizuar ende në databazë/i.test(m)) return NOT_READY
  if (/duplicate key|unique/i.test(m)) return 'Ky regjistrim ekziston tashmë (p.sh. i njëjti emër, barkod ose numër).'
  if (/permission denied|row-level security|not allowed|42501/i.test(m)) return 'Nuk ke të drejtë për këtë veprim. Pyet pronarin ose menaxherin.'
  if (/JWT|jwt expired|session/i.test(m)) return 'Seanca ka skaduar. Dil dhe hyr përsëri.'
  if (TECHNICAL.test(m)) return SERVER
  return m
}

/** An Error with a friendly message (for `throw`). */
export function friendlyError(error: { message?: string } | null | undefined): Error {
  return new Error(friendlyMessage(error?.message))
}
