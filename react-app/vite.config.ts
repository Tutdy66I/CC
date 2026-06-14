import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'CC-RSS-Reader/1.0',
              Accept:
                'application/rss+xml, application/atom+xml, application/xml, text/xml',
            },
          })

          if (!response.ok) {
            res.statusCode = response.status
            res.setHeader('Content-Type', 'text/plain')
            res.end(`Upstream returned ${response.status}`)
            return
          }

          const body = await response.text()
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/xml; charset=utf-8')
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(body)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'text/plain')
          res.end(`Failed to fetch: ${String(err)}`)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), rssProxyPlugin()],
})
