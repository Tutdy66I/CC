import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRssProxyResponse } from './rssProxyHandler.js'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

export function resolveStaticFilePath(
  pathname: string,
  distDirectory: string,
): string | null {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const root = resolve(distDirectory)
  const filePath = resolve(
    root,
    `.${decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`}`,
  )
  const fileRelativeToRoot = relative(root, filePath)
  if (
    fileRelativeToRoot === '..' ||
    fileRelativeToRoot.startsWith(`..${sep}`) ||
    fileRelativeToRoot.startsWith(sep)
  ) {
    return null
  }
  return filePath
}

async function handleRequest(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
  distDirectory: string,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost')
  if (requestUrl.pathname === '/api/rss-proxy') {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET', 'Content-Type': 'text/plain' })
      response.end('Method not allowed')
      return
    }
    const result = await createRssProxyResponse(
      requestUrl.searchParams.get('url'),
    )
    response.writeHead(result.status, {
      'Content-Type': result.contentType,
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(result.body)
    return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain',
    })
    response.end('Method not allowed')
    return
  }

  let filePath = resolveStaticFilePath(requestUrl.pathname, distDirectory)
  if (!filePath) {
    response.writeHead(400, { 'Content-Type': 'text/plain' })
    response.end('Invalid path')
    return
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = resolveStaticFilePath('/index.html', distDirectory)!
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = resolveStaticFilePath('/index.html', distDirectory)!
  }

  response.writeHead(200, {
    'Cache-Control': filePath.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
  } else {
    createReadStream(filePath).pipe(response)
  }
}

export function startProductionServer(
  distDirectory = resolve(process.cwd(), 'dist'),
  port = Number(process.env.PORT) || 4173,
): void {
  createServer((request, response) => {
    void handleRequest(request, response, distDirectory).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain' })
      }
      response.end('Internal server error')
    })
  }).listen(port, '0.0.0.0', () => {
    process.stdout.write(`Production server listening on port ${port}\n`)
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startProductionServer()
}
