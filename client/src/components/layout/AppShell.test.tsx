import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { AppShell } from './AppShell';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User, Workspace } from '@/types/api';

const user = { id: 'u1', name: 'Kwabena Asante', email: 'k@example.com', lastWorkspaceId: 'w2' } as User;
const ws = (id: string, type: 'personal' | 'business'): Workspace =>
  ({ id, name: type === 'business' ? 'Asante Motors' : 'Personal', type, baseCurrency: 'GHS', role: 'owner', permissions: [], status: 'active' }) as unknown as Workspace;

function mockWorkspaces(list: Workspace[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    String(url).startsWith('/api/notifications')
      ? jsonResponse({ success: true, data: [], meta: { unread: 0 } })
      : jsonResponse({ success: true, data: list }),
  );
}

beforeEach(() => vi.restoreAllMocks());

describe('AppShell navigation', () => {
  it('links every built section, including Reports and the AI Assistant', async () => {
    useAuth.getState().setSession(user, 't');
    mockWorkspaces([ws('w1', 'personal')]);
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>home</p>} />
        </Route>
      </Routes>,
    );
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Transactions' })).toHaveAttribute('href', '/transactions');
    expect(within(nav).getByRole('link', { name: 'Budgets' })).toHaveAttribute('href', '/budgets');
    expect(within(nav).getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports');
    expect(within(nav).getByRole('link', { name: 'AI Assistant' })).toHaveAttribute('href', '/assistant');
    expect(nav.querySelector('[aria-disabled="true"]')).toBeNull();
  });

  it('shows the Business section only in a business workspace', async () => {
    useAuth.getState().setSession(user, 't');
    mockWorkspaces([ws('w1', 'personal'), ws('w2', 'business')]);
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>home</p>} />
        </Route>
      </Routes>,
    );
    expect(await screen.findAllByText('Asante Motors')).not.toHaveLength(0);
    expect(screen.getByText('Business')).toBeInTheDocument();
  });
});
