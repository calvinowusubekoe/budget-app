import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { DocumentEditor } from './DocumentEditor';
import { BusinessOnly } from './BusinessOnly';

const user = { id: 'u1', name: 'Kwame', email: 'k@example.com', lastWorkspaceId: 'w1' } as User;
const ws = (type: 'business' | 'personal') => ({ id: 'w1', name: type === 'business' ? 'Kwame Hardware' : 'Personal', type, baseCurrency: 'GHS', role: 'owner', permissions: ['records.read', 'records.write'], status: 'active' });

type Call = { url: string; init?: RequestInit };
function server(type: 'business' | 'personal') {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/workspaces') return jsonResponse({ success: true, data: [ws(type)] });
    if (url === '/api/meta') return jsonResponse({ success: true, data: { currencies: { featured: ['GHS', 'USD'], all: ['GHS', 'USD'] }, legal: { termsVersion: 'x', privacyVersion: 'y' } } });
    if (url.startsWith('/api/business/customers')) return jsonResponse({ success: true, data: [{ id: 'c1', name: 'Osu Builders', email: '', phone: '', address: '', taxId: '', notes: '', status: 'active', outstanding: [], createdAt: '' }] });
    if (url === '/api/business/documents/preview') {
      return jsonResponse({ success: true, data: { subtotal: '955.00', taxTotal: '143.25', total: '1098.25', lines: [{ amount: '955.00', tax: '143.25' }] } });
    }
    if (url === '/api/business/invoices' && init?.method === 'POST') return jsonResponse({ success: true, data: { id: 'i1', number: 'INV-0001' } }, 201);
    return jsonResponse({ success: true, data: [] });
  });
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 't');
});

describe('DocumentEditor', () => {
  it('shows totals from the server and posts amounts as strings', async () => {
    const calls = server('business');
    renderWithProviders(<DocumentEditor kind="invoice" open onOpenChange={() => undefined} />);
    const u = userEvent.setup();
    await screen.findByRole('option', { name: 'Osu Builders' });
    await u.selectOptions(screen.getByLabelText('Customer'), 'c1');
    await u.type(screen.getByLabelText('Item 1 description'), 'Cement bags');
    await u.clear(screen.getByLabelText('Item 1 quantity'));
    await u.type(screen.getByLabelText('Item 1 quantity'), '10');
    await u.type(screen.getByLabelText('Item 1 unit price'), '95.50');
    await u.type(screen.getByLabelText('Item 1 tax percent'), '15');

    // The total shown is the server's, not computed in the browser.
    expect(await screen.findByText(/1,098\.25/)).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/business/documents/preview')).toBe(true);

    await u.click(screen.getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/business/invoices' && c.init?.method === 'POST')).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'POST' && c.url === '/api/business/invoices')!.init!.body));
    expect(body).toMatchObject({ partyId: 'c1', issue: true, lines: [{ description: 'Cement bags', quantity: '10', unitPrice: '95.50', taxRate: '15' }] });
    expect(body.total).toBeUndefined(); // totals are never sent; the server computes them
  });

  it('blocks items with too many decimals', async () => {
    const calls = server('business');
    renderWithProviders(<DocumentEditor kind="invoice" open onOpenChange={() => undefined} />);
    const u = userEvent.setup();
    await screen.findByRole('option', { name: 'Osu Builders' });
    await u.selectOptions(screen.getByLabelText('Customer'), 'c1');
    await u.type(screen.getByLabelText('Item 1 description'), 'x');
    await u.type(screen.getByLabelText('Item 1 unit price'), '1.005');
    await u.click(screen.getByRole('button', { name: 'Issue invoice' }));
    expect(await screen.findByText('GHS amounts have at most 2 decimal places.')).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === 'POST' && c.url === '/api/business/invoices')).toBe(false);
  });
});

describe('BusinessOnly', () => {
  it('explains that business tools need a business workspace', async () => {
    server('personal');
    renderWithProviders(
      <Routes>
        <Route element={<BusinessOnly />}>
          <Route path="/" element={<p>secret business page</p>} />
        </Route>
      </Routes>,
    );
    expect(await screen.findByText('Business tools live in business workspaces')).toBeInTheDocument();
    expect(screen.queryByText('secret business page')).toBeNull();
  });
});
