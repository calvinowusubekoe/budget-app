import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../modules/auth/tokens.service.js';
import { Session } from '../modules/auth/session.model.js';
import { User } from '../modules/users/user.model.js';

/**
 * Verifies the bearer token, then confirms the session is still live and the
 * user still active. The DB check makes logout, password resets and session
 * revocation take effect immediately rather than when the JWT expires.
 */
export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized());

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(new ApiError(401, 'TOKEN_EXPIRED', 'Your session expired. Sign in again.'));
  }

  const [session, user] = await Promise.all([Session.findById(payload.sid), User.findById(payload.sub)]);
  if (!session || !session.isActive() || session.userId.toString() !== payload.sub) {
    return next(ApiError.unauthorized('This session has ended. Sign in again.'));
  }
  if (!user || user.status !== 'active') return next(ApiError.unauthorized());

  req.user = user;
  req.session = session;
  next();
}
