import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Checkbox, Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert } from '@/components/ui/feedback';
import { applyFieldErrors, ApiError } from '@/services/api';
import { registerSchema, type RegisterValues } from './schemas';
import { useRegister } from './useAuthActions';

export function RegisterPage() {
  const navigate = useNavigate();
  const signup = useRegister();
  const { register, handleSubmit, formState, setError } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { defaultCurrency: 'GHS', acceptTerms: false, acceptPrivacy: false, marketingConsent: false },
  });
  const e = formState.errors;

  const onSubmit = handleSubmit((values) =>
    signup.mutate(values, {
      onSuccess: () => navigate('/onboarding', { replace: true }),
      onError: (err) => applyFieldErrors(err, setError),
    }),
  );

  const generalError = signup.error instanceof ApiError && !signup.error.details ? signup.error.message : null;

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Track income, spending, savings and Susu in one place. You start with a private personal workspace."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {generalError && <Alert tone="danger">{generalError}</Alert>}
        <Field label="Full name" htmlFor="name" error={e.name?.message}>
          <Input id="name" autoComplete="name" {...register('name')} />
        </Field>
        <Field label="Email" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="At least 10 characters, with a letter and a number.">
          <PasswordInput id="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field label="Main currency" htmlFor="defaultCurrency" error={e.defaultCurrency?.message} hint="Totals are shown in this currency. You can change it later.">
          <CurrencySelect id="defaultCurrency" {...register('defaultCurrency')} />
        </Field>

        <fieldset className="neu-inset grid gap-3 rounded-2xl p-4">
          <legend className="sr-only">Agreements</legend>
          <ConsentRow id="acceptTerms" error={e.acceptTerms?.message} {...register('acceptTerms')}>
            I agree to the <a className="text-primary underline" href="/legal/terms" target="_blank" rel="noreferrer">terms of use</a>.
          </ConsentRow>
          <ConsentRow id="acceptPrivacy" error={e.acceptPrivacy?.message} {...register('acceptPrivacy')}>
            I have read the <a className="text-primary underline" href="/legal/privacy" target="_blank" rel="noreferrer">privacy notice</a> and agree to Kontaa processing my financial records to provide the service.
          </ConsentRow>
          <ConsentRow id="marketingConsent" {...register('marketingConsent')}>
            Send me occasional product updates. Optional; you can change this any time.
          </ConsentRow>
        </fieldset>

        <Button type="submit" size="lg" loading={signup.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

type ConsentProps = React.InputHTMLAttributes<HTMLInputElement> & { id: string; error?: string; children: React.ReactNode };

function ConsentRow({ id, error, children, ...input }: ConsentProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <div>
      <label htmlFor={id} className="flex items-start gap-3 text-sm text-muted">
        <Checkbox id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-msg` : undefined} {...input} />
        <span>{children}</span>
      </label>
      {error && (
        <p id={`${id}-msg`} role="alert" className="mt-1 ml-8 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
