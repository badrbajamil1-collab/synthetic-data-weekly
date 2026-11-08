import { test } from 'node:test'
import assert from 'node:assert/strict'

import { userIdFromVerification } from '../worker/claims.ts'

test('userIdFromVerification: reads sub from the { data } envelope verifyToken returns', () => {
  assert.equal(userIdFromVerification({ data: { sub: 'user_2abc' } }), 'user_2abc')
})

test('userIdFromVerification: a verification error yields no user', () => {
  assert.equal(userIdFromVerification({ errors: [{ code: 'token-invalid' }] }), '')
  assert.equal(
    userIdFromVerification({ data: { sub: 'user_2abc' }, errors: [{ code: 'x' }] }),
    '',
  )
})

test('userIdFromVerification: an empty envelope yields no user', () => {
  assert.equal(userIdFromVerification({}), '')
  assert.equal(userIdFromVerification({ data: null }), '')
  assert.equal(userIdFromVerification({ data: {} }), '')
})

test('userIdFromVerification: a non-string sub is not an identity', () => {
  assert.equal(userIdFromVerification({ data: { sub: 42 } }), '')
  assert.equal(userIdFromVerification({ data: { sub: '' } }), '')
  assert.equal(userIdFromVerification({ data: { sub: null } }), '')
})

test('userIdFromVerification: a bare payload is not the verifyToken shape', () => {
  // The old bug: the payload was treated as the payload instead of { data }.
  assert.equal(userIdFromVerification({ sub: 'user_2abc' } as never), '')
})
