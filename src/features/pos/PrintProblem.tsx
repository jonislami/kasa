import { useCallback, useState } from 'react'
import { AlertTriangle, Printer, RotateCcw } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { PRINTER_ERROR_HINTS, PRINTER_ERROR_TITLES, toPrinterError, type PrinterError } from '@/lib/printer'

interface Problem {
  error: PrinterError
  retry: () => Promise<unknown>
  dialog?: () => void
}

/**
 * When the printer does not answer the till says so – the sale is already saved – and the cashier chooses:
 * try again (after switching the printer on / adding paper), print with the print dialog, or go on without paper.
 * Usage: const [problem, show] = usePrintProblem(); show(error, retry, dialog); render {problem}.
 */
export function usePrintProblem(): [JSX.Element | null, (e: unknown, retry: () => Promise<unknown>, dialog?: () => void) => void] {
  const [p, setP] = useState<Problem | null>(null)
  const [busy, setBusy] = useState(false)
  const show = useCallback((e: unknown, retry: () => Promise<unknown>, dialog?: () => void) => setP({ error: toPrinterError(e), retry, dialog }), [])
  if (!p) return [null, show]
  const again = async () => {
    setBusy(true)
    const current = p
    setP(null)
    try {
      await current.retry()
    } catch (e) {
      setP({ ...current, error: toPrinterError(e) })
    } finally {
      setBusy(false)
    }
  }
  const element = (
    <Dialog
      open
      onClose={() => setP(null)}
      title={PRINTER_ERROR_TITLES[p.error.kind]}
      width="md:max-w-[460px]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setP(null)}>
            Vazhdo pa printuar
          </Button>
          {p.dialog && (
            <Button
              variant="secondary"
              onClick={() => {
                const d = p.dialog!
                setP(null)
                d()
              }}
            >
              <Printer className="h-4 w-4" /> Printo me dritaren
            </Button>
          )}
          <Button loading={busy} onClick={() => void again()}>
            <RotateCcw className="h-4 w-4" /> Provo përsëri
          </Button>
        </div>
      }
    >
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-100 text-warn-700">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="text-[15px]">
          <p className="font-medium text-ink">{p.error.message}</p>
          <p className="mt-1 text-muted">{PRINTER_ERROR_HINTS[p.error.kind]}</p>
          <p className="mt-3 text-sm text-muted">Shitja / porosia është ruajtur; vetëm letra nuk doli.</p>
        </div>
      </div>
    </Dialog>
  )
  return [element, show]
}
