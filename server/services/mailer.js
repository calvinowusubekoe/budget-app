import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * SMTP when configured. Otherwise messages are captured in memory (tests)
 * or printed to the console (development) so links can be followed locally.
 * Production refuses to "send" without SMTP so emails are never silently lost.
 */
export const outbox = [];

let transport = null;
if (env.smtp.host) {
  transport = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
}

export async function sendMail({ to, subject, text, html }) {
  const message = { from: env.mailFrom, to, subject, text, html };
  if (transport) return transport.sendMail(message);
  if (env.isProd) throw new Error('SMTP is not configured; refusing to drop outbound email.');
  outbox.push(message);
  if (!env.isTest) logger.info(`\n--- email to ${to} ---\n${subject}\n\n${text}\n---------------------`);
  return { captured: true };
}

const link = (path) => new URL(path, env.clientUrl).toString();

export const emails = {
  verifyEmail: (user, token) => ({
    to: user.email,
    subject: 'Confirm your BudgetFlow email',
    text: `Hi ${user.name},\n\nConfirm your email address to finish setting up BudgetFlow:\n${link(`/verify-email?token=${token}`)}\n\nThis link expires in 24 hours. If you did not create an account, ignore this email.`,
  }),
  passwordReset: (user, token) => ({
    to: user.email,
    subject: 'Reset your BudgetFlow password',
    text: `Hi ${user.name},\n\nUse this link to choose a new password:\n${link(`/reset-password?token=${token}`)}\n\nThis link expires in 1 hour and signs you out of every device. If you did not ask for this, ignore this email; your password stays the same.`,
  }),
  susuInvite: ({ email, inviterName, groupName, token }) => ({
    to: email,
    subject: `${inviterName} added you to the ${groupName} Susu group on BudgetFlow`,
    text: `${inviterName} added you to ${groupName}, a Susu group whose records are kept on BudgetFlow.\n\nJoin to see the rotation schedule and confirm the contributions and payouts recorded for you:\n${link(`/susu/invitations/accept?token=${token}`)}\n\nBudgetFlow only keeps records. It never collects or pays out Susu money; you keep paying the way your group agrees.\n\nThe invitation expires in 14 days.`,
  }),
  workspaceInvite: ({ email, inviterName, workspaceName, role, token }) => ({
    to: email,
    subject: `${inviterName} invited you to ${workspaceName} on BudgetFlow`,
    text: `${inviterName} invited you to join the ${workspaceName} workspace as ${role}.\n\nAccept the invitation:\n${link(`/invitations/accept?token=${token}`)}\n\nThe invitation expires in 7 days.`,
  }),
};
