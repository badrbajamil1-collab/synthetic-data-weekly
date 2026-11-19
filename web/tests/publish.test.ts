import assert from 'node:assert/strict'
import test from 'node:test'

import { parsePublishPayload, publishReportToStorage } from '../worker/pipeline/publish.ts'

function encodePdf(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64')
}

test('parsePublishPayload: accepts valid report with optional PDF', () => {
  const res = parsePublishPayload({
    week_end: '2026-11-20',
    subject: 'Synthetic Data Weekly — Week of 14 – 20 Nov 2026',
    trend: 'Copula and DP advances.',
    items: [
      {
        title: 'Copula Synthesis',
        url: 'https://arxiv.org/abs/2611.22882v1?utm_source=test',
        source: 'arXiv',
        published: '2026-11-17',
        score: 9,
        well7_fit: 9,
        reason: 'Interpretable tabular synthesis.',
        summary: 'Investigates Gaussian Mixture Copula Models.',
        section: 'top',
      },
    ],
    pdf_base64: encodePdf('%PDF-1.4\nfake pdf bytes'),
  })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.data.id, 'week-2026-11-20')
  assert.equal(res.data.items.length, 1)
  assert.equal(res.data.items[0].url, 'https://arxiv.org/abs/2611.22882')
  assert.equal(res.data.items[0].published, '2026-11-17T00:00:00Z')
  assert.equal(res.data.items[0].position, 1)
  assert.ok(res.data.pdfBytes && res.data.pdfBytes.length > 5)
})

test('parsePublishPayload: rejects bad week_end, empty items, bad section, and non-PDF bytes', () => {
  const badDate = parsePublishPayload({ week_end: 'not-a-date', subject: 'S', items: [{ title: 'A', url: 'https://a.test', section: 'top' }] })
  assert.equal(badDate.ok, false)

  const emptyItems = parsePublishPayload({ week_end: '2026-11-20', subject: 'S', items: [] })
  assert.equal(emptyItems.ok, false)

  const badSection = parsePublishPayload({ week_end: '2026-11-20', subject: 'S', items: [{ title: 'A', url: 'https://a.test', section: 'invalid' }] })
  assert.equal(badSection.ok, false)

  const badPdf = parsePublishPayload({
    week_end: '2026-11-20',
    subject: 'S',
    items: [{ title: 'A', url: 'https://a.test', section: 'top' }],
    pdf_base64: encodePdf('NOT_A_PDF_FILE'),
  })
  assert.equal(badPdf.ok, false)

  const arrayBody = parsePublishPayload([])
  assert.equal(arrayBody.ok, false)
})

test('parsePublishPayload: deduplicates items sharing a normalized URL', () => {
  const res = parsePublishPayload({
    week_end: '2026-11-20',
    subject: 'Synthetic Data Weekly — Week of 14 – 20 Nov 2026',
    items: [
      { title: 'First', url: 'https://arxiv.org/abs/2611.22882v1', section: 'top' },
      { title: 'Duplicate', url: 'https://arxiv.org/abs/2611.22882v2?utm_source=x', section: 'worth' },
    ],
  })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.data.items.length, 1)
  assert.equal(res.data.items[0].title, 'First')
})

test('publishReportToStorage: writes PDF to R2 and upserts report + items + deletes stale items in D1', async () => {
  const parsed = parsePublishPayload({
    week_end: '2026-11-20',
    subject: 'Synthetic Data Weekly — Week of 14 – 20 Nov 2026',
    trend: 'Trend text.',
    items: [
      { title: 'Pick 1', url: 'https://arxiv.org/abs/2611.10001', source: 'arXiv', published: '2026-11-17', score: 9, well7_fit: 9, reason: 'Good fit', summary: 'Summary 1', section: 'top' },
      { title: 'Tool 1', url: 'https://github.com/org/tool', source: 'GitHub', published: '2026-11-16', score: 7, well7_fit: 8, reason: 'Useful repo', summary: 'Summary 2', section: 'tool' },
    ],
    pdf_base64: encodePdf('%PDF-1.4\nbody'),
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  const sqlCalls: Array<{ query: string; binds: unknown[] }> = []
  let batchedCount = 0
  const db = {
    prepare(query: string) {
      let binds: unknown[] = []
      const stmt = {
        bind(...values: unknown[]) {
          binds = values
          return stmt
        },
        async run() {
          sqlCalls.push({ query, binds })
          return { meta: { changes: 1 } }
        },
        async all<T>() {
          return { results: [] as T[] }
        },
        async first<T>() {
          return null as T | null
        },
        _inspect() {
          return { query, binds }
        },
      }
      return stmt
    },
    async batch(statements: unknown[]) {
      batchedCount = statements.length
      for (const s of statements as Array<{ run(): Promise<unknown> }>) {
        await s.run()
      }
      return []
    },
  }

  const r2Writes: Array<{ key: string; contentType?: string }> = []
  const bucket = {
    async put(key: string, _value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
      r2Writes.push({ key, contentType: options?.httpMetadata?.contentType })
    },
  }

  const result = await publishReportToStorage(db, bucket, parsed.data)
  assert.equal(result.reportId, 'week-2026-11-20')
  assert.equal(result.itemsCount, 2)
  assert.equal(result.hasPdf, true)
  assert.equal(result.pdfKey, 'reports/week-2026-11-20.pdf')
  assert.deepEqual(r2Writes, [{ key: 'reports/week-2026-11-20.pdf', contentType: 'application/pdf' }])
  assert.equal(batchedCount, 3) // 2 item upserts + 1 stale-item cleanup DELETE
  assert.ok(sqlCalls.some((c) => c.query.includes('INSERT INTO reports')))
  assert.ok(sqlCalls.some((c) => c.query.includes('DELETE FROM items WHERE report_id = ?')))
})
