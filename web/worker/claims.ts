/**
 * Reading a verified Clerk session token.
 *
 * `verifyToken()` in `@clerk/backend` 3.x neither throws nor returns the payload:
 * it returns `{ data }` on success and `{ errors }` on failure. Reading
 * `payload.sub` off that wrapper typechecks under a cast but is always
 * `undefined`, which silently 401s every signed-in request. The shape is handled
 * here, once, with tests.
 */

export interface VerifiedSessionToken {
  data?: { sub?: unknown } | null
  errors?: unknown
}

/** The `sub` claim, or '' when the token failed verification. */
export function userIdFromVerification(verified: VerifiedSessionToken): string {
  if (verified.errors || !verified.data) return ''
  return typeof verified.data.sub === 'string' ? verified.data.sub : ''
}
