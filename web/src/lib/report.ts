export interface Report {
  id: string
  week_end: string
  subject: string
  trend?: string
  created_at: string
  has_pdf?: number | boolean
}

export interface ReportItem {
  id: string
  title: string
  url: string
  source: string
  published: string
  score: number
  well7_fit: number | null
  reason: string
  summary: string
  section: string
  position: number
}

/**
 * Normalizes SQLite UTC timestamps (`YYYY-MM-DD HH:MM:SS`) so they parse as UTC
 * rather than local time, preventing 1-day backward shifts in negative-UTC zones.
 */
function parseUtcDate(value: string): Date {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(trimmed)) {
    return new Date(`${trimmed.replace(' ', 'T')}Z`)
  }
  return new Date(trimmed)
}

export function parseUtcTimestamp(value: string): number {
  const time = parseUtcDate(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function formatDate(value: string, style: 'long' | 'short' = 'long') {
  const date = parseUtcDate(value)
  if (Number.isNaN(date.getTime())) return value

  // undefined → resolve from navigator.languages / Accept-Language
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

const ABBREVIATIONS = /(?:^|[\s(["'])(?:e\.g|i\.e|vs|dr|mr|mrs|ms|prof|fig|figs|eq|no|al|etc|u\.s|u\.k)\.$/i

/**
 * Splits a multi-sentence trend/summary paragraph into a 1-sentence lead
 * plus scannable bullet points while avoiding splits on common abbreviations
 * (e.g., i.e., Fig., Dr., U.S., et al.).
 */
export function splitTrendSentences(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  const parts: string[] = []
  let buffer = ''
  const tokens = trimmed.split(/(\s+)/)

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    buffer += token
    if (/^\s+$/.test(token)) continue

    const nextSpace = tokens[i + 1]
    const nextWord = tokens[i + 2]
    if (
      /[.!?]["')]*$/.test(token) &&
      nextSpace &&
      nextWord &&
      /^[A-Z0-9"'(]/.test(nextWord) &&
      !ABBREVIATIONS.test(buffer.trim())
    ) {
      parts.push(buffer.trim())
      buffer = ''
      i += 1 // skip the separator whitespace
    }
  }

  if (buffer.trim()) parts.push(buffer.trim())
  return parts
}

const SOURCE_NAMES: Record<string, string> = {
  arxiv: 'arXiv',
  github: 'GitHub',
  'hacker news': 'Hacker News',
  'google news': 'Google News',
  'reddit r/machinelearning': 'Reddit r/MachineLearning',
  'reddit r/localllama': 'Reddit r/LocalLLaMA',
  'hugging face': 'Hugging Face',
  'microsoft research': 'Microsoft Research',
  'aws machine learning': 'AWS Machine Learning',
  'google research': 'Google Research',
  'bair berkeley': 'BAIR Berkeley',
  'together ai': 'Together AI',
  blogs: 'Research Blogs',
  hn: 'Hacker News',
  news: 'Google News',
  reddit: 'Reddit',
}

export function sourceLabel(source: string): string {
  const known = SOURCE_NAMES[source.trim().toLowerCase()]
  if (known) return known
  return source === source.toLowerCase() ? source.charAt(0).toUpperCase() + source.slice(1) : source
}

export function briefTitle(subject: string) {
  return subject.replace(/^Synthetic Data Weekly\s*[—–-]\s*/i, '')
}
