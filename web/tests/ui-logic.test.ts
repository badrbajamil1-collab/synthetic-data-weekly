import { test } from 'node:test'
import assert from 'node:assert/strict'

import { describeChipState } from '../src/lib/topics.ts'

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
