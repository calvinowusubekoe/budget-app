import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { BillingPage } from './BillingPage';

const user = { id: 'u1', name: 'Efua', email: 'e@example.com', lastWorkspaceId: 'w1' } as User;
const ws = (role: 'owner' | 'admin') => ({
  id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role, status: 'active',
  permissions: role === 'owner' ? ['workspace.read', 'workspace.update', 'billing.manage', 'records.read'] : ['workspace.read', 'workspace.update', 'records.read'],
});
const limits = { accounts: 5, budgets: 5, savingsGoals: 3, debts: 5, recurring: 5, susuPlans: 2, invoicesPerMonth: 10, billsPerMonth: 10, aiQuestionsPerMonth: 20 };
const none = Object.fromEntries(Object.keys(limits).map((k) => [k, null]));
const plans = {
  plans: [
    { key: 'free', name: 'Free', summary: '', workspaceType: null, limits, currency: 'GHS', prices: null },
    { key: 'personal_pro', name: 'Personal Pro', summary: 'No limits.', workspaceType: 'personal', limits: none, currency: 'GHS', prices: { monthly: '25.00', yearly: '250.00' } },
  ],
  providers: [{ key: 'paystack', label: 'Paystack', testMode: true }],
};
const free = { plan: 'free', planName: 'Free', state: 'none', graceUntil: null, limits, usage: { ...Object.fromEntries(Object.keys(limits).map((k) => [k, 0])), accounts: 5 }, subscription: null };

type Call = { url: string; init?: RequestInit };
function server(role: 'owner' | 'admin' = 'owner', check?: unknown) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/workspaces') return jsonResponse({ success: true, data: [ws(role)] });
    if (url === '/api/subscriptions/plans') return jsonResponse({ success: true, data: plans });
    if (url === '/api/subscriptions/current') return jsonResponse({ success: true, data: free });
    if (url === '/api/subscriptions/history') return jsonResponse({ success: true, data: [] });
    if (url === '/api/subscriptions/checkout') return jsonResponse({ success: true, data: { checkoutUrl: 'https://checkout.paystack.com/abc', payment: {} } }, 201);
    if (url.endsWith('/check')) return jsonResponse({ success: true, data: check });
    return jsonResponse({ success: true, data: [] });
  });
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 't');
});

describe('BillingPage', () => {
  it('shows usage against Free limits and sends the owner to hosted checkout', async () => {
    const calls = server();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderWithProviders(<BillingPage />);
    expect(await screen.findByText('5 of 5')).toBeInTheDocument();
    expect(screen.getByText('GH₵25.00', { exact: false })).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByRole('radio', { name: 'Yearly' }));
    await u.click(screen.getByRole('button', { name: 'Pay with Paystack' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.paystack.com/abc'));
    const post = calls.find((c) => c.url === '/api/subscriptions/checkout')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ plan: 'personal_pro', billingPeriod: 'yearly', provider: 'paystack' });
    expect(new Headers(post.init!.headers).get('Idempotency-Key')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('explains why non-owners cannot pay', async () => {
    server('admin');
    renderWithProviders(<BillingPage />);
    expect(await screen.findByText('Only the workspace owner can change the plan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay with Paystack' })).toBeDisabled();
  });

  it('on return from checkout, asks the server to confirm rather than trusting the URL', async () => {
    const calls = server('owner', { status: 'pending', reference: 'bf-' + 'a'.repeat(24), planName: 'Personal Pro', coverage: null, failureReason: null });
    renderWithProviders(<BillingPage />, { route: `/settings/billing?checkout=paystack&reference=bf-${'a'.repeat(24)}&status=success` });
    expect(await screen.findByText(/hasn't confirmed this payment yet/)).toBeInTheDocument();
    expect(calls.some((c) => c.url === `/api/subscriptions/payments/bf-${'a'.repeat(24)}/check` && c.init?.method === 'POST')).toBe(true);
  });
});
