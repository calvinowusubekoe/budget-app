import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { SusuWindow, User } from '@/types/api';
import { BeadTrack } from './BeadTrack';
import { SusuPage } from './SusuPage';

const user = { id: 'u1', name: 'Ama', email: 'a@example.com', lastWorkspaceId: 'w1' } as User;
const workspace = { id: 'w1', name: 'Personal', type: 'personal', baseCurrency: 'GHS', role: 'owner', permissions: ['records.read', 'records.write'], status: 'active' };

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 't');
});

describe('BeadTrack', () => {
  it('labels each period so screen readers hear the same story as the beads show', () => {
    const w = (index: number, status: SusuWindow['status'], contributed: string): SusuWindow => ({ index, due: `2026-11-0${index + 2}`, end: `2026-11-0${index + 2}`, expected: '20.00', contributed, entries: 1, status });
    render(<BeadTrack currency="GHS" windows={[w(2, 'open', '0.00'), w(0, 'met', '20.00'), w(1, 'missed', '0.00')]} />);
    const beads = screen.getAllByRole('listitem', { name: /2026|Nov/ }).filter((li) => li.getAttribute('aria-label'));
    expect(beads).toHaveLength(3);
    // Oldest first, whatever order the server sent.
    expect(beads[0]!.getAttribute('aria-label')).toMatch(/Paid in full/);
    expect(beads[1]!.getAttribute('aria-label')).toMatch(/Missed/);
    expect(beads[2]!.getAttribute('aria-label')).toMatch(/Due now/);
  });
});

describe('SusuPage', () => {
  it('states plainly that Kontaa never holds Susu money, and shows plan progress', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u === '/api/workspaces') return jsonResponse({ success: true, data: [workspace] });
      if (u.startsWith('/api/susu/summary')) return jsonResponse({ success: true, data: { totals: [{ currency: 'GHS', plans: 1, current: '240.00', arrears: '40.00', missed: 2 }], plans: [] } });
      if (u.startsWith('/api/susu/plans'))
        return jsonResponse({
          success: true,
          data: [
            {
              id: 'p1', name: 'Market susu', description: '', currency: 'GHS', targetAmount: '600.00', contributionAmount: '20.00', contributionHistory: [], frequency: 'daily', intervalDays: null,
              startDate: '2026-10-01', targetDate: null, location: { type: 'collector', label: 'Auntie Akos' }, status: 'active', notes: '', completedAt: null, cancelledAt: null, cancelReason: '',
              summary: { contributed: '260.00', withdrawn: '20.00', current: '240.00', target: '600.00', remaining: '360.00', progress: '40.0', reached: false, contributionCount: 13, withdrawalCount: 1, lastContribution: null, onScheduleFinish: null,
                schedule: { periods: 15, met: 13, partial: 0, missed: 2, open: 0, paused: 0, expectedToDate: '300.00', arrears: '40.00', streak: 3, nextDue: '2026-11-12' } },
              createdAt: '',
            },
          ],
        });
      return jsonResponse({ success: true, data: [] });
    });
    renderWithProviders(<SusuPage />);
    expect(screen.getByText('Kontaa never holds or moves Susu money')).toBeInTheDocument();
    expect(await screen.findByText('Market susu')).toBeInTheDocument();
    expect(screen.getByText(/2 missed/)).toBeInTheDocument();
    expect(screen.getByText(/Auntie Akos/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /40.0% of target/ })).toBeInTheDocument();
    // Nothing on the page offers to pay, send or collect money.
    expect(screen.queryByRole('button', { name: /pay|send|collect|transfer|withdraw funds/i })).toBeNull();
  });
});
