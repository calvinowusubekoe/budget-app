import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiBlob, saveBlob } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { useAuth } from '@/stores/auth';
import type { GroupActivity, GroupCapability, GroupContribution, GroupCycle, GroupMember, GroupPayout, GroupReport, SusuGroup } from '@/types/api';
import { sendOrQueue, type QueueInput } from '@/offline/sync';

/*
 * Group Susu hooks. Groups span several people's accounts, so these are keyed
 * by group, not workspace, and never send X-Workspace-Id. Records only:
 * nothing here moves money.
 */

const key = (...parts: unknown[]) => ['susu-groups', ...parts] as const;
const refresh = (groupId?: string) => {
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  return queryClient.invalidateQueries({ queryKey: groupId ? key(groupId) : key() });
};

export function useMyGroups() {
  const status = useAuth((s) => s.status);
  return useQuery({ queryKey: key('mine'), queryFn: () => api<SusuGroup[]>('/susu/groups'), enabled: status === 'authenticated' });
}

export function useGroup(id: string | undefined) {
  return useQuery({ queryKey: key(id), queryFn: () => api<SusuGroup>(`/susu/groups/${id}`), enabled: Boolean(id) });
}

export const can = (g: SusuGroup | undefined, c: GroupCapability) => Boolean(g?.me?.capabilities.includes(c));

export function useGroupMembers(id: string) {
  return useQuery({ queryKey: key(id, 'members'), queryFn: () => api<GroupMember[]>(`/susu/groups/${id}/members`) });
}
export function useGroupCycles(id: string) {
  return useQuery({ queryKey: key(id, 'cycles'), queryFn: () => api<GroupCycle[]>(`/susu/groups/${id}/cycles`) });
}
export function useGroupContributions(id: string, cycleId?: string) {
  return useQuery({ queryKey: key(id, 'contributions', cycleId ?? 'all'), queryFn: () => api<GroupContribution[]>(`/susu/groups/${id}/contributions${cycleId ? `?cycleId=${cycleId}` : ''}`) });
}
export function useGroupPayouts(id: string) {
  return useQuery({ queryKey: key(id, 'payouts'), queryFn: () => api<GroupPayout[]>(`/susu/groups/${id}/payouts`) });
}
export function useGroupReport(id: string) {
  return useQuery({ queryKey: key(id, 'report'), queryFn: () => api<GroupReport>(`/susu/groups/${id}/reports`) });
}
export function useGroupActivity(id: string) {
  return useQuery({ queryKey: key(id, 'activity'), queryFn: () => api<GroupActivity[]>(`/susu/groups/${id}/activity?limit=150`) });
}

export function useCreateGroup() {
  return useMutation({ mutationFn: (body: Record<string, unknown>) => api<SusuGroup>('/susu/groups', { method: 'POST', body }), onSuccess: () => refresh() });
}

export function useGroupMutations(id: string) {
  const done = () => refresh(id);
  const m = <B extends Record<string, unknown>, R = unknown>(fn: (b: B) => Promise<R>) => useMutation({ mutationFn: fn, onSuccess: done });
  return {
    update: m((body: Record<string, unknown>) => api<SusuGroup>(`/susu/groups/${id}`, { method: 'PATCH', body })),
    addMember: m((body: { displayName: string; phone?: string; role?: string }) => api<GroupMember>(`/susu/groups/${id}/members`, { method: 'POST', body })),
    invite: m((body: { email: string; displayName?: string; memberId?: string; role?: string }) => api<GroupMember>(`/susu/groups/${id}/invitations`, { method: 'POST', body })),
    updateMember: m(({ memberId, ...body }: { memberId: string } & Record<string, unknown>) => api<GroupMember>(`/susu/groups/${id}/members/${memberId}`, { method: 'PATCH', body })),
    generate: m((_: Record<string, never>) => api<GroupCycle[]>(`/susu/groups/${id}/cycles`, { method: 'POST', body: { generate: true } })),
    addCycle: m((body: { recipientMemberId: string; dueDate?: string }) => api<GroupCycle>(`/susu/groups/${id}/cycles`, { method: 'POST', body })),
    updateCycle: m(({ cycleId, ...body }: { cycleId: string; reason: string } & Record<string, unknown>) => api<GroupCycle>(`/susu/groups/${id}/cycles/${cycleId}`, { method: 'PATCH', body })),
    // Kept on this device when there's no connection (see src/offline).
    recordContribution: m(async ({ cycleId, idempotencyKey, summary, ...body }: { cycleId: string; memberId: string; amount: string; date: string; notes?: string; idempotencyKey: string; summary: QueueInput['summary'] }) => {
      const r = await sendOrQueue<GroupContribution>({ kind: 'group_contribution', workspaceId: null, path: `/susu/groups/${id}/cycles/${cycleId}/contributions`, body, idempotencyKey, summary });
      return { queued: r.queued };
    }),
    recordPayout: m(({ cycleId, ...body }: { cycleId: string; actualAmount: string; payoutDate: string; confirmationDetails?: string; notes?: string }) =>
      api<GroupPayout>(`/susu/groups/${id}/cycles/${cycleId}/payouts`, { method: 'POST', body }),
    ),
    act: m(({ kind, recordId, ...body }: { kind: 'contribution' | 'payout'; recordId: string; action: 'confirm' | 'dispute' | 'cancel' | 'correct'; reason?: string } & Record<string, unknown>) =>
      api(`/susu/groups/${id}/${kind === 'contribution' ? 'contributions' : 'payouts'}/${recordId}`, { method: 'PATCH', body }),
    ),
  };
}

export const ROLE_LABEL: Record<string, string> = { organizer: 'Organiser', assistant: 'Assistant organiser', member: 'Member' };
export const STATUS_LABEL: Record<string, string> = { recorded: 'Awaiting confirmation', confirmed: 'Confirmed by member', disputed: 'Disputed', cancelled: 'Cancelled' };

/** Attach a receipt or screenshot of the external payment to a contribution or payout record. */
export function useRecordProof(groupId: string) {
  return useMutation({
    mutationFn: ({ kind, recordId, file }: { kind: 'contribution' | 'payout'; recordId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api(`/susu/groups/${groupId}/${kind === 'contribution' ? 'contributions' : 'payouts'}/${recordId}/proof`, { method: 'POST', form });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['susu-groups', groupId] }),
  });
}

/** Downloads the proof, like every other attachment in Kontaa. */
export async function downloadRecordProof(groupId: string, kind: 'contribution' | 'payout', recordId: string, name: string) {
  saveBlob(await apiBlob(`/susu/groups/${groupId}/${kind === 'contribution' ? 'contributions' : 'payouts'}/${recordId}/proof`), name);
}
