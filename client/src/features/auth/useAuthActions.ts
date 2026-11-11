import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '@/services/api';
import { useAuth } from '@/stores/auth';
import { queryClient } from '@/app/queryClient';
import type { AuthResult, User } from '@/types/api';
import { clearOutboxForSignOut } from '@/offline/sync';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  defaultCurrency: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  marketingConsent: boolean;
}

export function useLogin() {
  const setSession = useAuth((s) => s.setSession);
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api<AuthResult>('/auth/login', { method: 'POST', body }),
    onSuccess: ({ user, accessToken }) => {
      queryClient.clear();
      setSession(user, accessToken);
    },
  });
}

export function useRegister() {
  const setSession = useAuth((s) => s.setSession);
  return useMutation({
    mutationFn: (body: RegisterInput) => api<AuthResult>('/auth/register', { method: 'POST', body: { ...body } }),
    onSuccess: ({ user, accessToken }) => {
      queryClient.clear();
      setSession(user, accessToken);
    },
  });
}

/**
 * Ends the session server-side, then wipes every cached query so nothing
 * from this account is left in memory for the next person on the device.
 */
export function useLogout() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (everywhere: boolean = false) =>
      api(everywhere ? '/auth/logout-all' : '/auth/logout', { method: 'POST', skipRefresh: true }).catch(() => null),
    onSettled: async () => {
      // Nothing from this account stays on a shared device: cached queries and queued records both go.
      const userId = useAuth.getState().user?.id;
      if (userId) await clearOutboxForSignOut(userId).catch(() => undefined);
      queryClient.clear();
      useAuth.getState().clear();
      navigate('/login', { replace: true });
    },
  });
}

export function useUpdateProfile() {
  const setUser = useAuth((s) => s.setUser);
  return useMutation({
    mutationFn: (body: Partial<Omit<User, 'onboardingCompleted'>> & { onboardingCompleted?: true }) =>
      api<{ user: User }>('/users/me', { method: 'PATCH', body }),
    onSuccess: ({ user }) => setUser(user),
  });
}
