import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chipScopes, filterItems, type FeedFilters, type SavedState } from '../src/lib/feed.ts'
import type { ReportItem } from '../src/lib/report.ts'

const empty: FeedFilters = { query: '', section: 'all', keyword: null, view: 'all' }

function item(over: Partial<ReportItem> & Pick<ReportItem, 'id'>): ReportItem {
  return {
    title: 'Tabular synthesis with privacy guarantees',
    url: `https://example.com/${over.id}`,
    source: 'arxiv',
    published: '2026-11-05',
    score: 8,
    well7_fit: 8,
    reason: 'benchmark',
    summary: 'A privacy-preserving tabular generator.',
    section: 'top',
    position: 0,
    ...over,
  }
}

const items: ReportItem[] = [
  item({ id: 'a', section: 'top', position: 0 }),
  item({ id: 'b', section: 'tool', position: 1, title: 'A toolkit for evaluation', summary: 'open source' }),
  item({ id: 'c', section: 'worth_a_look', position: 2, title: 'Vision diffusion models', summary: 'images' }),
]

const saved = new Map<string, SavedState>([
  ['a', { read_later: 1, important: 0 }],
  ['c', { read_later: 0, important: 1 }],
])

test('chipScopes: section counts ignore the section filter and cover every section', () => {
  const scopes = chipScopes(items, { ...empty, section: 'tool' }, saved)
  // The chips must be able to show what lives outside the active selection, and
  // the section dimension itself must not zero the other chips out.
  assert.deepEqual(scopes.section.map((i) => i.id).sort(), ['a', 'b', 'c'])
})

test('chipScopes: keyword counts ignore the keyword filter', () => {
  const scopes = chipScopes(items, empty, saved)
  assert.deepEqual(scopes.keyword.map((i) => i.id).sort(), ['a', 'b', 'c'])
})

test('chipScopes: view counts ignore the view filter, so the pills stay truthful', () => {
  const scopes = chipScopes(items, { ...empty, view: 'important' }, saved)
  // The pill "Important" does not zero out the others; "Your feed" chips
  // describe all saved states, but the list will still be filtered to important.
  assert.deepEqual(scopes.view.map((i) => i.id).sort(), ['a', 'b', 'c'])
  assert.equal(scopes.view.filter((i) => saved.get(i.id)?.important === 1).length, 1)
  assert.equal(scopes.view.filter((i) => saved.get(i.id)?.read_later === 1).length, 1)
})

test('chipScopes: every scope honours the active search', () => {
  const scopes = chipScopes(items, { ...empty, query: 'privacy' }, saved)
  assert.deepEqual(scopes.section.map((i) => i.id), ['a'])
})

test('chipScopes: empty scopes describe an empty result, so chips read zero not stale numbers', () => {
  const filters: FeedFilters = { ...empty, query: 'nothing-matches-this' }
  const visible = filterItems(items, filters, saved)
  const scopes = chipScopes(items, filters, saved)
  assert.equal(visible.length, 0)
  assert.equal(scopes.section.length, 0)
  assert.equal(scopes.keyword.length, 0)
  assert.equal(scopes.view.length, 0)
})
