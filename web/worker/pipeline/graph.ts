import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

import { rankingHealth } from './guard.ts'
import type { LlmEnv } from './llm.ts'
import { rankItems, type RankStats, type Scored } from './rank.ts'
import {
  ALL_SOURCE_FAMILIES,
  collectAll,
  normalizeUrl,
  sanitizeCollectOptions,
  type CollectOptions,
  type RawItem,
  type SourceFamily,
  type SourceResult,
  type SourceStat,
} from './sources.ts'
import {
  buildSections,
  fetchShortlistTexts,
  selectShortlist,
  trend,
  type FetchedText,
  type Section,
  type SummariseStats,
} from './summarise.ts'

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  run(): Promise<unknown>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike
  batch(statements: D1StatementLike[]): Promise<unknown[]>
}

export interface PipelineEnv extends LlmEnv {
  DB?: D1DatabaseLike
  GITHUB_TOKEN?: string
}

export type ResearchNodeName = 'collect' | 'clean' | 'rank' | 'fetch' | 'summarise' | 'publish'

export interface CleanStats {
  raw: number
  fresh: number
  duplicatesRemoved: number
  alreadyPublished: number
}

export interface ResearchGraphInput {
  sessionId?: string
  userId?: string | null
  mode: 'query' | 'weekly'
  query?: string
  days?: number
  sourceFamilies?: SourceFamily[]
  trigger?: 'cron' | 'manual'
}

export interface GraphDeps {
  collectAll: (
    since: Date,
    env: { GITHUB_TOKEN?: string },
    options?: CollectOptions,
  ) => Promise<{ items: RawItem[]; sources: SourceResult[]; stats: SourceStat[] }>
  rankItems: (items: RawItem[], env: LlmEnv, query?: string) => Promise<RankStats>
  fetchShortlistTexts: (items: RawItem[], githubToken?: string) => Promise<Record<string, FetchedText>>
  buildSections: (
    ranked: Scored[],
    env: LlmEnv,
    options?: { mode?: 'query' | 'weekly'; fetchedTexts?: Record<string, FetchedText> },
  ) => Promise<SummariseStats>
  trend: (picks: Array<{ title: string; summary: string }>, env: LlmEnv) => Promise<string>
}

const defaultDeps: GraphDeps = {
  collectAll,
  rankItems,
  fetchShortlistTexts,
  buildSections,
  trend,
}

