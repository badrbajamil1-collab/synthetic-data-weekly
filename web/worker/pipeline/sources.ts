import { XMLParser } from 'fast-xml-parser'

export interface RawItem {
  title: string
  url: string
  source: string
  published: string
  snippet: string
}

export type SourceFamily = 'arxiv' | 'hn' | 'github' | 'news' | 'reddit' | 'blogs'

export const ALL_SOURCE_FAMILIES: readonly SourceFamily[] = [
  'arxiv',
  'hn',
  'github',
  'news',
  'reddit',
  'blogs',
]

export interface CollectOptions {
  query?: string
  sourceFamilies?: SourceFamily[]
}

export interface SourceResult {
  name: string
  family: SourceFamily
  items: RawItem[]
  durationMs: number
  error: string | null
}

export interface SourceStat {
  name: string
  family: SourceFamily
  count: number
  durationMs: number
  error: string | null
}

const UA = 'synthetic-data-weekly/1.0 (weekly research digest)'
const KEYWORDS = /synthetic data|synthetic dataset|synthetic tabular|tabular synthesis|differential privacy|synthetic time.?series|synthetic training|data augmentation/i

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
})

export function sanitizeCollectOptions(input?: {
  query?: unknown
  days?: unknown
  sourceFamilies?: unknown
}): { query: string; days: number; sourceFamilies: SourceFamily[] } {
  const rawQuery = typeof input?.query === 'string' ? input.query.trim().slice(0, 140) : ''
  const parsedDays = typeof input?.days === 'number' ? input.days : Number(input?.days)
  const days = Number.isFinite(parsedDays) ? Math.min(30, Math.max(1, Math.round(parsedDays))) : 7

  const validSet = new Set<string>(ALL_SOURCE_FAMILIES)
  const requested = Array.isArray(input?.sourceFamilies)
    ? input.sourceFamilies.filter((item): item is SourceFamily => typeof item === 'string' && validSet.has(item))
    : []
  const sourceFamilies = requested.length > 0 ? [...new Set(requested)] : [...ALL_SOURCE_FAMILIES]

  return { query: rawQuery, days, sourceFamilies }
}

function queryMatchesText(text: string, customQuery: string): boolean {
  if (!customQuery) return true
  const tokens = customQuery
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
  if (tokens.length === 0) return true
  const lower = text.toLowerCase()
  return tokens.some((token) => lower.includes(token))
}

function textOf(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return String((value as Record<string, unknown>)['#text'] ?? '')
  return String(value)
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function entriesOf(xml: string): Record<string, any>[] {
  const doc = parser.parse(xml)
  const feed = doc.feed ?? doc.rss?.channel ?? doc.RDF ?? {}
  const list = feed.entry ?? feed.item ?? []
  return Array.isArray(list) ? list : [list]
}

function linkOf(entry: Record<string, any>): string {
  const link = entry.link
  if (typeof link === 'string') return link
  if (Array.isArray(link)) {
    const alternate = link.find((l) => l?.['@_rel'] === 'alternate') ?? link[0]
    return alternate?.['@_href'] ?? textOf(alternate)
  }
  if (link && typeof link === 'object') return link['@_href'] ?? textOf(link)
  return ''
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 10000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...(init.headers ?? {}) },
    })
  } finally {
    clearTimeout(timer)
  }
}

function withinWindow(published: string, since: Date): boolean {
  const time = Date.parse(published)
  return Number.isFinite(time) && time >= since.getTime()
}

