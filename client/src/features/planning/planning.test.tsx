import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { BudgetsPage } from '@/features/budgets/BudgetsPage';
import { LedgerPanel } from './LedgerPanel';

const user = { id: 'u1', name: 'Ama', email: 'a@example.com', lastWorkspaceId: 'w1', timezone: 'Africa/Accra' } as User;
const workspace = { id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role: 'owner', permissions: ['records.write', 'records.read'], status: 'active' };

type Call = { url: string; init?: RequestInit };
function server(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/workspaces') return jsonResponse({ success: true, data: [workspace] });
    for (const [prefix, body] of Object.entries(routes)) if (url.startsWith(prefix)) return jsonResponse(body);
    return jsonResponse({ success: true, data: [] });
  });
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 't');
});

describe('BudgetsPage', () => {
  it('shows server-calculated spending, remaining and state', async () => {
    server({
      '/api/budgets': {
        success: true,
        data: [
          {
            id: 'b1', name: 'Food', period: 'monthly', scope: 'categories', categories: [{ id: 'c1', name: 'Food', icon: 'utensils' }], currency: 'GHS', alertAt: 80, status: 'active', notes: '', amountHistory: [],
            current: { start: '2026-11-01', end: '2026-11-30', key: 'M2026-11', amount: '1000.00', spent: '1050.25', remaining: '-50.25', utilisation: '105.0', state: 'over', daysLeft: 19 },
          },
        ],
      },
    });
    renderWithProviders(<BudgetsPage />);
    expect(await screen.findByText('Food', { selector: 'h2 span' })).toBeInTheDocument();
    expect(screen.getByText(/over, with 19 days left this month/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /105.0% used/ })).toHaveAttribute('aria-valuenow', '105');
  });

  it('offers a way to start when there are none', async () => {
    server({ '/api/budgets': { success: true, data: [] } });
    renderWithProviders(<BudgetsPage />);
    expect(await screen.findByText('No budgets yet')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Create a budget/ })).toBeInTheDocument();
  });
});

describe('LedgerPanel', () => {
  const types = [{ value: 'contribution' as const, label: 'Put in', sign: '+' as const }, { value: 'withdrawal' as const, label: 'Take out', sign: '-' as const }];

  it('validates the amount, then posts a string amount', async () => {
    const calls = server({ '/api/savings-goals/g1/entries': { success: true, data: [] } });
    renderWithProviders(<LedgerPanel kind="savings" id="g1" currency="GHS" writable types={types} note="" />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Amount (GHS)'), '12.345');
    await u.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByText('GHS amounts have at most 2 decimal places.')).toBeInTheDocument();

    await u.clear(screen.getByLabelText('Amount (GHS)'));
    await u.type(screen.getByLabelText('Amount (GHS)'), '50');
    await u.click(screen.getByRole('radio', { name: 'Take out' }));
    await u.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'POST')!.init!.body));
    expect(body).toMatchObject({ type: 'withdrawal', amount: '50' });
  });

  it('requires a reason before reversing, and shows reversed entries struck through', async () => {
    server({
      '/api/debts/d1/payments': {
        success: true,
        data: [
          { id: 'e1', type: 'payment', amount: '100.00', date: '2026-11-01', notes: '', status: 'recorded', reversedAt: null, reversalReason: '', createdAt: '' },
          { id: 'e2', type: 'payment', amount: '20.00', date: '2026-10-01', notes: '', status: 'reversed', reversedAt: '2026-10-02', reversalReason: 'Bounced', createdAt: '' },
        ],
      },
    });
    renderWithProviders(<LedgerPanel kind="debt" id="d1" currency="GHS" writable types={[{ value: 'payment', label: 'Payment made', sign: '-' }, { value: 'charge', label: 'Interest or fee', sign: '+' }]} note="" />);
    const u = userEvent.setup();
    expect(await screen.findByText('Reversed: Bounced')).toBeInTheDocument();
    // Only the live entry can be reversed.
    const buttons = screen.getAllByRole('button', { name: 'Reverse this entry' });
    expect(buttons).toHaveLength(1);
    await u.click(buttons[0]!);
    const confirm = screen.getByRole('button', { name: 'Reverse' });
    expect(confirm).toBeDisabled();
    await u.type(screen.getByLabelText('Reason for reversing'), 'Entered twice');
    expect(confirm).toBeEnabled();
  });
});
