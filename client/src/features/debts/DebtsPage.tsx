import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, CreditCard, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Progress } from '@/components/ui/progress';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd, isZero, todayYmd } from '@/lib/money';
import { applyFieldErrors } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { Debt } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { useDebts, useSaveDebt } from '@/features/planning/hooks';
import { LedgerPanel } from '@/features/planning/LedgerPanel';

export function DebtsPage() {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [showArchived, setShowArchived] = useState(false);
  const debts = useDebts(showArchived);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const owe = debts.data?.filter((d) => d.direction === 'i_owe') ?? [];
  const owed = debts.data?.filter((d) => d.direction === 'owed_to_me') ?? [];
  const debt = debts.data?.find((d) => d.id === selected) ?? null;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">Debts</h1>
          <p className="max-w-xl text-muted">Loans, credit and money lent to others. Record payments here to keep a running balance.</p>
        </div>
        {writable && <Button onClick={() => setOpen(true)}><Plus /> Add a debt</Button>}
      </header>

      {debts.isPending ? <Skeleton className="h-44 rounded-3xl" /> : debts.error ? <Alert tone="danger">{debts.error.message}</Alert> : debts.data!.length === 0 ? (
        <Card>
          <EmptyState icon={CreditCard} title="No debts tracked" action={writable && <Button onClick={() => setOpen(true)}><Plus /> Add a debt</Button>}>
            Add a bank loan, a phone on credit, or money you lent a friend. You’ll see what’s left, what’s overdue and when it might be paid off.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Column title="You owe" description="Loans and credit you’re paying back." items={owe} onOpen={setSelected} />
          <Column title="Owed to you" description="Money others are paying you back." items={owed} onOpen={setSelected} />
        </div>
      )}

      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide archived' : 'Show archived'}</Button>
      <DebtDialog open={open} onOpenChange={setOpen} />
      <DebtDetail debt={debt} writable={writable} onClose={() => setSelected(null)} />
    </div>
  );
}

function Column({ title, description, items, onOpen }: { title: string; description: string; items: Debt[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div></CardHeader>
      {items.length === 0 ? <p className="text-sm text-muted">Nothing here.</p> : (
        <ul className="grid gap-3">
          {items.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onOpen(d.id)} className={cn('neu-raised-sm grid w-full gap-2 rounded-2xl p-4 text-left', d.status !== 'active' && 'opacity-70')}>
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.name}</span>
                    {d.counterparty && <span className="block truncate text-xs text-muted">{d.counterparty}</span>}
                  </span>
                  {d.status === 'paid_off' ? <Badge tone="primary">Paid off</Badge> : d.summary.overdue ? <Badge tone="gold">Overdue</Badge> : d.status === 'archived' ? <Badge>Archived</Badge> : null}
                </span>
                <span className="flex items-baseline justify-between">
                  <span className="tabular text-xl font-semibold">{formatMoney(d.summary.balance, d.currency)}</span>
                  <span className="tabular text-xs text-muted">{d.summary.paidPercent}% repaid</span>
                </span>
                <Progress value={d.summary.paidPercent} label={`${d.name}: ${d.summary.paidPercent}% repaid`} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DebtDetail({ debt, writable, onClose }: { debt: Debt | null; writable: boolean; onClose: () => void }) {
  const save = useSaveDebt();
  const [editing, setEditing] = useState(false);
  if (!debt) return null;
  const s = debt.summary;
  const owe = debt.direction === 'i_owe';
  return (
    <Dialog open={Boolean(debt)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogTitle>{debt.name}</DialogTitle>
        <DialogDescription>
          {owe ? 'You owe' : 'Owed to you by'} {debt.counterparty || 'someone'}, since {formatYmd(debt.startDate)}
          {debt.dueDate ? `, due ${formatYmd(debt.dueDate)}` : ''}.
        </DialogDescription>
        <div className="neu-inset mt-5 grid gap-3 rounded-2xl p-4">
          <div className="flex items-baseline justify-between">
            <span className={cn('tabular text-3xl font-semibold tracking-tight', s.overdue && 'text-danger')}>{formatMoney(s.balance, debt.currency)}</span>
            <span className="text-sm text-muted">left to {owe ? 'pay' : 'receive'}</span>
          </div>
          <Progress value={s.paidPercent} label="Repaid" />
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Borrowed</dt><dd className="tabular font-medium">{formatMoney(debt.principal, debt.currency)}</dd></div>
            <div><dt className="text-muted">Interest and fees</dt><dd className="tabular font-medium">{formatMoney(s.charges, debt.currency)}</dd></div>
            <div><dt className="text-muted">Repaid</dt><dd className="tabular font-medium">{formatMoney(s.paid, debt.currency)}</dd></div>
            {debt.interestRate && <div><dt className="text-muted">Rate</dt><dd className="tabular font-medium">{debt.interestRate}% a year</dd></div>}
          </dl>
          {s.projectedPayoff && <p className="text-sm text-muted">At the pace so far, it would be cleared around <strong className="text-ink">{formatYmd(s.projectedPayoff)}</strong> (an estimate).</p>}
          {s.overdue && <p className="text-sm text-danger">The due date has passed.</p>}
        </div>
        <h3 className="mt-5 mb-2 text-sm font-semibold">Payments and charges</h3>
        <LedgerPanel
          kind="debt"
          id={debt.id}
          currency={debt.currency}
          writable={writable && debt.status !== 'archived'}
          types={[{ value: 'payment', label: owe ? 'Payment made' : 'Payment received', sign: '-' }, { value: 'charge', label: 'Interest or fee', sign: '+' }]}
          note="Interest isn’t calculated automatically. Add it as a charge when the lender applies it. Record the money moving in Transactions too."
        />
        {writable && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
            <Button size="sm" variant="neu" onClick={() => setEditing(true)}>Edit details</Button>
            {debt.status !== 'archived' ? (
              <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: debt.id, status: 'archived' }, { onSuccess: () => { toast.success('Debt archived'); onClose(); } })}><Archive /> Archive</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: debt.id, status: 'active' }, { onSuccess: () => toast.success('Debt restored') })}><ArchiveRestore /> Restore</Button>
            )}
          </div>
        )}
        <DebtDialog open={editing} onOpenChange={setEditing} debt={debt} />
      </DialogContent>
    </Dialog>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name it.').max(80),
  direction: z.enum(['i_owe', 'owed_to_me']),
  counterparty: z.string().max(80),
  principal: z.string(),
  currency: z.string().length(3),
  interestRate: z.string().regex(/^(\d{1,3}(\.\d{1,4})?)?$/, 'Enter a yearly rate like 24 or 18.5.'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  dueDate: z.string(),
});
type Values = z.infer<typeof schema>;

