import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { jsonResponse, renderWithProviders } from '@/test/utils';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { GroupPage } from './GroupPage';

const user = { id: 'u-kofi', name: 'Kofi', email: 'k@example.com', lastWorkspaceId: 'w1' } as User;

const group = (role: 'organizer' | 'member', capabilities: string[]) => ({
  id: 'g1', name: 'Makola Traders Susu', description: '', currency: 'GHS', contributionAmount: '100.00', frequency: 'weekly', intervalDays: null, startDate: '2026-11-01', endDate: null,
  rotationMethod: 'fixed_order', collectionSchedule: '', maxMembers: 12, assistantPermissions: { manageMembers: false, manageCycles: false, recordContributions: true, recordPayouts: false },
  status: 'active', cancelReason: '', memberCount: 3, createdAt: '', me: { memberId: 'm-kofi', role, status: 'active', capabilities },
});

const cycles = [{ id: 'c1', number: 1, dueDate: '2026-11-01', recipient: { id: 'm-org', displayName: 'Abena' }, contributorCount: 3, contributorMemberIds: ['m-org', 'm-kofi', 'm-esi'], expectedPerMember: '100.00', expectedPool: '300.00', status: 'active', cancelReason: '', notes: '' }];
const report = {
  currency: 'GHS', asOf: '2026-11-11',
  totals: { cycles: 1, dueCycles: 1, expectedToDate: '300.00', received: '100.00', confirmed: '0.00', outstanding: '200.00', payoutsRecorded: 0, payoutsConfirmed: 0 },
  cycles: [{ cycleId: 'c1', number: 1, dueDate: '2026-11-01', due: true, recipient: { id: 'm-org', displayName: 'Abena' }, expectedPool: '300.00', received: '100.00', confirmed: '0.00', disputed: '0.00', outstanding: '200.00', payout: null, members: [{ memberId: 'm-kofi', received: '100.00', confirmed: '0.00', disputed: '0.00', state: 'paid' }] }],
  members: [{ member: { id: 'm-kofi', displayName: 'Kofi' }, expectedToDate: '100.00', received: '100.00', confirmed: '0.00', disputed: '0.00', outstanding: '0.00', missedCycles: 0, partialCycles: 0, upcoming: '0.00' }],
  disputes: [],
};
const myRecord = { id: 'r1', kind: 'contribution', cycleId: 'c1', cycleNumber: 1, currency: 'GHS', notes: '', status: 'recorded', recordedBy: 'Abena', events: [{ type: 'recorded', actor: 'Abena', reason: '', changes: null, at: '2026-11-01T10:00:00Z' }], canRespond: true, selfRecorded: false, createdAt: '', member: { id: 'm-kofi', displayName: 'Kofi' }, amount: '100.00', date: '2026-11-01' };

function server(role: 'organizer' | 'member', capabilities: string[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/susu/groups/g1') return jsonResponse({ success: true, data: group(role, capabilities) });
    if (url.startsWith('/api/susu/groups/g1/cycles')) return jsonResponse({ success: true, data: cycles });
    if (url.startsWith('/api/susu/groups/g1/reports')) return jsonResponse({ success: true, data: report });
    if (url.startsWith('/api/susu/groups/g1/members')) return jsonResponse({ success: true, data: [{ id: 'm-kofi', displayName: 'Kofi', role: 'member', status: 'active', registered: true, rotationPosition: 2, joinedAt: null }] });
    if (url.startsWith('/api/susu/groups/g1/contributions') && init?.method === 'PATCH') return jsonResponse({ success: true, data: { ...myRecord, status: 'confirmed', canRespond: false } });
    if (url.startsWith('/api/susu/groups/g1/contributions')) return jsonResponse({ success: true, data: [myRecord] });
    return jsonResponse({ success: true, data: [] });
  });
  return calls;
}

const renderAt = (tab: string) =>
  renderWithProviders(
    <Routes>
      <Route path="/susu/groups/:groupId" element={<GroupPage />} />
    </Routes>,
    { route: `/susu/groups/g1?tab=${tab}` },
  );

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.getState().setSession(user, 't');
});

describe('GroupPage', () => {
  it('says plainly that it only keeps records', async () => {
    server('member', []);
    renderAt('overview');
    expect(await screen.findByText(/It never collects, holds or pays out money/)).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Rotation, in turn order' })).toBeInTheDocument();
  });

  it('lets a member confirm their own record, and hides organiser actions', async () => {
    const calls = server('member', []);
    renderAt('records');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.init?.method === 'PATCH')!;
    expect(patch.url).toBe('/api/susu/groups/g1/contributions/r1');
    expect(JSON.parse(String(patch.init!.body))).toMatchObject({ action: 'confirm' });
    expect(screen.queryByRole('button', { name: /^Record$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel record/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();
  });

  it('requires a reason before a dispute is sent', async () => {
    server('member', []);
    renderAt('records');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Dispute/ }));
    const send = screen.getByRole('button', { name: 'Send dispute' });
    expect(send).toBeDisabled();
    await u.type(screen.getByLabelText('Reason'), 'I paid 120');
    expect(send).toBeEnabled();
  });

  it('shows organisers the settings tab', async () => {
    server('organizer', ['manageSettings', 'manageMembers', 'manageCycles', 'recordContributions', 'recordPayouts', 'viewAllRecords', 'viewContacts', 'cancelConfirmed']);
    renderAt('overview');
    expect(await screen.findByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });
});
