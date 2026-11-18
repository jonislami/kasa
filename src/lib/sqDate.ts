/**
 * Dates and times in Albanian, 24-hour clock.
 *
 * Browsers and Electron mostly ship without Albanian locale data, so `Intl.DateTimeFormat('sq-AL')` falls back
 * to English ("Tuesday, November 17", "11:39 PM"). This formatter takes the numbers from Intl (with the time zone)
 * and writes the words itself:  "e martë, 17 nëntor 2026" · "17.11.2026, 23:39" · "nëntor 2026" · "23:39:05".
 */
const WEEKDAYS = ['e diel', 'e hënë', 'e martë', 'e mërkurë', 'e enjte', 'e premte', 'e shtunë']
const WEEKDAYS_SHORT = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht']
const MONTHS = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor']
const MONTHS_SHORT = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'korr', 'gush', 'sht', 'tet', 'nën', 'dhj']
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Opts = Pick<Intl.DateTimeFormatOptions, 'timeZone' | 'weekday' | 'day' | 'month' | 'year' | 'hour' | 'minute' | 'second'>

export class SqDateFormat {
  private readonly o: Opts
  private readonly parts: Intl.DateTimeFormat

  constructor(options: Opts) {
    this.o = options
    // only the numbers come from Intl (en-GB, 24 h), in the requested time zone
    this.parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: options.timeZone,
      weekday: options.weekday ? 'short' : undefined,
      day: options.day ? '2-digit' : undefined,
      month: options.month ? '2-digit' : undefined,
      year: options.year ? 'numeric' : undefined,
      hour: options.hour ? '2-digit' : undefined,
      minute: options.minute ? '2-digit' : undefined,
      second: options.second ? '2-digit' : undefined,
      hourCycle: 'h23',
    })
  }

  format(value: Date | number | string): string {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const p: Record<string, string> = {}
    for (const x of this.parts.formatToParts(date)) p[x.type] = x.value
    const o = this.o
    const out: string[] = []

    let datePart = ''
    if (o.day || o.month || o.year) {
      const day = p.day ? (o.day === 'numeric' ? String(Number(p.day)) : p.day) : ''
      const m = p.month ? Number(p.month) - 1 : -1
      if (o.month === 'long' || o.month === 'short') {
        const name = (o.month === 'long' ? MONTHS : MONTHS_SHORT)[m] ?? ''
        datePart = [day, name, o.year ? p.year : ''].filter(Boolean).join(' ')
      } else {
        datePart = [day, p.month ? (o.month === 'numeric' ? String(m + 1) : p.month) : '', o.year ? p.year : ''].filter(Boolean).join('.')
      }
    }
    if (o.weekday) {
      const wd = EN_WEEKDAYS.indexOf(p.weekday ?? '')
      const name = wd < 0 ? '' : (o.weekday === 'long' ? WEEKDAYS : WEEKDAYS_SHORT)[wd]
      out.push(datePart ? `${name},` : name)
    }
    if (datePart) out.push(datePart)

    if (o.hour || o.minute) {
      const time = [p.hour, p.minute, o.second ? p.second : undefined].filter((x) => x !== undefined).join(':')
      if (out.length) out[out.length - 1] += ','
      out.push(time)
    }
    return out.join(' ')
  }
}

/** One-off formatting, in place of `date.toLocaleString('sq-AL', options)`. */
export function formatSq(value: Date | number | string, options: Opts): string {
  return new SqDateFormat(options).format(value)
}

/** "e martë" → "E martë" (start of a sentence or a title). */
export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
