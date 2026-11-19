// Serbian (Latin) on screen for the whole SEF program: when the till is set to Serbian, every text node and the
// placeholder / title / aria-label of the page is looked up in the dictionary (i18n.ts SR + i18nUi.ts) and replaced in
// place. Only whole texts of the dictionary are replaced, so product names, the business's data and amounts stay as
// they are. React keeps working: a text it writes again is translated again (the text node is changed, never
// replaced). Switching the language reloads the page so the Albanian texts come back.
import { getLang, onLangChange, t } from './i18n'
import { SR_UI, SR_UI_PATTERNS } from './i18nUi'

const ATTRS = ['placeholder', 'title', 'aria-label'] as const
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE'])

const patterns = SR_UI_PATTERNS.map(([sq, sr]) => {
  const parts = sq.split('{}').map((p) => p.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
  return { re: new RegExp('^' + parts.join('(.+?)') + '$'), sr }
})

const cache = new Map<string, string | null>()

/** The Serbian for one whole text, or null when it is not in the dictionary. */
function translate(text: string): string | null {
  if (cache.has(text)) return cache.get(text)!
  let out: string | null = SR_UI[text] ?? null
  if (out === null) {
    const viaCoupon = t(text, 'sr')
    if (viaCoupon !== text) out = viaCoupon
  }
  if (out === null) {
    for (const p of patterns) {
      const m = p.re.exec(text)
      if (m) {
        let i = 1
        out = p.sr.replace(/\{\}/g, () => m[i++] ?? '')
        break
      }
    }
  }
  cache.set(text, out)
  return out
}

/** Keeps the spaces around the text (JSX puts texts next to values: "Totali " + amount). */
function translateKeepingSpace(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  if (trimmed.length < 2 || !/[A-Za-zËëÇç]/.test(trimmed)) return null
  const sr = translate(trimmed)
  if (sr === null || sr === trimmed) return null
  const lead = raw.match(/^\s*/)![0]
  const trail = raw.match(/\s*$/)![0]
  return lead + sr + trail
}

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute('data-no-translate') || (e as HTMLElement).isContentEditable) return true
  }
  return false
}

function doText(node: Text) {
  if (skipped(node.parentElement)) return
  const sr = translateKeepingSpace(node.data)
  if (sr !== null && sr !== node.data) node.data = sr
}

function doAttrs(el: Element) {
  if (skipped(el) && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (!v) continue
    const sr = translateKeepingSpace(v)
    if (sr !== null && sr !== v) el.setAttribute(a, sr)
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const el = root as Element
  doAttrs(el)
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text)
    else doAttrs(n as Element)
  }
}

let started = false

/** Starts the on-screen translation when the language is Serbian; switching the language reloads the page. */
export function startScreenTranslation() {
  if (started || typeof document === 'undefined') return
  started = true
  const initial = getLang()
  onLangChange(() => {
    if (getLang() !== initial) window.location.reload()
  })
  if (initial !== 'sr') return
  document.documentElement.lang = 'sr-Latn'
  const run = () => {
    walk(document.body)
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target as Text)
        else if (m.type === 'attributes') doAttrs(m.target as Element)
        else m.addedNodes.forEach(walk)
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] })
  }
  if (document.body) run()
  else document.addEventListener('DOMContentLoaded', run, { once: true })
}
