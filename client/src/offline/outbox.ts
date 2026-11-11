import { openDB, deleteDB, type IDBPDatabase } from 'idb';

/**
 * The offline outbox: records made without a connection, kept in IndexedDB
 * until the server accepts them.
 *
 * - One database per signed-in user (`bf-outbox-<userId>`), so a different
 *   person signing in on the same device never sees these records.
 * - Signing out deletes the database.
 * - Nothing here is ever shown as saved on the server until the server has
 *   confirmed it ("synced").
 * - Each item's id doubles as its Idempotency-Key, so a replay after a lost
 *   response is stored once.
 */

export type OutboxStatus = 'saved_locally' | 'pending' | 'synced' | 'failed' | 'needs_review';
export type OutboxKind = 'transaction' | 'susu_contribution' | 'susu_withdrawal' | 'group_contribution';

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** Workspace for workspace-scoped records; null for Susu groups, which live outside workspaces. */
  workspaceId: string | null;
  path: string;
  body: Record<string, unknown>;
  /** What the person sees in the sync list. Amounts are the strings they typed. */
  summary: { title: string; amount: string; currency: string; date: string; context?: string };
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
  serverId?: string;
}

const STORE = 'items';
const dbName = (userId: string) => `bf-outbox-${userId}`;
const connections = new Map<string, Promise<IDBPDatabase>>();

function db(userId: string) {
  let c = connections.get(userId);
  if (!c) {
    c = openDB(dbName(userId), 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
    connections.set(userId, c);
  }
  return c;
}

export async function listItems(userId: string): Promise<OutboxItem[]> {
  const items = (await (await db(userId)).getAll(STORE)) as OutboxItem[];
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getItem(userId: string, id: string) {
  return (await (await db(userId)).get(STORE, id)) as OutboxItem | undefined;
}

export async function putItem(userId: string, item: OutboxItem) {
  await (await db(userId)).put(STORE, item);
}

export async function removeItem(userId: string, id: string) {
  await (await db(userId)).delete(STORE, id);
}

/** Deletes everything this user has queued on this device. */
export async function deleteUserOutbox(userId: string) {
  const c = connections.get(userId);
  if (c) {
    (await c).close();
    connections.delete(userId);
  }
  await deleteDB(dbName(userId));
}

export const UNSENT: OutboxStatus[] = ['saved_locally', 'pending', 'failed', 'needs_review'];
