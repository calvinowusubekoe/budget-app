import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, refreshSession } from './api';
import { useAuth } from '@/stores/auth';
import { safeNext } from '@/app/guards';
import { jsonResponse } from '@/test/utils';
import type { User } from '@/types/api';

const user = { id: 'u1', name: 'Esi', email: 'esi@example.com', lastWorkspaceId: 'w1' } as User;

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().clear();
});

describe('api client', () => {
  it('sends the bearer token and workspace header', async () => {
    useAuth.getState().setSession(user, 'tok-1');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true, data: { ok: 1 } }));
    await api('/workspaces', { workspaceId: 'w1' });
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect((init.headers as Record<string, string>)['X-Workspace-Id']).toBe('w1');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    useAuth.getState().setSession(user, 'expired');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { user, accessToken: 'fresh' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { value: 42 } }));

    await expect(api<{ value: number }>('/thing')).resolves.toEqual({ value: 42 });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh');
    expect((fetchMock.mock.calls[2]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    expect(useAuth.getState().accessToken).toBe('fresh');
  });

  it('signs the user out locally when refresh fails', async () => {
    useAuth.getState().setSession(user, 'expired');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'UNAUTHORIZED', message: 'gone' } }, 401));
    await expect(api('/thing')).rejects.toBeInstanceOf(ApiError);
    expect(useAuth.getState()).toMatchObject({ status: 'guest', user: null, accessToken: null });
  });

  it('retries a refresh that fails for a temporary reason instead of signing out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: false, error: { code: 'X', message: 'bad gateway' } }, 502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { user, accessToken: 'back' } }));
    const p = refreshSession();
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({ accessToken: 'back' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAuth.getState().status).toBe('authenticated');
    vi.useRealTimers();
  });

  it('treats an unreachable server as "can’t connect", never as signed out', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    useAuth.setState({ status: 'loading' });
    const p = refreshSession();
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeNull();
    expect(useAuth.getState().status).toBe('unreachable');

    // A running session survives a failed refresh while offline.
    useAuth.getState().setSession(user, 'still-here');
    const q = refreshSession();
    await vi.runAllTimersAsync();
    await q;
    expect(useAuth.getState()).toMatchObject({ status: 'authenticated', accessToken: 'still-here' });
    vi.useRealTimers();
  });

  it('shares one refresh between concurrent callers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true, data: { user, accessToken: 't' } }));
    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns network failures into a readable error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('safeNext', () => {
  it('only allows same-site relative paths', () => {
    expect(safeNext('/settings')).toBe('/settings');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
