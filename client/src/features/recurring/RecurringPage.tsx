import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, Check, MoreHorizontal, Pause, Play, SkipForward, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd } from '@/lib/money';
import { can } from '@/features/workspaces/useWorkspaces';
import type { RecurringSchedule } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { TxBadge } from '@/features/finance/icons';
import { useScheduleMutations, useSchedules } from '@/features/planning/hooks';

export function describeEvery(s: Pick<RecurringSchedule, 'frequency' | 'interval'>) {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' }[s.frequency];
  return s.interval === 1 ? `Every ${unit}` : `Every ${s.interval} ${unit}s`;
}

export function RecurringPage() {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [showEnded, setShowEnded] = useState(false);
  const schedules = useSchedules(showEnded);
  const m = useScheduleMutations();
  const onError = (e: Error) => toast.error(e.message);
  const pendingCount = schedules.data?.reduce((n, s) => n + s.pending.length, 0) ?? 0;

  return (
    <div className="grid gap-6">
      <header>
        <Link to="/transactions" className="text-sm text-primary hover:underline">Transactions</Link>
        <h1 className="text-[28px] font-semibold">Recurring</h1>
        <p className="max-w-xl text-muted">Rent, salary, subscriptions and anything else that repeats. Choose whether each one is recorded automatically or waits for you to confirm it.</p>
      </header>

      {pendingCount > 0 && <Alert tone="gold">{pendingCount} occurrence{pendingCount === 1 ? '' : 's'} waiting for you to confirm.</Alert>}

      {schedules.isPending ? <Skeleton className="h-40 rounded-3xl" /> : schedules.error ? <Alert tone="danger">{schedules.error.message}</Alert> : schedules.data!.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarClock} title="Nothing repeats yet" action={<Button asChild><Link to="/transactions">Go to transactions</Link></Button>}>
            When you record a transaction, tick “Repeat this” to schedule it. Past dates are filled in for you straight away.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {schedules.data!.map((s) => (
            <li key={s.id} className={cn('glass rounded-3xl p-4 sm:p-5', s.status !== 'active' && 'opacity-75')}>
              <div className="flex flex-wrap items-start gap-3">
                <TxBadge type={s.type} icon={s.category?.icon} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {s.description}
                    {s.mode === 'remind' && <Badge>Asks first</Badge>}
                    {s.status === 'paused' && <Badge>Paused</Badge>}
                    {s.status === 'ended' && <Badge>Ended</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    {describeEvery(s)}, {s.type === 'transfer' ? `${s.account?.name} → ${s.toAccount?.name}` : `${s.category?.name ?? ''}, ${s.account?.name ?? ''}`}
                  </p>
                  <p className="mt-1 text-xs text-subtle">
                    {s.nextDate ? `Next on ${formatYmd(s.nextDate)}` : s.status === 'paused' ? 'Paused' : 'No more occurrences'}
                    {s.endDate ? `, ends ${formatYmd(s.endDate)}` : ''}. {s.created} recorded so far.
                  </p>
                </div>
                <span className={cn('tabular font-semibold', s.type === 'income' && 'text-primary')}>
                  {formatMoney(s.amount, s.currency, { sign: s.type === 'income' ? '+' : s.type === 'expense' ? '-' : undefined })}
                </span>
                {writable && s.status !== 'ended' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded-lg p-1.5 text-subtle hover:text-ink" aria-label={`Actions for ${s.description}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {s.status === 'active' && <DropdownMenuItem onSelect={() => m.skip.mutate(s.id, { onSuccess: () => toast.success('Next one skipped'), onError })}><SkipForward /> Skip next</DropdownMenuItem>}
                      {s.status === 'active' ? (
                        <DropdownMenuItem onSelect={() => m.update.mutate({ id: s.id, status: 'paused' }, { onSuccess: () => toast.success('Paused'), onError })}><Pause /> Pause</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => m.update.mutate({ id: s.id, status: 'active' }, { onSuccess: () => toast.success('Resumed'), onError })}><Play /> Resume</DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => m.update.mutate({ id: s.id, mode: s.mode === 'auto' ? 'remind' : 'auto' }, { onSuccess: () => toast.success('Saved'), onError })}>
                        <CalendarClock /> {s.mode === 'auto' ? 'Ask me before recording' : 'Record automatically'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => m.update.mutate({ id: s.id, status: 'ended' }, { onSuccess: () => toast.success('Schedule ended. Past records stay.'), onError })} className="text-danger"><Square className="!text-danger" /> End schedule</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {s.lastError && s.status === 'active' && (
                <Alert tone="danger" className="mt-3">
                  <span className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4" /> The last occurrence couldn’t be recorded</span>
                  <span className="text-muted">{s.lastError} Fix the cause, then choose Resume from the menu to try again.</span>
                </Alert>
              )}

              {s.pending.length > 0 && (
                <ul className="mt-3 grid gap-2">
                  {s.pending.map((date) => (
                    <li key={date} className="neu-pressed flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm">
                      <span className="flex-1">Due {formatYmd(date)}</span>
                      {writable && (
                        <>
                          <Button size="sm" loading={m.confirm.isPending && m.confirm.variables?.date === date} onClick={() => m.confirm.mutate({ id: s.id, date }, { onSuccess: () => toast.success('Recorded'), onError })}><Check /> Record it</Button>
                          <Button size="sm" variant="ghost" onClick={() => m.dismiss.mutate({ id: s.id, date }, { onSuccess: () => toast.success('Dismissed'), onError })}><X /> Not this time</Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowEnded((v) => !v)}>{showEnded ? 'Hide ended' : 'Show ended'}</Button>
    </div>
  );
}
