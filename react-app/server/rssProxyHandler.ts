import { fetchPublicFeed } from './rssProxy.js'

type FetchPublicFeed = typeof fetchPublicFeed

export interface ProxyResponse {
  body: string
  contentType: string
  status: number
}

export interface RssProxyHandlerDependencies {
  fetchPublicFeed?: FetchPublicFeed
}

export async function createRssProxyResponse(
  url: string | null,
  dependencies: RssProxyHandlerDependencies = {},
): Promise<ProxyResponse> {
  if (!url) {
    return {
      body: 'Missing "url" query parameter',
      contentType: 'text/plain',
      status: 400,
    }
  }

  try {
    const result = await (dependencies.fetchPublicFeed ?? fetchPublicFeed)(url)
    if (result.status !== 200) {
      return {
        body: `Upstream returned ${result.status}`,
        contentType: 'text/plain',
        status: result.status,
      }
    }

    return {
      body: result.body,
      contentType: 'application/xml; charset=utf-8',
      status: 200,
    }
  } catch (error) {
    const isInvalidTarget =
      error instanceof Error &&
      (error.message === 'Invalid feed URL.' ||
        error.message.startsWith('Feed URL'))
    return {
      body: isInvalidTarget ? error.message : 'Failed to fetch feed.',
      contentType: 'text/plain',
      status: isInvalidTarget ? 400 : 502,
    }
  }
}
