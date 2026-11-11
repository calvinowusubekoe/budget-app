import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert } from '@/components/ui/feedback';
import { safeNext } from '@/app/guards';
import { loginSchema, type LoginValues } from './schemas';
import { useLogin } from './useAuthActions';
import { useMeta } from '@/hooks/useMeta';

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();
  const { demo } = useMeta();
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, { onSuccess: () => navigate(safeNext(params.get('next')), { replace: true }) }),
  );

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Pick up where you left off with your budgets and Susu records."
      footer={
        <>
          New to Kontaa?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {login.error && <Alert tone="danger">{login.error.message}</Alert>}
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <div className="-mt-1 text-right">
          <Link to="/forgot-password" className="text-sm text-primary hover:underline">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={login.isPending}>
          Sign in
        </Button>
        {demo && (
          <div className="grid gap-2 border-t border-[var(--line)] pt-4 text-center text-sm">
            <p className="text-muted">Testing Kontaa? Explore a demo account with sample data.</p>
            <Button type="button" variant="neu" loading={login.isPending && login.variables?.email === demo.email} onClick={() => login.mutate(demo, { onSuccess: () => navigate(safeNext(params.get('next')), { replace: true }) })}>
              Use the demo account
            </Button>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}
