// Draws the KontoSef.app icons (PWA, Windows, Android, iOS) from the logo geometry in public/icon.svg.
// No image tools needed: simple shapes rasterised with 4×4 supersampling.  Run: node scripts/icons.mjs
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const NAVY = [15, 27, 45]
const WHITE = [255, 255, 255]
const ACCENT = [138, 174, 235]
// Glyph on the 64-unit grid: [x, y, w, h, colour, opacity]
const GLYPH = [
  [15, 17, 34, 5, WHITE, 1],
  [29.5, 17, 5, 31, WHITE, 1],
  [18, 29, 7, 7, WHITE, 0.55],
  [39, 38, 7, 7, ACCENT, 1],
]

const inRound = (x, y, x0, y0, w, h, r) => {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r)
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/**
 * mode: tile  – rounded navy tile on transparent      (PWA "any", Windows, Android legacy)
 *       round – navy circle on transparent             (Android round)
 *       full  – navy edge to edge, no transparency     (iOS / apple-touch: the system rounds it)
 *       mask  – navy edge to edge, glyph in safe zone  (PWA maskable)
 *       fg    – glyph only on transparent, 108dp grid  (Android adaptive foreground)
 */
function draw(size, mode, w = size, h = size) {
  const png = new PNG({ width: w, height: h })
  const unit = Math.min(w, h) / 64
  const scale = { tile: 1, round: 0.92, full: 1, mask: 0.8, fg: 0.62, splash: 0.35 }[mode]
  const S = 4
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          // position on the 64 grid, centred
          const X = (px + (sx + 0.5) / S - w / 2) / unit + 32
          const Y = (py + (sy + 0.5) / S - h / 2) / unit + 32
          let col = null, al = 0
          const bgFull = mode === 'full' || mode === 'mask' || mode === 'splash'
          if (bgFull) (col = NAVY), (al = 1)
          else if (mode === 'tile' && inRound(X, Y, 0, 0, 64, 64, 15)) (col = NAVY), (al = 1)
          else if (mode === 'round' && (X - 32) ** 2 + (Y - 32) ** 2 <= 32 * 32) (col = NAVY), (al = 1)
          // glyph, scaled around the centre
          const gx = (X - 32) / scale + 32, gy = (Y - 32) / scale + 32
          for (const [x0, y0, gw, gh, c, o] of GLYPH)
            if (inRound(gx, gy, x0, y0, gw, gh, 1)) {
              const base = col ?? c
              col = base.map((v, i) => v * (1 - o) + c[i] * o)
              al = col === c ? o : Math.max(al, o)
              if (!bgFull && mode === 'fg') al = o
            }
          if (col) (r += col[0] * al), (g += col[1] * al), (b += col[2] * al), (a += al)
        }
      const i = (py * w + px) * 4
      const n = S * S
      png.data[i] = a ? r / a : 0
      png.data[i + 1] = a ? g / a : 0
      png.data[i + 2] = a ? b / a : 0
      png.data[i + 3] = Math.round((a / n) * 255)
    }
  return PNG.sync.write(png)
}

const out = (file, buf) => (writeFileSync(file, buf), console.log('✓', file))
out('public/icon-192.png', draw(192, 'tile'))
out('public/icon-512.png', draw(512, 'tile'))
out('public/icon-maskable-512.png', draw(512, 'mask'))
out('public/apple-touch-icon.png', draw(180, 'full'))
out('build/icon.png', draw(512, 'tile'))
out('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', draw(1024, 'full'))
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const res = 'android/app/src/main/res'
for (const [d, k] of Object.entries(dens)) {
  out(`${res}/mipmap-${d}/ic_launcher.png`, draw(48 * k, 'tile'))
  out(`${res}/mipmap-${d}/ic_launcher_round.png`, draw(48 * k, 'round'))
  out(`${res}/mipmap-${d}/ic_launcher_foreground.png`, draw(108 * k, 'fg'))
}
// Splash screens: navy with the mark in the middle, at their existing sizes
for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  try {
    const f = `${res}/${dir}/splash.png`
    const { width, height } = PNG.sync.read(readFileSync(f))
    out(f, draw(0, 'splash', width, height))
  } catch {
    /* no splash in this folder */
  }
}
