import {
  executeResearchGraph,
  type NodeProgressEvent,
  type PipelineEnv,
  type ResearchGraphInput,
  type ResearchGraphState,
  type ResearchNodeName,
} from './graph.ts'

export {
  executeResearchGraph,
  type NodeProgressEvent,
  type PipelineEnv,
  type ResearchGraphInput,
  type ResearchGraphState,
  type ResearchNodeName,
}

export type PipelineTrigger = 'cron' | 'manual'

export async function runWeeklyPipeline(
  env: PipelineEnv,
  trigger: PipelineTrigger,
  scheduledFor: Date,
): Promise<{ id: string; status: 'failed' | 'succeeded'; reportId?: string; error?: string; warnings?: string }> {
  const id = crypto.randomUUID()
  if (env.DB) {
    await env.DB.prepare(
      'INSERT INTO pipeline_runs (id, trigger, scheduled_for, started_at, status) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, trigger, scheduledFor.toISOString(), new Date().toISOString(), 'running')
      .run()
  }

  try {
    const state = await executeResearchGraph(env, {
      sessionId: id,
      mode: 'weekly',
      days: 7,
      trigger,
    })
    const warningText = state.warnings.join('; ')
    if (env.DB) {
      await env.DB.prepare('UPDATE pipeline_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
        .bind('succeeded', warningText ? `warnings: ${warningText}` : null, new Date().toISOString(), id)
        .run()
    }
    return {
      id,
      status: 'succeeded',
      reportId: state.reportId ?? undefined,
      warnings: warningText || undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (env.DB) {
      await env.DB.prepare('UPDATE pipeline_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
        .bind('failed', message, new Date().toISOString(), id)
        .run()
    }
    return { id, status: 'failed', error: message }
  }
}
