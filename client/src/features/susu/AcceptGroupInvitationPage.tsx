import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { formatMoney } from '@/lib/money';
import { api } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { useAuth } from '@/stores/auth';
import { useLogout } from '@/features/auth/useAuthActions';
import type { SusuGroup } from '@/types/api';

const EVERY: Record<string, string> = { daily: 'every day', weekly: 'every week', monthly: 'every month', custom: 'every few days' };

interface Preview {
  groupName: string;
  inviterName: string;
  currency: string;
  contributionAmount: string;
  frequency: string;
  email: string;
}

export function AcceptGroupInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const user = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const logout = useLogout();
  const preview = useQuery({ queryKey: ['susu-invite', token], queryFn: () => api<Preview>(`/susu/invitations/${encodeURIComponent(token)}`), enabled: Boolean(token), retry: false });
  const accept = useMutation({
    mutationFn: () => api<SusuGroup>(`/susu/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    onSuccess: async (g) => {
      await queryClient.invalidateQueries({ queryKey: ['susu-groups'] });
      navigate(`/susu/groups/${g.id}`, { replace: true });
    },
  });

  const p = preview.data;
  return (
    <AuthLayout title="Join a Susu group" subtitle={`Signed in as ${user.email}. The invitation must be for this address.`}>
      {!token ? (
        <Alert tone="danger">This invitation link is incomplete. Open it from your email again.</Alert>
      ) : preview.isPending ? (
        <Skeleton className="h-24" />
      ) : preview.error ? (
        <Alert tone="danger">{preview.error.message}</Alert>
      ) : (
        <div className="grid gap-4">
          <div className="neu-inset rounded-2xl p-4 text-sm">
            <p className="font-semibold">{p!.groupName}</p>
            <p className="text-muted">{p!.inviterName} invited you. Each member contributes {formatMoney(p!.contributionAmount, p!.currency)} {EVERY[p!.frequency] ?? 'regularly'}.</p>
          </div>
          <Alert tone="info">Joining lets you see the schedule and confirm or dispute the records kept for you. You keep paying the way your group agrees; Kontaa never handles Susu money.</Alert>
          {accept.error && <Alert tone="danger">{accept.error.message}</Alert>}
          <Button size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>Join the group</Button>
          <Button variant="ghost" onClick={() => logout.mutate(false)}>Use a different account</Button>
        </div>
      )}
    </AuthLayout>
  );
}
