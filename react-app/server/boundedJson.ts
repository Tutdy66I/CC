export async function boundedJson(
  response: Response,
  limit = 131072,
): Promise<unknown> {
  if (
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json') ||
    !response.body
  )
    throw new Error('Invalid JSON response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > limit) throw new Error('Response exceeds byte limit')
      chunks.push(part.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
