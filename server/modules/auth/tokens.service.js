import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { randomToken, sha256, safeEqualHex } from '../../utils/crypto.js';
import { Session } from './session.model.js';

export const REFRESH_COOKIE = 'bf_rt';

export function signAccessToken(user, session) {
  return jwt.sign({ sid: session._id.toString() }, env.jwt.accessSecret, {
    subject: user._id.toString(),
    expiresIn: env.jwt.accessTtl,
    issuer: 'budgetflow',
    audience: 'budgetflow-client',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, {
    issuer: 'budgetflow',
    audience: 'budgetflow-client',
    algorithms: ['HS256'],
  });
}

const refreshExpiry = () => new Date(Date.now() + env.refreshTtlDays * 24 * 60 * 60 * 1000);

/** Refresh cookie value is "<sessionId>.<secret>"; only sha256(secret) is stored. */
export async function createSession(user, ctx = {}) {
  const secret = randomToken();
  const session = await Session.create({
    userId: user._id,
    tokenHash: sha256(secret),
    userAgent: ctx.userAgent ?? '',
    ip: ctx.ip ?? '',
    expiresAt: refreshExpiry(),
  });
  return { session, refreshToken: `${session._id}.${secret}` };
}

/**
 * Rotates the refresh secret. Returns null when the token is unknown, expired
 * or revoked. Replaying an already-rotated secret revokes the whole session.
 */
export async function rotateSession(rawToken, ctx = {}) {
  const [sessionId, secret] = String(rawToken ?? '').split('.');
  if (!sessionId || !secret || !/^[a-f0-9]{24}$/.test(sessionId)) return null;

  const session = await Session.findById(sessionId);
  if (!session || !session.isActive()) return null;

  const presented = sha256(secret);
  if (!safeEqualHex(presented, session.tokenHash)) {
    if (session.previousTokenHash && safeEqualHex(presented, session.previousTokenHash)) {
      session.revokedAt = new Date();
      session.revokedReason = 'refresh_token_reuse';
      await session.save();
    }
    return null;
  }

  const nextSecret = randomToken();
  // Conditional update so two concurrent refreshes cannot both succeed.
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, tokenHash: session.tokenHash, revokedAt: null },
    {
      tokenHash: sha256(nextSecret),
      previousTokenHash: session.tokenHash,
      lastUsedAt: new Date(),
      expiresAt: refreshExpiry(),
      ip: ctx.ip ?? session.ip,
      userAgent: ctx.userAgent ?? session.userAgent,
    },
    { returnDocument: 'after' },
  );
  if (!updated) return null;
  return { session: updated, refreshToken: `${updated._id}.${nextSecret}` };
}

export async function revokeSession(sessionId, reason = 'logout') {
  await Session.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });
}

export async function revokeAllSessions(userId, { exceptSessionId, reason = 'revoke_all' } = {}) {
  const filter = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  await Session.updateMany(filter, { revokedAt: new Date(), revokedReason: reason });
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: env.refreshTtlDays * 24 * 60 * 60 * 1000,
  };
}
