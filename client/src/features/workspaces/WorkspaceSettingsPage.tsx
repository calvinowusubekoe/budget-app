import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { History, MailPlus, Trash2, UsersRound } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { formatDate, initials } from '@/lib/utils';
import { applyFieldErrors } from '@/services/api';
import { useAuth } from '@/stores/auth';
import type { AuditEntry, Role, Workspace } from '@/types/api';
import {
  can,
  useActiveWorkspace,
  useAudit,
  useChangeRole,
  useInvitations,
  useInvite,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateWorkspace,
} from './useWorkspaces';

const ROLE_HELP: Record<Exclude<Role, 'owner'>, string> = {
  admin: 'Manage settings and people',
  member: 'Add and edit records',
  viewer: 'Read-only',
};

export function WorkspaceSettingsPage() {
  const { workspace, isLoading } = useActiveWorkspace();
  if (isLoading || !workspace) return <Skeleton className="h-64 rounded-3xl" />;
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-[28px] font-semibold">Workspace settings</h1>
        <p className="text-muted">{workspace.name}. You are {workspace.role === 'owner' ? 'the owner' : `a${workspace.role === 'admin' ? 'n' : ''} ${workspace.role}`}.</p>
      </header>
      <DetailsCard key={workspace.id} workspace={workspace} />
      <MembersCard workspace={workspace} />
      {can(workspace, 'audit.read') && <AuditCard workspace={workspace} />}
    </div>
  );
}

const detailsSchema = z.object({ name: z.string().trim().min(1, 'Name the workspace.').max(80), baseCurrency: z.string().length(3) });

function DetailsCard({ workspace }: { workspace: Workspace }) {
  const editable = can(workspace, 'workspace.update');
  const update = useUpdateWorkspace(workspace.id);
  const { register, handleSubmit, formState, setError, reset } = useForm<z.infer<typeof detailsSchema>>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: workspace.name, baseCurrency: workspace.baseCurrency },
  });
  const onSubmit = handleSubmit((v) =>
    update.mutate(v, {
      onSuccess: (ws) => {
        reset({ name: ws.name, baseCurrency: ws.baseCurrency });
        toast.success('Workspace updated');
      },
      onError: (err) => applyFieldErrors(err, setError),
    }),
  );
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            {editable ? 'Changing the reporting currency affects how totals are shown. Past records keep the exchange rate they were saved with.' : 'Only owners and admins can change these.'}
          </CardDescription>
        </div>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
        <Field label="Name" htmlFor="ws-name" error={formState.errors.name?.message}>
          <Input id="ws-name" disabled={!editable} {...register('name')} />
        </Field>
        <Field label="Reporting currency" htmlFor="ws-currency">
          <CurrencySelect id="ws-currency" disabled={!editable} {...register('baseCurrency')} />
        </Field>
        {editable && (
          <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
            Save changes
          </Button>
        )}
      </form>
      {update.error && !applyFieldErrors(update.error, () => undefined) && <Alert tone="danger" className="mt-4">{update.error.message}</Alert>}
    </Card>
  );
}

const inviteSchema = z.object({ email: z.string().trim().email('Enter a valid email address.'), role: z.enum(['admin', 'member', 'viewer']) });

