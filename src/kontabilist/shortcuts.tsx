import { useEffect, useRef } from 'react'
import { Dialog } from '@/components/ui'

/** True when the key press belongs to a text field (shortcuts without Ctrl/Alt must not fire there). */
export const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable)

/** A page-level shortcut; `combo` like 'n', '/', 'alt+arrowleft', 'ctrl+enter'. Ignored while a dialog is open. */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+')
    const key = parts.pop()!
    const want = { ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift') }
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return
      if ((e.ctrlKey || e.metaKey) !== want.ctrl || e.altKey !== want.alt || (want.shift && !e.shiftKey)) return
      if (!want.ctrl && !want.alt && isTyping(e)) return
      if (document.querySelector('[role="dialog"]') && !want.ctrl) return
      e.preventDefault()
      ref.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, enabled])
}

const LIST: [string, string][] = [
  ['Ctrl K', 'Kërkimi global: kompania, fatura, partneri, faqja'],
  ['Alt ← / Alt →', 'Periudha e kaluar / tjetër'],
  ['N', 'Dokument i ri në listën e hapur'],
  ['/', 'Kërko në tabelë'],
  ['Ctrl Enter', 'Ruaj faturën'],
  ['Esc', 'Mbyll dritaren'],
  ['?', 'Kjo listë'],
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Shkurtesat e tastierës" width="md:max-w-[460px]">
      <table className="w-full text-[13px]">
        <tbody>
          {LIST.map(([k, v]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <td className="w-[130px] py-2 pr-3">
                <kbd className="rounded-sm border border-line bg-[#F9FAFB] px-1.5 py-0.5 font-mono text-[12px]">{k}</kbd>
              </td>
              <td className="py-2 text-ink">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}
