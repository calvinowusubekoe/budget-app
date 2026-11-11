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
import { useAuth } from '@/stores/auth';
import { useCreateGroup } from './groupHooks';

const schema = z.object({
  name: z.string().trim().min(1, 'Name the group.').max(80),
  currency: z.string().length(3),
  contributionAmount: z.string(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  intervalDays: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the first due date.'),
  rotationMethod: z.enum(['fixed_order', 'random', 'manual']),
  collectionSchedule: z.string().max(300),
  maxMembers: z.string(),
});
type Values = z.infer<typeof schema>;

export function GroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const create = useCreateGroup();
  const { register, handleSubmit, watch, setError, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', currency: user?.defaultCurrency ?? 'GHS', contributionAmount: '', frequency: 'weekly', intervalDays: '3', startDate: todayYmd(), rotationMethod: 'fixed_order', collectionSchedule: '', maxMembers: '12' },
  });
  const frequency = watch('frequency');

  const onSubmit = handleSubmit((v) => {
    const amount = cleanAmount(v.contributionAmount);
    const err = amountError(amount, v.currency);
    if (err) return setError('contributionAmount', { message: err });
    create.mutate(
      { ...v, contributionAmount: amount, intervalDays: v.frequency === 'custom' ? Number(v.intervalDays) : null, maxMembers: Number(v.maxMembers) || 12 },
      {
        onSuccess: (g) => { onOpenChange(false); toast.success('Group created. Add your members next.'); navigate(`/susu/groups/${g.id}?tab=members`); },
        onError: (e) => { if (!applyFieldErrors(e, setError)) toast.error(e.message); },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogTitle>New Susu group</DialogTitle>
        <DialogDescription>Keep the records for a rotating group you organise. Members keep paying and collecting the way you agree; Kontaa never handles the money.</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Group name" htmlFor="ng-name" error={formState.errors.name?.message} className="sm:col-span-2"><Input id="ng-name" placeholder="e.g. Makola Traders Susu" {...register('name')} /></Field>
          <Field label="Each member contributes" htmlFor="ng-amt" error={formState.errors.contributionAmount?.message}><Input id="ng-amt" inputMode="decimal" className="tabular" placeholder="100.00" {...register('contributionAmount')} /></Field>
          <Field label="Currency" htmlFor="ng-cur"><CurrencySelect id="ng-cur" {...register('currency')} /></Field>
          <Field label="How often" htmlFor="ng-freq">
            <Select id="ng-freq" {...register('frequency')}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="custom">Every few days</option>
            </Select>
          </Field>
          <Field label="First due date" htmlFor="ng-start" error={formState.errors.startDate?.message}><Input id="ng-start" type="date" {...register('startDate')} /></Field>
          {frequency === 'custom' && (
            <Field label="Every how many days?" htmlFor="ng-int"><Input id="ng-int" type="number" min={2} max={90} className="w-28" {...register('intervalDays')} /></Field>
          )}
          <Field label="Who collects when?" htmlFor="ng-rot">
            <Select id="ng-rot" {...register('rotationMethod')}>
              <option value="fixed_order">In the order members are listed</option>
              <option value="random">Draw the order at random</option>
              <option value="manual">I’ll choose each time</option>
            </Select>
          </Field>
          <Field label="Most members" htmlFor="ng-max"><Input id="ng-max" type="number" min={2} max={200} className="w-28" {...register('maxMembers')} /></Field>
          <Field label="When and where you collect (optional)" htmlFor="ng-sched" className="sm:col-span-2"><Input id="ng-sched" placeholder="e.g. Sundays after church, at the shop" {...register('collectionSchedule')} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create group</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
