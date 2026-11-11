// License of the business (SEF, migration 0029) as the app knows it from the session context.
// The database refuses new sales after expiry + grace anyway; this stops them earlier (also offline)
// and lets the screens show a clear message.

export type LicenseStateCode = 'active' | 'expiring' | 'grace' | 'expired' | 'suspended' | 'cancelled'
export interface LicenseInfo {
  state: LicenseStateCode
  expires_on: string | null
  grace_until: string | null
  days_left: number | null
  max_devices: number
}

export const LICENSE_EXPIRED_MESSAGE = 'Abonimi i Kasa-s ka skaduar. Shitjet e reja ndalen derisa të paguhet abonimi (pronari e sheh te Llogaria).'

let current: LicenseInfo | null = null

export function setLicense(l: LicenseInfo | null | undefined) {
  current = l ?? null
}

export function getLicense(): LicenseInfo | null {
  return current
}

/** Throws before a new sale when the license no longer allows selling. */
export function assertCanSell() {
  if (current?.state === 'expired') throw new Error(LICENSE_EXPIRED_MESSAGE)
}
