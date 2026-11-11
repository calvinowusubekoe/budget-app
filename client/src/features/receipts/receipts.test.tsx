import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { ReceiptScan, User } from '@/types/api';
import { TransactionDialog } from '@/features/transactions/TransactionDialog';
import { ScanReceiptDialog } from './ScanReceiptDialog';

const user = { id: 'u1', name: 'Ama', email: 'a@example.com', lastWorkspaceId: 'w1' } as User;
const workspace = { id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role: 'owner', permissions: ['records.write'], status: 'active' };
const accounts = [
  { id: 'a-usd', name: 'Dollar card', type: 'bank', currency: 'USD', status: 'active', balance: '0.00', transactionCount: 0 },
  { id: 'a-ghs', name: 'MoMo', type: 'mobile_money', currency: 'GHS', status: 'active', balance: '0.00', transactionCount: 0 },
];
const categories = [
  { id: 'c-food', kind: 'expense', name: 'Food', icon: 'utensils', systemKey: 'food', archived: false },
  { id: 'c-housing', kind: 'expense', name: 'Housing', icon: 'home', systemKey: 'housing', archived: false },
];
const scan: ReceiptScan = {
  kind: 'ai_suggestion',
  draft: { type: 'expense', amount: '1250.50', currency: 'GHS', date: '2026-11-10', counterparty: 'Melcom Accra Mall', description: 'Chest freezer', reference: 'MP241111.C12345', fees: '12.51', categoryId: 'c-housing', categoryName: 'Housing', documentKind: 'mobile_money' },
  warnings: ['The receipt is slightly cut off at the bottom.'],
  possibleDuplicates: [{ id: 't0', date: '2026-11-10', description: 'Freezer', amount: '1250.50', currency: 'GHS', type: 'expense' }],
};
const aiStatus = (over = {}) => ({ configured: true, provider: 'Anthropic', model: 'm', consented: true, consentVersion: 'x', workspaceEnabled: true, usage: { used: 0, limit: 20 }, scans: { used: 1, limit: 10 }, ...over });

type Call = { url: string; init?: RequestInit };
function server(st = aiStatus()) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/workspaces') return jsonResponse({ success: true, data: [workspace] });
    if (url.startsWith('/api/accounts')) return jsonResponse({ success: true, data: accounts, meta: { totals: [] } });
    if (url.startsWith('/api/categories')) return jsonResponse({ success: true, data: categories });
    if (url === '/api/ai/status') return jsonResponse({ success: true, data: st });
    if (url === '/api/ai/receipts/scan') return jsonResponse({ success: true, data: scan });
    if (url === '/api/transactions' && init?.method === 'POST') return jsonResponse({ success: true, data: { id: 't-new', type: 'expense' } }, 201);
    if (url === '/api/transactions/t-new/attachments') return jsonResponse({ success: true, data: { id: 'att1' } }, 201);
    return jsonResponse({ success: true, data: [] });
  });
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 'token');
});

const file = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'momo.png', { type: 'image/png' });

describe('ScanReceiptDialog', () => {
  it('uploads the chosen file and hands back what was read', async () => {
    const calls = server();
    const onRead = vi.fn();
    globalThis.URL.createObjectURL ??= () => 'blob:x';
    globalThis.URL.revokeObjectURL ??= () => undefined;
    renderWithProviders(<ScanReceiptDialog open onOpenChange={() => undefined} onRead={onRead} />);
    const u = userEvent.setup();
    expect(await screen.findByText('9 scans left this month')).toBeInTheDocument();
    await u.upload(screen.getByLabelText('Receipt file'), file());
    await u.click(screen.getByRole('button', { name: 'Read receipt' }));
    await waitFor(() => expect(onRead).toHaveBeenCalled());
    const post = calls.find((c) => c.url === '/api/ai/receipts/scan')!;
    expect(post.init!.body).toBeInstanceOf(FormData);
    expect(onRead.mock.calls[0]![0]).toEqual(scan);
  });

  it('asks for consent first, saying what is sent', async () => {
    server(aiStatus({ consented: false }));
    renderWithProviders(<ScanReceiptDialog open onOpenChange={() => undefined} onRead={() => undefined} />);
    expect(await screen.findByText(/the image is sent to Anthropic with your category names/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read receipt' })).toBeNull();
  });

  it('explains when scanning is unavailable', async () => {
    server(aiStatus({ configured: false }));
    renderWithProviders(<ScanReceiptDialog open onOpenChange={() => undefined} onRead={() => undefined} />);
    expect(await screen.findByText(/isn’t set up on this server/)).toBeInTheDocument();
  });
});

describe('TransactionDialog with a scanned receipt', () => {
  it('pre-fills the form as a labelled suggestion, then saves and attaches the image', async () => {
    const calls = server();
    renderWithProviders(<TransactionDialog open onOpenChange={() => undefined} receipt={{ scan, file: file() }} />);
    expect(await screen.findByText('Filled in by AI from your receipt.')).toBeInTheDocument();
    expect(screen.getByText('The receipt is slightly cut off at the bottom.')).toBeInTheDocument();
    expect(screen.getByText(/This may already be recorded/)).toBeInTheDocument();
    expect(screen.getByText('momo.png will be attached when you save.')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByLabelText('Paid from')).toHaveValue('a-ghs')); // the GHS account, not the first one
    expect(screen.getByLabelText('Amount')).toHaveValue('1250.50');
    expect(screen.getByLabelText('Description')).toHaveValue('Chest freezer');
    expect(screen.getByLabelText('Category')).toHaveValue('c-housing');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Record transaction' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/transactions/t-new/attachments')).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url === '/api/transactions' && c.init?.method === 'POST')!.init!.body));
    expect(body).toMatchObject({ amount: '1250.50', accountId: 'a-ghs', categoryId: 'c-housing', date: '2026-11-10', payee: 'Melcom Accra Mall' });
    expect(body.notes).toBe('Ref: MP241111.C12345\nFees: 12.51 GHS');
  });
});
