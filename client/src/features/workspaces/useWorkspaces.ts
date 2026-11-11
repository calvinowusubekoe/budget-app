import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useAuth } from '@/stores/auth';
import { queryClient } from '@/app/queryClient';
import type { AuditEntry, Invitation, Member, Role, Workspace, WorkspaceType } from '@/types/api';

export const wsKeys = {
  all: ['workspaces'] as const,
  members: (id: string) => ['workspaces', id, 'members'] as const,
  invitations: (id: string) => ['workspaces', id, 'invitations'] as const,
  audit: (id: string) => ['workspaces', id, 'audit'] as const,
};

export function useWorkspaces() {
  const status = useAuth((s) => s.status);
  return useQuery({
    queryKey: wsKeys.all,
    queryFn: () => api<Workspace[]>('/workspaces'),
    enabled: status === 'authenticated',
  });
}

/** The workspace the user is working in, falling back to their first one. */
export function useActiveWorkspace() {
  const activeId = useAuth((s) => s.activeWorkspaceId);
  const q = useWorkspaces();
  const list = q.data ?? [];
  const workspace = list.find((w) => w.id === activeId) ?? list[0] ?? null;
  return { workspace, workspaces: list, isLoading: q.isLoading, error: q.error };
}

export function can(workspace: Workspace | null, permission: string) {
  return Boolean(workspace?.permissions.includes(permission));
}

export function useSwitchWorkspace() {
  const setActive = useAuth((s) => s.setActiveWorkspace);
  const setUser = useAuth((s) => s.setUser);
  return (id: string) => {
    setActive(id);
    // Remember the choice on the account, not the device.
    api<{ user: import('@/types/api').User }>('/users/me', { method: 'PATCH', body: { lastWorkspaceId: id } })
      .then(({ user }) => setUser(user))
      .catch(() => undefined);
  };
}

export interface CreateWorkspaceInput {
  name: string;
  type: WorkspaceType;
  baseCurrency: string;
  business?: { legalName?: string; industry?: string };
}

export function useCreateWorkspace() {
  return useMutation({
    mutationFn: (body: CreateWorkspaceInput) => api<Workspace>('/workspaces', { method: 'POST', body: { ...body } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wsKeys.all }),
  });
}

export function useUpdateWorkspace(id: string) {
  return useMutation({
    mutationFn: (body: Partial<Pick<Workspace, 'name' | 'baseCurrency'>> & { business?: Partial<NonNullable<Workspace['business']>> }) =>
      api<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: { ...body } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wsKeys.all }),
  });
}

export function useMembers(id: string) {
  return useQuery({ queryKey: wsKeys.members(id), queryFn: () => api<Member[]>(`/workspaces/${id}/members`) });
}

export function useInvitations(id: string, enabled: boolean) {
  return useQuery({
    queryKey: wsKeys.invitations(id),
    queryFn: () => api<Invitation[]>(`/workspaces/${id}/invitations`),
    enabled,
  });
}

export function useAudit(id: string, enabled: boolean) {
  return useQuery({ queryKey: wsKeys.audit(id), queryFn: () => api<AuditEntry[]>(`/workspaces/${id}/audit?limit=30`), enabled });
}

const invalidateWs = (id: string) => queryClient.invalidateQueries({ queryKey: ['workspaces', id] });

export function useInvite(id: string) {
  return useMutation({
    mutationFn: (body: { email: string; role: Exclude<Role, 'owner'> }) =>
      api<Invitation>(`/workspaces/${id}/invitations`, { method: 'POST', body }),
    onSuccess: () => invalidateWs(id),
  });
}

export function useRevokeInvitation(id: string) {
  return useMutation({
    mutationFn: (invitationId: string) => api(`/workspaces/${id}/invitations/${invitationId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateWs(id),
  });
}

export function useChangeRole(id: string) {
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Exclude<Role, 'owner'> }) =>
      api(`/workspaces/${id}/members/${memberId}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => invalidateWs(id),
  });
}

export function useRemoveMember(id: string) {
  return useMutation({
    mutationFn: (memberId: string) => api(`/workspaces/${id}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateWs(id);
      queryClient.invalidateQueries({ queryKey: wsKeys.all });
    },
  });
}