async function feed(
  name: string,
  family: SourceFamily,
  url: string,
  keywordFilter: boolean,
  since: Date,
  customQuery = '',
  timeoutMs = 10000,
): Promise<SourceResult> {
  const start = Date.now()
  try {
    const response = await fetchWithTimeout(url, {}, timeoutMs)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const entries = entriesOf(await response.text())
    const items: RawItem[] = []
    for (const entry of entries) {
      const title = textOf(entry.title).trim()
      const link = linkOf(entry)
      const published = String(entry.published ?? entry.updated ?? entry.pubDate ?? entry.date ?? '')
      const snippet = stripHtml(textOf(entry.summary ?? entry.description ?? entry.content ?? '')).slice(0, 1200)
      if (!title || !link) continue
      if (!withinWindow(published, since)) continue
      const combined = `${title} ${snippet}`
      if (keywordFilter && !KEYWORDS.test(combined) && !queryMatchesText(combined, customQuery)) continue
      if (customQuery && keywordFilter && !queryMatchesText(combined, customQuery)) continue
      items.push({ title, url: link, source: name, published: new Date(published).toISOString(), snippet })
    }
    return { name, family, items, durationMs: Date.now() - start, error: null }
  } catch (error) {
    return {
      name,
      family,
      items: [],
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function arxiv(since: Date, customQuery = ''): Promise<SourceResult> {
  const terms = customQuery
    ? `all:"synthetic data" AND all:${customQuery}`
    : 'all:"synthetic data"'
  const query = encodeURIComponent(terms)
  const url = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=25`
  // arXiv routinely takes 15-25s; a 10s timeout aborts healthy queries.
  return feed('arXiv', 'arxiv', url, false, since, customQuery, 30000)
}

async function hackerNews(since: Date, customQuery = ''): Promise<SourceResult> {
  const start = Date.now()
  const from = Math.floor(since.getTime() / 1000)
  const searchTerms = customQuery ? `synthetic data ${customQuery}` : 'synthetic data'
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(searchTerms)}&tags=story&numericFilters=created_at_i>${from}&hitsPerPage=15`
  try {
    const response = await fetchWithTimeout(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { hits: Array<Record<string, any>> }
    const items = body.hits
      .filter((hit) => hit.title)
      .map((hit) => ({
        title: String(hit.title),
        url: String(hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`),
        source: 'Hacker News',
        published: new Date(String(hit.created_at)).toISOString(),
        snippet: `${hit.points ?? 0} points on Hacker News`,
      }))
    return { name: 'Hacker News', family: 'hn', items, durationMs: Date.now() - start, error: null }
  } catch (error) {
    return {
      name: 'Hacker News',
      family: 'hn',
      items: [],
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function github(since: Date, token: string | undefined, customQuery = ''): Promise<SourceResult> {
  const start = Date.now()
  const day = since.toISOString().slice(0, 10)
  const extra = customQuery ? ` ${customQuery}` : ''
  const q = encodeURIComponent(`synthetic-data${extra} in:name,description,topics created:>=${day}`)
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const response = await fetchWithTimeout(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=15`, { headers })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { items: Array<Record<string, any>> }
    const items = body.items.map((repo) => ({
      title: String(repo.full_name),
      url: String(repo.html_url),
      source: 'GitHub',
      published: new Date(String(repo.created_at ?? repo.pushed_at)).toISOString(),
      snippet: `${repo.stargazers_count} stars. ${repo.description ?? ''}`.trim(),
    }))
    return { name: 'GitHub', family: 'github', items, durationMs: Date.now() - start, error: null }
  } catch (error) {
    return {
      name: 'GitHub',
      family: 'github',
      items: [],
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function collectAll(
  since: Date,
  env: { GITHUB_TOKEN?: string },
  options?: CollectOptions,
): Promise<{ items: RawItem[]; sources: SourceResult[]; stats: SourceStat[] }> {
  const customQuery = (options?.query ?? '').trim()
  const activeFamilies = new Set<SourceFamily>(
    options?.sourceFamilies && options.sourceFamilies.length > 0
      ? options.sourceFamilies
      : ALL_SOURCE_FAMILIES,
  )
  const windowDays = Math.max(1, Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)))
  const gnewsQuery = customQuery
    ? encodeURIComponent(`"synthetic data" ${customQuery} when:${windowDays}d`)
    : encodeURIComponent(`"synthetic data" when:${windowDays}d`)

  const tasks: Array<Promise<SourceResult>> = []
  if (activeFamilies.has('arxiv')) tasks.push(arxiv(since, customQuery))
  if (activeFamilies.has('hn')) tasks.push(hackerNews(since, customQuery))
  if (activeFamilies.has('github')) tasks.push(github(since, env.GITHUB_TOKEN, customQuery))
  if (activeFamilies.has('news')) {
    tasks.push(
      feed(
        'Google News',
        'news',
        `https://news.google.com/rss/search?q=${gnewsQuery}&hl=en-US&gl=US&ceid=US:en`,
        false,
        since,
        customQuery,
      ),
    )
  }
  if (activeFamilies.has('reddit')) {
    // Combined multi-sub feed without trailing slash (`/.rss` returns 429).
    tasks.push(
      feed(
        'Reddit',
        'reddit',
        'https://www.reddit.com/r/MachineLearning+LocalLLaMA+datascience.rss',
        true,
        since,
        customQuery,
      ),
    )
  }
  if (activeFamilies.has('blogs')) {
    tasks.push(
      feed('Hugging Face', 'blogs', 'https://huggingface.co/blog/feed.xml', true, since, customQuery),
      feed('Microsoft Research', 'blogs', 'https://www.microsoft.com/en-us/research/feed/', true, since, customQuery),
      feed('AWS Machine Learning', 'blogs', 'https://aws.amazon.com/blogs/machine-learning/feed/', true, since, customQuery),
      feed('Google Research', 'blogs', 'https://research.google/blog/rss/', true, since, customQuery),
      feed('BAIR Berkeley', 'blogs', 'https://bair.berkeley.edu/blog/feed.xml', true, since, customQuery),
      feed('Together AI', 'blogs', 'https://www.together.ai/blog/rss.xml', true, since, customQuery),
    )
  }

  const sources = await Promise.all(tasks)
  const seen = new Set<string>()
  const items: RawItem[] = []
  for (const source of sources) {
    for (const item of source.items) {
      const key = normalizeUrl(item.url)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  const stats: SourceStat[] = sources.map((s) => ({
    name: s.name,
    family: s.family,
    count: s.items.length,
    durationMs: s.durationMs,
    error: s.error,
  }))
  return { items, sources, stats }
}

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'source') url.searchParams.delete(key)
    }
    url.hash = ''
    url.protocol = 'https:'
    url.hostname = url.hostname.toLowerCase()
    if (url.hostname.endsWith('arxiv.org')) url.pathname = url.pathname.replace(/v\d+$/, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}
