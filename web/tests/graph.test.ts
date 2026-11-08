import { test } from 'node:test'
import assert from 'node:assert/strict'

import { executeResearchGraph, type NodeProgressEvent } from '../worker/pipeline/graph.ts'

test('executeResearchGraph: runs collect -> clean -> rank -> fetch -> summarise -> publish in order and emits events', async () => {
  const events: NodeProgressEvent[] = []
  const state = await executeResearchGraph(
    { OPENROUTER_API_KEY: 'test', OPENROUTER_MODEL: 'test-model', DB: null as never },
    { mode: 'query', query: 'differential privacy', days: 7 },
    (ev) => {
      events.push(ev)
    },
    {
      collectAll: async () => ({
        items: [
          {
            title: 'DP Tabular Diffusion 2026',
            url: 'https://arxiv.org/abs/2611.00001v1',
            source: 'arXiv',
            published: new Date().toISOString(),
            snippet: 'Achieves 94.2% utility under epsilon 1.0 differential privacy.',
          },
          {
            title: 'Duplicate DP Tabular Diffusion',
            url: 'https://arxiv.org/abs/2611.00001v2?utm_source=rss',
            source: 'Hugging Face',
            published: new Date().toISOString(),
            snippet: 'Duplicate URL with version suffix.',
          },
        ],
        sources: [],
        stats: [{ name: 'arXiv', family: 'arxiv', count: 2, durationMs: 12, error: null }],
      }),
      rankItems: async (items) => ({
        scored: items.map((item) => ({ ...item, score: 9, well7_fit: 9, reason: 'Strong DP tabular result' })),
        failedBatches: 0,
        totalBatches: 1,
      }),
      fetchShortlistTexts: async () => ({
        'https://arxiv.org/abs/2611.00001': {
          text: 'Achieves 94.2% utility under epsilon 1.0 differential privacy across 5 clinical datasets.',
          origin: 'full text',
        },
      }),
      buildSections: async (scored) => ({
        sections: scored.map((item) => ({
          section: 'top',
          item,
          summary: {
            summary: 'Achieves 94.2% utility under epsilon 1.0 differential privacy across 5 clinical datasets.',
            origin: 'full text',
            guard: 'passed',
          },
        })),
        fallbacks: 0,
      }),
      trend: async () => 'Differential privacy utility reaches 94.2% on clinical benchmarks.',
    },
  )

  assert.deepEqual(
    events.map((e) => e.node),
    ['collect', 'clean', 'rank', 'fetch', 'summarise', 'publish'],
  )
  assert.equal(state.cleanStats.raw, 2)
  assert.equal(state.cleanStats.fresh, 1)
  assert.equal(state.cleanStats.duplicatesRemoved, 1)
  assert.equal(state.sections.length, 1)
  assert.equal(state.trend, 'Differential privacy utility reaches 94.2% on clinical benchmarks.')
})

test('executeResearchGraph: short-circuits cleanly when clean produces zero fresh items', async () => {
  const events: NodeProgressEvent[] = []
  let rankCalled = false
  const state = await executeResearchGraph(
    { OPENROUTER_API_KEY: 'test', OPENROUTER_MODEL: 'test-model', DB: null as never },
    { mode: 'query', query: 'nonexistent-topic-xyz', days: 1 },
    (ev) => {
      events.push(ev)
    },
    {
      collectAll: async () => ({ items: [], sources: [], stats: [] }),
      rankItems: async () => {
        rankCalled = true
        return { scored: [], failedBatches: 0, totalBatches: 0 }
      },
    },
  )

  assert.equal(rankCalled, false)
  assert.deepEqual(events.map((e) => e.node), ['collect', 'clean', 'publish'])
  assert.equal(state.cleanStats.fresh, 0)
  assert.equal(state.warnings.length > 0, true)
})
