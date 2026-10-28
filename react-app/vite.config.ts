import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRssProxyResponse } from './server/rssProxyHandler'
import { handleTutorRequest } from './server/aiTutorHandler'
import { validatePublishableKey } from './server/publicConfig'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Preserve the v13.1 byte identity: comb modules are a disjoint engine.
const ofdmSource = createHash('sha256')
for (const file of [
  ...readdirSync('src/lib')
    .filter((x) => x.endsWith('.ts') && !x.startsWith('ofdmComb'))
    .map((x) => `src/lib/${x}`),
  'src/workers/ofdmResearch.worker.ts',
].sort()) {
  ofdmSource
    .update(file + '\0')
    .update(readFileSync(resolve(file)))
    .update('\0')
}

const combSource = createHash('sha256')
for (const file of [
  ...readdirSync('src/lib')
    .filter((x) => x.endsWith('.ts'))
    .map((x) => `src/lib/${x}`),
  'src/workers/ofdmResearch.worker.ts',
  'src/workers/ofdmCombResearch.worker.ts',
].sort()) {
  combSource
    .update(file + '\0')
    .update(readFileSync(resolve(file)))
    .update('\0')
}

// The new engine has its own transitive source identity. Keep the v1.3 lists above unchanged.
function syncLibFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    return entry.isDirectory()
      ? syncLibFiles(path)
      : entry.isFile() && path.endsWith('.ts')
        ? [path]
        : []
  })
}
const syncSource = createHash('sha256')
for (const file of [
  ...syncLibFiles('src/lib'),
  'src/workers/ofdmSync.worker.ts',
].sort()) {
  syncSource
    .update(file + '\0')
    .update(readFileSync(resolve(file)))
    .update('\0')
}
const jointSource = createHash('sha256')
for (const file of [
  ...syncLibFiles('src/lib'),
  'src/workers/jointSync.worker.ts',
].sort()) {
  jointSource
    .update(file + '\0')
    .update(readFileSync(resolve(file)))
    .update('\0')
}

function rssProxyPlugin(): Plugin {
  return {
    name: 'rss-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai-tutor', (req, res) => {
        void handleTutorRequest(req, res)
      })
      server.middlewares.use('/api/rss-proxy', async (req, res) => {
        const url = new URL(
          req.url ?? '/',
          'http://localhost',
        ).searchParams.get('url')

        const response = await createRssProxyResponse(url)
        res.statusCode = response.status
        res.setHeader('Content-Type', response.contentType)
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(response.body)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __OFDM_SOURCE_FINGERPRINT__: JSON.stringify(ofdmSource.digest('hex')),
    __OFDM_COMB_SOURCE_FINGERPRINT__: JSON.stringify(combSource.digest('hex')),
    __OFDM_SYNC_SOURCE_FINGERPRINT__: JSON.stringify(syncSource.digest('hex')),
    __OFDM_JOINT_SOURCE_FINGERPRINT__: JSON.stringify(
      jointSource.digest('hex'),
    ),
  },
  base: process.env.DEPLOY_BASE_PATH || '/',
  plugins: [
    react(),
    rssProxyPlugin(),
    {
      name: 'validate-public-supabase-config',
      configResolved(config) {
        validatePublishableKey(config.env.VITE_SUPABASE_PUBLISHABLE_KEY)
      },
    },
  ],
})
