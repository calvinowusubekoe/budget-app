import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { api } from '@/services/api';
import { useAuth } from '@/stores/auth';
import { queryClient } from '@/app/queryClient';
import type { Workspace } from '@/types/api';
import { useSwitchWorkspace, wsKeys } from './useWorkspaces';
import { useLogout } from '@/features/auth/useAuthActions';

/** Reached from the emailed link. RequireAuth ensures the user is signed in first. */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const user = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const switchTo = useSwitchWorkspace();
  const logout = useLogout();

  const accept = useMutation({
    mutationFn: () => api<Workspace>('/workspaces/invitations/accept', { method: 'POST', body: { token } }),
    onSuccess: async (ws) => {
      await queryClient.invalidateQueries({ queryKey: wsKeys.all });
      switchTo(ws.id);
      navigate('/', { replace: true });
    },
  });

  return (
    <AuthLayout title="Join a workspace" subtitle={`You’re signed in as ${user.email}. The invitation must have been sent to this address.`}>
      {!token ? (
        <Alert tone="danger">This invitation link is incomplete. Open it from your email again.</Alert>
      ) : (
        <div className="grid gap-4">
          {accept.error && <Alert tone="danger">{accept.error.message}</Alert>}
          <Button size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>
            Accept invitation
          </Button>
          <Button variant="ghost" onClick={() => logout.mutate(false)}>
            Use a different account
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
