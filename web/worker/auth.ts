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
  isAdmin: boolean
}

/**
 * Verifies the Clerk session JWT the SPA sends as `Authorization: Bearer <token>`.
 * Fail-closed: without CLERK_SECRET_KEY, or on any verification error, there is
 * no signed-in viewer. No cookies, no Cloudflare Access.
 */
export async function currentViewer(request: Request, env: AuthEnv): Promise<Viewer | null> {
  if (!env.CLERK_SECRET_KEY) return null
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null

  let verified: VerifiedSessionToken
  try {
    verified = (await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY })) as VerifiedSessionToken
  } catch {
    return null
  }
  const userId = userIdFromVerification(verified)
  if (!userId) return null

  // One Clerk Backend API call per signed-in request for the email: required for
  // the admin allow-list and the display label, and it doubles as the identity
  // cache write in the routes below (upsertUser in index.ts).
  let email = ''
  try {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
    const user = await clerk.users.getUser(userId)
    email = (user.primaryEmailAddress?.emailAddress ?? '').toLowerCase()
  } catch {
    email = ''
  }

  const admins = (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return { userId, email, isAdmin: admins.includes(email) }
}
