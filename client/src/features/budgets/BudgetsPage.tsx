import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Archive, MoreHorizontal, Pause, Pencil, Play, Plus, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd } from '@/lib/money';
import { applyFieldErrors } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { Budget } from '@/types/api';
import { useCategories, useWs } from '@/features/finance/hooks';
import { CategoryIcon } from '@/features/finance/icons';
import { useBudgetHistory, useBudgets, useSaveBudget } from '@/features/planning/hooks';

const PERIOD_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' } as const;
const PERIOD_NOUN = { weekly: 'week', monthly: 'month', yearly: 'year' } as const;

const tone = (b: Budget) => (b.current.state === 'over' ? 'danger' : b.current.state === 'warning' ? 'gold' : 'primary');

export function BudgetsPage() {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [params] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const budgets = useBudgets(showArchived);
  const save = useSaveBudget();
  const [dialog, setDialog] = useState<{ open: boolean; budget?: Budget | null }>({ open: false });
  const [historyFor, setHistoryFor] = useState<string | null>(params.get('focus'));

  const visible = budgets.data?.filter((b) => (showArchived ? true : b.status !== 'archived')) ?? [];
  const act = (b: Budget, status: Budget['status'], msg: string) => save.mutate({ id: b.id, status }, { onSuccess: () => toast.success(msg), onError: (e) => toast.error(e.message) });

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">Budgets</h1>
          <p className="max-w-xl text-muted">Set a limit for a week, month or year, for all spending or just some categories. Totals are in {ws.workspace?.baseCurrency}.</p>
        </div>
        {writable && <Button onClick={() => setDialog({ open: true, budget: null })}><Plus /> New budget</Button>}
      </header>

      {budgets.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-44 rounded-3xl" />)}</div>
      ) : budgets.error ? (
        <Alert tone="danger">{budgets.error.message}</Alert>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState icon={Target} title="No budgets yet" action={writable && <Button onClick={() => setDialog({ open: true, budget: null })}><Plus /> Create a budget</Button>}>
            Start with one category you want to keep an eye on, like food or transport. You’ll get a notice when spending reaches your warning level.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {visible.map((b) => (
            <li key={b.id} className={cn('glass flex flex-col gap-4 rounded-3xl p-5', b.status !== 'active' && 'opacity-75')}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <span className="truncate">{b.name}</span>
                    {b.status === 'paused' && <Badge>Paused</Badge>}
                    {b.status === 'archived' && <Badge>Archived</Badge>}
                  </h2>
                  <p className="truncate text-sm text-muted">
                    {PERIOD_LABEL[b.period]}, {b.scope === 'all' ? 'all spending' : b.categories.map((c) => c.name).join(', ')}
                  </p>
                </div>
                {writable && (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded-lg p-1.5 text-subtle hover:text-ink" aria-label={`Actions for ${b.name}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDialog({ open: true, budget: b })}><Pencil /> Edit</DropdownMenuItem>
                      {b.status === 'active' && <DropdownMenuItem onSelect={() => act(b, 'paused', 'Budget paused')}><Pause /> Pause alerts</DropdownMenuItem>}
                      {b.status !== 'active' && <DropdownMenuItem onSelect={() => act(b, 'active', 'Budget resumed')}><Play /> Resume</DropdownMenuItem>}
                      {b.status !== 'archived' && <DropdownMenuItem onSelect={() => act(b, 'archived', 'Budget archived')}><Archive /> Archive</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="tabular text-2xl font-semibold tracking-tight">{formatMoney(b.current.spent, b.currency)}</p>
                  <p className="tabular text-sm text-muted">of {formatMoney(b.current.amount, b.currency)}</p>
                </div>
                <Progress value={b.current.utilisation} tone={tone(b)} label={`${b.name}: ${b.current.utilisation}% used`} />
                <p className={cn('mt-2 text-sm', b.current.state === 'over' ? 'text-danger' : 'text-muted')}>
                  {b.current.state === 'over'
                    ? `${formatMoney(b.current.remaining.replace('-', ''), b.currency)} over, with ${b.current.daysLeft} day${b.current.daysLeft === 1 ? '' : 's'} left this ${PERIOD_NOUN[b.period]}`
                    : `${formatMoney(b.current.remaining, b.currency)} left, ${b.current.daysLeft} day${b.current.daysLeft === 1 ? '' : 's'} to go`}
                  <span className="text-subtle"> ({b.current.utilisation}% used)</span>
                </p>
              </div>

              <Button variant="ghost" size="sm" className="self-start" onClick={() => setHistoryFor(historyFor === b.id ? null : b.id)} aria-expanded={historyFor === b.id}>
                {historyFor === b.id ? 'Hide past periods' : 'Compare with past periods'}
              </Button>
              {historyFor === b.id && <History budget={b} />}
            </li>
          ))}
        </ul>
      )}

      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide archived' : 'Show archived'}</Button>
      <BudgetDialog open={dialog.open} budget={dialog.budget} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </div>
  );
}

function History({ budget }: { budget: Budget }) {
  const h = useBudgetHistory(budget.id, 6);
  if (h.isPending) return <Skeleton className="h-32" />;
  if (h.error) return <Alert tone="danger">{h.error.message}</Alert>;
  return (
    <ol className="grid gap-2.5" aria-label="Past periods">
      {h.data!.map((p, i) => (
        <li key={p.key} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className={cn('text-muted', i === 0 && 'font-medium text-ink')}>
            {i === 0 ? 'Now' : budget.period === 'monthly' ? formatYmd(p.start, { month: 'short', year: 'numeric' }) : budget.period === 'yearly' ? p.start.slice(0, 4) : formatYmd(p.start, { day: 'numeric', month: 'short' })}
          </span>
          <Progress value={p.utilisation} tone={p.state === 'over' ? 'danger' : p.state === 'warning' ? 'gold' : 'primary'} label={`${p.utilisation}% of ${p.amount}`} className="h-2" />
          <span className="tabular w-28 text-right text-xs text-muted">{formatMoney(p.spent, budget.currency)} / {formatMoney(p.amount, budget.currency)}</span>
        </li>
      ))}
    </ol>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name the budget.').max(80),
  period: z.enum(['weekly', 'monthly', 'yearly']),
  scope: z.enum(['all', 'categories']),
  categoryIds: z.array(z.string()),
  amount: z.string(),
  alertAt: z.coerce.number().int().min(1).max(100),
  notes: z.string().max(500),
});
type Values = z.input<typeof schema>;

function BudgetDialog({ open, onOpenChange, budget }: { open: boolean; onOpenChange: (o: boolean) => void; budget?: Budget | null }) {
  const ws = useWs();
  const currency = ws.workspace?.baseCurrency ?? 'GHS';
  const categories = useCategories();
  const save = useSaveBudget();
  const expenseCats = (categories.data ?? []).filter((c) => c.kind === 'expense');
  const defaults = (): Values => ({
    name: budget?.name ?? '',
    period: budget?.period ?? 'monthly',
    scope: budget?.scope ?? 'categories',
    categoryIds: budget?.categories.map((c) => c.id) ?? [],
    amount: budget?.current.amount ?? '',
    alertAt: budget?.alertAt ?? 80,
    notes: budget?.notes ?? '',
  });
  const { register, handleSubmit, control, watch, reset, setError, formState } = useForm<Values, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const scope = watch('scope');
  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, budget?.id]);

  const onSubmit = handleSubmit((v) => {
    const amount = cleanAmount(v.amount);
    const err = amountError(amount, currency);
    if (err) return setError('amount', { message: err });
    if (v.scope === 'categories' && v.categoryIds.length === 0) return setError('categoryIds', { message: 'Choose at least one category.' });
    const body = { ...v, amount, categoryIds: v.scope === 'all' ? [] : v.categoryIds };
    save.mutate(budget ? { id: budget.id, ...body, period: undefined } : body, {
      onSuccess: () => { toast.success(budget ? 'Budget saved' : 'Budget created'); onOpenChange(false); },
      onError: (e) => { if (!applyFieldErrors(e, setError)) toast.error(e.message); },
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogTitle>{budget ? 'Edit budget' : 'New budget'}</DialogTitle>
        <DialogDescription>{budget ? 'A new limit applies from this period on. Past periods keep the limit they had.' : 'Spending is counted in the reporting currency, using each record’s saved rate.'}</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4">
          <Field label="Name" htmlFor="b-name" error={formState.errors.name?.message}><Input id="b-name" placeholder="e.g. Food and market" {...register('name')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Period" htmlFor="b-period" hint={budget ? 'Can’t change after creation.' : undefined}>
              <Select id="b-period" disabled={Boolean(budget)} {...register('period')}>
                <option value="weekly">Every week (Mon–Sun)</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </Select>
            </Field>
            <Field label={`Limit (${currency})`} htmlFor="b-amount" error={formState.errors.amount?.message}>
              <Input id="b-amount" inputMode="decimal" className="tabular" placeholder="1500.00" {...register('amount')} />
            </Field>
          </div>
          <Field label="Covers" htmlFor="b-scope">
            <Select id="b-scope" {...register('scope')}>
              <option value="categories">Chosen categories</option>
              <option value="all">All spending</option>
            </Select>
          </Field>
          {scope === 'categories' && (
            <fieldset className="neu-inset rounded-2xl p-3">
              <legend className="sr-only">Categories</legend>
              <Controller
                control={control}
                name="categoryIds"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2">
                    {expenseCats.map((c) => {
                      const on = field.value.includes(c.id);
                      return (
                        <button key={c.id} type="button" aria-pressed={on} onClick={() => field.onChange(on ? field.value.filter((x) => x !== c.id) : [...field.value, c.id])} className={cn('inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition', on ? 'bg-primary text-primary-fg' : 'neu-raised-sm text-muted hover:text-ink')}>
                          <CategoryIcon icon={c.icon} className="size-3.5" /> {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
              {formState.errors.categoryIds && <p role="alert" className="mt-2 text-[13px] text-danger">{formState.errors.categoryIds.message}</p>}
            </fieldset>
          )}
          <Field label="Warn me at (% of limit)" htmlFor="b-alert" hint="You’ll also be told if spending goes over the limit.">
            <Input id="b-alert" type="number" min={1} max={100} className="w-28" {...register('alertAt')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{budget ? 'Save budget' : 'Create budget'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
