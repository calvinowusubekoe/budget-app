import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, PiggyBank, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Progress } from '@/components/ui/progress';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd, todayYmd } from '@/lib/money';
import { applyFieldErrors } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { SavingsGoal } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { useGoals, useGoalTrend, useSaveGoal } from '@/features/planning/hooks';
import { LedgerPanel } from '@/features/planning/LedgerPanel';

const PER = { weekly: 'week', monthly: 'month', quarterly: 'quarter', none: '' } as const;

export function SavingsPage() {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [showArchived, setShowArchived] = useState(false);
  const goals = useGoals(showArchived);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const goal = goals.data?.find((g) => g.id === selected) ?? null;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">Savings goals</h1>
          <p className="max-w-xl text-muted">Track progress toward things you’re saving for. Entries here are your own record of what you set aside; the money stays wherever you keep it.</p>
        </div>
        {writable && <Button onClick={() => setOpen(true)}><Plus /> New goal</Button>}
      </header>

      {goals.isPending ? <Skeleton className="h-44 rounded-3xl" /> : goals.error ? <Alert tone="danger">{goals.error.message}</Alert> : goals.data!.length === 0 ? (
        <Card>
          <EmptyState icon={PiggyBank} title="No savings goals yet" action={writable && <Button onClick={() => setOpen(true)}><Plus /> Set a goal</Button>}>
            For example, school fees for next term, a new phone, or an emergency fund. Add a target date to see how much to set aside each month.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.data!.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => setSelected(g.id)} className={cn('glass flex w-full flex-col gap-3 rounded-3xl p-5 text-left transition hover:brightness-105', g.status === 'archived' && 'opacity-70')}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{g.name}</span>
                  {g.summary.reached ? <Badge tone="primary">Reached</Badge> : g.summary.overdue ? <Badge tone="gold">Past target date</Badge> : g.status === 'archived' ? <Badge>Archived</Badge> : null}
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabular text-2xl font-semibold tracking-tight">{formatMoney(g.summary.current, g.currency)}</span>
                  <span className="tabular text-sm text-muted">of {formatMoney(g.targetAmount, g.currency)}</span>
                </div>
                <Progress value={g.summary.progress} label={`${g.name}: ${g.summary.progress}%`} tone={g.summary.reached ? 'primary' : 'gold'} />
                <p className="text-sm text-muted">
                  {g.summary.reached
                    ? 'Target reached.'
                    : g.summary.requiredPerPeriod
                      ? `Set aside ${formatMoney(g.summary.requiredPerPeriod, g.currency)} a ${PER[g.contributionFrequency]} to reach it by ${formatYmd(g.targetDate!)}.`
                      : `${formatMoney(g.summary.remaining, g.currency)} to go.`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide archived' : 'Show archived'}</Button>
      <GoalDialog open={open} onOpenChange={setOpen} />
      <GoalDetail goal={goal} writable={writable} onClose={() => setSelected(null)} />
    </div>
  );
}

function GoalDetail({ goal, writable, onClose }: { goal: SavingsGoal | null; writable: boolean; onClose: () => void }) {
  const trend = useGoalTrend(goal?.id ?? null);
  const save = useSaveGoal();
  const [editing, setEditing] = useState(false);
  if (!goal) return null;
  const s = goal.summary;
  return (
    <Dialog open={Boolean(goal)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogTitle>{goal.name}</DialogTitle>
        <DialogDescription>{goal.description || (goal.targetDate ? `Target ${formatYmd(goal.targetDate)}` : 'No target date')}</DialogDescription>

        <div className="neu-inset mt-5 grid gap-3 rounded-2xl p-4">
          <div className="flex items-baseline justify-between">
            <span className="tabular text-3xl font-semibold tracking-tight">{formatMoney(s.current, goal.currency)}</span>
            <span className="tabular text-muted">{s.progress}% of {formatMoney(goal.targetAmount, goal.currency)}</span>
          </div>
          <Progress value={s.progress} label="Progress" tone={s.reached ? 'primary' : 'gold'} />
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">Put in</dt><dd className="tabular font-medium">{formatMoney(s.contributed, goal.currency)}</dd></div>
            <div><dt className="text-muted">Taken out</dt><dd className="tabular font-medium">{formatMoney(s.withdrawn, goal.currency)}</dd></div>
            <div><dt className="text-muted">Still to go</dt><dd className="tabular font-medium">{formatMoney(s.remaining, goal.currency)}</dd></div>
          </dl>
          {!s.reached && (s.projectedDate || s.requiredPerPeriod) && (
            <p className="text-sm text-muted">
              {s.projectedDate && <>At your pace so far you’d reach it around <strong className="text-ink">{formatYmd(s.projectedDate)}</strong> (an estimate). </>}
              {s.requiredPerPeriod && <>To hit the target date, set aside <strong className="text-ink">{formatMoney(s.requiredPerPeriod, goal.currency)}</strong> each {PER[goal.contributionFrequency]}.</>}
              {s.onTrack === false && <Badge tone="gold" className="ml-1">Behind schedule</Badge>}
            </p>
          )}
        </div>

        {trend.data && trend.data.some((m) => m.net !== '0.00' && m.net !== '0') && (
          <section aria-label="Saved per month" className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Saved per month</h3>
            <div className="flex h-20 items-end gap-1" role="img" aria-label="Net saved in each of the last 12 months">
              {(() => {
                const vals = trend.data.map((m) => Number(m.net));
                const max = Math.max(...vals.map(Math.abs), 1);
                return trend.data.map((m, i) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${m.month}: ${formatMoney(m.net, goal.currency)}`}>
                    <div className={cn('w-full rounded-t-md', vals[i]! < 0 ? 'bg-danger/70' : 'bg-gold')} style={{ height: `${(Math.abs(vals[i]!) / max) * 64}px`, minHeight: vals[i] ? 3 : 0 }} />
                    <span className="text-[10px] text-subtle">{m.month.slice(5)}</span>
                  </div>
                ));
              })()}
            </div>
          </section>
        )}

        <h3 className="mt-5 mb-2 text-sm font-semibold">Entries</h3>
        <LedgerPanel
          kind="savings"
          id={goal.id}
          currency={goal.currency}
          writable={writable && goal.status === 'active'}
          types={[{ value: 'contribution', label: 'Put in', sign: '+' }, { value: 'withdrawal', label: 'Take out', sign: '-' }]}
          note="This records your progress only. If money moved between accounts, record a transfer too."
        />

        {writable && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
            <Button size="sm" variant="neu" onClick={() => setEditing(true)}>Edit goal</Button>
            {goal.status === 'active' ? (
              <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: goal.id, status: 'archived' }, { onSuccess: () => { toast.success('Goal archived'); onClose(); } })}><Archive /> Archive</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: goal.id, status: 'active' }, { onSuccess: () => toast.success('Goal restored') })}><ArchiveRestore /> Restore</Button>
            )}
          </div>
        )}
        <GoalDialog open={editing} onOpenChange={setEditing} goal={goal} />
      </DialogContent>
    </Dialog>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name the goal.').max(80),
  description: z.string().max(500),
  targetAmount: z.string(),
  currency: z.string().length(3),
  targetDate: z.string(),
  contributionFrequency: z.enum(['weekly', 'monthly', 'quarterly', 'none']),
});
type Values = z.infer<typeof schema>;

function GoalDialog({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (o: boolean) => void; goal?: SavingsGoal }) {
  const ws = useWs();
  const save = useSaveGoal();
  const defaults = (): Values => ({
    name: goal?.name ?? '',
    description: goal?.description ?? '',
    targetAmount: goal?.targetAmount ?? '',
    currency: goal?.currency ?? ws.workspace?.baseCurrency ?? 'GHS',
    targetDate: goal?.targetDate ?? '',
    contributionFrequency: goal?.contributionFrequency ?? 'monthly',
  });
  const { register, handleSubmit, reset, setError, formState, watch } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const currency = watch('currency');
  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  const onSubmit = handleSubmit((v) => {
    const targetAmount = cleanAmount(v.targetAmount);
    const err = amountError(targetAmount, v.currency);
    if (err) return setError('targetAmount', { message: err });
    const body = { ...v, targetAmount, targetDate: v.targetDate || null, ...(goal && goal.summary.entryCount > 0 ? { currency: undefined } : {}) };
    save.mutate(goal ? { id: goal.id, ...body } : body, {
      onSuccess: () => { toast.success(goal ? 'Goal saved' : 'Goal created'); onOpenChange(false); },
      onError: (e) => { if (!applyFieldErrors(e, setError)) toast.error(e.message); },
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{goal ? 'Edit goal' : 'New savings goal'}</DialogTitle>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="What are you saving for?" htmlFor="g-name" error={formState.errors.name?.message} className="sm:col-span-2"><Input id="g-name" placeholder="e.g. Kofi’s school fees" {...register('name')} /></Field>
          <Field label="Target amount" htmlFor="g-target" error={formState.errors.targetAmount?.message}><Input id="g-target" inputMode="decimal" className="tabular" {...register('targetAmount')} /></Field>
          <Field label="Currency" htmlFor="g-cur" hint={goal && goal.summary.entryCount > 0 ? 'Locked: entries exist.' : undefined}><CurrencySelect id="g-cur" disabled={Boolean(goal && goal.summary.entryCount > 0)} {...register('currency')} /></Field>
          <Field label="Target date (optional)" htmlFor="g-date" error={formState.errors.targetDate?.message}><Input id="g-date" type="date" min={todayYmd()} {...register('targetDate')} /></Field>
          <Field label="I’ll save every" htmlFor="g-freq">
            <Select id="g-freq" {...register('contributionFrequency')}>
              <option value="weekly">Week</option>
              <option value="monthly">Month</option>
              <option value="quarterly">Quarter</option>
              <option value="none">No set schedule</option>
            </Select>
          </Field>
          <Field label="Notes (optional)" htmlFor="g-desc" className="sm:col-span-2"><Input id="g-desc" placeholder={`Where you keep it, e.g. Fidelity savings (${currency})`} {...register('description')} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{goal ? 'Save goal' : 'Create goal'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
