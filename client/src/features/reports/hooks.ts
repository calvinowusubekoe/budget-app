import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api, apiBlob, saveBlob } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { toQuery, useWs } from '@/features/finance/hooks';
import type { AiAnswer, AiStatus, Granularity, IncomeSpending, Insight, SavingsAnalysis, SeparatedTotals, SpendingAnalysis } from '@/types/api';

export interface Range {
  from: string;
  to: string;
}

function useAnalytics<T>(path: string, params: Record<string, string>, enabled = true) {
  const ws = useWs();
  return useQuery({
    queryKey: ws.key('analytics', path, params),
    queryFn: () => ws.call<T>(`/analytics/${path}${toQuery(params)}`),
    enabled: Boolean(ws.id) && enabled,
    placeholderData: keepPreviousData,
  });
}

export const useIncomeSpending = (r: Range, granularity: Granularity) => useAnalytics<IncomeSpending>('monthly', { ...r, granularity });
export const useSpending = (r: Range) => useAnalytics<SpendingAnalysis>('spending', { ...r });
export const useSavingsAnalytics = (r: Range, granularity: Granularity) => useAnalytics<SavingsAnalysis>('savings', { ...r, granularity });
export const useSeparated = (r: Range) => useAnalytics<SeparatedTotals>('separated', { ...r });
export const useInsights = (r: Range) => useAnalytics<Insight[]>('insights', { ...r });

export function useExportIncomeSpending() {
  const ws = useWs();
  return useMutation({
    mutationFn: async ({ from, to, granularity }: Range & { granularity: Granularity }) => {
      const blob = await apiBlob(`/analytics/monthly${toQuery({ from, to, granularity, format: 'csv' })}`, { workspaceId: ws.id });
      saveBlob(blob, `income-spending-${from}-to-${to}.csv`);
    },
  });
}

/* ---------------- AI assistant ---------------- */

export function useAiStatus() {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('ai', 'status'), queryFn: () => ws.call<AiStatus>('/ai/status'), enabled: Boolean(ws.id) });
}

export function useAiMutations() {
  const ws = useWs();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ws', ws.id, 'ai'] });
  return {
    consent: useMutation({ mutationFn: () => api('/ai/consent', { method: 'POST' }), onSuccess: refresh }),
    withdraw: useMutation({ mutationFn: () => api('/ai/consent', { method: 'DELETE' }), onSuccess: refresh }),
    toggle: useMutation({
      mutationFn: (enabled: boolean) => ws.call('/ai/workspace', { method: 'PATCH', body: { enabled } }),
      onSuccess: () => {
        void refresh();
        return queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      },
    }),
    ask: useMutation({
      mutationFn: (body: { question: string; history: { role: 'user' | 'assistant'; content: string }[]; from: string; to: string }) => ws.call<AiAnswer>('/ai/ask', { method: 'POST', body }),
      onSettled: refresh,
    }),
  };
}
