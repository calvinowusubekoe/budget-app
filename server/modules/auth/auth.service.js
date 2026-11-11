import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { runAtomic } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { User } from '../users/user.model.js';
import { AuthToken } from './authToken.model.js';
import { Session } from './session.model.js';
import { createSession, revokeAllSessions, rotateSession, revokeSession, signAccessToken } from './tokens.service.js';
import { createWorkspaceRecords } from '../workspaces/workspaces.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { emails, sendMail } from '../../services/mailer.js';

const HOUR = 60 * 60 * 1000;

// A precomputed hash lets failed lookups cost the same as real comparisons,
// so response timing does not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

export const hashPassword = (plain) => bcrypt.hash(plain, env.bcryptRounds);

async function issueToken(userId, purpose, ttlMs) {
  const token = randomToken();
  // Older unused tokens for the same purpose stop working.
  await AuthToken.updateMany({ userId, purpose, usedAt: null }, { usedAt: new Date() });
  await AuthToken.create({ userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

async function consumeToken(token, purpose) {
  return AuthToken.findOneAndUpdate(
    { tokenHash: sha256(token), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { returnDocument: 'after' },
  );
}

async function startSession(user, ctx) {
  const { session, refreshToken } = await createSession(user, ctx);
  return { user, accessToken: signAccessToken(user, session), refreshToken };
}

export async function register(input, ctx) {
  if (await User.exists({ email: input.email })) {
    throw ApiError.conflict('An account with this email already exists. Sign in instead.', 'EMAIL_TAKEN');
  }
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const user = await runAtomic(async (session) => {
    const [created] = await User.create(
      [
        {
          name: input.name,
          email: input.email,
          passwordHash,
          defaultCurrency: input.defaultCurrency,
          consents: [
            { type: 'terms', version: env.legal.termsVersion, granted: true, recordedAt: now },
            { type: 'privacy', version: env.legal.privacyVersion, granted: true, recordedAt: now },
            { type: 'marketing', version: env.legal.privacyVersion, granted: input.marketingConsent, recordedAt: now },
          ],
        },
      ],
      { session },
    );
    const { workspace } = await createWorkspaceRecords(
      { name: 'Personal', type: 'personal', baseCurrency: input.defaultCurrency },
      created,
      session,
    );
    created.lastWorkspaceId = workspace._id;
    await created.save({ session });
    return created;
  });

  await recordAudit({ actorId: user._id, action: 'user.registered', entityType: 'User', entityId: user._id, ctx });
  const token = await issueToken(user._id, 'email_verification', 24 * HOUR);
  await sendMail(emails.verifyEmail(user, token));
  return startSession(user, ctx);
}

export async function login({ email, password }, ctx) {
  const user = await User.findOne({ email }).select('+passwordHash +failedLoginCount +lockedUntil');
  const invalid = ApiError.unauthorized('Email or password is incorrect.');

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes or reset your password.');
  }
  if (user.status !== 'active') throw invalid;

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= env.login.maxAttempts) {
      user.lockedUntil = new Date(Date.now() + env.login.lockMinutes * 60 * 1000);
      user.failedLoginCount = 0;
      await recordAudit({ actorId: user._id, action: 'user.locked', entityType: 'User', entityId: user._id, ctx });
    }
    await user.save();
    throw invalid;
  }

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();
  await recordAudit({ actorId: user._id, action: 'user.login', entityType: 'User', entityId: user._id, ctx });
  return startSession(user, ctx);
}

export async function refresh(rawToken, ctx) {
  const rotated = await rotateSession(rawToken, ctx);
  if (!rotated) throw ApiError.unauthorized('Your session has ended. Sign in again.');
  const user = await User.findById(rotated.session.userId);
  if (!user || user.status !== 'active') {
    await revokeSession(rotated.session._id, 'user_inactive');
    throw ApiError.unauthorized();
  }
  return { user, accessToken: signAccessToken(user, rotated.session), refreshToken: rotated.refreshToken };
}

export async function logout(rawToken) {
  const [sessionId] = String(rawToken ?? '').split('.');
  if (/^[a-f0-9]{24}$/.test(sessionId ?? '')) await revokeSession(sessionId, 'logout');
}

/** Always resolves the same way so the endpoint cannot be used to probe for accounts. */
export async function forgotPassword(email) {
  const user = await User.findOne({ email, status: 'active' });
  if (!user) return;
  const token = await issueToken(user._id, 'password_reset', HOUR);
  await sendMail(emails.passwordReset(user, token));
}

export async function resetPassword({ token, password }, ctx) {
  const record = await consumeToken(token, 'password_reset');
  if (!record) throw ApiError.badRequest('This reset link is invalid or has expired. Request a new one.');
  const user = await User.findById(record.userId).select('+passwordHash');
  if (!user) throw ApiError.badRequest('This reset link is invalid or has expired. Request a new one.');

  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.lockedUntil = null;
  user.failedLoginCount = 0;
  // Completing a reset proves control of the inbox.
  if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
  await user.save();
  await revokeAllSessions(user._id, { reason: 'password_reset' });
  await recordAudit({ actorId: user._id, action: 'user.password_reset', entityType: 'User', entityId: user._id, ctx });
}

export async function verifyEmail(token, ctx) {
  const record = await consumeToken(token, 'email_verification');
  if (!record) throw ApiError.badRequest('This verification link is invalid or has expired. Request a new one.');
  const user = await User.findByIdAndUpdate(record.userId, { emailVerifiedAt: new Date() }, { returnDocument: 'after' });
  await recordAudit({ actorId: user._id, action: 'user.email_verified', entityType: 'User', entityId: user._id, ctx });
  return user;
}

export async function resendVerification(user) {
  if (user.emailVerifiedAt) throw ApiError.badRequest('Your email is already confirmed.');
  const token = await issueToken(user._id, 'email_verification', 24 * HOUR);
  await sendMail(emails.verifyEmail(user, token));
}

export async function listSessions(userId, currentSessionId) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
  return sessions.map((s) => ({
    id: s._id.toString(),
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    current: s._id.toString() === currentSessionId.toString(),
  }));
}

export async function revokeUserSession(userId, sessionId) {
  const result = await Session.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { revokedAt: new Date(), revokedReason: 'user_revoked' },
  );
  if (!result.matchedCount) throw ApiError.notFound('Session not found.');
}
