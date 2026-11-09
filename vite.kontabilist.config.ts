// "Kasa Kontabilist" – the accountant's program: same code base and database as Kasa, its own
// entry (kontabilist.html → index.html), output (dist-kontabilist/) and installer.
//   npm run dev:kontabilist      → http://localhost:5174
//   npm run build:kontabilist    → dist-kontabilist/ (web: its own Vercel project)
//   npm run dist:win:kontabilist → release/Kasa-Kontabilist-Setup-<version>.exe
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { existsSync, readFileSync, renameSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

/** Serves kontabilist.html for every app route in dev/preview and renames it to index.html after the build. */
function entryHtml(): Plugin {
  const rewrite = (req: { url?: string; headers: Record<string, string | string[] | undefined> }) => {
    const url = req.url ?? '/'
    const accept = String(req.headers.accept ?? '')
    if (accept.includes('text/html') && !/\.[a-z0-9]+(\?|$)/i.test(url.split('?')[0])) req.url = '/kontabilist.html'
  }
  return {
    name: 'kontabilist-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && !/\.[a-z0-9]+(\?|$)/i.test(req.url.split('?')[0])) req.url = '/index.html'
        next()
      })
    },
    // The built page must be index.html (Electron, Vercel and preview look for it).
    closeBundle() {
      const from = fileURLToPath(new URL('./dist-kontabilist/kontabilist.html', import.meta.url))
      if (existsSync(from)) renameSync(from, fileURLToPath(new URL('./dist-kontabilist/index.html', import.meta.url)))
    },
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Not a PWA: the shared layout's service-worker hook becomes a no-op.
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/kontabilist/pwaStub.ts', import.meta.url)),
    },
  },
  plugins: [react(), entryHtml()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: {
    outDir: 'dist-kontabilist',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./kontabilist.html', import.meta.url)) },
  },
})
