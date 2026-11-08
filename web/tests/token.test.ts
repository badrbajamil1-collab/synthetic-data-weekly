import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bearerToken, tokenMatches } from '../worker/pipeline/token.ts'

const SECRET = 'a'.repeat(48)

test('bearerToken: reads the scheme case-insensitively and trims padding', () => {
  assert.equal(bearerToken('Bearer abc123'), 'abc123')
  assert.equal(bearerToken('bearer   abc123  '), 'abc123')
  assert.equal(bearerToken('  Bearer abc123  '), 'abc123')
})

test('bearerToken: a header without the Bearer scheme is not a token', () => {
  assert.equal(bearerToken('abc123'), '')
  assert.equal(bearerToken('Basic abc123'), '')
  assert.equal(bearerToken(null), '')
  assert.equal(bearerToken(''), '')
  assert.equal(bearerToken('Bearer'), '')
})

test('tokenMatches: identical values match', () => {
  assert.equal(tokenMatches(SECRET, SECRET), true)
})

test('tokenMatches: a trailing newline or space does not match', () => {
  assert.equal(tokenMatches(SECRET + '\n', SECRET), false)
  assert.equal(tokenMatches(SECRET + ' ', SECRET), false)
  assert.equal(tokenMatches(' ' + SECRET, SECRET), false)
})

test('tokenMatches: same length, one character different, does not match', () => {
  const other = 'b'.repeat(48)
  assert.equal(tokenMatches(other, SECRET), false)
  assert.equal(tokenMatches('a'.repeat(47) + 'b', SECRET), false)
})

test('tokenMatches: different length does not match', () => {
  assert.equal(tokenMatches('a'.repeat(47), SECRET), false)
  assert.equal(tokenMatches(SECRET + 'a', SECRET), false)
})

test('tokenMatches: an unset or empty secret never authorises', () => {
  assert.equal(tokenMatches('', ''), false)
  assert.equal(tokenMatches('', undefined), false)
  assert.equal(tokenMatches(SECRET, undefined), false)
  assert.equal(tokenMatches(SECRET, ''), false)
})
