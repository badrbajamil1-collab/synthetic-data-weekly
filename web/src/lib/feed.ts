import type { ReportItem } from './report.ts'

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
export type { Taggable }

// Comprehensive topic catalog, matched against title, summary and reason.
export const TOPICS: Topic[] = [
  { label: 'Privacy', pattern: /privacy|differentially|\bDP\b|anonymi[sz]|de-?identif|membership inference|memoriz|epsilon|\bε\b|re-?identif/i },
  { label: 'Tabular', pattern: /tabular|relational|spreadsheet|\btables?\b|\brows?\b|structured data|dataframe/i },
  { label: 'Healthcare', pattern: /clinical|medical|health|patient|\bEHR\b|hospital|biomedical|genom|pharmac|radiolog/i },
  { label: 'Evaluation', pattern: /benchmark|evaluat|leaderboard|fidelity|utility|metric|audit|verif|validat/i },
  { label: 'LLMs', pattern: /\bLLMs?\b|language models?|\bGPT|llama|qwen|mistral|claude|gemma|nemotron|instruction|fine[- ]tun|reasoning|prompt/i },
  { label: 'Diffusion & GANs', pattern: /diffusion|score[- ]based|flow matching|\bGANs?\b|generative adversarial|\bVAEs?\b|variational autoencoder|autoregressive/i },
  { label: 'Agents', pattern: /\bagents?\b|agentic|multi[- ]agent|persona|role[- ]play/i },
  { label: 'Tools & code', pattern: /\blibrar(?:y|ies)\b|toolkit|open[- ]source|\bSDK\b|\bCLI\b|\bframework\b|\brepo(?:sitory)?\b|pip install|package|python/i },
  { label: 'Fairness', pattern: /fairness|\bbias(?:ed)?\b|debias|equity|demographic|subgroup|disparit/i },
  { label: 'Simulation', pattern: /simulat|digital twin|sim-to-real|world model|monte carlo/i },
  { label: 'Vision', pattern: /\bimages?\b|vision|\bvideos?\b|3D|splatting|multimodal|render/i },
  { label: 'Time series', pattern: /time[- ]series|forecast|temporal|sequential| longitudinal/i },
  { label: 'Finance', pattern: /financ|fraud|banking|trading|credit|transaction|anti[- ]money/i },
  { label: 'Federated & Distributed', pattern: /federated|decentraliz|cross[- ]silo|collaborative learning|distributed/i },
  { label: 'Watermarking & Provenance', pattern: /watermark|provenance|detection|attribution|fingerprint|model collapse/i },
  { label: 'Graph & Network', pattern: /\bgraphs?\b|\bGNNs?\b|network topology|knowledge graph/i },
  { label: 'Audio & Speech', pattern: /\baudio\b|speech|\bvoice\b|acoustic|\bTTS\b|\bASR\b/i },
  { label: 'Robotics & Embodied', pattern: /robot|embodied|manipulation|autonomous driving|trajectory|lidar/i },
  { label: 'Data Curation', pattern: /curat|deduplicat|filtering|pruning|distill|augmentation|synthetic corpus/i },
  { label: 'Security & Red-Teaming', pattern: /jailbreak|red[- ]team|adversarial|safety|backdoor|cyber|intrusion/i },
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

/**
 * The item lists behind the chip counts on a filtered page.
 *
 * Each chip set ignores its own dimension — selecting "Tools" must not make the
 * Tools chip read 0 — and honours everything else, including the search text.
 */
export function chipScopes(
  items: ReportItem[],
  filters: FeedFilters,
  saved: Map<string, SavedState>,
): { section: ReportItem[]; keyword: ReportItem[]; view: ReportItem[] } {
  const withoutView: FeedFilters = { ...filters, view: 'all' }
  return {
    section: filterItems(items, { ...withoutView, section: 'all' }, saved),
    keyword: filterItems(items, { ...withoutView, keyword: null }, saved),
    view: filterItems(items, withoutView, saved),
  }
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