function MembersCard({ workspace }: { workspace: Workspace }) {
  const me = useAuth((s) => s.user)!;
  const manage = can(workspace, 'members.manage');
  const members = useMembers(workspace.id);
  const invitations = useInvitations(workspace.id, can(workspace, 'invitations.manage'));
  const invite = useInvite(workspace.id);
  const revoke = useRevokeInvitation(workspace.id);
  const changeRole = useChangeRole(workspace.id);
  const remove = useRemoveMember(workspace.id);
  const [confirming, setConfirming] = useState<string | null>(null);

  const assignable: Exclude<Role, 'owner'>[] = workspace.role === 'owner' ? ['admin', 'member', 'viewer'] : ['member', 'viewer'];
  const { register, handleSubmit, formState, reset, setError, watch } = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'member' },
  });
  const inviteRole = watch('role');

  const onInvite = handleSubmit((v) =>
    invite.mutate(v, {
      onSuccess: (inv) => {
        reset({ email: '', role: v.role });
        toast.success(`Invitation sent to ${inv.email}`);
      },
      onError: (err) => {
        if (!applyFieldErrors(err, setError)) toast.error(err.message);
      },
    }),
  );

  const onError = (err: Error) => toast.error(err.message);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>People</CardTitle>
          <CardDescription>
            {workspace.type === 'personal' ? 'Personal workspaces are private to you. Create a business workspace to work with a team.' : 'Everyone here can see this workspace’s records. Roles control who can change them.'}
          </CardDescription>
        </div>
      </CardHeader>

      {workspace.type === 'business' && can(workspace, 'invitations.manage') && (
        <form onSubmit={onInvite} noValidate className="neu-inset mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-start [&>button]:sm:mt-7">
          <Field label="Invite by email" htmlFor="invite-email" error={formState.errors.email?.message}>
            <Input id="invite-email" type="email" placeholder="name@company.com" className="glass shadow-none" {...register('email')} />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint={ROLE_HELP[inviteRole]}>
            <Select id="invite-role" className="glass shadow-none" {...register('role')}>
              {assignable.map((r) => (
                <option key={r} value={r}>
                  {r[0]!.toUpperCase() + r.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={invite.isPending}>
            <MailPlus /> Send invite
          </Button>
        </form>
      )}

      {members.isPending ? (
        <Skeleton className="h-24" />
      ) : members.error ? (
        <Alert tone="danger">{members.error.message}</Alert>
      ) : (
        <ul className="divide-y divide-line">
          {members.data!.map((m) => {
            const isMe = m.userId === me.id;
            const editable = manage && m.role !== 'owner' && !isMe && assignable.includes(m.role as Exclude<Role, 'owner'>);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="neu-raised-sm grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-primary">{initials(m.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {m.name} {isMe && <span className="text-subtle">(you)</span>}
                  </span>
                  <span className="block truncate text-sm text-muted">{m.email}</span>
                </span>
                {editable ? (
                  <Select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    className="h-9 w-32 text-sm"
                    onChange={(e) => changeRole.mutate({ memberId: m.id, role: e.target.value as Exclude<Role, 'owner'> }, { onError, onSuccess: () => toast.success(`${m.name} is now ${e.target.value}`) })}
                  >
                    {assignable.map((r) => (
                      <option key={r} value={r}>
                        {r[0]!.toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone={m.role === 'owner' ? 'gold' : 'neutral'} className="capitalize">
                    {m.role}
                  </Badge>
                )}
                {m.role !== 'owner' && (isMe || editable) && (
                  confirming === m.id ? (
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(m.id, { onError, onSuccess: () => setConfirming(null) })}>
                        {isMe ? 'Leave' : 'Remove'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button size="icon" variant="ghost" aria-label={isMe ? 'Leave workspace' : `Remove ${m.name}`} onClick={() => setConfirming(m.id)}>
                      <Trash2 />
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {invitations.data && invitations.data.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-medium text-muted">Waiting to accept</h3>
          <ul className="grid gap-2">
            {invitations.data.map((inv) => (
              <li key={inv.id} className="neu-pressed flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                <span className="text-subtle capitalize">{inv.role}</span>
                <span className="text-subtle">{inv.status === 'expired' ? 'Expired' : `Expires ${formatDate(inv.expiresAt)}`}</span>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(inv.id, { onError, onSuccess: () => toast.success('Invitation revoked') })}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {workspace.type === 'business' && members.data?.length === 1 && !invitations.data?.length && (
        <EmptyState icon={UsersRound} title="Just you so far">
          Invite a co-owner, bookkeeper or staff member. They get their own sign-in and only the access you choose.
        </EmptyState>
      )}
    </Card>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'workspace.updated': 'updated workspace details',
  'invitation.created': 'sent an invitation',
  'invitation.revoked': 'revoked an invitation',
  'invitation.accepted': 'joined the workspace',
  'member.role_changed': 'changed a member’s role',
  'member.removed': 'removed a member',
  'member.left': 'left the workspace',
};

function describe(e: AuditEntry) {
  const m = e.metadata as Record<string, string | undefined>;
  if (e.action === 'invitation.created' && m.email) return `invited ${m.email} as ${m.role}`;
  if (e.action === 'member.role_changed') return `changed a role from ${m.from} to ${m.to}`;
  return ACTION_LABELS[e.action] ?? e.action;
}

function AuditCard({ workspace }: { workspace: Workspace }) {
  const audit = useAudit(workspace.id, true);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Activity</CardTitle>
          <CardDescription>A permanent record of changes in this workspace. Entries can’t be edited or deleted.</CardDescription>
        </div>
      </CardHeader>
      {audit.isPending ? (
        <Skeleton className="h-24" />
      ) : audit.error ? (
        <Alert tone="danger">{audit.error.message}</Alert>
      ) : audit.data!.length === 0 ? (
        <EmptyState icon={History} title="No activity yet" />
      ) : (
        <ol className="grid gap-2.5">
          {audit.data!.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span>
                <span className="font-medium">{e.actor?.name ?? 'System'}</span> <span className="text-muted">{describe(e)}</span>
              </span>
              <time className="tabular text-xs text-subtle" dateTime={e.createdAt}>
                {formatDate(e.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
