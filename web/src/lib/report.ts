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

export function formatDate(value: string, style: 'long' | 'short' = 'long') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  // undefined → resolve from navigator.languages / Accept-Language
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
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
}

export function sourceLabel(source: string): string {
  const known = SOURCE_NAMES[source.trim().toLowerCase()]
  if (known) return known
  return source === source.toLowerCase() ? source.charAt(0).toUpperCase() + source.slice(1) : source
}

export function briefTitle(subject: string) {
  return subject.replace(/^Synthetic Data Weekly\s*[—–-]\s*/i, '')
}
