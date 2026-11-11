import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { LoginPage } from '@/features/auth/LoginPage';
import { FeedbackDialog } from './FeedbackDialog';
import { GuidePage } from './GuidePage';
import { TestBanner } from './TestBanner';

const user = { id: 'u1', name: 'Kofi', email: 'k@example.com', lastWorkspaceId: 'w1' } as User;
const meta = (stage: 'live' | 'test', demo: { email: string; password: string } | null = null) => ({ currencies: { featured: ['GHS'], all: ['GHS'] }, legal: { termsVersion: 'x', privacyVersion: 'y' }, stage, demo });

type Call = { url: string; init?: RequestInit };
function server(m: ReturnType<typeof meta>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/meta') return jsonResponse({ success: true, data: m });
    if (url === '/api/workspaces') return jsonResponse({ success: true, data: [{ id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role: 'owner', permissions: [], status: 'active' }] });
    if (url === '/api/feedback') return jsonResponse({ success: true, data: { id: 'f1', received: true } }, 201);
    if (url === '/api/auth/login') return jsonResponse({ success: true, data: { user, accessToken: 't' } });
    return jsonResponse({ success: true, data: [] });
  });
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().clear();
});

describe('tester kit', () => {
  it('shows the test banner only on test builds', async () => {
    server(meta('test'));
    const { unmount } = renderWithProviders(<TestBanner />);
    expect(await screen.findByText(/Use made-up details/)).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    server(meta('live'));
    renderWithProviders(<TestBanner />);
    await waitFor(() => expect(screen.queryByText(/Use made-up details/)).toBeNull());
  });

  it('offers the demo account on the sign-in page and signs in with it', async () => {
    const calls = server(meta('test', { email: 'demo@kontaa.app', password: 'kontaa demo 2026' }));
    renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use the demo account' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/auth/login')).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.url === '/api/auth/login')!.init!.body))).toEqual({ email: 'demo@kontaa.app', password: 'kontaa demo 2026' });
  });

  it('hides the demo button on live builds', async () => {
    server(meta('live'));
    renderWithProviders(<LoginPage />, { route: '/login' });
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('button', { name: 'Use the demo account' })).toBeNull();
  });

  it('sends feedback with the page it came from', async () => {
    useAuth.getState().setSession(user, 't');
    const calls = server(meta('test'));
    renderWithProviders(<FeedbackDialog open onOpenChange={() => undefined} />, { route: '/budgets' });
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText('What is it about?'), 'confusing');
    await u.type(screen.getByLabelText('Your feedback'), 'The alert percentage is unclear');
    await u.click(screen.getByRole('radio', { name: '4 out of 5' }));
    await u.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/feedback')).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url === '/api/feedback')!.init!.body));
    expect(body).toMatchObject({ category: 'confusing', message: 'The alert percentage is unclear', rating: 4, page: '/budgets' });
  });

  it('the guide shows the demo sign-in details', async () => {
    server(meta('test', { email: 'demo@kontaa.app', password: 'kontaa demo 2026' }));
    renderWithProviders(<GuidePage />, { route: '/guide' });
    expect(await screen.findByText('demo@kontaa.app')).toBeInTheDocument();
    expect(screen.getByText('kontaa demo 2026')).toBeInTheDocument();
    expect(screen.getByText('Things to try')).toBeInTheDocument();
  });
});
