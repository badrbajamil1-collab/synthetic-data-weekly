import { test } from 'node:test'
import assert from 'node:assert/strict'

import { userIdFromVerification } from '../worker/claims.ts'

// The top-level `verifyToken` export of @clerk/backend 3.x is wrapped in
// `withLegacyReturn` (dist/jwt/index.js): it returns the JWT payload itself and
// throws on failure. These tests pin that shape.

test('userIdFromVerification: reads sub from the payload verifyToken returns', () => {
  assert.equal(userIdFromVerification({ sub: 'user_2abc' }), 'user_2abc')
})

test('userIdFromVerification: the { data } envelope is not what the top-level export returns', () => {
  // The WEB-01 regression: reading `.data.sub` 401'd every signed-in request.
  assert.equal(userIdFromVerification({ data: { sub: 'user_2abc' } } as never), '')
})

test('userIdFromVerification: an empty or missing payload yields no user', () => {
  assert.equal(userIdFromVerification({}), '')
  assert.equal(userIdFromVerification(null), '')
  assert.equal(userIdFromVerification(undefined), '')
})

test('userIdFromVerification: a non-string sub is not an identity', () => {
  assert.equal(userIdFromVerification({ sub: 42 }), '')
  assert.equal(userIdFromVerification({ sub: '' }), '')
  assert.equal(userIdFromVerification({ sub: null }), '')
})
