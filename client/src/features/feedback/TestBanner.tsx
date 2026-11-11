import { Link } from 'react-router';
import { FlaskConical } from 'lucide-react';
import { useMeta } from '@/hooks/useMeta';
import { cn } from '@/lib/utils';

/** Shown on every screen of a tester build, so nobody mistakes it for the real thing. */
export function TestBanner({ className }: { className?: string }) {
  const { stage } = useMeta();
  if (stage !== 'test') return null;
  return (
    <div role="note" className={cn('flex items-start gap-2 rounded-2xl bg-gold-soft px-4 py-2 text-sm', className)}>
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
      <p>
        <strong className="font-medium">Test version.</strong> Use made-up details, not your real finances. Payments are switched off.{' '}
        <Link to="/guide" className="font-medium whitespace-nowrap text-primary hover:underline">
          Tester guide
        </Link>
      </p>
    </div>
  );
}
