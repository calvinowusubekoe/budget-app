import { cn } from '@/lib/utils';

/**
 * Inset neumorphic track with a solid fill. `value` is the server's
 * percentage string; it's only used for the bar's width, never for maths.
 */
export function Progress({ value, tone = 'primary', label, className }: { value: string; tone?: 'primary' | 'gold' | 'danger'; label: string; className?: string }) {
  const pct = Math.min(Math.max(Number(value) || 0, 0), 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Number(value) || 0} aria-valuemin={0} aria-valuemax={100} className={cn('neu-inset h-2.5 overflow-hidden rounded-full', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', tone === 'primary' && 'bg-primary', tone === 'gold' && 'bg-gold', tone === 'danger' && 'bg-danger')}
        style={{ width: `${pct > 0 ? Math.max(pct, 2) : 0}%` }}
      />
    </div>
  );
}
