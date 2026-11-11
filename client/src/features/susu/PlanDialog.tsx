import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { amountError, cleanAmount, todayYmd } from '@/lib/money';
import { applyFieldErrors } from '@/services/api';
import type { SusuPlan } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { LOCATION_LABEL, useSaveSusuPlan } from './hooks';

const schema = z.object({
  name: z.string().trim().min(1, 'Name the plan.').max(80),
  currency: z.string().length(3),
  contributionAmount: z.string(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  intervalDays: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date.'),
  targetAmount: z.string(),
  targetDate: z.string(),
  locationType: z.enum(['home_box', 'envelope', 'safe', 'collector', 'other']),
  locationLabel: z.string().max(80),
  description: z.string().max(500),
});
type Values = z.infer<typeof schema>;

export function PlanDialog({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (o: boolean) => void; plan?: SusuPlan }) {
  const ws = useWs();
  const navigate = useNavigate();
  const save = useSaveSusuPlan();
  const locked = Boolean(plan && plan.summary.contributionCount > 0);
  const defaults = (): Values => ({
    name: plan?.name ?? '',
    currency: plan?.currency ?? ws.workspace?.baseCurrency ?? 'GHS',
    contributionAmount: plan?.contributionAmount ?? '',
    frequency: plan?.frequency ?? 'daily',
    intervalDays: plan?.intervalDays ? String(plan.intervalDays) : '3',
    startDate: plan?.startDate ?? todayYmd(),
    targetAmount: plan?.targetAmount ?? '',
    targetDate: plan?.targetDate ?? '',
    locationType: plan?.location.type ?? 'collector',
    locationLabel: plan?.location.label ?? '',
    description: plan?.description ?? '',
  });
  const { register, handleSubmit, reset, watch, setError, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const frequency = watch('frequency');
  const locationType = watch('locationType');
  const currency = watch('currency');
  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id]);

  const onSubmit = handleSubmit((v) => {
    const contributionAmount = cleanAmount(v.contributionAmount);
    const e1 = amountError(contributionAmount, v.currency);
    if (e1) return setError('contributionAmount', { message: e1 });
    const targetAmount = cleanAmount(v.targetAmount);
    if (targetAmount) {
      const e2 = amountError(targetAmount, v.currency);
      if (e2) return setError('targetAmount', { message: e2 });
    }
    const body: Record<string, unknown> = {
      name: v.name,
      description: v.description,
      contributionAmount,
      targetAmount: targetAmount || null,
      targetDate: v.targetDate || null,
      location: { type: v.locationType, label: v.locationLabel },
      ...(locked ? {} : { currency: v.currency, frequency: v.frequency, startDate: v.startDate, intervalDays: v.frequency === 'custom' ? Number(v.intervalDays) : null }),
    };
    if (plan && plan.contributionAmount === contributionAmount) delete body.contributionAmount;
    save.mutate(plan ? { id: plan.id, ...body } : body, {
      onSuccess: (p) => {
        onOpenChange(false);
        toast.success(plan ? 'Plan saved' : 'Plan created');
        if (!plan) navigate(`/susu/plans/${p.id}`);
      },
      onError: (e) => { if (!applyFieldErrors(e, setError)) toast.error(e.message); },
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogTitle>{plan ? 'Edit Susu plan' : 'New personal Susu plan'}</DialogTitle>
        <DialogDescription>A record of what you set aside and where. BudgetFlow keeps the record; the money stays with you or your collector.</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Plan name" htmlFor="sp-name" error={formState.errors.name?.message} className="sm:col-span-2"><Input id="sp-name" placeholder="e.g. Daily market susu" {...register('name')} /></Field>
          <Field label="I contribute" htmlFor="sp-amount" error={formState.errors.contributionAmount?.message} hint={plan && plan.summary.contributionCount > 0 ? 'A new amount applies from today.' : undefined}>
            <Input id="sp-amount" inputMode="decimal" className="tabular" placeholder="20.00" {...register('contributionAmount')} />
          </Field>
          <Field label="How often" htmlFor="sp-freq" hint={locked ? 'Locked: contributions are recorded.' : undefined}>
            <Select id="sp-freq" disabled={locked} {...register('frequency')}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="custom">Every few days</option>
            </Select>
          </Field>
          {frequency === 'custom' && (
            <Field label="Every how many days?" htmlFor="sp-int"><Input id="sp-int" type="number" min={2} max={90} disabled={locked} className="w-28" {...register('intervalDays')} /></Field>
          )}
          <Field label="Currency" htmlFor="sp-cur"><CurrencySelect id="sp-cur" disabled={locked} {...register('currency')} /></Field>
          <Field label="Starting" htmlFor="sp-start" error={formState.errors.startDate?.message}><Input id="sp-start" type="date" disabled={locked} {...register('startDate')} /></Field>
          <Field label="Where is the money kept?" htmlFor="sp-loc">
            <Select id="sp-loc" {...register('locationType')}>
              {Object.entries(LOCATION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label={locationType === 'collector' ? 'Collector’s name (optional)' : 'Label (optional)'} htmlFor="sp-loclabel">
            <Input id="sp-loclabel" placeholder={locationType === 'collector' ? 'e.g. Auntie Akos, Makola' : 'e.g. Blue tin under the bed'} {...register('locationLabel')} />
          </Field>
          <Field label={`Target (${currency}, optional)`} htmlFor="sp-target" error={formState.errors.targetAmount?.message}><Input id="sp-target" inputMode="decimal" className="tabular" {...register('targetAmount')} /></Field>
          <Field label="Target date (optional)" htmlFor="sp-tdate"><Input id="sp-tdate" type="date" {...register('targetDate')} /></Field>
          <Field label="What is it for? (optional)" htmlFor="sp-desc" className="sm:col-span-2"><Input id="sp-desc" placeholder="e.g. Shop restock before Christmas" {...register('description')} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{plan ? 'Save plan' : 'Create plan'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
