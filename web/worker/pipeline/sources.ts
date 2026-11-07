import { XMLParser } from 'fast-xml-parser'

export interface RawItem {
  title: string
  url: string
  source: string
  published: string
  snippet: string
}

export interface SourceResult {
  name: string
  items: RawItem[]
  error: string | null
}

const UA = 'synthetic-data-weekly/1.0 (weekly research digest)'
const KEYWORDS = /synthetic data|synthetic dataset|synthetic tabular|tabular synthesis|differential privacy|synthetic time.?series|synthetic training|data augmentation/i

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
})

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

async function feed(name: string, url: string, keywordFilter: boolean, since: Date): Promise<SourceResult> {
  try {
    const response = await fetchWithTimeout(url)
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
      if (keywordFilter && !KEYWORDS.test(`${title} ${snippet}`)) continue
      items.push({ title, url: link, source: name, published: new Date(published).toISOString(), snippet })
    }
    return { name, items, error: null }
  } catch (error) {
    return { name, items: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function arxiv(since: Date): Promise<SourceResult> {
  const query = encodeURIComponent('all:"synthetic data"')
  const url = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=25`
  return feed('arXiv', url, false, since)
}

async function hackerNews(since: Date): Promise<SourceResult> {
  const from = Math.floor(since.getTime() / 1000)
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent('synthetic data')}&tags=story&numericFilters=created_at_i>${from}&hitsPerPage=15`
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
    return { name: 'Hacker News', items, error: null }
  } catch (error) {
    return { name: 'Hacker News', items: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function github(since: Date, token: string | undefined): Promise<SourceResult> {
  const day = since.toISOString().slice(0, 10)
  const q = encodeURIComponent(`synthetic-data in:name,description,topics pushed:>${day}`)
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const response = await fetchWithTimeout(`https://api.github.com/search/repositories?q=${q}&sort=updated&per_page=15`, { headers })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as { items: Array<Record<string, any>> }
    const items = body.items.map((repo) => ({
      title: String(repo.full_name),
      url: String(repo.html_url),
      source: 'GitHub',
      published: new Date(String(repo.pushed_at)).toISOString(),
      snippet: `${repo.stargazers_count} stars. ${repo.description ?? ''}`.trim(),
    }))
    return { name: 'GitHub', items, error: null }
  } catch (error) {
    return { name: 'GitHub', items: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export async function collectAll(since: Date, env: { GITHUB_TOKEN?: string }): Promise<{ items: RawItem[]; sources: SourceResult[] }> {
  const sources = await Promise.all([
    arxiv(since),
    hackerNews(since),
    github(since, env.GITHUB_TOKEN),
    feed('Google News', 'https://news.google.com/rss/search?q=%22synthetic+data%22+when:7d&hl=en-US&gl=US&ceid=US:en', false, since),
    feed('Reddit r/MachineLearning', 'https://www.reddit.com/r/MachineLearning/.rss', true, since),
    feed('Reddit r/LocalLLaMA', 'https://www.reddit.com/r/LocalLLaMA/.rss', true, since),
    feed('Hugging Face', 'https://huggingface.co/blog/feed.xml', true, since),
    feed('Microsoft Research', 'https://www.microsoft.com/en-us/research/feed/', true, since),
    feed('AWS Machine Learning', 'https://aws.amazon.com/blogs/machine-learning/feed/', true, since),
    feed('Google Research', 'https://research.google/blog/rss/', true, since),
    feed('BAIR Berkeley', 'https://bair.berkeley.edu/blog/feed.xml', true, since),
    feed('Together AI', 'https://www.together.ai/blog/rss.xml', true, since),
  ])
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
  return { items, sources }
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
