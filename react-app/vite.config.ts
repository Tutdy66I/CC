import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupAddress } from 'node:dns'

const MAX_FEED_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 10_000

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false
  }

  const [first, second] = octets as [number, number, number, number]
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  )
}

function isPrivateIPv6(hostname: string): boolean {
  const address = hostname.toLowerCase()
  return (
    address === '::' ||
    address === '::1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    /^fe[89ab]/.test(address) ||
    address.startsWith('::ffff:')
  )
}

async function validateFeedUrl(
  value: string,
): Promise<{ url: URL; addresses: LookupAddress[] }> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid feed URL.')
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Feed URL must use HTTP or HTTPS without credentials.')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Feed URL must point to a public host.')
  }

  const ipVersion = isIP(hostname)
  if (ipVersion === 4 && isPrivateIPv4(hostname)) {
    throw new Error('Feed URL must point to a public host.')
  }
  if (ipVersion === 6 && isPrivateIPv6(hostname)) {
    throw new Error('Feed URL must point to a public host.')
  }

  const addresses: LookupAddress[] =
    ipVersion === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname, family: ipVersion }]
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address),
    )
  ) {
    throw new Error('Feed URL must resolve to public addresses only.')
  }

  return { url, addresses }
}

function requestPinnedUrl(target: {
  url: URL
  addresses: LookupAddress[]
}): Promise<{ body: string; location?: string; status: number }> {
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, target.addresses)
    } else {
      const address = target.addresses[0]!
      callback(null, address.address, address.family)
    }
  }
  const requestFn =
    target.url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise((resolve, reject) => {
    const request = requestFn(
      target.url,
      {
        lookup: pinnedLookup,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'User-Agent': 'CC-RSS-Reader/1.0',
          Accept:
            'application/rss+xml, application/atom+xml, application/xml, text/xml',
        },
      },
      (response) => {
        const status = response.statusCode ?? 502
        const isRedirect = status >= 300 && status < 400
        const contentLength = Number(response.headers['content-length'])
        if (
          !isRedirect &&
          Number.isFinite(contentLength) &&
          contentLength > MAX_FEED_BYTES
        ) {
          request.destroy(new Error('Feed response exceeds the 2 MB limit.'))
          return
        }

        const chunks: Buffer[] = []
        let bytesRead = 0
        response.on('data', (chunk: Buffer | string) => {
          if (isRedirect) return
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytesRead += buffer.byteLength
          if (bytesRead > MAX_FEED_BYTES) {
            request.destroy(new Error('Feed response exceeds the 2 MB limit.'))
            return
          }
          chunks.push(buffer)
        })
        response.on('end', () => {
          resolve({
            body: isRedirect ? '' : Buffer.concat(chunks).toString('utf8'),
            location: response.headers.location,
            status,
          })
        })
      },
    )

    request.on('error', reject)
    request.end()
  })
}

async function fetchPublicFeed(
  value: string,
): Promise<{ body: string; status: number }> {
  let target = await validateFeedUrl(value)

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await requestPinnedUrl(target)

    if (response.status >= 300 && response.status < 400) {
      if (!response.location || redirects === MAX_REDIRECTS) {
        return { body: '', status: 502 }
      }
      target = await validateFeedUrl(
        new URL(response.location, target.url).href,
      )
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      return { body: '', status: response.status }
    }
    return { body: response.body, status: response.status }
  }

  return { body: '', status: 502 }
}

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
