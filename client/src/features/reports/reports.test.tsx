import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { ReportsPage } from './ReportsPage';

const user = { id: 'u1', name: 'Abena', email: 'a@example.com', lastWorkspaceId: 'w1' } as User;
const ws = { id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role: 'owner', status: 'active', permissions: ['records.read', 'workspace.update'] };
const point = { key: '2026-10', label: 'Oct 2026', start: '2026-10-01', end: '2026-10-31', income: '3000.10', expense: '1200.35', net: '1799.75', cumulativeNet: '1799.75', savingsRate: '60.0' };
const ok = (data: unknown) => jsonResponse({ success: true, data });

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 't');
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/workspaces') return ok([ws]);
    if (url.startsWith('/api/analytics/monthly'))
      return ok({ currency: 'GHS', from: '2026-06-01', to: '2026-11-11', granularity: 'month', series: [point], totals: { income: '3000.10', expense: '1200.35', net: '1799.75', savingsRate: '60.0' }, previous: { from: '2025-12-01', to: '2026-05-31', income: '0.00', expense: '0.00', net: '0.00', incomeChange: null, expenseChange: null } });
    if (url.startsWith('/api/analytics/separated'))
      return ok({ from: 'a', to: 'b', trackedIncomeExpense: { currency: 'GHS', income: '3000.10', expense: '1200.35', count: 2 }, transfers: [{ currency: 'GHS', amount: '500.00', count: 1 }], savingsAllocations: [], personalSusu: { contributions: [], withdrawals: [] }, groupSusu: { yourContributions: [], payoutsToYou: [] }, subscriptionPayments: [] });
    if (url.startsWith('/api/analytics/spending'))
      return ok({ currency: 'GHS', from: 'a', to: 'b', total: '1200.35', previousTotal: '0.00', change: null, previous: { from: 'a', to: 'b' }, categories: [{ categoryId: 'c', name: 'Food', icon: 'x', amount: '1200.35', count: 2, share: '100.0', previous: '0.00', change: null, threePeriodAverage: '0.00' }], unusual: [], rules: 'r' });
    if (url.startsWith('/api/analytics/savings')) return ok({ from: 'a', to: 'b', goals: [], savingsFlow: [], personalSusu: { totals: [], plans: [], flow: [] }, groupSusu: [] });
    return ok([]);
  });
});

describe('ReportsPage', () => {
  it('states the server totals in words and keeps other movements separate', async () => {
    renderWithProviders(<ReportsPage />);
    expect(await screen.findByText('GH₵3,000.10')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(await screen.findByText('Transfers between your accounts')).toBeInTheDocument();
    expect(screen.getByText('GH₵500.00 (1)')).toBeInTheDocument();
    expect(screen.getByText('BudgetFlow plan payments')).toBeInTheDocument();
    expect(await screen.findByText('Where the money went')).toBeInTheDocument();
  });
});
