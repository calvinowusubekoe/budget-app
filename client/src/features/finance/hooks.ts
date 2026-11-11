import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api, apiEnvelope } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { useActiveWorkspace } from '@/features/workspaces/useWorkspaces';
import { sendOrQueue, type QueueInput } from '@/offline/sync';
import type {
  Account,
  Attachment,
  AuditEntry,
  Category,
  Dashboard,
  ExchangeRate,
  PageMeta,
  RateResolution,
  Summary,
  Transaction,
  TransactionInput,
} from '@/types/api';

/**
 * Every workspace-scoped query key starts with ['ws', workspaceId], so
 * switching workspace can never show cached data from another one.
 */
export function useWs() {
  const { workspace } = useActiveWorkspace();
  const id = workspace?.id ?? null;
  return {
    workspace,
    id,
    key: (...parts: unknown[]) => ['ws', id, ...parts] as const,
    call: <T>(path: string, opts: Parameters<typeof api>[1] = {}) => api<T>(path, { ...opts, workspaceId: id }),
  };
}

/** After any write, refresh everything derived from records in this workspace. */
export function invalidateMoney(workspaceId: string | null) {
  // A saved expense can trigger a budget alert, so notifications refresh too.
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  return queryClient.invalidateQueries({ queryKey: ['ws', workspaceId] });
}

export function toQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/* ---------------- accounts ---------------- */

export function useAccounts(includeArchived = false) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('accounts', { includeArchived }),
    queryFn: () => apiEnvelope<Account[]>(`/accounts${toQuery({ includeArchived })}`, { workspaceId: ws.id }),
    enabled: Boolean(ws.id),
    select: (r) => ({ items: r.data, totals: (r.meta?.totals ?? []) as { currency: string; amount: string }[] }),
  });
}

export interface AccountInput {
  name: string;
  type: Account['type'];
  currency: string;
  openingBalance: string;
  openingDate: string;
  institution: string;
  notes: string;
}

export function useSaveAccount() {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<AccountInput> & { id?: string; status?: Account['status'] }) =>
      id ? ws.call<Account>(`/accounts/${id}`, { method: 'PATCH', body }) : ws.call<Account>('/accounts', { method: 'POST', body }),
    onSuccess: () => invalidateMoney(ws.id),
  });
}

