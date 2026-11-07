import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  matchesFollows,
  scoreBands,
  sortFollows,
  sourceCounts,
  topicCounts,
  type TopicFollow,
} from '../src/lib/topics.ts'

interface Row {
  title: string
  summary: string
  reason: string
  source: string
}

const privacyItem: Row = {
  title: 'Differentially private tabular synthesis',
  summary: 'Membership inference attacks against synthetic health data',
  reason: 'DP plus membership inference is the Well7 risk model',
  source: 'arxiv',
}

const repoItem: Row = {
  title: 'A new open-source toolkit for evaluating synthetic data',
  summary: 'Benchmarks utility and fidelity measures for generated tabular data',
  reason: 'A tool the team can adopt directly',
  source: 'github',
}

const newsItem: Row = {
  title: 'Community on synthetic data',
  summary: 'A neutral post about increased interest',
  reason: 'Signals attention, not substance',
  source: 'reddit',
}

const neutralItem: Row = {
  title: 'Generic industry note',
  summary: 'A general round-up of activity',
  reason: 'Not research, not a tool',
  source: 'news',
}

test('matchesFollows: item joins the feed when a topic label is followed', () => {
  const follows: TopicFollow[] = [{ kind: 'topic', value: 'Privacy' }]
  assert.equal(matchesFollows(privacyItem, follows), true)
})

test('matchesFollows: item joins the feed when its source slug is followed', () => {
  const follows: TopicFollow[] = [{ kind: 'source', value: 'github' }]
  assert.equal(matchesFollows(repoItem, follows), true)
})

test('matchesFollows: item is out of the feed when nothing matches', () => {
  const follows: TopicFollow[] = [
    { kind: 'topic', value: 'Privacy' },
    { kind: 'source', value: 'hn' },
  ]
  assert.equal(matchesFollows(newsItem, follows), false)
})

test('matchesFollows: empty follows exclude nothing matched, input at odds still false', () => {
  assert.equal(matchesFollows(privacyItem, []), false)
  assert.equal(matchesFollows(neutralItem, []), false)
})

test('sortFollows: kind first, then value', () => {
  const sorted = sortFollows([
    { kind: 'topic', value: 'Tools & code' },
    { kind: 'source', value: 'github' },
    { kind: 'topic', value: 'Finance' },
    { kind: 'source', value: 'arxiv' },
  ])
  assert.deepEqual(sorted, [
    { kind: 'source', value: 'arxiv' },
    { kind: 'source', value: 'github' },
    { kind: 'topic', value: 'Finance' },
    { kind: 'topic', value: 'Tools & code' },
  ])
})

test('scoreBands: three fixed bands with counts', () => {
  assert.deepEqual(scoreBands([10, 8, 5, 6, 7, 1, 2, 3, 4]), [
    { label: '8–10', count: 2 },
    { label: '5–7', count: 3 },
    { label: '1–4', count: 4 },
  ])
})

test('scoreBands: an empty week still shows the three labels', () => {
  assert.deepEqual(scoreBands([]), [
    { label: '8–10', count: 0 },
    { label: '5–7', count: 0 },
    { label: '1–4', count: 0 },
  ])
})

test('scoreBands: nulls in the input are skipped, never invented into a band', () => {
  assert.deepEqual(scoreBands([null, null]), [
    { label: '8–10', count: 0 },
    { label: '5–7', count: 0 },
    { label: '1–4', count: 0 },
  ])
})

test('sourceCounts: counts by source slug, sorted by count then label', () => {
  assert.deepEqual(
    sourceCounts([
      repoItem,
      { ...repoItem, source: 'github' },
      newsItem,
    ]),
    [
      { label: 'github', count: 2 },
      { label: 'reddit', count: 1 },
    ],
  )
})

test('topicCounts: counts labels from the real matcher', () => {
  const counts = topicCounts([privacyItem, repoItem])
  const privacy = counts.find((c) => c.label === 'Privacy')
  const code = counts.find((c) => c.label === 'Tools & code')
  assert.ok(privacy && privacy.count === 1)
  assert.ok(code && code.count === 1)
})

test('topicCounts: a privacy item contributes its labels once each', () => {
  const counts = topicCounts([privacyItem])
  const privacy = counts.find((c) => c.label === 'Privacy')
  assert.ok(privacy && privacy.count === 1)
})
