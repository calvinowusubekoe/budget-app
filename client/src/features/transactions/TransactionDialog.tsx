import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd, RATE_SOURCE_LABEL, todayYmd } from '@/lib/money';
import { ApiError, applyFieldErrors } from '@/services/api';
import type { Frequency, Transaction, TransactionInput, TxType } from '@/types/api';
import { useAccounts, useCategories, useRateMutations, useRateResolve, useSaveTransaction, useWs } from '@/features/finance/hooks';
import { useScheduleMutations } from '@/features/planning/hooks';

const schema = z.object({
  type: z.enum(['expense', 'income', 'transfer']),
  accountId: z.string().min(1, 'Choose an account.'),
  toAccountId: z.string(),
  categoryId: z.string(),
  amount: z.string(),
  toAmount: z.string(),
  exchangeRate: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  description: z.string().trim().min(1, 'Describe it in a few words.').max(140),
  payee: z.string().max(80),
  notes: z.string().max(2000),
  isRecurring: z.boolean(),
  frequency: z.string(),
  askFirst: z.boolean(),
});
type Values = z.infer<typeof schema>;

const TYPES: { value: TxType; label: string; icon: typeof ArrowUpRight }[] = [
  { value: 'expense', label: 'Expense', icon: ArrowUpRight },
  { value: 'income', label: 'Income', icon: ArrowDownLeft },
  { value: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
];

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  transaction?: Transaction | null;
  defaultType?: TxType;
  defaultAccountId?: string;
}

