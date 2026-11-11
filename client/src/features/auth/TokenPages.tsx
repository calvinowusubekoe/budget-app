import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { MailCheck } from 'lucide-react';
import { z } from 'zod';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Alert, Spinner } from '@/components/ui/feedback';
import { api } from '@/services/api';
import { useAuth } from '@/stores/auth';
import type { User } from '@/types/api';
import { forgotSchema, resetSchema } from './schemas';

export function ForgotPasswordPage() {
  const send = useMutation({ mutationFn: (body: { email: string }) => api('/auth/forgot-password', { method: 'POST', body }) });
  const { register, handleSubmit, formState } = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) });

  if (send.isSuccess) {
    return (
      <AuthLayout title="Check your email" footer={<Link to="/login" className="text-primary hover:underline">Back to sign in</Link>}>
        <Alert tone="success">
          If an account exists for <strong>{send.variables?.email}</strong>, we’ve sent a link to reset the password. It expires in one hour.
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email you signed up with and we’ll send you a reset link."
      footer={<Link to="/login" className="text-primary hover:underline">Back to sign in</Link>}
    >
      <form onSubmit={handleSubmit((v) => send.mutate(v))} noValidate className="grid gap-4">
        {send.error && <Alert tone="danger">{send.error.message}</Alert>}
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Button type="submit" size="lg" loading={send.isPending}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const reset = useMutation({ mutationFn: (password: string) => api('/auth/reset-password', { method: 'POST', body: { token, password } }) });
  const { register, handleSubmit, formState } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  if (!token) {
    return (
      <AuthLayout title="Reset link missing" footer={<Link to="/forgot-password" className="text-primary hover:underline">Request a new link</Link>}>
        <Alert tone="danger">Open the link from your email again, or request a new one.</Alert>
      </AuthLayout>
    );
  }
  if (reset.isSuccess) {
    return (
      <AuthLayout title="Password updated">
        <Alert tone="success">You’ve been signed out on every device. Sign in with your new password.</Alert>
        <Button asChild size="lg" className="mt-5 w-full">
          <Link to="/login">Sign in</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="This signs you out of BudgetFlow on every device.">
      <form onSubmit={handleSubmit((v) => reset.mutate(v.password))} noValidate className="grid gap-4">
        {reset.error && (
          <Alert tone="danger" action={<Link to="/forgot-password" className="text-sm font-medium text-primary">New link</Link>}>
            {reset.error.message}
          </Alert>
        )}
        <Field label="New password" htmlFor="password" error={formState.errors.password?.message} hint="At least 10 characters, with a letter and a number.">
          <PasswordInput id="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" error={formState.errors.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button type="submit" size="lg" loading={reset.isPending}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { status, setUser, user } = useAuth();
  const verify = useMutation({
    mutationFn: () => api<{ user: User }>('/auth/verify-email', { method: 'POST', body: { token } }),
    onSuccess: (data) => {
      // Only update the in-memory user if it is the same account.
      if (user?.id === data.user.id) setUser(data.user);
    },
  });
  const fired = useRef(false);
  useEffect(() => {
    if (token && !fired.current) {
      fired.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  const next = status === 'authenticated' ? '/' : '/login';
  return (
    <AuthLayout title="Confirm your email">
      {!token && <Alert tone="danger">This link is incomplete. Open the link from your email again.</Alert>}
      {verify.isPending && <Spinner label="Confirming your email" />}
      {verify.isError && <Alert tone="danger">{verify.error.message}</Alert>}
      {verify.isSuccess && (
        <div className="grid justify-items-center gap-4 text-center">
          <div className="neu-raised grid size-14 place-items-center rounded-2xl text-primary">
            <MailCheck className="size-6" aria-hidden />
          </div>
          <p className="text-muted">Your email address is confirmed.</p>
        </div>
      )}
      {(verify.isSuccess || verify.isError || !token) && (
        <Button asChild size="lg" variant={verify.isSuccess ? 'primary' : 'neu'} className="mt-5 w-full">
          <Link to={next}>{status === 'authenticated' ? 'Go to dashboard' : 'Sign in'}</Link>
        </Button>
      )}
    </AuthLayout>
  );
}
