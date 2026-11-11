import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionDialog } from './TransactionDialog';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';

const user = { id: 'u1', name: 'Ama', email: 'a@example.com', lastWorkspaceId: 'w1' } as User;
const workspace = { id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role: 'owner', permissions: ['records.write'], status: 'active' };
const accounts = [
  { id: 'a-ghs', name: 'MoMo', type: 'mobile_money', currency: 'GHS', status: 'active', balance: '0.00', transactionCount: 0 },
  { id: 'a-usd', name: 'Dollar card', type: 'bank', currency: 'USD', status: 'active', balance: '0.00', transactionCount: 0 },
];
const categories = [
  { id: 'c-food', kind: 'expense', name: 'Food', icon: 'utensils', systemKey: 'food', archived: false },
  { id: 'c-salary', kind: 'income', name: 'Salary', icon: 'briefcase', systemKey: 'salary', archived: false },
];

type Call = { url: string; init?: RequestInit };

function mockServer(opts: { rateFound: boolean }) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/workspaces') return jsonResponse({ success: true, data: [workspace] });
    if (url.startsWith('/api/accounts')) return jsonResponse({ success: true, data: accounts, meta: { totals: [] } });
    if (url.startsWith('/api/categories')) return jsonResponse({ success: true, data: categories });
    if (url.startsWith('/api/exchange-rates/resolve')) {
      return jsonResponse({
        success: true,
        data: opts.rateFound
          ? { from: 'USD', to: 'GHS', found: true, rate: '15.5', source: 'manual', estimated: false, rateDate: '2026-11-01', convertedAmount: '155.00', providerAvailable: false }
          : { from: 'USD', to: 'GHS', found: false, convertedAmount: null, providerAvailable: false },
      });
    }
    if (url === '/api/transactions' && init?.method === 'POST') {
      return jsonResponse({ success: true, data: { id: 't1', type: 'expense' } }, 201);
    }
    return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: url } }, 404);
  });
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 'token');
});

const posted = (calls: Call[]) => calls.filter((c) => c.url === '/api/transactions' && c.init?.method === 'POST');

describe('TransactionDialog', () => {
  it('records an expense with amounts as strings and an idempotency key', async () => {
    const calls = mockServer({ rateFound: true });
    renderWithProviders(<TransactionDialog open onOpenChange={() => undefined} />);
    const u = userEvent.setup();

    await screen.findByRole('option', { name: 'MoMo (GHS)' });
    await u.type(screen.getByLabelText('Amount'), '1,250.50');
    await u.selectOptions(screen.getByLabelText('Category'), 'c-food');
    await u.type(screen.getByLabelText('Description'), 'Makola market');
    await u.click(screen.getByRole('button', { name: 'Record transaction' }));

    await waitFor(() => expect(posted(calls)).toHaveLength(1));
    const req = posted(calls)[0]!;
    const body = JSON.parse(String(req.init!.body));
    expect(body).toMatchObject({ type: 'expense', accountId: 'a-ghs', categoryId: 'c-food', amount: '1250.50', description: 'Makola market' });
    expect(typeof body.amount).toBe('string');
    expect(body.exchangeRate).toBeUndefined();
    expect((req.init!.headers as Record<string, string>)['Idempotency-Key']).toMatch(/.{8,}/);
  });

  it('blocks amounts with too many decimals for the currency', async () => {
    const calls = mockServer({ rateFound: true });
    renderWithProviders(<TransactionDialog open onOpenChange={() => undefined} />);
    const u = userEvent.setup();
    await screen.findByRole('option', { name: 'MoMo (GHS)' });
    await u.type(screen.getByLabelText('Amount'), '10.555');
    await u.selectOptions(screen.getByLabelText('Category'), 'c-food');
    await u.type(screen.getByLabelText('Description'), 'x');
    await u.click(screen.getByRole('button', { name: 'Record transaction' }));
    expect(await screen.findByText('GHS amounts have at most 2 decimal places.')).toBeInTheDocument();
    expect(posted(calls)).toHaveLength(0);
  });

  it('shows the stored rate and converted amount for a foreign-currency account', async () => {
    mockServer({ rateFound: true });
    renderWithProviders(<TransactionDialog open onOpenChange={() => undefined} defaultAccountId="a-usd" />);
    const u = userEvent.setup();
    await screen.findByRole('option', { name: 'Dollar card (USD)' });
    await u.selectOptions(screen.getByLabelText('Paid from'), 'a-usd');
    await u.type(screen.getByLabelText('Amount'), '10');
    expect(await screen.findByText(/Manual rate/)).toBeInTheDocument();
    expect(screen.getByText('15.5')).toBeInTheDocument();
  });

  it('asks for a rate when none is on record and sends it', async () => {
    const calls = mockServer({ rateFound: false });
    renderWithProviders(<TransactionDialog open onOpenChange={() => undefined} />);
    const u = userEvent.setup();
    await screen.findByRole('option', { name: 'Dollar card (USD)' });
    await u.selectOptions(screen.getByLabelText('Paid from'), 'a-usd');
    await u.type(screen.getByLabelText('Amount'), '10');
    const rate = await screen.findByLabelText('Exchange rate: 1 USD in GHS');
    await u.selectOptions(screen.getByLabelText('Category'), 'c-food');
    await u.type(screen.getByLabelText('Description'), 'Netflix');

    await u.click(screen.getByRole('button', { name: 'Record transaction' }));
    expect(await screen.findByText('Enter how many GHS one USD was worth.')).toBeInTheDocument();
    expect(posted(calls)).toHaveLength(0);

    await u.type(rate, '15.42');
    await u.click(screen.getByRole('button', { name: 'Record transaction' }));
    await waitFor(() => expect(posted(calls)).toHaveLength(1));
    expect(JSON.parse(String(posted(calls)[0]!.init!.body))).toMatchObject({ accountId: 'a-usd', amount: '10', exchangeRate: '15.42' });
  });
});
