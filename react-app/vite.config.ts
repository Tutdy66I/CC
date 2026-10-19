import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fetchPublicFeed } from './server/rssProxy'

function rssProxyPlugin(): Plugin {
  return {
    name: 'rss-proxy',
    configureServer(server) {
      server.middlewares.use('/api/rss-proxy', async (req, res) => {
        const url = new URL(
          req.url ?? '/',
          'http://localhost',
        ).searchParams.get('url')

        if (!url) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'text/plain')
          res.end('Missing "url" query parameter')
          return
        }

        try {
          const result = await fetchPublicFeed(url)

          if (result.status !== 200) {
            res.statusCode = result.status
            res.setHeader('Content-Type', 'text/plain')
            res.end(`Upstream returned ${result.status}`)
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/xml; charset=utf-8')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(result.body)
        } catch (err) {
          const isInvalidTarget =
            err instanceof Error &&
            (err.message === 'Invalid feed URL.' ||
              err.message.startsWith('Feed URL'))
          res.statusCode = isInvalidTarget ? 400 : 502
          res.setHeader('Content-Type', 'text/plain')
          res.end(err instanceof Error ? err.message : 'Failed to fetch feed.')
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), rssProxyPlugin()],
})
