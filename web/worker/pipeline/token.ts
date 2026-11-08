/**
 * Bearer-token helpers for the manual pipeline trigger.
 *
 * Pure and dependency-free, so the rule can be tested without a Worker. The
 * token is a shared secret held in `CRON_RUN_TOKEN`; a caller that has it can
 * start a run from a script without a Clerk session.
 */

/** The token from an `Authorization: Bearer <token>` header, or '' when absent. */
export function bearerToken(header: string | null): string {
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(header ?? '')
  return match ? match[1] : ''
}

/**
 * Constant-time comparison of a presented token with the configured secret.
 *
 * An unset or empty secret never authorises, and a length mismatch is a
 * mismatch: a token pasted with a trailing newline must not pass.
 */
export function tokenMatches(provided: string, expected: string | undefined): boolean {
  if (typeof expected !== 'string' || expected.length === 0) return false
  if (provided.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return mismatch === 0
}
