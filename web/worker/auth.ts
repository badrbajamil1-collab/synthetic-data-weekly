import { createClerkClient, verifyToken } from '@clerk/backend'

import { userIdFromVerification, type VerifiedSessionToken } from './claims.ts'

export interface AuthEnv {
  CLERK_SECRET_KEY?: string
  ADMIN_EMAILS?: string
}

export interface Viewer {
  /** Clerk user id (user_xxx) — the users.id identity in D1. */
  userId: string
  email: string
  username: string
  isAdmin: boolean
}

export function displayUsername(
  user: {
    username?: string | null
    fullName?: string | null
    firstName?: string | null
    lastName?: string | null
  },
  email: string,
): string {
  const combinedName = [user.firstName, user.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
  const fallbackLocal = email.includes('@') ? email.split('@')[0] : ''
  const raw =
    [user.username, user.fullName, combinedName, fallbackLocal].find(
      (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
    ) ?? ''
  const sanitized = [...raw]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
  return sanitized
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/**
 * Clerk session tokens live 60 s; `iat`/`nbf`/`exp` are checked against the
 * Worker clock. Clerk's 5 s default rejects tokens whenever the edge clock and
 * Clerk's issuer drift by a few seconds ("token-iat-in-the-future"), so allow
 * a modest, documented skew.
 */
const CLOCK_SKEW_MS = 30_000

/**
 * Last verification failure reason per request (a Clerk reason code such as
 * `token-expired` or `jwk-kid-mismatch`, never token contents). Surfaced as the
 * `X-Auth-Error` response header so a 401 is diagnosable from the browser.
 */
const failureReasons = new WeakMap<Request, string>()

export function authFailureReason(request: Request): string | undefined {
  return failureReasons.get(request)
}

/**
 * Verifies the Clerk session JWT the SPA sends as `Authorization: Bearer <token>`.
 * Fail-closed: without CLERK_SECRET_KEY, or on any verification error, there is
 * no signed-in viewer. No cookies, no Cloudflare Access.
 */
export async function currentViewer(request: Request, env: AuthEnv): Promise<Viewer | null> {
  if (!env.CLERK_SECRET_KEY) {
    failureReasons.set(request, 'server-missing-secret')
    return null
  }
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) {
    failureReasons.set(request, 'no-token')
    return null
  }

  let verified: VerifiedSessionToken
  try {
    verified = (await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      clockSkewInMs: CLOCK_SKEW_MS,
    })) as VerifiedSessionToken
  } catch (error) {
    const reason = (error as { reason?: string })?.reason ?? 'verify-failed'
    failureReasons.set(request, reason)
    console.warn('clerk verifyToken failed:', reason)
    return null
  }
  const userId = userIdFromVerification(verified)
  if (!userId) {
    failureReasons.set(request, 'no-sub')
    return null
  }

  // One Clerk Backend API call per signed-in request for the email & username:
  // required for the admin allow-list, weekly email list, and display label,
  // and it doubles as the identity cache write in the routes below (upsertUser).
  let email = ''
  let username = ''
  try {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
    const user = await clerk.users.getUser(userId)
    email = (user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? '')
      .trim()
      .toLowerCase()
    username = displayUsername(user, email)
  } catch {
    email = ''
    username = ''
  }

  const admins = (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return { userId, email, username, isAdmin: admins.includes(email) }
}
