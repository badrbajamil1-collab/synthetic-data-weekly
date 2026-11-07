import type { ReportItem } from '@/lib/report'

export type FeedSection = 'all' | 'top' | 'tool' | 'worth'
export type FeedView = 'all' | 'read_later' | 'important'

export interface FeedFilters {
  query: string
  section: FeedSection
  keyword: string | null
  view: FeedView
}

export interface SavedState {
  read_later: number
  important: number
}

export interface Topic {
  label: string
  pattern: RegExp
}

type Taggable = Pick<ReportItem, 'title' | 'summary' | 'reason'>

// Heuristic key words, matched against title, summary and reason. Edit this list to change them.
export const TOPICS: Topic[] = [
  { label: 'Privacy', pattern: /privacy|differentially|anonymi[sz]|de-?identif|membership inference|memoriz/i },
  { label: 'Tabular', pattern: /tabular|relational|spreadsheet|\btables?\b/i },
  { label: 'Healthcare', pattern: /clinical|medical|health|patient|\bEHR\b|hospital|biomedical/i },
  { label: 'Evaluation', pattern: /benchmark|evaluat|leaderboard|fidelity|utility|metric/i },
  { label: 'LLMs', pattern: /\bLLMs?\b|language models?|\bGPT|llama|qwen|mistral|claude|gemma|nemotron|instruction[- ]tun/i },
  { label: 'Diffusion & GANs', pattern: /diffusion|score[- ]based|flow matching|\bGANs?\b|generative adversarial|\bVAEs?\b|variational autoencoder/i },
  { label: 'Agents', pattern: /\bagents?\b|agentic/i },
  { label: 'Tools & code', pattern: /\blibrar(?:y|ies)\b|toolkit|open[- ]source|\bSDK\b|\bCLI\b|\bframework\b|\brepo\b|pip install/i },
  { label: 'Fairness', pattern: /fairness|\bbias(?:ed)?\b|debias|equity/i },
  { label: 'Simulation', pattern: /simulat|digital twin|sim-to-real/i },
  { label: 'Vision', pattern: /\bimages?\b|vision|\bvideos?\b|3D|splatting/i },
  { label: 'Time series', pattern: /time[- ]series|forecast/i },
  { label: 'Finance', pattern: /financ|fraud|banking|trading/i },
]

const SECTION_VALUES: Record<Exclude<FeedSection, 'all'>, string[]> = {
  top: ['top', 'top_picks'],
  tool: ['tool', 'tools'],
  worth: ['worth', 'worth_a_look'],
}

export function topicsFor(item: Taggable): string[] {
  const text = `${item.title} ${item.summary ?? ''} ${item.reason ?? ''}`
  return TOPICS.filter((topic) => topic.pattern.test(text)).map((topic) => topic.label)
}

export function keywordCounts(items: Taggable[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const label of topicsFor(item)) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function sectionCounts(items: ReportItem[]): Record<FeedSection, number> {
  const counts: Record<FeedSection, number> = { all: items.length, top: 0, tool: 0, worth: 0 }
  for (const item of items) {
    for (const key of Object.keys(SECTION_VALUES) as Array<keyof typeof SECTION_VALUES>) {
      if (SECTION_VALUES[key].includes(item.section)) counts[key] += 1
    }
  }
  return counts
}

export function filterItems(items: ReportItem[], filters: FeedFilters, saved: Map<string, SavedState>): ReportItem[] {
  const query = filters.query.trim().toLowerCase()
  return items
    .filter((item) => filters.section === 'all' || SECTION_VALUES[filters.section].includes(item.section))
    .filter((item) => {
      const state = saved.get(item.id)
      if (filters.view === 'read_later') return state?.read_later === 1
      if (filters.view === 'important') return state?.important === 1
      return true
    })
    .filter((item) => !filters.keyword || topicsFor(item).includes(filters.keyword))
    .filter((item) => !query || `${item.title} ${item.summary ?? ''} ${item.source}`.toLowerCase().includes(query))
    .sort((a, b) => b.score - a.score || a.position - b.position)
}