function DebtDialog({ open, onOpenChange, debt }: { open: boolean; onOpenChange: (o: boolean) => void; debt?: Debt }) {
  const ws = useWs();
  const save = useSaveDebt();
  const locked = Boolean(debt && (debt.summary.paymentCount > 0 || !isZero(debt.summary.charges)));
  const defaults = (): Values => ({
    name: debt?.name ?? '',
    direction: debt?.direction ?? 'i_owe',
    counterparty: debt?.counterparty ?? '',
    principal: debt?.principal ?? '',
    currency: debt?.currency ?? ws.workspace?.baseCurrency ?? 'GHS',
    interestRate: debt?.interestRate ?? '',
    startDate: debt?.startDate ?? todayYmd(),
    dueDate: debt?.dueDate ?? '',
  });
  const { register, handleSubmit, reset, setError, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });
  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debt?.id]);

  const onSubmit = handleSubmit((v) => {
    const principal = cleanAmount(v.principal);
    const err = amountError(principal, v.currency);
    if (err) return setError('principal', { message: err });
    const body: Record<string, unknown> = { ...v, principal, interestRate: v.interestRate || null, dueDate: v.dueDate || null };
    if (debt) {
      delete body.direction;
      if (locked) { delete body.principal; delete body.currency; }
    }
    save.mutate(debt ? { id: debt.id, ...body } : body, {
      onSuccess: () => { toast.success(debt ? 'Debt saved' : 'Debt added'); onOpenChange(false); },
      onError: (e) => { if (!applyFieldErrors(e, setError)) toast.error(e.message); },
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{debt ? 'Edit debt' : 'Add a debt'}</DialogTitle>
        <DialogDescription>BudgetFlow keeps the record. Payments still happen between you and the other party.</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
          {!debt && (
            <Field label="Which way?" htmlFor="d-dir" className="sm:col-span-2">
              <Select id="d-dir" {...register('direction')}>
                <option value="i_owe">I owe this money</option>
                <option value="owed_to_me">Someone owes me</option>
              </Select>
            </Field>
          )}
          <Field label="Name" htmlFor="d-name" error={formState.errors.name?.message}><Input id="d-name" placeholder="e.g. Car loan" {...register('name')} /></Field>
          <Field label="Lender or borrower" htmlFor="d-cp"><Input id="d-cp" placeholder="e.g. GCB, Auntie Efua" {...register('counterparty')} /></Field>
          <Field label="Amount borrowed" htmlFor="d-principal" error={formState.errors.principal?.message} hint={locked ? 'Locked: payments exist. Add a charge to increase it.' : undefined}><Input id="d-principal" inputMode="decimal" className="tabular" disabled={locked} {...register('principal')} /></Field>
          <Field label="Currency" htmlFor="d-cur"><CurrencySelect id="d-cur" disabled={locked} {...register('currency')} /></Field>
          <Field label="Start date" htmlFor="d-start" error={formState.errors.startDate?.message}><Input id="d-start" type="date" max={todayYmd()} {...register('startDate')} /></Field>
          <Field label="Due date (optional)" htmlFor="d-due" error={formState.errors.dueDate?.message}><Input id="d-due" type="date" {...register('dueDate')} /></Field>
          <Field label="Interest, % a year (optional)" htmlFor="d-rate" error={formState.errors.interestRate?.message} hint="For reference only." className="sm:col-span-2"><Input id="d-rate" inputMode="decimal" className="w-32 tabular" {...register('interestRate')} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{debt ? 'Save' : 'Add debt'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
