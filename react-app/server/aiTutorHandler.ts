import type { IncomingMessage, ServerResponse } from 'node:http'
import { createTutorReply } from './aiTutor.js'

let active = 0
const clients = new Map<string, { start: number; count: number }>()

export async function handleTutorRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const send = (status: number, body: object) => {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    send(405, { error: '仅支持 POST。' })
    return
  }
  if (!req.headers['content-type']?.startsWith('application/json')) {
    send(415, { error: '请发送 JSON。' })
    return
  }
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) {
        send(403, { error: '仅允许同源请求。' })
        return
      }
    } catch {
      send(403, { error: '来源无效。' })
      return
    }
  }
  const now = Date.now()
  for (const [address, entry] of clients)
    if (now - entry.start > 60000) clients.delete(address)
  const address = req.socket.remoteAddress ?? 'unknown'
  const entry = clients.get(address) ?? { start: now, count: 0 }
  if (
    active >= 2 ||
    entry.count >= 10 ||
    (!clients.has(address) && clients.size >= 1000)
  ) {
    res.setHeader('Retry-After', '60')
    send(429, { error: '请求较多，请稍后再试。' })
    return
  }
  entry.count++
  clients.set(address, entry)
  active++
  const controller = new AbortController()
  const close = () => controller.abort()
  res.on('close', close)
  const timer = setTimeout(() => {
    controller.abort()
    res.once('finish', () => req.destroy())
    send(408, { error: '请求读取超时。' })
  }, 15000)
  try {
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of req) {
      length += Buffer.byteLength(chunk)
      if (length > 64000) {
        send(413, { error: '请求过大。' })
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    clearTimeout(timer)
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(400, { error: 'JSON 格式无效。' })
      return
    }
    const result = await createTutorReply(
      body,
      process.env,
      fetch,
      controller.signal,
    )
    if (!res.writableEnded) send(result.status, result.body)
  } catch {
    if (!res.writableEnded) send(400, { error: '无法读取请求。' })
  } finally {
    clearTimeout(timer)
    res.off('close', close)
    active--
  }
}
