import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import { Download, Laptop, LogOut } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Checkbox, Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { ThemeToggle } from '@/components/layout/Brand';
import { formatDate } from '@/lib/utils';
import { api, applyFieldErrors } from '@/services/api';
import { queryClient } from '@/app/queryClient';
import { useAuth } from '@/stores/auth';
import type { SessionInfo } from '@/types/api';
import { useLogout, useUpdateProfile } from '@/features/auth/useAuthActions';
import { passwordRule } from '@/features/auth/schemas';

export function SettingsPage() {
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">Settings</h1>
          <p className="text-muted">Your profile, sign-in security and privacy choices.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="neu"><Link to="/settings/billing">Plan and billing</Link></Button>
          <Button asChild variant="neu"><Link to="/settings/workspace">Workspace</Link></Button>
          <Button asChild variant="neu"><Link to="/settings/categories">Categories</Link></Button>
          <Button asChild variant="neu"><Link to="/settings/exchange-rates">Exchange rates</Link></Button>
        </div>
      </header>
      <ProfileCard />
      <PasswordCard />
      <SessionsCard />
      <PrivacyCard />
    </div>
  );
}

const profileSchema = z.object({ name: z.string().trim().min(1, 'Enter your name.').max(80), defaultCurrency: z.string().length(3) });

function ProfileCard() {
  const user = useAuth((s) => s.user)!;
  const update = useUpdateProfile();
  const { register, handleSubmit, formState, reset, setError } = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name, defaultCurrency: user.defaultCurrency },
  });
  const onSubmit = handleSubmit((v) =>
    update.mutate(v, {
      onSuccess: ({ user: u }) => {
        reset({ name: u.name, defaultCurrency: u.defaultCurrency });
        toast.success('Profile saved');
      },
      onError: (err) => !applyFieldErrors(err, setError) && toast.error(err.message),
    }),
  );
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Signed in as {user.email} {user.emailVerified ? <Badge tone="primary">Confirmed</Badge> : <Badge tone="gold">Not confirmed</Badge>}
          </CardDescription>
        </div>
        <ThemeToggle />
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
        <Field label="Full name" htmlFor="p-name" error={formState.errors.name?.message}>
          <Input id="p-name" autoComplete="name" {...register('name')} />
        </Field>
        <Field label="Main currency" htmlFor="p-currency">
          <CurrencySelect id="p-currency" {...register('defaultCurrency')} />
        </Field>
        <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}

const pwSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: passwordRule, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' });

function PasswordCard() {
  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api('/users/me/password', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const { register, handleSubmit, formState, reset, setError } = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });
  const onSubmit = handleSubmit(({ currentPassword, newPassword }) =>
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          reset({ currentPassword: '', newPassword: '', confirm: '' });
          toast.success('Password changed. Other devices were signed out.');
        },
        onError: (err) => !applyFieldErrors(err, setError) && toast.error(err.message),
      },
    ),
  );
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing it signs you out everywhere except this device.</CardDescription>
        </div>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 md:grid-cols-3">
        <Field label="Current password" htmlFor="pw-current" error={formState.errors.currentPassword?.message}>
          <PasswordInput id="pw-current" autoComplete="current-password" {...register('currentPassword')} />
        </Field>
        <Field label="New password" htmlFor="pw-new" error={formState.errors.newPassword?.message}>
          <PasswordInput id="pw-new" autoComplete="new-password" {...register('newPassword')} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={formState.errors.confirm?.message}>
          <PasswordInput id="pw-confirm" autoComplete="new-password" {...register('confirm')} />
        </Field>
        <div className="md:col-span-3">
          <Button type="submit" variant="neu" loading={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function deviceLabel(ua: string) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  return `${browser} on ${os}`;
}

function SessionsCard() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionInfo[]>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Device signed out');
      return queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => toast.error(err.message),
  });
  const logout = useLogout();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>If you don’t recognise a device, sign it out and change your password.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate(true)}>
          <LogOut /> Sign out everywhere
        </Button>
      </CardHeader>
      {sessions.isPending ? (
        <Skeleton className="h-20" />
      ) : sessions.error ? (
        <Alert tone="danger">{sessions.error.message}</Alert>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {sessions.data!.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="neu-raised-sm grid size-10 place-items-center rounded-xl text-muted">
                <Laptop className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {deviceLabel(s.userAgent)} {s.current && <Badge tone="primary">This device</Badge>}
                </span>
                <span className="block text-sm text-muted">
                  Last active {formatDate(s.lastUsedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  {s.ip ? `, from ${s.ip}` : ''}
                </span>
              </span>
              {!s.current && (
                <Button size="sm" variant="neu" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PrivacyCard() {
  const user = useAuth((s) => s.user)!;
  const update = useUpdateProfile();
  const download = useMutation({
    mutationFn: () => api<unknown>('/users/me/export'),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'kontaa-profile.json' });
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>
            Read the <Link to="/legal/privacy" className="text-primary underline">privacy notice</Link> to see what Kontaa stores and why.
          </CardDescription>
        </div>
      </CardHeader>
      <div className="grid gap-4">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={user.marketingConsent}
            disabled={update.isPending}
            onChange={(e) =>
              update.mutate({ marketingConsent: e.target.checked }, { onSuccess: () => toast.success('Preference saved'), onError: (err) => toast.error(err.message) })
            }
          />
          <span>
            <span className="block font-medium">Product updates by email</span>
            <span className="text-muted">Occasional news about new features. Account and security emails are always sent.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="neu" loading={download.isPending} onClick={() => download.mutate()}>
            <Download /> Download my profile data
          </Button>
          <span className="text-sm text-muted">A JSON copy of your profile, consents and workspace memberships.</span>
        </div>
      </div>
    </Card>
  );
}