export function useDeleteAccount() {
  const ws = useWs();
  return useMutation({
    mutationFn: (id: string) => ws.call(`/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateMoney(ws.id),
  });
}

/* ---------------- categories ---------------- */

export function useCategories(includeArchived = false) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('categories', { includeArchived }),
    queryFn: () => ws.call<Category[]>(`/categories${toQuery({ includeArchived })}`),
    enabled: Boolean(ws.id),
    staleTime: 5 * 60_000,
  });
}

export function useSaveCategory() {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string; kind?: Category['kind']; name?: string; icon?: string; archived?: boolean }) =>
      id ? ws.call<Category>(`/categories/${id}`, { method: 'PATCH', body }) : ws.call<Category>('/categories', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ws.key('categories') }),
  });
}

/* ---------------- transactions ---------------- */

export interface TxFilters {
  type?: string;
  accountId?: string;
  categoryId?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  recurring?: boolean;
}

export function useTransactions(filters: TxFilters, page: number, limit = 25) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('transactions', filters, page, limit),
    queryFn: () => apiEnvelope<Transaction[]>(`/transactions${toQuery({ ...filters, page, limit })}`, { workspaceId: ws.id }),
    enabled: Boolean(ws.id),
    placeholderData: keepPreviousData,
    select: (r) => ({ items: r.data, meta: r.meta as unknown as PageMeta }),
  });
}

export function useTransaction(id: string | null) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('transaction', id),
    queryFn: () => ws.call<Transaction>(`/transactions/${id}`),
    enabled: Boolean(ws.id && id),
  });
}

export function useTransactionHistory(id: string) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('transaction', id, 'history'), queryFn: () => ws.call<AuditEntry[]>(`/transactions/${id}/history`) });
}

export type SaveResult = { queued: false; transaction: Transaction } | { queued: true };

/**
 * Creates or edits a transaction. A new one made without a connection is
 * kept on this device and sent later (see src/offline); edits need a connection.
 */
export function useSaveTransaction() {
  const ws = useWs();
  return useMutation({
    // Run even when the browser reports offline: sendOrQueue decides whether to send or keep it here.
    networkMode: 'always',
    mutationFn: async ({ id, body, idempotencyKey, summary }: { id?: string; body: Partial<TransactionInput>; idempotencyKey: string; summary?: QueueInput['summary'] }): Promise<SaveResult> => {
      if (id) return { queued: false, transaction: await ws.call<Transaction>(`/transactions/${id}`, { method: 'PATCH', body: { ...body } }) };
      const r = await sendOrQueue<Transaction>({ kind: 'transaction', workspaceId: ws.id, path: '/transactions', body: { ...body }, idempotencyKey, summary: summary ?? { title: String(body.description ?? 'Transaction'), amount: String(body.amount ?? ''), currency: '', date: String(body.date ?? '') } });
      return r.queued ? { queued: true } : { queued: false, transaction: r.data };
    },
    onSuccess: (r) => {
      if (!r.queued) void invalidateMoney(ws.id);
    },
  });
}

export function useTransactionAction() {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'delete' | 'reconcile' | 'unreconcile'; reason?: string }) =>
      action === 'delete'
        ? ws.call(`/transactions/${id}`, { method: 'DELETE', body: { reason: reason ?? '' } })
        : ws.call<Transaction>(`/transactions/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => invalidateMoney(ws.id),
  });
}

export function useSummary(range: { from?: string; to?: string; accountId?: string }) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('summary', range),
    queryFn: () => ws.call<Summary>(`/transactions/summary${toQuery(range)}`),
    enabled: Boolean(ws.id),
    placeholderData: keepPreviousData,
  });
}

export function useDashboard(range: { from: string; to: string }) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('dashboard', range),
    queryFn: () => ws.call<Dashboard>(`/analytics/dashboard${toQuery(range)}`),
    enabled: Boolean(ws.id),
  });
}

/* ---------------- attachments ---------------- */

export function useAttachments(transactionId: string) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('transaction', transactionId, 'attachments'), queryFn: () => ws.call<Attachment[]>(`/transactions/${transactionId}/attachments`) });
}

export function useAttachmentMutations(transactionId: string) {
  const ws = useWs();
  const done = () => invalidateMoney(ws.id);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return ws.call<Attachment>(`/transactions/${transactionId}/attachments`, { method: 'POST', form });
    },
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (attachmentId: string) => ws.call(`/transactions/${transactionId}/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: done,
  });
  return { upload, remove };
}

/* ---------------- exchange rates ---------------- */

export function useRates() {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('rates'),
    queryFn: () => apiEnvelope<ExchangeRate[]>('/exchange-rates', { workspaceId: ws.id }),
    enabled: Boolean(ws.id),
    select: (r) => ({ items: r.data, provider: (r.meta?.provider as string | null) ?? null }),
  });
}

export function useRateResolve(params: { from?: string; date?: string; amount?: string }, enabled: boolean) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('rate-resolve', params),
    queryFn: () => ws.call<RateResolution>(`/exchange-rates/resolve${toQuery(params)}`),
    enabled: Boolean(ws.id && enabled && params.from && params.date),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function useRateMutations() {
  const ws = useWs();
  const done = () => invalidateMoney(ws.id);
  return {
    save: useMutation({
      mutationFn: (body: { from: string; to: string; rate: string; effectiveDate: string }) => ws.call<ExchangeRate>('/exchange-rates', { method: 'POST', body }),
      onSuccess: done,
    }),
    fetch: useMutation({
      mutationFn: (body: { from: string; to: string }) => ws.call<ExchangeRate>('/exchange-rates/fetch', { method: 'POST', body }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => ws.call(`/exchange-rates/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}
