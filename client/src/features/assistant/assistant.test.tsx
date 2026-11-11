import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { AssistantPage } from './AssistantPage';

const user = { id: 'u1', name: 'Abena', email: 'a@example.com', lastWorkspaceId: 'w1' } as User;
const ws = { id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role: 'owner', status: 'active', permissions: ['workspace.read', 'workspace.update', 'records.read'] };
const status = (over = {}) => ({ configured: true, provider: 'Anthropic', model: 'claude-opus-5-5', consented: true, consentVersion: 'x', workspaceEnabled: true, usage: { used: 2, limit: 20 }, ...over });

type Call = { url: string; init?: RequestInit };
function server(st: object, answer?: object) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/workspaces') return jsonResponse({ success: true, data: [ws] });
    if (url === '/api/ai/status') return jsonResponse({ success: true, data: st });
    if (url === '/api/ai/consent') return jsonResponse({ success: true, data: { consented: true } });
    if (url === '/api/ai/ask') return jsonResponse({ success: true, data: answer });
    if (url.startsWith('/api/analytics/insights')) return jsonResponse({ success: true, data: [{ id: 'net-negative', topic: 'income', severity: 'warning', title: 'You spent GHS 20.00 more than you earned', detail: 'd', figures: {}, link: '/reports' }] });
    return jsonResponse({ success: true, data: [] });
  });
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 't');
  // Chromium's scrollIntoView can return a Promise; an effect must not return it.
  Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve()) as unknown as typeof Element.prototype.scrollIntoView;
});

describe('AssistantPage', () => {
  it('explains when AI is not set up and still shows rule-based insights', async () => {
    server(status({ configured: false, provider: null }));
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText(/isn.t set up on this server/)).toBeInTheDocument();
    expect(await screen.findByText('You spent GHS 20.00 more than you earned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
  });

  it('asks for consent first, listing what is and is not shared', async () => {
    const calls = server(status({ consented: false }));
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText('Transaction descriptions, payees and notes')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Agree and continue' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/ai/consent' && c.init?.method === 'POST')).toBe(true));
  });

  it('labels answers as AI suggestions and warns about figures not in the records', async () => {
    const calls = server(status(), {
      answer: 'You spent **GHS 120.50**. You might save GHS 40.00 a month.',
      kind: 'ai_suggestion',
      disclaimer: 'AI-generated. Suggestions are recommendations, not verified financial facts.',
      unverifiedFigures: ['40.00'],
      model: 'm',
      period: { from: 'a', to: 'b' },
      insights: [],
    });
    renderWithProviders(<AssistantPage />);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Your question'), 'How did I do?');
    await u.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('AI suggestion')).toBeInTheDocument();
    expect(screen.getByText('GHS 120.50').tagName).toBe('STRONG');
    expect(screen.getByText(/Not from your records: 40.00/)).toBeInTheDocument();
    expect(screen.getByText(/not verified financial facts/)).toBeInTheDocument();
    const body = JSON.parse(String(calls.find((c) => c.url === '/api/ai/ask')!.init!.body));
    expect(body).toMatchObject({ question: 'How did I do?', history: [] });
    expect(body.from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('stops asking at the monthly limit', async () => {
    server(status({ usage: { used: 20, limit: 20 } }));
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText('20 of 20 questions this month')).toBeInTheDocument();
    expect(screen.getByLabelText('Your question')).toBeDisabled();
  });
});
