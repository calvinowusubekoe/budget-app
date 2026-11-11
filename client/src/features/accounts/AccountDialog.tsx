import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert } from '@/components/ui/feedback';
import { applyFieldErrors, ApiError } from '@/services/api';
import { cleanAmount, minorUnits, todayYmd } from '@/lib/money';
import type { Account } from '@/types/api';
import { useSaveAccount, useWs } from '@/features/finance/hooks';
import { ACCOUNT_TYPE_LABEL } from '@/features/finance/icons';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Name the account.').max(80),
    type: z.enum(['cash', 'bank', 'mobile_money', 'savings', 'other']),
    currency: z.string().length(3),
    openingBalance: z.string().transform(cleanAmount).pipe(z.string().regex(/^-?\d{1,13}(\.\d{1,4})?$/, 'Enter an amount like 1500.00, or 0.')),
    openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
    institution: z.string().max(80),
    notes: z.string().max(500),
  })
  .superRefine((v, ctx) => {
    const decimals = v.openingBalance.split('.')[1]?.length ?? 0;
    if (decimals > minorUnits(v.currency)) ctx.addIssue({ code: 'custom', path: ['openingBalance'], message: `${v.currency} amounts have at most ${minorUnits(v.currency)} decimal places.` });
  });
type Values = z.input<typeof schema>;

const INSTITUTION_HINT: Record<Account['type'], string> = {
  cash: 'e.g. Wallet, Shop till',
  bank: 'e.g. GCB, Ecobank, Stanbic',
  mobile_money: 'e.g. MTN MoMo, Telecel Cash',
  savings: 'e.g. Fidelity savings',
  other: '',
};

export function AccountDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account?: Account | null }) {
  const { workspace } = useWs();
  const save = useSaveAccount();
  const locked = Boolean(account && account.transactionCount > 0);
  const defaults = (): Values => ({
    name: account?.name ?? '',
    type: account?.type ?? 'mobile_money',
    currency: account?.currency ?? workspace?.baseCurrency ?? 'GHS',
    openingBalance: account?.openingBalance ?? '0',
    openingDate: account?.openingDate ?? todayYmd(),
    institution: account?.institution ?? '',
    notes: account?.notes ?? '',
  });
  const { register, handleSubmit, formState, reset, setError, watch } = useForm<Values, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const type = watch('type');

  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      { id: account?.id, ...v, ...(locked ? { currency: undefined } : {}) },
      {
        onSuccess: (a) => {
          toast.success(account ? 'Account saved' : `${a.name} added`);
          onOpenChange(false);
        },
        onError: (err) => applyFieldErrors(err, setError),
      },
    ),
  );

  const general = save.error instanceof ApiError && !save.error.details ? save.error.message : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{account ? 'Edit account' : 'Add an account'}</DialogTitle>
        <DialogDescription>An account is a label for where money sits, like a MoMo wallet or bank account. Kontaa only keeps the record; it can’t see or move the money.</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
          {general && <Alert tone="danger" className="sm:col-span-2">{general}</Alert>}
          <Field label="Account name" htmlFor="acc-name" error={formState.errors.name?.message} className="sm:col-span-2">
            <Input id="acc-name" placeholder="e.g. MTN MoMo" {...register('name')} />
          </Field>
          <Field label="Type" htmlFor="acc-type">
            <Select id="acc-type" {...register('type')}>
              {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" htmlFor="acc-currency" hint={locked ? 'Locked: this account already has transactions.' : undefined}>
            <CurrencySelect id="acc-currency" disabled={locked} {...register('currency')} />
          </Field>
          <Field label="Balance when you start tracking" htmlFor="acc-opening" error={formState.errors.openingBalance?.message} hint="Use a minus sign for money owed, e.g. an overdraft.">
            <Input id="acc-opening" inputMode="decimal" className="tabular" {...register('openingBalance')} />
          </Field>
          <Field label="As of" htmlFor="acc-date" error={formState.errors.openingDate?.message}>
            <Input id="acc-date" type="date" {...register('openingDate')} />
          </Field>
          <Field label="Provider (optional)" htmlFor="acc-inst" className="sm:col-span-2">
            <Input id="acc-inst" placeholder={INSTITUTION_HINT[type]} {...register('institution')} />
          </Field>
          <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{account ? 'Save account' : 'Add account'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
