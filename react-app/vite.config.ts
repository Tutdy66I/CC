import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRssProxyResponse } from './server/rssProxyHandler'

function rssProxyPlugin(): Plugin {
  return {
    name: 'rss-proxy',
    configureServer(server) {
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
  plugins: [react(), rssProxyPlugin()],
})
