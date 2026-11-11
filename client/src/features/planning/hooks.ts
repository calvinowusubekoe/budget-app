import { useMutation, useQuery } from '@tanstack/react-query';
import { apiEnvelope, api } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { useAuth } from '@/stores/auth';
import type { AppNotification, Budget, Debt, LedgerEntry, PeriodProgress, RecurringSchedule, SavingsGoal, Transaction } from '@/types/api';
import { invalidateMoney, toQuery, useWs } from '@/features/finance/hooks';

/* ---------------- budgets ---------------- */

export function useBudgets(includeArchived = false) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('budgets', { includeArchived }), queryFn: () => ws.call<Budget[]>(`/budgets${toQuery({ includeArchived })}`), enabled: Boolean(ws.id) });
}

export function useBudgetHistory(id: string | null, periods = 6) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('budgets', id, 'history', periods), queryFn: () => ws.call<PeriodProgress[]>(`/budgets/${id}/history?periods=${periods}`), enabled: Boolean(ws.id && id) });
}

export interface BudgetInput {
  name: string;
  period: Budget['period'];
  scope: Budget['scope'];
  categoryIds: string[];
  amount: string;
  alertAt: number;
  notes: string;
}

export function useSaveBudget() {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<BudgetInput> & { id?: string; status?: Budget['status'] }) =>
      id ? ws.call<Budget>(`/budgets/${id}`, { method: 'PATCH', body }) : ws.call<Budget>('/budgets', { method: 'POST', body }),
    onSuccess: () => invalidateMoney(ws.id),
  });
}

/* ---------------- savings goals ---------------- */

export function useGoals(includeArchived = false) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('goals', { includeArchived }), queryFn: () => ws.call<SavingsGoal[]>(`/savings-goals${toQuery({ includeArchived })}`), enabled: Boolean(ws.id) });
}

export function useSaveGoal() {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown> & { id?: string }) =>
      id ? ws.call<SavingsGoal>(`/savings-goals/${id}`, { method: 'PATCH', body }) : ws.call<SavingsGoal>('/savings-goals', { method: 'POST', body }),
    onSuccess: () => invalidateMoney(ws.id),
  });
}

export function useGoalTrend(id: string | null) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('goals', id, 'trend'), queryFn: () => ws.call<{ month: string; net: string }[]>(`/savings-goals/${id}/trend`), enabled: Boolean(ws.id && id) });
}

/* ---------------- debts ---------------- */

export function useDebts(includeArchived = false) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('debts', { includeArchived }), queryFn: () => ws.call<Debt[]>(`/debts${toQuery({ includeArchived })}`), enabled: Boolean(ws.id) });
}

export function useSaveDebt() {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown> & { id?: string }) =>
      id ? ws.call<Debt>(`/debts/${id}`, { method: 'PATCH', body }) : ws.call<Debt>('/debts', { method: 'POST', body }),
    onSuccess: () => invalidateMoney(ws.id),
  });
}

/* ---------------- shared ledger (savings entries, debt payments) ---------------- */

export type LedgerKind = 'savings' | 'debt';
const ledgerPath = (kind: LedgerKind, id: string) => (kind === 'savings' ? `/savings-goals/${id}/entries` : `/debts/${id}/payments`);

export function useLedger(kind: LedgerKind, id: string | null) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key(kind === 'savings' ? 'goals' : 'debts', id, 'ledger'), queryFn: () => ws.call<LedgerEntry[]>(ledgerPath(kind, id!)), enabled: Boolean(ws.id && id) });
}

export function useLedgerMutations(kind: LedgerKind, id: string) {
  const ws = useWs();
  const done = () => invalidateMoney(ws.id);
  return {
    add: useMutation({ mutationFn: (body: { type: LedgerEntry['type']; amount: string; date: string; notes: string }) => ws.call(ledgerPath(kind, id), { method: 'POST', body }), onSuccess: done }),
    reverse: useMutation({ mutationFn: ({ entryId, reason }: { entryId: string; reason: string }) => ws.call(`${ledgerPath(kind, id)}/${entryId}/reverse`, { method: 'POST', body: { reason } }), onSuccess: done }),
  };
}

/* ---------------- recurring ---------------- */

export function useSchedules(includeEnded = false) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('recurring', { includeEnded }), queryFn: () => ws.call<RecurringSchedule[]>(`/recurring${toQuery({ includeEnded })}`), enabled: Boolean(ws.id) });
}

export function useScheduleMutations() {
  const ws = useWs();
  const done = () => invalidateMoney(ws.id);
  return {
    create: useMutation({ mutationFn: (body: Record<string, unknown>) => ws.call<RecurringSchedule>('/recurring', { method: 'POST', body }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) => ws.call<RecurringSchedule>(`/recurring/${id}`, { method: 'PATCH', body }), onSuccess: done }),
    skip: useMutation({ mutationFn: (id: string) => ws.call<RecurringSchedule>(`/recurring/${id}/skip`, { method: 'POST' }), onSuccess: done }),
    confirm: useMutation({ mutationFn: ({ id, date }: { id: string; date: string }) => ws.call<Transaction>(`/recurring/${id}/confirm`, { method: 'POST', body: { date } }), onSuccess: () => { done(); invalidateNotifications(); } }),
    dismiss: useMutation({ mutationFn: ({ id, date }: { id: string; date: string }) => ws.call(`/recurring/${id}/dismiss`, { method: 'POST', body: { date } }), onSuccess: () => { done(); invalidateNotifications(); } }),
  };
}

/* ---------------- notifications ---------------- */

const invalidateNotifications = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

export function useNotifications() {
  const status = useAuth((s) => s.status);
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiEnvelope<AppNotification[]>('/notifications?limit=30'),
    enabled: status === 'authenticated',
    refetchInterval: 60_000,
    select: (r) => ({ items: r.data, unread: Number(r.meta?.unread ?? 0) }),
  });
}

export function useNotificationMutations() {
  return {
    read: useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: invalidateNotifications }),
    readAll: useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: invalidateNotifications }),
  };
}

/** After any money write, notifications may have changed (budget alerts). */
export function refreshNotificationsSoon() {
  setTimeout(invalidateNotifications, 300);
}
