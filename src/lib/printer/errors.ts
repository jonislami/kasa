// Why a print did not come out, so the till can say it clearly and offer what to do (PrintProblem dialog).
//  offline – the printer is off, unplugged, out of range or not answering on the network
//  paper   – out of paper, cover open, paper jammed (when the printer / driver reports it)
//  stuck   – the job waited in the Windows queue with an error and was removed
//  failed  – anything else
export type PrinterErrorKind = 'offline' | 'paper' | 'stuck' | 'failed'

export class PrinterError extends Error {
  constructor(
    public readonly kind: PrinterErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'PrinterError'
  }
}

/** The Windows app sends errors as "kind:text" (electron/main.cts); other errors become 'failed'. */
export function toPrinterError(e: unknown): PrinterError {
  if (e instanceof PrinterError) return e
  const m = e instanceof Error ? e.message : String(e)
  const hit = /^(offline|paper|stuck|failed):(.*)$/s.exec(m)
  if (hit) return new PrinterError(hit[1] as PrinterErrorKind, hit[2].trim())
  if (/not connected|nuk është i lidhur|disconnected|GATT|NetworkError|nuk përgjigjet|ndërpre/i.test(m)) return new PrinterError('offline', m)
  return new PrinterError('failed', m)
}

export const PRINTER_ERROR_TITLES: Record<PrinterErrorKind, string> = {
  offline: 'Printeri nuk përgjigjet',
  paper: 'Printeri ka problem me letrën',
  stuck: 'Kuponi nuk u printua',
  failed: 'Printimi dështoi',
}

export const PRINTER_ERROR_HINTS: Record<PrinterErrorKind, string> = {
  offline: 'Kontrollo që printeri është i ndezur, i lidhur (kablli / Bluetooth / rrjeti) dhe afër pajisjes.',
  paper: 'Kontrollo rrotullën e letrës dhe mbylle mirë kapakun.',
  stuck: 'Kontrollo printerin (letra, kapaku, kablli), pastaj provo përsëri.',
  failed: 'Provo përsëri ose printo me dritaren e printimit.',
}
