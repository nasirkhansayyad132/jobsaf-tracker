import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const canonicalDataFiles = new Map([
  ['/data/jobs.json', fileURLToPath(new URL('../docs/data/jobs.json', import.meta.url))],
  ['/data/summary.json', fileURLToPath(new URL('../docs/data/summary.json', import.meta.url))],
])

/** Serve the repository's canonical data during local development without copying it. */
function canonicalDataDevPlugin() {
  return {
    name: 'canonical-jobs-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        const dataFile = canonicalDataFiles.get(pathname)

        if (!dataFile) {
          next()
          return
        }

        try {
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(await readFile(dataFile))
        } catch (error) {
          server.config.logger.error(`Unable to serve ${pathname}: ${error.message}`)
          response.statusCode = 503
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: 'Canonical job data is unavailable.' }))
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    canonicalDataDevPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/data\/(jobs|summary)\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'jobs-data-v1',
              networkTimeoutSeconds: 8,
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Afghanistan Tech Jobs',
        short_name: 'Tech Jobs',
        description: 'Find current software, data, IT, and technology jobs in Afghanistan.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        scope: './',
        start_url: './',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  base: './',
  build: {
    // Never build into docs/: docs/data is the canonical scraper output.
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
