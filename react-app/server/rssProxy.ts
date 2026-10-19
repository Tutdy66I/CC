import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const MAX_FEED_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 10_000

type FeedTarget = { url: URL; addresses: LookupAddress[] }
type FeedResponse = { body: string; location?: string; status: number }
type ResolveHost = (hostname: string) => Promise<LookupAddress[]>
type RequestFeed = (target: FeedTarget) => Promise<FeedResponse>

export interface FeedProxyDependencies {
  resolveHost?: ResolveHost
  request?: RequestFeed
}

function resolvePublicHost(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, verbatim: true })
}

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

export async function validateFeedUrl(
  value: string,
  resolveHost: ResolveHost = resolvePublicHost,
): Promise<FeedTarget> {
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
      ? await resolveHost(hostname)
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

function requestPinnedUrl(target: FeedTarget): Promise<FeedResponse> {
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

export async function fetchPublicFeed(
  value: string,
  dependencies: FeedProxyDependencies = {},
): Promise<{ body: string; status: number }> {
  const resolveHost = dependencies.resolveHost ?? resolvePublicHost
  const request = dependencies.request ?? requestPinnedUrl
  let target = await validateFeedUrl(value, resolveHost)

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await request(target)

    if (response.status >= 300 && response.status < 400) {
      if (!response.location || redirects === MAX_REDIRECTS) {
        return { body: '', status: 502 }
      }
      target = await validateFeedUrl(
        new URL(response.location, target.url).href,
        resolveHost,
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
