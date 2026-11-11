import { useMutation, useQuery } from '@tanstack/react-query';
import type { SusuEntry, SusuMonth, SusuPlan, SusuScheduleStats, SusuTotals, SusuWindow } from '@/types/api';
import { invalidateMoney, toQuery, useWs } from '@/features/finance/hooks';
import { sendOrQueue, type QueueInput } from '@/offline/sync';

/** Personal Susu: records only. These hooks never call anything that moves money. */

export function useSusuSummary() {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('susu', 'summary'),
    queryFn: () => ws.call<{ totals: SusuTotals[]; plans: { id: string; name: string; currency: string; status: string; current: string; progress: string | null; missed: number; nextDue: string | null }[] }>('/susu/summary'),
    enabled: Boolean(ws.id),
  });
}

export function useSusuPlans(includeClosed = false) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('susu', 'plans', { includeClosed }), queryFn: () => ws.call<SusuPlan[]>(`/susu/plans${toQuery({ includeClosed })}`), enabled: Boolean(ws.id) });
}

export function useSusuPlan(id: string | undefined) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('susu', 'plan', id), queryFn: () => ws.call<SusuPlan>(`/susu/plans/${id}`), enabled: Boolean(ws.id && id) });
}

export function useSusuSchedule(id: string | undefined, limit = 60) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('susu', 'plan', id, 'schedule', limit),
    queryFn: () => ws.call<{ windows: SusuWindow[]; stats: SusuScheduleStats }>(`/susu/plans/${id}/schedule?limit=${limit}`),
    enabled: Boolean(ws.id && id),
  });
}

export function useSusuMonthly(id: string | undefined) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('susu', 'plan', id, 'monthly'), queryFn: () => ws.call<SusuMonth[]>(`/susu/plans/${id}/monthly`), enabled: Boolean(ws.id && id) });
}

export function useSusuEntries(id: string | undefined, kind: SusuEntry['kind']) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('susu', 'plan', id, kind),
    queryFn: () => ws.call<SusuEntry[]>(`/susu/plans/${id}/${kind === 'contribution' ? 'contributions' : 'withdrawals'}`),
    enabled: Boolean(ws.id && id),
  });
}

export function useSaveSusuPlan() {
  const ws = useWs();
  return useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown> & { id?: string }) =>
      id ? ws.call<SusuPlan>(`/susu/plans/${id}`, { method: 'PATCH', body }) : ws.call<SusuPlan>('/susu/plans', { method: 'POST', body }),
    onSuccess: () => invalidateMoney(ws.id),
  });
}

export function useSusuEntryMutations(planId: string) {
  const ws = useWs();
  const done = () => invalidateMoney(ws.id);
  const path = (kind: SusuEntry['kind']) => `/susu/plans/${planId}/${kind === 'contribution' ? 'contributions' : 'withdrawals'}`;
  return {
    // Kept on this device when there's no connection (see src/offline); `queued` says which happened.
    add: useMutation({
      networkMode: 'always',
      mutationFn: async ({ kind, idempotencyKey, summary, ...body }: { kind: SusuEntry['kind']; amount: string; date: string; notes: string; reason?: string; idempotencyKey: string; summary: QueueInput['summary'] }) => {
        const r = await sendOrQueue<{ entry: SusuEntry }>({ kind: kind === 'contribution' ? 'susu_contribution' : 'susu_withdrawal', workspaceId: ws.id, path: path(kind), body, idempotencyKey, summary });
        return { queued: r.queued };
      },
      onSuccess: (r) => {
        if (!r.queued) void done();
      },
    }),
    cancel: useMutation({
      mutationFn: ({ kind, id, reason }: { kind: SusuEntry['kind']; id: string; reason: string }) => ws.call(`${path(kind)}/${id}/cancel`, { method: 'POST', body: { reason } }),
      onSuccess: done,
    }),
    attach: useMutation({
      mutationFn: ({ id, file }: { id: string; file: File }) => {
        const form = new FormData();
        form.append('file', file);
        return ws.call<SusuEntry>(`${path('contribution')}/${id}/attachment`, { method: 'POST', form });
      },
      onSuccess: done,
    }),
  };
}

export const LOCATION_LABEL = {
  home_box: 'Savings box at home',
  envelope: 'Envelope',
  safe: 'Personal safe',
  collector: 'Susu collector',
  other: 'Somewhere else',
} as const;

export function describeFrequency(p: Pick<SusuPlan, 'frequency' | 'intervalDays'>) {
  if (p.frequency === 'custom') return `every ${p.intervalDays} days`;
  return { daily: 'every day', weekly: 'every week', monthly: 'every month' }[p.frequency];
}
