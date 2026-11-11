import bcrypt from 'bcryptjs';
import { ApiError } from '../../utils/ApiError.js';
import { ok, requestContext } from '../../utils/http.js';
import { env } from '../../config/env.js';
import { User } from './user.model.js';
import { WorkspaceMember } from '../workspaces/workspaceMember.model.js';
import { hashPassword } from '../auth/auth.service.js';
import { revokeAllSessions } from '../auth/tokens.service.js';
import { recordAudit } from '../audit/audit.service.js';

const isValidTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export async function updateProfile(req, res) {
  const user = req.user;
  const body = req.valid.body;

  if (body.timezone && !isValidTimezone(body.timezone)) {
    throw ApiError.validation([{ location: 'body', field: 'timezone', message: 'Unknown time zone.' }]);
  }
  if (body.lastWorkspaceId) {
    const member = await WorkspaceMember.exists({ workspaceId: body.lastWorkspaceId, userId: user._id, status: 'active' });
    if (!member) throw ApiError.notFound('Workspace not found.');
    user.lastWorkspaceId = body.lastWorkspaceId;
  }
  for (const key of ['name', 'defaultCurrency', 'locale', 'timezone']) {
    if (body[key] !== undefined) user[key] = body[key];
  }
  if (body.onboardingCompleted && !user.onboardingCompletedAt) user.onboardingCompletedAt = new Date();
  if (body.marketingConsent !== undefined) {
    user.consents.push({ type: 'marketing', version: env.legal.privacyVersion, granted: body.marketingConsent });
  }
  await user.save();
  ok(res, { user: user.toPublic() });
}

export async function changePassword(req, res) {
  const user = await User.findById(req.user._id).select('+passwordHash');
  const { currentPassword, newPassword } = req.valid.body;
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw ApiError.validation([{ location: 'body', field: 'currentPassword', message: 'Current password is incorrect.' }]);
  }
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  // Keep this device signed in; sign out everywhere else.
  await revokeAllSessions(user._id, { exceptSessionId: req.session._id, reason: 'password_changed' });
  await recordAudit({ actorId: user._id, action: 'user.password_changed', entityType: 'User', entityId: user._id, ctx: requestContext(req) });
  ok(res, { message: 'Password updated. Other devices have been signed out.' });
}

/** Data-subject access: everything BudgetFlow holds about the profile itself. */
export async function exportProfile(req, res) {
  const user = await User.findById(req.user._id).lean();
  const memberships = await WorkspaceMember.find({ userId: user._id }).lean();
  delete user.passwordHash;
  delete user.failedLoginCount;
  delete user.lockedUntil;
  res.setHeader('Content-Disposition', 'attachment; filename="budgetflow-profile.json"');
  ok(res, { user, memberships });
}

export function me(req, res) {
  ok(res, { user: req.user.toPublic() });
}
