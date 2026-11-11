import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { listItems } from './outbox';
import { clearOutboxForSignOut, flushOutbox, sendOrQueue, useOutbox } from './sync';
import { SyncIndicator } from './OfflineUi';

const userA = { id: 'userA', name: 'Ama', email: 'a@example.com' } as User;
const userB = { id: 'userB', name: 'Kojo', email: 'k@example.com' } as User;
const tx = (key = 'key-00000001') => ({
  kind: 'transaction' as const,
  workspaceId: 'w1',
  path: '/transactions',
  body: { type: 'expense', amount: '12.50', description: 'Trotro' },
  summary: { title: 'Trotro', amount: '12.50', currency: 'GHS', date: '2026-11-11', context: 'MoMo' },
  idempotencyKey: key,
});

function setOnline(v: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
  useOutbox.getState().setOnline(v);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  setOnline(true);
  await clearOutboxForSignOut(userA.id);
  await clearOutboxForSignOut(userB.id);
  useAuth.getState().setSession(userA, 'token');
});
afterEach(() => setOnline(true));

describe('offline outbox', () => {
  it('keeps a record on the device when offline, without calling the server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    setOnline(false);
    const r = await sendOrQueue(tx());
    expect(r.queued).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    const [item] = await listItems(userA.id);
    expect(item).toMatchObject({ id: 'key-00000001', status: 'saved_locally', summary: { amount: '12.50' } });
  });

  it('queues under the same key when the connection drops mid-request, so a replay saves once', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await sendOrQueue(tx('key-00000002'));
    expect(r.queued).toBe(true);
    expect((await listItems(userA.id))[0]!.id).toBe('key-00000002');
  });

  it('does not queue when the server rejects the record', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Some fields need attention.' } }, 422));
    await expect(sendOrQueue(tx())).rejects.toThrow('Some fields need attention.');
    expect(await listItems(userA.id)).toHaveLength(0);
  });

  it('syncs with the original Idempotency-Key and marks the record synced', async () => {
    setOnline(false);
    await sendOrQueue(tx('key-00000003'));
    setOnline(true);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true, data: { id: 'srv1' } }, 201));
    await flushOutbox();
    const call = fetch.mock.calls.find(([u]) => String(u) === '/api/transactions')!;
    expect(new Headers(call[1]!.headers).get('Idempotency-Key')).toBe('key-00000003');
    expect(new Headers(call[1]!.headers).get('X-Workspace-Id')).toBe('w1');
    expect((await listItems(userA.id))[0]).toMatchObject({ status: 'synced', serverId: 'srv1' });
  });

  it('retries server outages later, and holds rejected records for review', async () => {
    setOnline(false);
    await sendOrQueue(tx('key-00000004'));
    await sendOrQueue({ ...tx('key-00000005'), path: '/susu/plans/p1/contributions', kind: 'susu_contribution' });
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
      String(u) === '/api/transactions'
        ? jsonResponse({ success: false, error: { code: 'X', message: 'Busy' } }, 503)
        : jsonResponse({ success: false, error: { code: 'BAD_REQUEST', message: 'This plan was cancelled and is read-only.' } }, 400),
    );
    await flushOutbox();
    const items = await listItems(userA.id);
    const failed = items.find((i) => i.id === 'key-00000004')!;
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    expect(failed.nextAttemptAt).toBeGreaterThan(Date.now() + 20_000);
    expect(items.find((i) => i.id === 'key-00000005')).toMatchObject({ status: 'needs_review', lastError: 'This plan was cancelled and is read-only.' });

    // Not due yet, and reviews wait for the person: nothing is sent.
    const fetch = vi.spyOn(globalThis, 'fetch');
    fetch.mockClear();
    await flushOutbox();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps each person’s records separate on a shared device, and sign-out deletes them', async () => {
    setOnline(false);
    await sendOrQueue(tx('key-00000006'));
    useAuth.getState().setSession(userB, 'token-b');
    expect(await listItems(userB.id)).toHaveLength(0);
    await useOutbox.getState().refresh();
    expect(useOutbox.getState().items).toHaveLength(0);

    useAuth.getState().setSession(userA, 'token');
    expect(await listItems(userA.id)).toHaveLength(1);
    await clearOutboxForSignOut(userA.id);
    expect(await listItems(userA.id)).toHaveLength(0);
  });

  it('shows plain statuses and never presents a local record as synced', async () => {
    setOnline(false);
    await sendOrQueue(tx('key-00000007'));
    renderWithProviders(<SyncIndicator />);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Offline, 1 waiting to sync' }));
    expect(await screen.findByText('Saved on this device')).toBeInTheDocument();
    expect(screen.queryByText('Synced')).toBeNull();
    expect(screen.getByText('Trotro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync now/ })).toBeDisabled();
  });
});
