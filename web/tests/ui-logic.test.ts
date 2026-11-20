import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatDate, parseUtcTimestamp, splitTrendSentences } from '../src/lib/report.ts'
import { normalizePath } from '../src/lib/router.ts'
import { describeChipState, matchesFollows, sameFollow } from '../src/lib/topics.ts'

test('describeChipState: distinguishes active filter from followed topic state', () => {
  assert.deepEqual(describeChipState({ active: true, followed: false }), {
    filterAriaPressed: true,
    followAriaPressed: false,
    tone: 'active',
  })
  assert.deepEqual(describeChipState({ active: false, followed: true }), {
    filterAriaPressed: false,
    followAriaPressed: true,
    tone: 'followed',
  })
  assert.deepEqual(describeChipState({ active: true, followed: true }), {
    filterAriaPressed: true,
    followAriaPressed: true,
    tone: 'both',
  })
})

test('sameFollow & matchesFollows: handle custom topic casing consistently', () => {
  assert.equal(sameFollow({ kind: 'topic', value: 'privacy' }, 'topic', 'Privacy'), true)
  assert.equal(sameFollow({ kind: 'source', value: 'arXiv' }, 'source', 'arxiv'), true)
  assert.equal(
    matchesFollows(
      { title: 'Differentially private tables', summary: '', reason: '', source: 'arxiv' },
      [{ kind: 'topic', value: 'privacy' }],
    ),
    true,
  )
})

test('splitTrendSentences: does not split on common abbreviations', () => {
  const text = 'Synthetic benchmarks (e.g. Fig. 2 in the U.S. clinical study) improved utility. Open-source tooling expanded.'
  assert.deepEqual(splitTrendSentences(text), [
    'Synthetic benchmarks (e.g. Fig. 2 in the U.S. clinical study) improved utility.',
    'Open-source tooling expanded.',
  ])
})

test('formatDate & parseUtcTimestamp: handle SQLite UTC timestamps and invalid dates safely', () => {
  const formatted = formatDate('2026-11-19 00:30:00', 'short')
  assert.match(formatted, /19/)
  assert.match(formatted, /2026/)
  assert.equal(parseUtcTimestamp('not-a-date'), 0)
  assert.ok(parseUtcTimestamp('2026-11-20 00:00:00') > parseUtcTimestamp('2026-11-19 23:59:59'))
})

test('normalizePath: removes trailing slashes while preserving root', () => {
  assert.equal(normalizePath('/'), '/')
  assert.equal(normalizePath('/archive/'), '/archive')
  assert.equal(normalizePath('/brief/week-2026-11-20///'), '/brief/week-2026-11-20')
})
