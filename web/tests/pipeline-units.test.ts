import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeCollectOptions, ALL_SOURCE_FAMILIES } from '../worker/pipeline/sources.ts'
import { selectShortlist } from '../worker/pipeline/summarise.ts'
import type { Scored } from '../worker/pipeline/rank.ts'

test('sanitizeCollectOptions: clamps days to 1..30 and defaults empty query and sourceFamilies', () => {
  assert.deepEqual(sanitizeCollectOptions({}), {
    query: '',
    days: 7,
    sourceFamilies: [...ALL_SOURCE_FAMILIES],
  })
  assert.equal(sanitizeCollectOptions({ days: 0 }).days, 1)
  assert.equal(sanitizeCollectOptions({ days: 99 }).days, 30)
  assert.equal(sanitizeCollectOptions({ days: 'invalid' }).days, 7)
  assert.equal(sanitizeCollectOptions({ query: '  healthcare privacy  ' }).query, 'healthcare privacy')
  assert.deepEqual(
    sanitizeCollectOptions({ sourceFamilies: ['arxiv', 'bogus', 'github'] }).sourceFamilies,
    ['arxiv', 'github'],
  )
  assert.deepEqual(
    sanitizeCollectOptions({ sourceFamilies: ['bogus'] }).sourceFamilies,
    [...ALL_SOURCE_FAMILIES],
  )
})

test('selectShortlist: caps query mode at 8 (4 top, 2 tool, 2 worth) and weekly mode at 16', () => {
  const items: Scored[] = Array.from({ length: 20 }, (_, i) => ({
    title: `Item ${i}`,
    url: `https://example.com/${i}`,
    source: i % 3 === 0 ? 'GitHub' : 'arXiv',
    published: '2026-11-08T00:00:00.000Z',
    snippet: 'Synthetic data snippet.',
    score: 8,
    well7_fit: 10 - (i % 5),
    reason: 'Good fit',
  }))
  const queryPlan = selectShortlist(items, 'query')
  assert.equal(queryPlan.filter((p) => p.section === 'top').length, 4)
  assert.equal(queryPlan.filter((p) => p.section === 'tool').length, 2)
  assert.equal(queryPlan.filter((p) => p.section === 'worth').length, 2)

  const weeklyPlan = selectShortlist(items, 'weekly')
  assert.equal(weeklyPlan.filter((p) => p.section === 'top').length, 6)
  assert.equal(weeklyPlan.length <= 16, true)
})
