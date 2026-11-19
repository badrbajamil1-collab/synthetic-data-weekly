import { normalizeUrl } from './sources.ts'
import type { D1DatabaseLike, D1StatementLike } from './graph.ts'

export type PublishSection = 'top' | 'tool' | 'worth'

const VALID_SECTIONS = new Set<string>(['top', 'tool', 'worth'])

export interface PublishItemInput {
  title: string
  url: string
  source: string
  published: string
  score: number
  well7_fit: number | null
  reason: string
  summary: string
  section: PublishSection
  position: number
}

export interface PublishPayload {
  id: string
  week_end: string
  subject: string
  trend: string
  created_at: string
  items: PublishItemInput[]
  pdfBytes: Uint8Array | null
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
}

function asTrimmedString(value: unknown, maxLen = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : ''
}

function decodeBase64(raw: string): Uint8Array {
  const cleaned = raw.replace(/\s+/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function publishItemId(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeUrl(url)))
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function parsePublishPayload(body: unknown): { ok: true; data: PublishPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'expected a JSON object' }
  }
  const obj = body as Record<string, unknown>
  const weekEnd = asTrimmedString(obj.week_end, 32)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
    return { ok: false, error: 'week_end must be YYYY-MM-DD' }
  }
  const id = asTrimmedString(obj.id, 64) || `week-${weekEnd}`
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    return { ok: false, error: 'id contains invalid characters' }
  }
  const subject = asTrimmedString(obj.subject, 300)
  if (!subject) {
    return { ok: false, error: 'subject is required' }
  }
  const trend = asTrimmedString(obj.trend, 6000)
  const createdAt = asTrimmedString(obj.created_at, 64) || new Date().toISOString()

  if (!Array.isArray(obj.items) || obj.items.length === 0) {
    return { ok: false, error: 'items must be a non-empty array' }
  }

  const positions: Record<PublishSection, number> = { top: 0, tool: 0, worth: 0 }
  const items: PublishItemInput[] = []
  for (const rawItem of obj.items) {
    if (!rawItem || typeof rawItem !== 'object') {
      return { ok: false, error: 'each item must be an object' }
    }
    const row = rawItem as Record<string, unknown>
    const title = asTrimmedString(row.title, 400)
    const url = asTrimmedString(row.url, 2000)
    const section = asTrimmedString(row.section, 16)
    if (!title || !url) {
      return { ok: false, error: 'each item requires title and url' }
    }
    if (!VALID_SECTIONS.has(section)) {
      return { ok: false, error: `invalid section: ${section || '(empty)'}` }
    }
    const typedSection = section as PublishSection
    positions[typedSection] += 1
    const rawPos = typeof row.position === 'number' && Number.isInteger(row.position) && row.position > 0
      ? row.position
      : positions[typedSection]
    const rawScore = Number(row.score ?? 0)
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(10, Math.round(rawScore))) : 0
    const rawFit = row.well7_fit === null || row.well7_fit === undefined ? null : Number(row.well7_fit)
    const well7Fit = rawFit !== null && Number.isFinite(rawFit) ? Math.max(0, Math.min(10, Math.round(rawFit))) : null
    const published = asTrimmedString(row.published, 64) || `${weekEnd}T00:00:00Z`

    items.push({
      title,
      url: normalizeUrl(url),
      source: asTrimmedString(row.source, 120) || 'web',
      published: published.includes('T') ? published : `${published}T00:00:00Z`,
      score,
      well7_fit: well7Fit,
      reason: asTrimmedString(row.reason, 500),
      summary: asTrimmedString(row.summary, 4000),
      section: typedSection,
      position: rawPos,
    })
  }

  let pdfBytes: Uint8Array | null = null
  if (typeof obj.pdf_base64 === 'string' && obj.pdf_base64.trim()) {
    try {
      pdfBytes = decodeBase64(obj.pdf_base64)
    } catch {
      return { ok: false, error: 'pdf_base64 is not valid base64' }
    }
    const isPdf =
      pdfBytes.length >= 5 &&
      pdfBytes[0] === 0x25 && // %
      pdfBytes[1] === 0x50 && // P
      pdfBytes[2] === 0x44 && // D
      pdfBytes[3] === 0x46 && // F
      pdfBytes[4] === 0x2d    // -
    if (!isPdf) {
      return { ok: false, error: 'pdf_base64 does not decode to a PDF (%PDF- header missing)' }
    }
  }

  return {
    ok: true,
    data: { id, week_end: weekEnd, subject, trend, created_at: createdAt, items, pdfBytes },
  }
}

export async function publishReportToStorage(
  db: D1DatabaseLike,
  bucket: R2BucketLike | undefined,
  payload: PublishPayload,
): Promise<{ reportId: string; itemsCount: number; hasPdf: boolean; pdfKey: string | null }> {
  let pdfKey: string | null = null
  if (payload.pdfBytes && bucket) {
    pdfKey = `reports/${payload.id}.pdf`
    await bucket.put(pdfKey, payload.pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
    })
  }

  await db
    .prepare(
      `INSERT INTO reports (id, week_end, subject, trend, created_at, pdf_r2_key)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         week_end = excluded.week_end,
         subject = excluded.subject,
         trend = excluded.trend,
         created_at = excluded.created_at,
         pdf_r2_key = COALESCE(excluded.pdf_r2_key, reports.pdf_r2_key)`,
    )
    .bind(payload.id, payload.week_end, payload.subject, payload.trend, payload.created_at, pdfKey)
    .run()

  const ids: string[] = []
  const statements: D1StatementLike[] = []
  for (const item of payload.items) {
    const id = await publishItemId(item.url)
    ids.push(id)
    statements.push(
      db
        .prepare(
          `INSERT INTO items (id, report_id, title, url, source, published, score, well7_fit, reason, summary, section, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             report_id = excluded.report_id,
             title = excluded.title,
             url = excluded.url,
             source = excluded.source,
             published = excluded.published,
             score = excluded.score,
             well7_fit = excluded.well7_fit,
             reason = excluded.reason,
             summary = excluded.summary,
             section = excluded.section,
             position = excluded.position`,
        )
        .bind(
          id,
          payload.id,
          item.title,
          item.url,
          item.source,
          item.published,
          item.score,
          item.well7_fit,
          item.reason,
          item.summary,
          item.section,
          item.position,
        ),
    )
  }

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    statements.push(
      db.prepare(`DELETE FROM items WHERE report_id = ? AND id NOT IN (${placeholders})`).bind(
        payload.id,
        ...ids,
      ),
    )
  }
  await db.batch(statements)

  return {
    reportId: payload.id,
    itemsCount: payload.items.length,
    hasPdf: pdfKey !== null,
    pdfKey,
  }
}