export function TransactionDialog({ open, onOpenChange, transaction, defaultType = 'expense', defaultAccountId }: Props) {
  const ws = useWs();
  const base = ws.workspace?.baseCurrency ?? 'GHS';
  const accounts = useAccounts();
  const categories = useCategories();
  const save = useSaveTransaction();
  const schedules = useScheduleMutations();
  const rates = useRateMutations();
  const editing = Boolean(transaction);
  const idempotencyKey = useMemo(newKey, [open]); // one key per opening: retries never double-save
  const [rateOpen, setRateOpen] = useState(false);

  const activeAccounts = useMemo(() => (accounts.data?.items ?? []).filter((a) => a.status === 'active' || a.id === transaction?.account.id || a.id === transaction?.toAccount?.id), [accounts.data, transaction]);

  const defaults = (): Values => ({
    type: transaction?.type ?? defaultType,
    accountId: transaction?.account.id ?? defaultAccountId ?? activeAccounts[0]?.id ?? '',
    toAccountId: transaction?.toAccount?.id ?? '',
    categoryId: transaction?.category?.id ?? '',
    amount: transaction?.amount ?? '',
    toAmount: transaction?.toAmount ?? '',
    exchangeRate: '',
    date: transaction?.date ?? todayYmd(),
    description: transaction?.description ?? '',
    payee: transaction?.payee ?? '',
    notes: transaction?.notes ?? '',
    isRecurring: transaction?.recurrence.isRecurring ?? false,
    frequency: transaction?.recurrence.frequency ?? 'monthly',
    askFirst: false,
  });

  const { register, handleSubmit, control, formState, reset, setError, setValue, clearErrors } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const v = useWatch({ control }) as Values;

  useEffect(() => {
    if (open) {
      reset(defaults());
      setRateOpen(false);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id]);

  // Pick a sensible default account once accounts load.
  useEffect(() => {
    if (open && !v.accountId && activeAccounts[0]) setValue('accountId', activeAccounts[0].id);
  }, [open, v.accountId, activeAccounts, setValue]);

  const account = activeAccounts.find((a) => a.id === v.accountId);
  const toAccount = activeAccounts.find((a) => a.id === v.toAccountId);
  const currency = account?.currency ?? base;
  const isTransfer = v.type === 'transfer';
  const crossTransfer = isTransfer && toAccount && toAccount.currency !== currency;
  const needsRate = currency !== base;
  const cleanedAmount = cleanAmount(v.amount ?? '');
  const amountOk = cleanedAmount && !amountError(cleanedAmount, currency);

  // In edit mode the saved snapshot is reused unless money fields changed.
  const moneyChanged = !transaction || cleanedAmount !== transaction.amount || v.date !== transaction.date || v.accountId !== transaction.account.id;
  const resolve = useRateResolve({ from: currency, date: v.date, amount: amountOk ? cleanedAmount : undefined }, open && needsRate && moneyChanged);
  const rateMissing = needsRate && moneyChanged && resolve.data && !resolve.data.found;
  const showRateInput = needsRate && (rateOpen || rateMissing);

  const kindCategories = (categories.data ?? []).filter((c) => c.kind === v.type || c.id === transaction?.category?.id);

  const onSubmit = handleSubmit((values) => {
    const amount = cleanAmount(values.amount);
    const err = amountError(amount, currency);
    if (err) return setError('amount', { message: err });
    if (!isTransfer && !values.categoryId) return setError('categoryId', { message: 'Choose a category.' });
    if (isTransfer && !values.toAccountId) return setError('toAccountId', { message: 'Choose where the money went.' });
    const toAmount = cleanAmount(values.toAmount);
    if (crossTransfer) {
      const e2 = amountError(toAmount, toAccount!.currency);
      if (e2) return setError('toAmount', { message: e2 });
    }
    const rate = cleanAmount(values.exchangeRate);
    if (showRateInput && !/^\d{1,10}(\.\d{1,10})?$/.test(rate)) return setError('exchangeRate', { message: `Enter how many ${base} one ${currency} was worth.` });

    const body: Partial<TransactionInput> = {
      type: values.type,
      accountId: values.accountId,
      amount,
      date: values.date,
      description: values.description.trim(),
      payee: values.payee.trim(),
      notes: values.notes.trim(),
      ...(isTransfer ? { toAccountId: values.toAccountId, ...(crossTransfer ? { toAmount } : {}) } : { categoryId: values.categoryId }),
      ...(showRateInput && rate ? { exchangeRate: rate } : {}),
      ...(transaction ? { version: transaction.version } : {}),
    };

    const label = values.type === 'income' ? 'Income' : values.type === 'transfer' ? 'Transfer' : 'Expense';
    save.mutate(
      { id: transaction?.id, body, idempotencyKey, summary: { title: body.description || label, amount, currency, date: values.date, context: account?.name } },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          if (r.queued) {
            // Not on the server yet: say so plainly, and never show it as recorded.
            toast(`${label} saved on this device`, { description: values.isRecurring ? 'It will sync when you’re back online. Set up the repeat after it syncs.' : 'It will sync when you’re back online.' });
            return;
          }
          const t = r.transaction;
          if (!editing && values.isRecurring) {
            // The saved transaction becomes the first occurrence of the schedule.
            schedules.create.mutate(
              { fromTransactionId: t.id, frequency: values.frequency as Frequency, mode: values.askFirst ? 'remind' : 'auto' },
              {
                onSuccess: (r) => toast.success(`${label} recorded. Repeats ${r.frequency}${r.nextDate ? `, next on ${formatYmd(r.nextDate)}` : ''}.`),
                onError: (e) => toast.error(`${label} recorded, but the schedule wasn’t set up: ${e.message}`),
              },
            );
          } else {
            toast.success(editing ? 'Transaction updated' : `${label} recorded`);
          }
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'RATE_REQUIRED') setRateOpen(true);
          applyFieldErrors(e, setError);
        },
      },
    );
  });

  const generalError = save.error instanceof ApiError && !save.error.details ? save.error.message : null;
  const noAccounts = accounts.isSuccess && activeAccounts.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogTitle>{editing ? 'Edit transaction' : 'Record a transaction'}</DialogTitle>
        <DialogDescription>Record money that moved outside BudgetFlow, so your balances and reports stay true.</DialogDescription>

        {noAccounts ? (
          <div className="mt-5 grid gap-4">
            <Alert tone="gold">Add an account first, so BudgetFlow knows where this money came from or went.</Alert>
            <Button asChild><Link to="/accounts" onClick={() => onOpenChange(false)}>Go to accounts</Link></Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4">
            {generalError && <Alert tone="danger">{generalError}</Alert>}

            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <div role="radiogroup" aria-label="Type" className="neu-inset grid grid-cols-3 gap-1 rounded-2xl p-1">
                  {TYPES.map(({ value, label, icon: Icon }) => {
                    const locked = editing && (value === 'transfer') !== (transaction!.type === 'transfer');
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={field.value === value}
                        disabled={locked}
                        title={locked ? 'A transfer can’t become income or an expense. Delete it and record a new one.' : undefined}
                        onClick={() => {
                          field.onChange(value);
                          setValue('categoryId', '');
                          clearErrors();
                        }}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition disabled:opacity-40',
                          field.value === value ? 'neu-raised-sm text-primary' : 'text-muted hover:text-ink',
                        )}
                      >
                        <Icon className="size-4" aria-hidden /> {label}
                      </button>
                    );
                  })}
                </div>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field label={isTransfer ? 'Amount sent' : 'Amount'} htmlFor="tx-amount" error={formState.errors.amount?.message}>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm font-medium text-subtle">{currency}</span>
                  <Input id="tx-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" className="tabular h-14 pl-16 text-2xl font-semibold" {...register('amount')} />
                </div>
              </Field>
              <Field label="Date" htmlFor="tx-date" error={formState.errors.date?.message}>
                <Input id="tx-date" type="date" className="h-14" max="2100-12-31" {...register('date')} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={isTransfer ? 'From account' : v.type === 'income' ? 'Paid into' : 'Paid from'} htmlFor="tx-account" error={formState.errors.accountId?.message}>
                <Select id="tx-account" {...register('accountId')}>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                  ))}
                </Select>
              </Field>
              {isTransfer ? (
                <Field label="To account" htmlFor="tx-to" error={formState.errors.toAccountId?.message}>
                  <Select id="tx-to" {...register('toAccountId')}>
                    <option value="">Choose an account</option>
                    {activeAccounts.filter((a) => a.id !== v.accountId).map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Category" htmlFor="tx-category" error={formState.errors.categoryId?.message}>
                  <Select id="tx-category" {...register('categoryId')}>
                    <option value="">Choose a category</option>
                    {kindCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            {crossTransfer && (
              <Field label={`Amount received in ${toAccount!.name}`} htmlFor="tx-toamount" error={formState.errors.toAmount?.message} hint="What actually arrived, after the conversion and any fees.">
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm font-medium text-subtle">{toAccount!.currency}</span>
                  <Input id="tx-toamount" inputMode="decimal" className="tabular pl-16" {...register('toAmount')} />
                </div>
              </Field>
            )}

            {needsRate && (
              <RateBox
                currency={currency}
                base={base}
                transaction={moneyChanged ? null : transaction}
                resolution={resolve.data}
                loading={resolve.isFetching}
                showInput={Boolean(showRateInput)}
                onOverride={() => setRateOpen(true)}
                onFetch={() => rates.fetch.mutate({ from: currency, to: base }, { onSuccess: () => { setRateOpen(false); toast.success('Rate updated'); }, onError: (e) => toast.error(e.message) })}
                fetching={rates.fetch.isPending}
                error={formState.errors.exchangeRate?.message}
                register={register('exchangeRate')}
              />
            )}

            <Field label="Description" htmlFor="tx-desc" error={formState.errors.description?.message}>
              <Input id="tx-desc" placeholder={v.type === 'income' ? 'e.g. November salary' : isTransfer ? 'e.g. Moved to MoMo' : 'e.g. Market shopping'} {...register('description')} />
            </Field>

            {!isTransfer && (
              <Field label={v.type === 'income' ? 'From (optional)' : 'Paid to (optional)'} htmlFor="tx-payee">
                <Input id="tx-payee" {...register('payee')} />
              </Field>
            )}

            <Field label="Notes (optional)" htmlFor="tx-notes">
              <textarea id="tx-notes" rows={2} className="neu-inset w-full rounded-xl px-3.5 py-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring" {...register('notes')} />
            </Field>

            {transaction?.recurringId ? (
              <p className="text-sm text-muted">
                Part of a recurring schedule.{' '}
                <Link to="/transactions/recurring" className="text-primary hover:underline" onClick={() => onOpenChange(false)}>Manage it</Link>
              </p>
            ) : !editing ? (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox {...register('isRecurring')} />
                  Repeat this
                </label>
                {v.isRecurring && (
                  <>
                    <Select aria-label="How often" className="h-9 w-40 text-sm" {...register('frequency')}>
                      <option value="weekly">Every week</option>
                      <option value="monthly">Every month</option>
                      <option value="quarterly">Every quarter</option>
                      <option value="yearly">Every year</option>
                      <option value="daily">Every day</option>
                    </Select>
                    <label className="flex items-center gap-2 text-sm text-muted">
                      <Checkbox {...register('askFirst')} />
                      Ask me before each one
                    </label>
                  </>
                )}
              </div>
            ) : null}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Record transaction'}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RateBoxProps {
  currency: string;
  base: string;
  transaction?: Transaction | null;
  resolution?: import('@/types/api').RateResolution;
  loading: boolean;
  showInput: boolean;
  onOverride: () => void;
  onFetch: () => void;
  fetching: boolean;
  error?: string;
  register: ReturnType<ReturnType<typeof useForm<Values>>['register']>;
}

/** Explains which rate converts this record to the reporting currency, and where it came from. */
function RateBox({ currency, base, transaction, resolution, loading, showInput, onOverride, onFetch, fetching, error, register }: RateBoxProps) {
  const r = transaction?.reporting;
  return (
    <div className="neu-pressed grid gap-3 rounded-2xl p-4 text-sm" aria-live="polite">
      {r ? (
        <p>
          Saved as <strong className="tabular">{formatMoney(r.amount, r.currency)}</strong> at 1 {currency} = <span className="tabular">{r.rate}</span> {base}
          <span className="text-muted"> ({RATE_SOURCE_LABEL[r.source]}{r.estimated ? ', estimated' : ''}). Change the amount, date or account to recalculate.</span>
        </p>
      ) : resolution?.found && !showInput ? (
        <p>
          {resolution.convertedAmount ? <>About <strong className="tabular">{formatMoney(resolution.convertedAmount, base)}</strong> at </> : 'Uses '}
          1 {currency} = <span className="tabular">{resolution.rate}</span> {base}
          <span className="text-muted">
            {' '}({RATE_SOURCE_LABEL[resolution.source!]}
            {resolution.rateDate ? ` from ${formatYmd(resolution.rateDate)}` : ''}
            {resolution.estimated ? ', estimated' : ''})
          </span>
          {' '}<button type="button" className="font-medium text-primary hover:underline" onClick={onOverride}>Use a different rate</button>
        </p>
      ) : loading && !resolution ? (
        <p className="text-muted">Checking exchange rates…</p>
      ) : null}

      {showInput && (
        <div className="grid gap-2">
          <Field label={`Exchange rate: 1 ${currency} in ${base}`} htmlFor="tx-rate" error={error} hint={resolution && !resolution.found ? `No ${currency}→${base} rate is saved for this date. Enter the rate you got.` : 'Used for this record only.'}>
            <Input id="tx-rate" inputMode="decimal" placeholder="e.g. 15.40" className="tabular glass shadow-none" {...register} />
          </Field>
          {resolution?.providerAvailable && (
            <Button type="button" size="sm" variant="neu" className="justify-self-start" loading={fetching} onClick={onFetch}>
              <RefreshCw /> Get today’s rate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
