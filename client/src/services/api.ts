import { useAuth } from '@/stores/auth';
import type { AuthResult } from '@/types/api';

export interface FieldIssue {
  location: string;
  field: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: FieldIssue[];
  constructor(status: number, code: string, message: string, details?: FieldIssue[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Body = Record<string, unknown> | unknown[] | undefined;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: Body;
  /** Multipart upload; mutually exclusive with body. */
  form?: FormData;
  /** Sends X-Workspace-Id for workspace-scoped endpoints. */
  workspaceId?: string | null;
  /** Makes a create safe to retry: the server stores it once. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  skipRefresh?: boolean;
}

export interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

async function send(path: string, { method = 'GET', body, form, workspaceId, idempotencyKey, signal }: RequestOptions, token: string | null, accept: string) {
  const headers: Record<string, string> = { Accept: accept };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Can’t reach Kontaa. Check your connection and try again.');
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const e = payload?.error;
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? `Request failed (${res.status}).`, e?.details);
  }
  return res;
}

async function rawEnvelope<T>(path: string, options: RequestOptions, token: string | null): Promise<Envelope<T>> {
  const res = await send(path, options, token, 'application/json');
  const payload = await res.json().catch(() => null);
  if (!payload?.success) throw new ApiError(res.status, 'UNKNOWN', 'Unexpected response from the server.');
  return { data: payload.data as T, meta: payload.meta };
}

const raw = async <T>(path: string, options: RequestOptions, token: string | null) => (await rawEnvelope<T>(path, options, token)).data;

let refreshing: Promise<AuthResult | null> | null = null;
/** Back-off before retrying a refresh that failed for a temporary reason (ms). */
export const REFRESH_RETRIES = [500, 1500, 3500];

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Calls are
 * de-duplicated within a tab and serialised across tabs with the Web Locks
 * API, because the server burns a session whose old refresh token is replayed.
 */
export function refreshSession(): Promise<AuthResult | null> {
  if (refreshing) return refreshing;
  const run = async () => {
    // Only a definite "no" from the server ends the session. A dropped
    // connection or a server mid-restart is retried before giving up.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await raw<AuthResult>('/auth/refresh', { method: 'POST' }, null);
        useAuth.getState().setSession(result.user, result.accessToken);
        return result;
      } catch (err) {
        const transient = err instanceof ApiError && (err.status === 0 || err.status >= 500);
        if (!transient) {
          useAuth.getState().clear();
          return null;
        }
        if (attempt >= REFRESH_RETRIES.length) {
          // Couldn't reach the server, which says nothing about the session. A running session
          // stays as it is (records queue offline); at startup we show "can't connect" rather
          // than the sign-in page, and try again when the connection returns.
          if (useAuth.getState().status !== 'authenticated') useAuth.getState().setUnreachable();
          return null;
        }
        await new Promise((r) => setTimeout(r, REFRESH_RETRIES[attempt]));
      }
    }
  };
  const locked = typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('budgetflow-refresh', run)
    : run();
  refreshing = locked.finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Runs a request, refreshing the access token once if it has expired. */
async function withRefresh<R>(run: (token: string | null) => Promise<R>, skipRefresh?: boolean): Promise<R> {
  const token = useAuth.getState().accessToken;
  try {
    return await run(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && token && !skipRefresh) {
      const refreshed = await refreshSession();
      if (refreshed) return run(refreshed.accessToken);
    }
    throw err;
  }
}

export function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return withRefresh((token) => raw<T>(path, options, token), options.skipRefresh);
}

/** Like api(), but keeps the response meta (pagination, provider info). */
export function apiEnvelope<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  return withRefresh((token) => rawEnvelope<T>(path, options, token), options.skipRefresh);
}

/** Downloads a file (CSV export, receipt) with the user's credentials. */
export function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  return withRefresh(async (token) => (await send(path, options, token, '*/*')).blob(), options.skipRefresh);
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Maps server validation details onto react-hook-form fields. */
export function applyFieldErrors(err: unknown, setError: (field: never, e: { message: string }) => void) {
  if (err instanceof ApiError && err.details?.length) {
    for (const d of err.details) setError(d.field as never, { message: d.message });
    return true;
  }
  return false;
}