export const ResearchAnnotation = Annotation.Root({
  sessionId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  userId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  mode: Annotation<'query' | 'weekly'>({
    reducer: (_prev, next) => next,
    default: () => 'query',
  }),
  query: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  days: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 7,
  }),
  sourceFamilies: Annotation<SourceFamily[]>({
    reducer: (_prev, next) => next,
    default: () => [...ALL_SOURCE_FAMILIES],
  }),
  rawItems: Annotation<RawItem[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  sourceStats: Annotation<SourceStat[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  cleanItems: Annotation<RawItem[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  cleanStats: Annotation<CleanStats>({
    reducer: (_prev, next) => next,
    default: () => ({ raw: 0, fresh: 0, duplicatesRemoved: 0, alreadyPublished: 0 }),
  }),
  scoredItems: Annotation<Scored[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  rankBatches: Annotation<{ failedBatches: number; totalBatches: number }>({
    reducer: (_prev, next) => next,
    default: () => ({ failedBatches: 0, totalBatches: 0 }),
  }),
  fetchedTexts: Annotation<Record<string, FetchedText>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  sections: Annotation<Section[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  trend: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  warnings: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  reportId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
})

export type ResearchGraphState = typeof ResearchAnnotation.State

export interface NodeProgressEvent {
  sessionId: string
  node: ResearchNodeName
  status: 'completed'
  timestamp: string
  summary: Record<string, unknown>
  stateSnapshot: Partial<ResearchGraphState>
}

const DAY_MS = 24 * 60 * 60 * 1000
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

async function itemId(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeUrl(url)))
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function upsertSessionRow(
  db: D1DatabaseLike | undefined,
  state: ResearchGraphState,
  currentNode: string,
  status: 'running' | 'succeeded' | 'failed',
  error: string | null = null,
): Promise<void> {
  if (!db) return
  const now = new Date().toISOString()
  const stats = {
    sourceStats: state.sourceStats,
    cleanStats: state.cleanStats,
    scoredCount: state.scoredItems.length,
    fetchedCount: Object.keys(state.fetchedTexts).length,
    sectionCount: state.sections.length,
    warnings: state.warnings,
    reportId: state.reportId,
  }
  const result = {
    sections: state.sections,
    scoredItems: state.scoredItems.slice(0, 24),
    cleanItems: state.cleanItems.slice(0, 24),
    trend: state.trend,
    sourceStats: state.sourceStats,
    cleanStats: state.cleanStats,
    warnings: state.warnings,
    reportId: state.reportId,
  }
  try {
    await db
      .prepare(
        `INSERT INTO research_sessions (id, user_id, mode, query, days, status, current_node, stats_json, result_json, error, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           current_node = excluded.current_node,
           stats_json = excluded.stats_json,
           result_json = excluded.result_json,
           error = excluded.error,
           finished_at = excluded.finished_at`,
      )
      .bind(
        state.sessionId,
        state.userId,
        state.mode,
        state.query,
        state.days,
        status,
        currentNode,
        JSON.stringify(stats),
        JSON.stringify(result),
        error,
        now,
        status === 'running' ? null : now,
      )
      .run()
  } catch {
    // D1 session checkpoint failure must never crash the research run itself.
  }
}

export function buildResearchGraph(
  env: PipelineEnv,
  depsInput?: Partial<GraphDeps>,
) {
  const deps: GraphDeps = { ...defaultDeps, ...depsInput }

  const workflow = new StateGraph(ResearchAnnotation)
    .addNode('collect', async (state: ResearchGraphState) => {
      const since = new Date(Date.now() - state.days * DAY_MS)
      const { items, stats } = await deps.collectAll(since, env, {
        query: state.query,
        sourceFamilies: state.sourceFamilies,
      })
      const sourceErrors = stats.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`)
      const warnings = [...state.warnings]
      if (sourceErrors.length > 0) warnings.push(sourceErrors.join('; '))
      return {
        rawItems: items,
        sourceStats: stats,
        warnings,
      }
    })
    .addNode('clean', async (state: ResearchGraphState) => {
      const seen = new Set<string>()
      const deduped: RawItem[] = []
      for (const item of state.rawItems) {
        const key = normalizeUrl(item.url)
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(item)
      }
      const duplicatesRemoved = state.rawItems.length - deduped.length

      let alreadyPublished = 0
      let fresh = deduped
      const weekEnd = new Date().toISOString().slice(0, 10)
      const targetReportId = `week-${weekEnd}`
      if (state.mode === 'weekly' && env.DB) {
        try {
          const { results: previous } = await env.DB.prepare('SELECT url FROM items WHERE report_id <> ?')
            .bind(targetReportId)
            .all<{ url: string }>()
          const publishedSet = new Set(previous.map((row) => normalizeUrl(row.url)))
          fresh = deduped.filter((item) => !publishedSet.has(normalizeUrl(item.url)))
          alreadyPublished = deduped.length - fresh.length
        } catch {
          alreadyPublished = 0
        }
      }

      const cap = state.mode === 'query' ? 24 : 60
      const cleanItems = fresh.slice(0, cap)
      const warnings = [...state.warnings]
      if (cleanItems.length === 0) {
        const scopeLabel = state.query ? `"${state.query}"` : 'synthetic data'
        warnings.push(`No fresh items matched ${scopeLabel} in the last ${state.days} day(s).`)
      }

      return {
        cleanItems,
        cleanStats: {
          raw: state.rawItems.length,
          fresh: cleanItems.length,
          duplicatesRemoved,
          alreadyPublished,
        },
        warnings,
      }
    })
    .addNode('rank', async (state: ResearchGraphState) => {
      const ranked = await deps.rankItems(state.cleanItems, env, state.query)
      const warnings = [...state.warnings]
      if (ranked.failedBatches > 0) {
        warnings.push(
          `rank: ${ranked.failedBatches}/${ranked.totalBatches} score batches got no model output; items kept at score 1`,
        )
      }
      const sorted = [...ranked.scored].sort(
        (a, b) =>
          (b.well7_fit ?? 0) - (a.well7_fit ?? 0) ||
          (b.score ?? 0) - (a.score ?? 0) ||
          b.title.localeCompare(a.title),
      )
      return {
        scoredItems: sorted,
        rankBatches: {
          failedBatches: ranked.failedBatches,
          totalBatches: ranked.totalBatches,
        },
        warnings,
      }
    })
    .addNode('fetch', async (state: ResearchGraphState) => {
      const plan = selectShortlist(state.scoredItems, state.mode)
      const fetchedTexts = await deps.fetchShortlistTexts(
        plan.map((p) => p.item),
        env.GITHUB_TOKEN,
      )
      return { fetchedTexts }
    })
    .addNode('summarise', async (state: ResearchGraphState) => {
      const { sections, fallbacks } = await deps.buildSections(state.scoredItems, env, {
        mode: state.mode,
        fetchedTexts: state.fetchedTexts,
      })
      const warnings = [...state.warnings]
      if (fallbacks > 0) {
        warnings.push(`summaries: ${fallbacks}/${sections.length} fell back to extractive text`)
      }
      const picks = sections.filter((s) => s.section === 'top')
      const summaryTrend = await deps.trend(
        picks.map((p) => ({ title: p.item.title, summary: p.summary.summary })),
        env,
      )
      return {
        sections,
        trend: summaryTrend,
        warnings,
      }
    })
    .addNode('publish', async (state: ResearchGraphState) => {
      if (state.mode !== 'weekly') {
        return { reportId: null }
      }
      if (state.cleanItems.length === 0) {
        throw new Error(
          `no new items in the last ${state.days} days (${state.warnings.length > 0 ? state.warnings.join('; ') : 'all sources ok'})`,
        )
      }
      const health = rankingHealth({
        scored: state.scoredItems,
        failedBatches: state.rankBatches.failedBatches,
        totalBatches: state.rankBatches.totalBatches || Math.max(1, Math.ceil(state.scoredItems.length / 15)),
      })
      if (!health.publishable) {
        throw new Error(`ranking degraded: ${health.reason}; refusing to publish (previous week left intact)`)
      }

      const now = new Date()
      const since = new Date(now.getTime() - state.days * DAY_MS)
      const weekEnd = now.toISOString().slice(0, 10)
      const reportId = `week-${weekEnd}`
      const subject = `Synthetic Data Weekly — Week of ${dateFormat.format(since)} – ${dateFormat.format(now)}`

      if (env.DB) {
        await env.DB.prepare(
          `INSERT INTO reports (id, week_end, subject, trend, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET week_end = excluded.week_end, subject = excluded.subject,
             trend = excluded.trend, created_at = excluded.created_at`,
        )
          .bind(reportId, weekEnd, subject, state.trend, now.toISOString())
          .run()

        const ids: string[] = []
        const statements: D1StatementLike[] = []
        const positions: Record<string, number> = {}
        for (const section of state.sections) {
          const id = await itemId(section.item.url)
          ids.push(id)
          positions[section.section] = (positions[section.section] ?? 0) + 1
          statements.push(
            env.DB.prepare(
              `INSERT INTO items (id, report_id, title, url, source, published, score, well7_fit, reason, summary, section, position)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET report_id = excluded.report_id, title = excluded.title,
                 source = excluded.source, published = excluded.published, score = excluded.score,
                 well7_fit = excluded.well7_fit, reason = excluded.reason, summary = excluded.summary,
                 section = excluded.section, position = excluded.position`,
            ).bind(
              id,
              reportId,
              section.item.title,
              normalizeUrl(section.item.url),
              section.item.source,
              section.item.published,
              section.item.score ?? section.item.well7_fit,
              section.item.well7_fit,
              section.item.reason,
              section.summary.summary,
              section.section,
              positions[section.section],
            ),
          )
        }
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',')
          statements.push(
            env.DB.prepare(`DELETE FROM items WHERE report_id = ? AND id NOT IN (${placeholders})`).bind(
              reportId,
              ...ids,
            ),
          )
        }
        await env.DB.batch(statements)
      }

      return { reportId }
    })
    .addEdge(START, 'collect')
    .addEdge('collect', 'clean')
    .addConditionalEdges('clean', (state: ResearchGraphState) =>
      state.cleanItems.length === 0 ? 'publish' : 'rank',
    )
    .addEdge('rank', 'fetch')
    .addEdge('fetch', 'summarise')
    .addEdge('summarise', 'publish')
    .addEdge('publish', END)

  return workflow.compile()
}

function summarizeNodeUpdate(node: ResearchNodeName, state: ResearchGraphState): Record<string, unknown> {
  switch (node) {
    case 'collect':
      return {
        rawCount: state.rawItems.length,
        sourceStats: state.sourceStats,
      }
    case 'clean':
      return {
        cleanStats: state.cleanStats,
        previewCount: state.cleanItems.length,
      }
    case 'rank':
      return {
        scoredCount: state.scoredItems.length,
        topScore: state.scoredItems[0]?.well7_fit ?? 0,
      }
    case 'fetch': {
      const origins = Object.values(state.fetchedTexts)
      return {
        fetchedCount: origins.length,
        fullTextCount: origins.filter((o) => o.origin === 'full text').length,
      }
    }
    case 'summarise':
      return {
        sectionCount: state.sections.length,
        hasTrend: Boolean(state.trend),
      }
    case 'publish':
      return {
        reportId: state.reportId,
        sessionId: state.sessionId,
      }
  }
}

export async function executeResearchGraph(
  env: PipelineEnv,
  input: ResearchGraphInput,
  onNodeEvent?: (event: NodeProgressEvent) => Promise<void> | void,
  deps?: Partial<GraphDeps>,
): Promise<ResearchGraphState> {
  const sanitized = sanitizeCollectOptions({
    query: input.query,
    days: input.days,
    sourceFamilies: input.sourceFamilies,
  })
  const sessionId = input.sessionId ?? crypto.randomUUID()

  let currentState: ResearchGraphState = {
    sessionId,
    userId: input.userId ?? null,
    mode: input.mode,
    query: sanitized.query,
    days: sanitized.days,
    sourceFamilies: sanitized.sourceFamilies,
    rawItems: [],
    sourceStats: [],
    cleanItems: [],
    cleanStats: { raw: 0, fresh: 0, duplicatesRemoved: 0, alreadyPublished: 0 },
    scoredItems: [],
    rankBatches: { failedBatches: 0, totalBatches: 0 },
    fetchedTexts: {},
    sections: [],
    trend: '',
    warnings: [],
    reportId: null,
  }

  await upsertSessionRow(env.DB, currentState, 'collect', 'running')

  const compiled = buildResearchGraph(env, deps)
  try {
    const stream = await compiled.stream(currentState, { streamMode: 'updates' })
    for await (const chunk of stream) {
      for (const [nodeName, partial] of Object.entries(chunk)) {
        const node = nodeName as ResearchNodeName
        currentState = {
          ...currentState,
          ...(partial as Partial<ResearchGraphState>),
        }
        const status = node === 'publish' ? 'succeeded' : 'running'
        await upsertSessionRow(env.DB, currentState, node, status)
        if (onNodeEvent) {
          await onNodeEvent({
            sessionId,
            node,
            status: 'completed',
            timestamp: new Date().toISOString(),
            summary: summarizeNodeUpdate(node, currentState),
            stateSnapshot: {
              cleanStats: currentState.cleanStats,
              sourceStats: currentState.sourceStats,
              cleanItems: currentState.cleanItems.slice(0, 24),
              scoredItems: currentState.scoredItems.slice(0, 24),
              sections: currentState.sections,
              trend: currentState.trend,
              warnings: currentState.warnings,
              reportId: currentState.reportId,
            },
          })
        }
      }
    }
    return currentState
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await upsertSessionRow(env.DB, currentState, 'publish', 'failed', message)
    throw error
  }
}
