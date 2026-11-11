import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { useWs } from '@/features/finance/hooks';
import type { BillingPeriod, CurrentPlan, PaymentProviderKey, PlanKey, PlanPayment, PlansResponse, SubscriptionInfo } from '@/types/api';

export function usePlans() {
  return useQuery({ queryKey: ['plans'], queryFn: () => api<PlansResponse>('/subscriptions/plans'), staleTime: 5 * 60_000 });
}

export function useCurrentPlan() {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('subscription'), queryFn: () => ws.call<CurrentPlan>('/subscriptions/current'), enabled: Boolean(ws.id) });
}

export function usePaymentHistory(enabled: boolean) {
  const ws = useWs();
  return useQuery({ queryKey: ws.key('subscription', 'history'), queryFn: () => ws.call<PlanPayment[]>('/subscriptions/history'), enabled: Boolean(ws.id) && enabled });
}

export function useBillingMutations() {
  const ws = useWs();
  // A plan change affects limits everywhere in the workspace, so refresh it all.
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    return queryClient.invalidateQueries({ queryKey: ['ws', ws.id] });
  };
  return {
    checkout: useMutation({
      mutationFn: ({ idempotencyKey, ...body }: { plan: Exclude<PlanKey, 'free'>; billingPeriod: BillingPeriod; provider: PaymentProviderKey; idempotencyKey: string }) =>
        ws.call<{ payment: PlanPayment; checkoutUrl: string }>('/subscriptions/checkout', { method: 'POST', body, idempotencyKey }),
      onSettled: done,
    }),
    check: useMutation({ mutationFn: (reference: string) => ws.call<PlanPayment>(`/subscriptions/payments/${reference}/check`, { method: 'POST' }), onSuccess: done }),
    cancel: useMutation({ mutationFn: (reason: string) => ws.call<SubscriptionInfo>('/subscriptions/cancel', { method: 'POST', body: { reason } }), onSuccess: done }),
    resume: useMutation({ mutationFn: () => ws.call<SubscriptionInfo>('/subscriptions/resume', { method: 'POST' }), onSuccess: done }),
  };
}
