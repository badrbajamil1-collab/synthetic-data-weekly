import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../worker/index.ts'
import { displayUsername } from '../worker/auth.ts'
import {
  askWithFallback,
  candidateModels,
  DEFAULT_FALLBACK_MODELS,
  isFreeDailyQuotaError,
} from '../worker/pipeline/llm.ts'

test('displayUsername: picks Clerk username, fullName, first+last, or email local-part and strips control chars', () => {
  assert.equal(
    displayUsername({ username: 'badr\r\n_dev', fullName: 'Badr Bajamil' }, 'badr@example.com'),
    'badr _dev',
  )
  assert.equal(
    displayUsername({ username: '   ', fullName: 'Badr   Bajamil' }, 'badr@example.com'),
    'Badr Bajamil',
  )
  assert.equal(
    displayUsername({ firstName: 'Laila', lastName: 'Bashmal' }, 'laila@example.com'),
    'Laila Bashmal',
  )
  assert.equal(displayUsername({}, 'yasminemehrez890@gmail.com'), 'yasminemehrez890')
})

test('candidateModels: builds deduplicated 4-model default chain and respects custom CSV overrides', () => {
  const defaults = candidateModels({ OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free' })
  assert.deepEqual(defaults, [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    ...DEFAULT_FALLBACK_MODELS,
  ])

  const custom = candidateModels({
    OPENROUTER_MODEL: 'primary:free',
    OPENROUTER_FALLBACK_MODELS: ' primary:free , backup-a:free , , backup-b ',
  })
  assert.deepEqual(custom, ['primary:free', 'backup-a:free', 'backup-b'])

  const disabled = candidateModels({
    OPENROUTER_MODEL: 'only-one:free',
    OPENROUTER_FALLBACK_MODELS: '',
  })
  assert.deepEqual(disabled, ['only-one:free'])
})

test('askWithFallback: returns primary when healthy, falls back on error or empty, skips :free on daily quota, fails fast on 401/403', async () => {
  const primaryCalls: string[] = []
  const okPrimary = await askWithFallback(
    { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm1:free', OPENROUTER_FALLBACK_MODELS: 'm2:free' },
    'sys',
    'user',
    {
      invokeModel: async (model) => {
        primaryCalls.push(model)
        return '{"ok":true}'
      },
    },
  )
  assert.deepEqual(primaryCalls, ['m1:free'])
  assert.equal(okPrimary.model, 'm1:free')
  assert.equal(okPrimary.content, '{"ok":true}')

  const fallbackCalls: string[] = []
  const afterThrow = await askWithFallback(
    { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm1:free', OPENROUTER_FALLBACK_MODELS: 'm2:free,m3:free' },
    'sys',
    'user',
    {
      invokeModel: async (model) => {
        fallbackCalls.push(model)
        if (model === 'm1:free') throw new Error('HTTP 503 upstream overloaded')
        if (model === 'm2:free') return '   '
        return '{"ok":3}'
      },
    },
  )
  assert.deepEqual(fallbackCalls, ['m1:free', 'm2:free', 'm3:free'])
  assert.equal(afterThrow.model, 'm3:free')

  const quotaCalls: string[] = []
  assert.equal(isFreeDailyQuotaError(new Error('Rate limit: free-models-per-day exceeded')), true)
  const afterQuota = await askWithFallback(
    {
      OPENROUTER_API_KEY: 'k',
      OPENROUTER_MODEL: 'm1:free',
      OPENROUTER_FALLBACK_MODELS: 'm2:free,m3:free,paid/fallback',
    },
    'sys',
    'user',
    {
      invokeModel: async (model) => {
        quotaCalls.push(model)
        if (model === 'm1:free') throw new Error('429 free-models-per-day limit reached')
        return '{"paid":true}'
      },
    },
  )
  assert.deepEqual(quotaCalls, ['m1:free', 'paid/fallback'])
  assert.equal(afterQuota.model, 'paid/fallback')

  const authCalls: string[] = []
  await assert.rejects(
    () =>
      askWithFallback(
        { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm1:free', OPENROUTER_FALLBACK_MODELS: 'm2:free' },
        'sys',
        'user',
        {
          invokeModel: async (model) => {
            authCalls.push(model)
            const err = new Error('Unauthorized') as Error & { status?: number }
            err.status = 401
            throw err
          },
        },
      ),
    /Unauthorized/,
  )
  assert.deepEqual(authCalls, ['m1:free'])
})

function makeMockEnv(options?: {
  pdfKeys?: Record<string, string>
  pdfBytes?: Record<string, Uint8Array>
  runs?: Array<Record<string, unknown>>
  subscribers?: Array<Record<string, unknown>>
}) {
  const headCalls: string[] = []
  const getCalls: string[] = []
  const pdfKeys = options?.pdfKeys ?? {}
  const pdfBytes = options?.pdfBytes ?? {}
  const runs = options?.runs ?? []
  const subscribers = options?.subscribers ?? []

  const DB = {
    prepare(query: string) {
      let binds: unknown[] = []
      const stmt = {
        bind(...values: unknown[]) {
          binds = values
          return stmt
        },
        async run() {
          return { meta: { changes: 0 } }
        },
        async first<T>() {
          if (query.includes('SELECT pdf_r2_key FROM reports WHERE id = ?')) {
            const key = pdfKeys[String(binds[0])]
            return (key ? { pdf_r2_key: key } : null) as T | null
          }
          return null as T | null
        },
        async all<T>() {
          if (query.includes('FROM pipeline_runs')) {
            return { results: runs as T[] }
          }
          if (query.includes('FROM users') && query.includes('email_subscribed = 1')) {
            return { results: subscribers as T[] }
          }
          return { results: [] as T[] }
        },
      }
      return stmt
    },
    async batch() {
      return []
    },
  }

  const BUCKET = {
    async head(key: string) {
      headCalls.push(key)
      const bytes = pdfBytes[key]
      if (!bytes) return null
      return { key, size: bytes.byteLength }
    },
    async get(key: string) {
      getCalls.push(key)
      const bytes = pdfBytes[key]
      if (!bytes) return null
      return {
        key,
        size: bytes.byteLength,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
      }
    },
  }

  return {
    env: {
      DB: DB as never,
      BUCKET: BUCKET as never,
      CRON_RUN_TOKEN: 'secret-cron-token',
      OPENROUTER_API_KEY: 'test',
      OPENROUTER_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      CLERK_SECRET_KEY: 'sk_test_mock',
    },
    headCalls,
    getCalls,
  }
}

test('worker PDF endpoint supports GET and HEAD with Content-Length, sanitized filename, and 404 when missing', async () => {
  const samplePdf = new TextEncoder().encode('%PDF-1.4\nhello world\n')
  const { env, headCalls, getCalls } = makeMockEnv({
    pdfKeys: {
      'week-2026-11-20': 'reports/week-2026-11-20.pdf',
      'week%22bad': 'reports/week-bad.pdf',
    },
    pdfBytes: {
      'reports/week-2026-11-20.pdf': samplePdf,
      'reports/week-bad.pdf': samplePdf,
    },
  })

  const getRes = await worker.fetch(
    new Request('https://example.test/api/reports/week-2026-11-20/pdf'),
    env as never,
  )
  assert.equal(getRes.status, 200)
  assert.equal(getRes.headers.get('Content-Type'), 'application/pdf')
  assert.equal(getRes.headers.get('Content-Length'), String(samplePdf.byteLength))
  assert.equal(getRes.headers.get('Content-Disposition'), 'inline; filename="week-2026-11-20.pdf"')
  assert.deepEqual(new Uint8Array(await getRes.arrayBuffer()), samplePdf)
  assert.deepEqual(getCalls, ['reports/week-2026-11-20.pdf'])

  const headRes = await worker.fetch(
    new Request('https://example.test/api/reports/week-2026-11-20/pdf', { method: 'HEAD' }),
    env as never,
  )
  assert.equal(headRes.status, 200)
  assert.equal(headRes.headers.get('Content-Type'), 'application/pdf')
  assert.equal(headRes.headers.get('Content-Length'), String(samplePdf.byteLength))
  assert.equal(await headRes.text(), '')
  assert.deepEqual(headCalls, ['reports/week-2026-11-20.pdf'])

  const sanitizedRes = await worker.fetch(
    new Request('https://example.test/api/reports/week%22bad/pdf', { method: 'HEAD' }),
    env as never,
  )
  assert.equal(sanitizedRes.status, 200)
  assert.equal(sanitizedRes.headers.get('Content-Disposition'), 'inline; filename="week_22bad.pdf"')

  const missGet = await worker.fetch(
    new Request('https://example.test/api/reports/week-missing/pdf'),
    env as never,
  )
  const missHead = await worker.fetch(
    new Request('https://example.test/api/reports/week-missing/pdf', { method: 'HEAD' }),
    env as never,
  )
  assert.equal(missGet.status, 404)
  assert.equal(missHead.status, 404)
})

test('worker private and admin routes fail closed with Cache-Control: private, no-store', async () => {
  const { env } = makeMockEnv({
    runs: [{ id: 'run-1', trigger: 'python-sync', status: 'succeeded' }],
    subscribers: [
      {
        id: 'user_1',
        email: 'alice@example.com',
        username: 'Alice',
        subscribed_at: '2026-11-24T00:00:00Z',
        created_at: '2026-11-24T00:00:00Z',
      },
      {
        id: 'user_2',
        email: 'bob@example.com',
        username: '',
        subscribed_at: null,
        created_at: '2026-11-24T00:01:00Z',
      },
    ],
  })

  const runsUnauth = await worker.fetch(new Request('https://example.test/api/pipeline/runs'), env as never)
  assert.equal(runsUnauth.status, 403)
  assert.equal(runsUnauth.headers.get('Cache-Control'), 'private, no-store')

  const runsAuth = await worker.fetch(
    new Request('https://example.test/api/pipeline/runs', {
      headers: { Authorization: 'Bearer secret-cron-token' },
    }),
    env as never,
  )
  assert.equal(runsAuth.status, 200)
  assert.equal(runsAuth.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(await runsAuth.json(), {
    runs: [{ id: 'run-1', trigger: 'python-sync', status: 'succeeded' }],
  })

  const subsUnauth = await worker.fetch(new Request('https://example.test/api/subscribers'), env as never)
  assert.equal(subsUnauth.status, 403)
  assert.equal(subsUnauth.headers.get('Cache-Control'), 'private, no-store')

  const subsAuth = await worker.fetch(
    new Request('https://example.test/api/subscribers', {
      headers: { Authorization: 'Bearer secret-cron-token' },
    }),
    env as never,
  )
  assert.equal(subsAuth.status, 200)
  assert.equal(subsAuth.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(await subsAuth.json(), {
    subscribers: [
      {
        user_id: 'user_1',
        email: 'alice@example.com',
        username: 'Alice',
        subscribed_at: '2026-11-24T00:00:00Z',
      },
      {
        user_id: 'user_2',
        email: 'bob@example.com',
        username: 'bob',
        subscribed_at: '2026-11-24T00:01:00Z',
      },
    ],
  })

  const meUnauth = await worker.fetch(new Request('https://example.test/api/me'), env as never)
  assert.equal(meUnauth.status, 401)
  assert.equal(meUnauth.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(meUnauth.headers.get('X-Auth-Error'), 'no-token')

  const subToggleUnauth = await worker.fetch(
    new Request('https://example.test/api/my/subscription', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed: false }),
    }),
    env as never,
  )
  assert.equal(subToggleUnauth.status, 401)
  assert.equal(subToggleUnauth.headers.get('Cache-Control'), 'private, no-store')

  const publishUnauth = await worker.fetch(
    new Request('https://example.test/api/reports/publish', { method: 'POST' }),
    env as never,
  )
  assert.equal(publishUnauth.status, 403)
  assert.equal(publishUnauth.headers.get('Cache-Control'), 'private, no-store')

  const deleteUnauth = await worker.fetch(
    new Request('https://example.test/api/reports/week-2026-11-20', { method: 'DELETE' }),
    env as never,
  )
  assert.equal(deleteUnauth.status, 403)
  assert.equal(deleteUnauth.headers.get('Cache-Control'), 'private, no-store')
})
