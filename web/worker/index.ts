import { currentViewer, type AuthEnv, type Viewer } from './auth.ts'
import { runWeeklyPipeline, type PipelineEnv } from './pipeline/index.ts'

export interface Env extends PipelineEnv, AuthEnv {
  BUCKET: R2Bucket
  CRON_RUN_TOKEN?: string
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

/** users rows are keyed by Clerk user id; email is refreshed on every pass. */
async function upsertUser(env: Env, viewer: Viewer, now = new Date()): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email',
  )
    .bind(viewer.userId, viewer.email, now.toISOString())
    .run()
}

interface StateBody {
  read_later?: boolean
  important?: boolean
  note?: string
}

async function putState(env: Env, userId: string, itemId: string, body: StateBody): Promise<Response> {
  const item = await env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(itemId).first()
  if (!item) return json({ error: 'item not found' }, 404)

  const current = await env.DB.prepare(
    'SELECT read_later, important, note FROM user_items WHERE user_id = ? AND item_id = ?',
  )
    .bind(userId, itemId)
    .first<{ read_later: number; important: number; note: string }>()

  const next = {
    read_later: body.read_later ?? (current ? current.read_later === 1 : false),
    important: body.important ?? (current ? current.important === 1 : false),
    note: (body.note ?? current?.note ?? '').slice(0, 2000),
  }
  const now = new Date().toISOString()

  if (!next.read_later && !next.important && !next.note) {
    await env.DB.prepare('DELETE FROM user_items WHERE user_id = ? AND item_id = ?').bind(userId, itemId).run()
    return json({ item_id: itemId, read_later: false, important: false, note: '', updated_at: now })
  }

  await env.DB.prepare(
    `INSERT INTO user_items (user_id, item_id, read_later, important, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET read_later = excluded.read_later,
       important = excluded.important, note = excluded.note, updated_at = excluded.updated_at`,
  )
    .bind(userId, itemId, next.read_later ? 1 : 0, next.important ? 1 : 0, next.note, now)
    .run()

  return json({ item_id: itemId, ...next, updated_at: now })
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runWeeklyPipeline(env, 'cron', new Date(controller.scheduledTime))
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    if (path === '/api/health') {
      return json({ ok: true, service: 'synthetic-data-web' })
    }

    if (path === '/api/reports' && method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, week_end, subject, created_at FROM reports ORDER BY week_end DESC'
      ).all()
      return json({ reports: results })
    }

    const reportMatch = path.match(/^\/api\/reports\/([^/]+)$/)
    if (reportMatch && method === 'GET') {
      const report = await env.DB.prepare(
        'SELECT id, week_end, subject, trend, created_at, (pdf_r2_key IS NOT NULL) AS has_pdf FROM reports WHERE id = ?'
      ).bind(reportMatch[1]).first()
      if (!report) return new Response('Not found', { status: 404 })
      return json({ report })
    }

    const itemsMatch = path.match(/^\/api\/reports\/([^/]+)\/items$/)
    if (itemsMatch && method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, title, url, source, published, score, well7_fit, reason, summary, section, position FROM items WHERE report_id = ? ORDER BY section, position'
      ).bind(itemsMatch[1]).all()
      return json({ items: results })
    }

    const pdfMatch = path.match(/^\/api\/reports\/([^/]+)\/pdf$/)
    if (pdfMatch && method === 'GET') {
      const report = await env.DB.prepare('SELECT pdf_r2_key FROM reports WHERE id = ?').bind(pdfMatch[1]).first<{ pdf_r2_key: string }>()
      if (!report?.pdf_r2_key) return new Response('Not found', { status: 404 })
      const obj = await env.BUCKET.get(report.pdf_r2_key)
      if (!obj) return new Response('Not found', { status: 404 })
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${pdfMatch[1]}.pdf"`,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    if (path === '/api/pipeline/runs' && method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, trigger, scheduled_for, started_at, finished_at, status, error FROM pipeline_runs ORDER BY started_at DESC LIMIT 20'
      ).all()
      return json({ runs: results })
    }

    // Everything below needs either a signed-in Clerk identity or, for the
    // pipeline trigger, a matching CRON_RUN_TOKEN secret (so a run can be
    // started by hand from tools). Fail-closed: with no token configured,
    // only a Clerk admin can trigger.
    if (path.startsWith('/api/me') || path.startsWith('/api/my/')) {
      const viewer = await currentViewer(request, env)
      if (!viewer) return json({ error: 'sign in required' }, 401)

      if (viewer.email) await upsertUser(env, viewer)

      if (path === '/api/me' && method === 'GET') {
        return json({ user_id: viewer.userId, email: viewer.email, isAdmin: viewer.isAdmin })
      }

      if (path === '/api/my/library' && method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT i.id, i.title, i.url, i.source, i.published, i.score, i.reason, i.summary, i.section,
                  r.week_end, u.read_later, u.important, u.note, u.updated_at
           FROM user_items u
           JOIN items i ON i.id = u.item_id
           JOIN reports r ON r.id = i.report_id
           WHERE u.user_id = ?
           ORDER BY i.published DESC`,
        ).bind(viewer.userId).all()
        return json({ items: results })
      }

      const stateMatch = path.match(/^\/api\/my\/items\/([^/]+)$/)
      if (stateMatch && method === 'PUT') {
        const body = (await request.json().catch(() => null)) as StateBody | null
        if (!body || typeof body !== 'object') return json({ error: 'expected a JSON body' }, 400)
        return putState(env, viewer.userId, stateMatch[1], body)
      }

      return json({ error: 'sign in required' }, 401)
    }

    if (path === '/api/pipeline/run' && method === 'POST') {
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const viewer = await currentViewer(request, env)
      if (viewer?.isAdmin !== true && !(typeof env.CRON_RUN_TOKEN === 'string' && env.CRON_RUN_TOKEN.length > 0
        && bearer.length > 20 && timingSafeEqual(bearer, env.CRON_RUN_TOKEN))) {
        return json({ error: 'admin sign-in or bearer token required' }, 403)
      }
      const result = await runWeeklyPipeline(env, 'manual', new Date())
      return json(result, result.status === 'succeeded' ? 200 : 500)
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>

function timingSafeEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
  return mismatch === 0
}
