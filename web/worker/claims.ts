/**
 * Reading a verified Clerk session token.
 *
 * The top-level `verifyToken` export of `@clerk/backend` 3.x is wrapped in
 * `withLegacyReturn` (see `dist/jwt/index.js`): it returns the JWT payload
 * directly and THROWS on failure. (Only the internal, unwrapped function
 * returns `{ data, errors }`.) An earlier fix read `.data.sub` off the payload,
 * which is always `undefined`, so every signed-in request was answered 401 and
 * the SPA showed "Your session was not accepted". The shape is handled here,
 * once, with tests.
 */

export interface VerifiedSessionToken {
  sub?: unknown
}

/** The `sub` claim, or '' when there is no usable payload. */
export function userIdFromVerification(verified: VerifiedSessionToken | null | undefined): string {
  if (!verified || typeof verified !== 'object') return ''
  return typeof verified.sub === 'string' ? verified.sub : ''
}
