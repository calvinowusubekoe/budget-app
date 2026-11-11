import { create } from 'zustand';
import { api, ApiError } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { useAuth } from '@/stores/auth';
import { deleteUserOutbox, listItems, putItem, removeItem, UNSENT, type OutboxItem, type OutboxKind } from './outbox';

/** Retry delays after a failed attempt: 30 s, 2 min, 10 min, then every 30 min. */
export const RETRY_DELAYS = [30_000, 120_000, 600_000, 1_800_000];
const KEEP_SYNCED_MS = 24 * 60 * 60 * 1000;

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bf-outbox') : null;

interface OutboxState {
  items: OutboxItem[];
  syncing: boolean;
  online: boolean;
  setOnline: (v: boolean) => void;
  refresh: () => Promise<void>;
}

export const useOutbox = create<OutboxState>((set) => ({
  items: [],
  syncing: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  setOnline: (online) => set({ online }),
  refresh: async () => {
    const user = useAuth.getState().user;
    set({ items: user ? await listItems(user.id) : [] });
  },
}));

const changed = async () => {
  await useOutbox.getState().refresh();
  channel?.postMessage('changed');
};
channel?.addEventListener('message', () => void useOutbox.getState().refresh());

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Asks the browser to wake us when the connection returns (Background Sync, where supported). */
async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } })?.sync?.register('bf-outbox');
  } catch {
    // Not supported (e.g. Safari, Firefox): the page retries on reconnect instead.
  }
}

export interface QueueInput {
  kind: OutboxKind;
  workspaceId: string | null;
  path: string;
  body: Record<string, unknown>;
  summary: OutboxItem['summary'];
  /** Reuse the form's key so a request that did reach the server isn't saved twice. */
  idempotencyKey?: string;
}

export async function enqueue(input: QueueInput) {
  const user = useAuth.getState().user;
  if (!user) throw new Error('Sign in to save records.');
  const now = Date.now();
  const item: OutboxItem = { id: input.idempotencyKey ?? newId(), kind: input.kind, workspaceId: input.workspaceId, path: input.path, body: input.body, summary: input.summary, status: 'saved_locally', attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now };
  await putItem(user.id, item);
  await changed();
  void requestBackgroundSync();
  return item;
}

/**
 * Sends a create to the server, or keeps it on this device if there's no
 * connection. Returns { queued: true } when it was kept locally.
 * Server errors (validation, permissions) are thrown as usual: only a
 * missing connection queues.
 */
export async function sendOrQueue<T>(input: QueueInput & { idempotencyKey: string }): Promise<{ queued: false; data: T } | { queued: true; item: OutboxItem }> {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline) {
    try {
      const data = await api<T>(input.path, { method: 'POST', body: input.body, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey });
      return { queued: false, data };
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 0)) throw err;
    }
  }
  return { queued: true, item: await enqueue(input) };
}

const serverIdOf = (data: unknown) => {
  const d = data as { id?: string; entry?: { id?: string } } | null;
  return d?.id ?? d?.entry?.id;
};

/** Sends every due item, one at a time. Safe to call often; tabs take turns. */
export async function flushOutbox({ force = false } = {}) {
  const user = useAuth.getState().user;
  if (!user || !useAuth.getState().accessToken) return;
  const run = async () => {
    useOutbox.setState({ syncing: true });
    const touched = new Set<string | null>();
    try {
      const now = Date.now();
      for (const item of await listItems(user.id)) {
        if (item.status === 'synced') {
          if (now - (item.syncedAt ?? now) > KEEP_SYNCED_MS) await removeItem(user.id, item.id);
          continue;
        }
        if (item.status === 'needs_review') continue; // waits for the person to retry or discard it
        if (!force && item.nextAttemptAt > now) continue;

        await putItem(user.id, { ...item, status: 'pending', updatedAt: Date.now() });
        await changed();
        try {
          const data = await api(item.path, { method: 'POST', body: item.body, workspaceId: item.workspaceId, idempotencyKey: item.id });
          await putItem(user.id, { ...item, status: 'synced', serverId: serverIdOf(data), syncedAt: Date.now(), updatedAt: Date.now(), lastError: undefined });
          touched.add(item.workspaceId);
        } catch (err) {
          const e = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', String(err));
          if (e.status === 401) {
            // Session ended: leave it queued for after sign-in.
            await putItem(user.id, { ...item, status: 'saved_locally', updatedAt: Date.now() });
            break;
          }
          if (e.status === 0 || e.status === 429 || e.status >= 500) {
            const attempts = item.attempts + 1;
            await putItem(user.id, { ...item, status: 'failed', attempts, lastError: e.message, nextAttemptAt: Date.now() + RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)]!, updatedAt: Date.now() });
            if (e.status === 0) break; // still offline: stop for now
          } else {
            // The server looked at it and said no (validation, permission, plan limit, a deleted account...).
            const detail = e.details?.map((d) => d.message).join(' ');
            await putItem(user.id, { ...item, status: 'needs_review', attempts: item.attempts + 1, lastError: detail ? `${e.message} ${detail}` : e.message, updatedAt: Date.now() });
          }
        }
        await changed();
      }
    } finally {
      useOutbox.setState({ syncing: false });
      await changed();
      for (const ws of touched) void queryClient.invalidateQueries({ queryKey: ws ? ['ws', ws] : ['susu-groups'] });
      if (touched.size) void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  };
  if (navigator.locks?.request) await navigator.locks.request('bf-outbox', { ifAvailable: true }, async (lock) => (lock ? run() : undefined));
  else await run();
}

export async function discardItem(id: string) {
  const user = useAuth.getState().user;
  if (!user) return;
  await removeItem(user.id, id);
  await changed();
}

export async function retryItem(id: string) {
  const user = useAuth.getState().user;
  if (!user) return;
  const item = (await listItems(user.id)).find((i) => i.id === id);
  if (item) await putItem(user.id, { ...item, status: 'saved_locally', nextAttemptAt: Date.now(), updatedAt: Date.now() });
  await changed();
  await flushOutbox({ force: true });
}

export const unsentCount = (items: OutboxItem[]) => items.filter((i) => UNSENT.includes(i.status)).length;

/** Called on sign-out: removes this user's queued records from the device. */
export async function clearOutboxForSignOut(userId: string) {
  await deleteUserOutbox(userId);
  useOutbox.setState({ items: [] });
  channel?.postMessage('changed');
}
