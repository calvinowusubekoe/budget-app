import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/stores/auth';
import { Spinner } from '@/components/ui/feedback';
import { Unreachable } from '@/offline/Unreachable';

/** Signed-in area. New accounts go through onboarding first. */
export function RequireAuth({ allowOnboarding = false }: { allowOnboarding?: boolean }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner label="Restoring your session" />;
  if (status === 'unreachable') return <Unreachable />;
  if (status === 'guest' || !user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />;
  }
  if (!user.onboardingCompleted && !allowOnboarding) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function GuestOnly() {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <Spinner label="Restoring your session" />;
  if (status === 'unreachable') return <Unreachable />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Only follow same-site relative paths after sign-in, never absolute URLs. */
export function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
