import { WorkspaceMember } from '../workspaces/workspaceMember.model.js';
import { Notification } from './notification.model.js';

/** Owners and admins hear about workspace-level events such as budgets and schedules. */
export async function workspaceManagers(workspaceId) {
  const rows = await WorkspaceMember.find({ workspaceId, status: 'active', role: { $in: ['owner', 'admin'] } }).select('userId').lean();
  return rows.map((r) => r.userId);
}

/**
 * Creates a notification once per (user, dedupeKey). Repeats are ignored,
 * so callers can fire freely without spamming.
 */
export async function notify(userIds, { workspaceId, type, title, body = '', link = null, data = {}, dedupeKey }) {
  const ops = userIds.map((userId) => ({
    updateOne: {
      filter: { userId, dedupeKey },
      update: { $setOnInsert: { userId, workspaceId, type, title, body, link, data, dedupeKey } },
      upsert: true,
    },
  }));
  if (ops.length) await Notification.bulkWrite(ops, { ordered: false });
}

export async function resolveNotifications(filter) {
  await Notification.updateMany({ ...filter, resolvedAt: null }, { resolvedAt: new Date(), readAt: new Date() });
}

export function presentNotification(n) {
  return {
    id: String(n._id),
    workspaceId: n.workspaceId ? String(n.workspaceId) : null,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    data: n.data,
    read: Boolean(n.readAt),
    resolved: Boolean(n.resolvedAt),
    createdAt: n.createdAt,
  };
}

export async function listNotifications(userId, { limit = 30, unreadOnly = false } = {}) {
  const q = { userId };
  if (unreadOnly) q.readAt = null;
  const [rows, unread] = await Promise.all([
    Notification.find(q).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ userId, readAt: null }),
  ]);
  return { items: rows.map(presentNotification), unread };
}

export async function markRead(userId, id) {
  await Notification.updateOne({ _id: id, userId }, { readAt: new Date() });
}

export async function markAllRead(userId) {
  await Notification.updateMany({ userId, readAt: null }, { readAt: new Date() });
}
