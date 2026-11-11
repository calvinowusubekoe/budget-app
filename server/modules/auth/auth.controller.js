import { ok, created, requestContext } from '../../utils/http.js';
import * as auth from './auth.service.js';
import { REFRESH_COOKIE, refreshCookieOptions, revokeAllSessions } from './tokens.service.js';

function sendSession(res, { user, accessToken, refreshToken }, status = 200) {
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return ok(res, { user: user.toPublic(), accessToken }, { status });
}

function clearCookie(res) {
  const { maxAge: _ignored, ...opts } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, opts);
}

export async function register(req, res) {
  sendSession(res, await auth.register(req.valid.body, requestContext(req)), 201);
}

export async function login(req, res) {
  sendSession(res, await auth.login(req.valid.body, requestContext(req)));
}

export async function refresh(req, res) {
  try {
    sendSession(res, await auth.refresh(req.cookies?.[REFRESH_COOKIE], requestContext(req)));
  } catch (err) {
    clearCookie(res);
    throw err;
  }
}

export async function logout(req, res) {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  clearCookie(res);
  ok(res, { signedOut: true });
}

export async function logoutAll(req, res) {
  await revokeAllSessions(req.user._id, { reason: 'logout_all' });
  clearCookie(res);
  ok(res, { signedOut: true });
}

export async function forgotPassword(req, res) {
  await auth.forgotPassword(req.valid.body.email);
  ok(res, { message: 'If an account exists for that email, a reset link is on its way.' });
}

export async function resetPassword(req, res) {
  await auth.resetPassword(req.valid.body, requestContext(req));
  clearCookie(res);
  ok(res, { message: 'Password updated. Sign in with your new password.' });
}

export async function verifyEmail(req, res) {
  const user = await auth.verifyEmail(req.valid.body.token, requestContext(req));
  ok(res, { user: user.toPublic() });
}

export async function resendVerification(req, res) {
  await auth.resendVerification(req.user);
  created(res, { message: 'Verification email sent.' });
}

export async function me(req, res) {
  ok(res, { user: req.user.toPublic() });
}

export async function sessions(req, res) {
  ok(res, await auth.listSessions(req.user._id, req.session._id));
}

export async function revokeSessionById(req, res) {
  await auth.revokeUserSession(req.user._id, req.valid.params.sessionId);
  ok(res, { revoked: true });
}
