import { collectAll, normalizeUrl } from './sources.ts'
import { rankItems } from './rank.ts'
import { rankingHealth } from './guard.ts'
import { buildSections, trend } from './summarise.ts'
import type { LlmEnv } from './llm.ts'

export interface PipelineEnv extends LlmEnv {
  DB: D1Database
  GITHUB_TOKEN?: string
}

export type PipelineTrigger = 'cron' | 'manual'

const WINDOW_DAYS = 7
const MAX_RANKED = 60
const DAY = 24 * 60 * 60 * 1000

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

async function itemId(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeUrl(url)))
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function runWeeklyPipeline(
  env: PipelineEnv,
  trigger: PipelineTrigger,
  scheduledFor: Date,
): Promise<{ id: string; status: 'failed' | 'succeeded'; reportId?: string; error?: string }> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO pipeline_runs (id, trigger, scheduled_for, started_at, status) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, trigger, scheduledFor.toISOString(), new Date().toISOString(), 'running')
    .run()

  try {
    const result = await produceReport(env)
    await env.DB.prepare('UPDATE pipeline_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
      .bind('succeeded', result.warnings || null, new Date().toISOString(), id)
      .run()
    return { id, status: 'succeeded', reportId: result.reportId, error: result.warnings || undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await env.DB.prepare('UPDATE pipeline_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
      .bind('failed', message, new Date().toISOString(), id)
      .run()
    return { id, status: 'failed', error: message }
  }
}

async function produceReport(env: PipelineEnv): Promise<{ reportId: string; warnings: string }> {  const now = new Date()
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY)
  const weekEnd = now.toISOString().slice(0, 10)
  const reportId = `week-${weekEnd}`

  const { items, sources } = await collectAll(since, env)
  const warnings: string[] = []
  const sourceErrors = sources.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`)
  if (sourceErrors.length > 0) warnings.push(sourceErrors.join('; '))

  const { results: previous } = await env.DB.prepare('SELECT url FROM items WHERE report_id <> ?')
    .bind(reportId)
    .all<{ url: string }>()
  const published = new Set(previous.map((row) => normalizeUrl(row.url)))
  const fresh = items.filter((item) => !published.has(normalizeUrl(item.url)))
  if (fresh.length === 0) {
    throw new Error(`no new items in the last ${WINDOW_DAYS} days (${warnings.length > 0 ? warnings.join('; ') : 'all sources ok'})`)
  }

  const ranked = await rankItems(fresh.slice(0, MAX_RANKED), env)
  // A failed ranking must not reach D1: this Worker writes the live archive, so
  // publishing an all-score-1 week would replace a good brief with noise.
  const health = rankingHealth(ranked)
  if (!health.publishable) {
    throw new Error(`ranking degraded: ${health.reason}; refusing to publish (previous week left intact)`)
  }
  const { sections, fallbacks } = await buildSections(ranked.scored, env)
  // Degraded model output must be visible in the run log, not silent.
  if (ranked.failedBatches > 0) {
    warnings.push(
      `rank: ${ranked.failedBatches}/${ranked.totalBatches} score batches got no model output; items kept at score 1`,
    )
  }
  if (fallbacks > 0) {
    warnings.push(`summaries: ${fallbacks}/${sections.length} fell back to extractive text`)
  }
  const picks = sections.filter((s) => s.section === 'top')
  const summaryTrend = await trend(picks.map((p) => ({ title: p.item.title, summary: p.summary.summary })), env)

  const subject = `Synthetic Data Weekly — Week of ${dateFormat.format(since)} – ${dateFormat.format(now)}`
  await env.DB.prepare(
    `INSERT INTO reports (id, week_end, subject, trend, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET week_end = excluded.week_end, subject = excluded.subject,
       trend = excluded.trend, created_at = excluded.created_at`,
  )
    .bind(reportId, weekEnd, subject, summaryTrend, now.toISOString())
    .run()

  const ids: string[] = []
  const statements: D1PreparedStatement[] = []
  const positions: Record<string, number> = {}
  for (const section of sections) {
    const id = await itemId(section.item.url)
    ids.push(id)
    positions[section.section] = (positions[section.section] ?? 0) + 1
    statements.push(
      env.DB.prepare(
        `INSERT INTO items (id, report_id, title, url, source, published, score, well7_fit, reason, summary, section, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET report_id = excluded.report_id, title = excluded.title,
           source = excluded.source, published = excluded.published, score = excluded.score,
           reason = excluded.reason, summary = excluded.summary, section = excluded.section,
           position = excluded.position`,
      ).bind(
        id,
        reportId,
        section.item.title,
        normalizeUrl(section.item.url),
        section.item.source,
        section.item.published,
        section.item.score,
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
      env.DB.prepare(`DELETE FROM items WHERE report_id = ? AND id NOT IN (${placeholders})`).bind(reportId, ...ids),
    )
  }
  await env.DB.batch(statements)
  return { reportId, warnings: warnings.join('; ') }
}
