// Text size of this device: "Normal" or "E madhe" (larger text and buttons for people who see less well or for a small
// till screen). The whole page is scaled with CSS zoom, so fixed pixel sizes grow too; kept per device.
export type TextSize = 'normal' | 'large'

const KEY = 'kasa.textSize'
const ZOOM: Record<TextSize, string> = { normal: '', large: '1.15' }

export function getTextSize(): TextSize {
  try {
    return localStorage.getItem(KEY) === 'large' ? 'large' : 'normal'
  } catch {
    return 'normal'
  }
}

export function applyTextSize(size: TextSize = getTextSize()) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('zoom', ZOOM[size])
  // viewport heights (100dvh …) grow with the zoom; screens that fill the window divide by it (--zoom)
  document.documentElement.style.setProperty('--zoom', ZOOM[size] || '1')
}

export function setTextSize(size: TextSize) {
  try {
    localStorage.setItem(KEY, size)
  } catch {
    /* storage unavailable */
  }
  applyTextSize(size)
}
