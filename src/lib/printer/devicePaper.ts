import { LINE_CHARS, PAPER_WIDTHS, type PaperWidth } from './escpos'

/**
 * The paper roll of the printer at this till, chosen on the device (Printeri → Letra). It overrides the business
 * setting, so each till prints on its own roll (58, 80 or 100 mm) and every role can set it where the printer is.
 */
export interface DevicePaper {
  paper_width: PaperWidth | null
  line_chars: number | null
}

const KEY = 'kasa.paper'

export function devicePaper(): DevicePaper {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DevicePaper>
    return {
      paper_width: PAPER_WIDTHS.some((p) => p.value === v.paper_width) ? (v.paper_width as PaperWidth) : null,
      line_chars: LINE_CHARS.includes(v.line_chars as (typeof LINE_CHARS)[number]) ? (v.line_chars as number) : null,
    }
  } catch {
    return { paper_width: null, line_chars: null }
  }
}

export function setDevicePaper(p: DevicePaper) {
  try {
    if (!p.paper_width && !p.line_chars) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
}

// "Printo automatikisht kuponin" on this till: on / off chosen here, or (null) as set for the business.
const AUTO_KEY = 'kasa.autoPrint'

export function deviceAutoPrint(): boolean | null {
  try {
    const v = localStorage.getItem(AUTO_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

export function setDeviceAutoPrint(v: boolean | null) {
  try {
    if (v === null) localStorage.removeItem(AUTO_KEY)
    else localStorage.setItem(AUTO_KEY, v ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/** The receipt settings with this device's paper and auto-print applied (a manager's business setting stays the default). */
export function withDevicePaper<T extends { paper_width: PaperWidth; settings: { line_chars?: number | null; auto_print?: boolean } }>(s: T): T {
  const d = devicePaper()
  const auto = deviceAutoPrint()
  const withAuto = auto === null ? s : { ...s, settings: { ...s.settings, auto_print: auto } }
  if (!d.paper_width && !d.line_chars) return withAuto
  return {
    ...withAuto,
    paper_width: d.paper_width ?? s.paper_width,
    // a paper chosen on the device starts with its own characters per line, unless the device sets them too
    settings: { ...withAuto.settings, line_chars: d.line_chars ?? (d.paper_width ? null : s.settings.line_chars) },
  }
}
