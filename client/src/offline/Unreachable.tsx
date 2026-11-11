import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { refreshSession } from '@/services/api';

/**
 * Shown when Kontaa couldn't be reached to check the session (usually offline at startup).
 * Nothing is signed out, and records saved on this device stay queued.
 */
export function Unreachable() {
  const [trying, setTrying] = useState(false);
  const retry = async () => {
    setTrying(true);
    await refreshSession();
    setTrying(false);
  };
  useEffect(() => {
    const on = () => void retry();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);
  return (
    <AuthLayout title="Can’t reach Kontaa" subtitle="Opening your account needs a connection. You haven’t been signed out.">
      <div className="grid gap-4">
        <p className="flex items-start gap-2 text-sm text-muted">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
          Records you saved on this device are kept and will sync once you’re connected and open Kontaa. This page tries again by itself when the connection returns.
        </p>
        <Button size="lg" className="w-full" loading={trying} onClick={() => void retry()}>
          Try again
        </Button>
      </div>
    </AuthLayout>
  );
}
