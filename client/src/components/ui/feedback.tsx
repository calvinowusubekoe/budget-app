import * as React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'danger' | 'gold';

const toneClass: Record<Tone, string> = {
  info: 'bg-primary-soft text-ink',
  success: 'bg-primary-soft text-ink',
  danger: 'bg-danger-soft text-ink',
  gold: 'bg-gold-soft text-ink',
};
const toneIcon: Record<Tone, React.ElementType> = { info: Info, success: CheckCircle2, danger: AlertCircle, gold: Info };
const iconColor: Record<Tone, string> = { info: 'text-primary', success: 'text-success', danger: 'text-danger', gold: 'text-gold-ink' };

export function Alert({ tone = 'info', children, className, action }: { tone?: Tone; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl px-4 py-3 text-sm', toneClass[tone], className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconColor[tone])} aria-hidden />
      <div className="min-w-0 flex-1 basis-48">{children}</div>
      {action && <div className="pl-7 sm:pl-0">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-line', className)} aria-hidden />;
}

export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'gold'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'neu-pressed text-muted',
        tone === 'primary' && 'bg-primary-soft text-primary',
        tone === 'gold' && 'bg-gold-soft text-gold-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: React.ElementType; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="neu-raised mb-4 grid size-14 place-items-center rounded-2xl text-primary">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center">
      <div className="neu-raised grid size-14 place-items-center rounded-full">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
