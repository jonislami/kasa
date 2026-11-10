// Vercel build for both web apps from the same repo (vercel.json has one build command and one output dir).
//   Kasa project:            no KASA_APP            → npm run build              → dist/
//   Kasa Kontabilist project: KASA_APP=kontabilist  → npm run build:kontabilist → dist-kontabilist/ copied to dist/
import { execSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'

const app = process.env.KASA_APP ?? 'kasa'
const run = (cmd) => execSync(cmd, { stdio: 'inherit' })

if (app === 'kontabilist') {
  run('npm run build:kontabilist')
  rmSync('dist', { recursive: true, force: true })
  cpSync('dist-kontabilist', 'dist', { recursive: true })
} else {
  run('npm run build')
}
