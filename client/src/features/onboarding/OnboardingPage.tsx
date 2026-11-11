import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Briefcase, Check, User } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useUpdateProfile } from '@/features/auth/useAuthActions';
import { useCreateWorkspace, useWorkspaces } from '@/features/workspaces/useWorkspaces';

/**
 * Two short steps: confirm how money is shown, then say whether a business
 * workspace is needed. Everything here can be changed later in settings.
 */
export function OnboardingPage() {
  const user = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const update = useUpdateProfile();
  const create = useCreateWorkspace();
  const workspaces = useWorkspaces();

  const [step, setStep] = useState<1 | 2>(1);
  const [currency, setCurrency] = useState(user.defaultCurrency);
  const [mode, setMode] = useState<'personal' | 'both'>('personal');
  const [businessName, setBusinessName] = useState('');
  const [nameError, setNameError] = useState<string>();

  const personal = workspaces.data?.find((w) => w.type === 'personal' && w.role === 'owner');
  const busy = update.isPending || create.isPending;
  const error = update.error ?? create.error;

  async function finishStepOne() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await update.mutateAsync({ defaultCurrency: currency, ...(tz ? { timezone: tz } : {}) });
    setStep(2);
  }

  async function finish() {
    if (mode === 'both') {
      if (!businessName.trim()) return setNameError('Name your business workspace.');
      await create.mutateAsync({ name: businessName.trim(), type: 'business', baseCurrency: currency });
    }
    await update.mutateAsync({ onboardingCompleted: true, ...(personal ? { lastWorkspaceId: personal.id } : {}) });
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout
      title={step === 1 ? `Welcome, ${user.name.split(' ')[0]}` : 'Who are you tracking for?'}
      subtitle={step === 1 ? 'Confirm the currency you think in. Records in other currencies are converted to it for totals.' : 'You can add or remove workspaces at any time.'}
    >
      <ol aria-label="Setup progress" className="mb-6 flex gap-2">
        {[1, 2].map((n) => (
          <li key={n} aria-current={step === n ? 'step' : undefined} className={cn('h-1.5 flex-1 rounded-full', n <= step ? 'bg-primary' : 'neu-inset')}>
            <span className="sr-only">Step {n} of 2</span>
          </li>
        ))}
      </ol>
      {error && <Alert tone="danger" className="mb-4">{error.message}</Alert>}

      {step === 1 ? (
        <div className="grid gap-5">
          <Field label="Main currency" htmlFor="currency">
            <CurrencySelect id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
          <Button size="lg" loading={busy} onClick={() => void finishStepOne().catch(() => undefined)}>
            Continue
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <div role="radiogroup" aria-label="Workspaces to set up" className="grid gap-3">
            <Choice active={mode === 'personal'} onSelect={() => setMode('personal')} icon={User} title="Just me" body="A private personal workspace for your own money and Susu plans." />
            <Choice active={mode === 'both'} onSelect={() => setMode('both')} icon={Briefcase} title="Me and a business" body="Keep business revenue and expenses apart from personal records, and invite your team." />
          </div>
          {mode === 'both' && (
            <Field label="Business workspace name" htmlFor="biz" error={nameError}>
              <Input id="biz" value={businessName} onChange={(e) => { setBusinessName(e.target.value); setNameError(undefined); }} placeholder="e.g. Kwame’s Hardware" />
            </Field>
          )}
          <div className="mt-1 flex gap-3">
            <Button variant="neu" size="lg" onClick={() => setStep(1)} disabled={busy}>
              Back
            </Button>
            <Button size="lg" className="flex-1" loading={busy} onClick={() => void finish().catch(() => undefined)}>
              Go to dashboard
            </Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}

function Choice({ active, onSelect, icon: Icon, title, body }: { active: boolean; onSelect: () => void; icon: typeof User; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn('flex items-start gap-3 rounded-2xl p-4 text-left transition', active ? 'neu-pressed' : 'neu-raised-sm hover:text-ink')}
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', active ? 'bg-primary text-primary-fg' : 'bg-primary-soft text-primary')}>
        {active ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <span>
        <span className="block font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{body}</span>
      </span>
    </button>
  );
}
