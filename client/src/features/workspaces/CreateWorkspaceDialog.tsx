import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Briefcase, User } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { applyFieldErrors } from '@/services/api';
import { useCreateWorkspace, useSwitchWorkspace } from './useWorkspaces';

const schema = z.object({
  name: z.string().trim().min(1, 'Name the workspace.').max(80),
  type: z.enum(['personal', 'business']),
  baseCurrency: z.string().length(3),
  legalName: z.string().max(160),
  industry: z.string().max(80),
});
type Values = z.infer<typeof schema>;

export function CreateWorkspaceDialog({ open, onOpenChange, defaultType = 'business' }: { open: boolean; onOpenChange: (o: boolean) => void; defaultType?: 'personal' | 'business' }) {
  const user = useAuth((s) => s.user);
  const create = useCreateWorkspace();
  const switchTo = useSwitchWorkspace();
  const { register, handleSubmit, watch, setValue, formState, setError, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: defaultType, baseCurrency: user?.defaultCurrency ?? 'GHS', legalName: '', industry: '' },
  });
  const type = watch('type');

  const onSubmit = handleSubmit(({ legalName, industry, ...rest }) =>
    create.mutate(
      { ...rest, business: rest.type === 'business' ? { legalName, industry } : undefined },
      {
        onSuccess: (ws) => {
          switchTo(ws.id);
          reset();
          onOpenChange(false);
        },
        onError: (err) => applyFieldErrors(err, setError),
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Create a workspace</DialogTitle>
        <DialogDescription>Each workspace keeps its own records. Business workspaces can be shared with a team.</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4">
          {create.error && !('details' in create.error && create.error.details) && <Alert tone="danger">{create.error.message}</Alert>}
          <div role="radiogroup" aria-label="Workspace type" className="grid grid-cols-2 gap-3">
            {(['business', 'personal'] as const).map((t) => {
              const Icon = t === 'business' ? Briefcase : User;
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setValue('type', t)}
                  className={cn('flex items-center gap-2.5 rounded-2xl px-3 py-3 text-left text-sm font-medium transition', active ? 'neu-pressed text-primary' : 'neu-raised-sm text-muted hover:text-ink')}
                >
                  <Icon className="size-4" aria-hidden />
                  {t === 'business' ? 'Business' : 'Personal'}
                </button>
              );
            })}
          </div>
          <Field label="Workspace name" htmlFor="ws-name" error={formState.errors.name?.message}>
            <Input id="ws-name" placeholder={type === 'business' ? 'e.g. Adwoa’s Catering' : 'e.g. Household'} {...register('name')} />
          </Field>
          <Field label="Reporting currency" htmlFor="ws-currency" hint="Totals for this workspace are shown in this currency.">
            <CurrencySelect id="ws-currency" {...register('baseCurrency')} />
          </Field>
          {type === 'business' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Registered name (optional)" htmlFor="ws-legal">
                <Input id="ws-legal" {...register('legalName')} />
              </Field>
              <Field label="Industry (optional)" htmlFor="ws-industry">
                <Input id="ws-industry" {...register('industry')} />
              </Field>
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create workspace
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
