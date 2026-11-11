import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn, initials } from '@/lib/utils';
import { formatMoney } from '@/lib/money';
import { ApiError } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { Party } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { usePartyMutations, useParties, type PartyKind } from './hooks';

export function ContactsPage() {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [params, setParams] = useSearchParams();
  const kind: PartyKind = params.get('type') === 'supplier' ? 'supplier' : 'customer';
  const [showArchived, setShowArchived] = useState(false);
  const parties = useParties(kind, showArchived);
  const m = usePartyMutations(kind);
  const [editing, setEditing] = useState<Party | null | undefined>(undefined);
  const onErr = (e: Error) => toast.error(e.message);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/business" className="text-sm text-primary hover:underline">Business</Link>
          <h1 className="text-[28px] font-semibold">Customers and suppliers</h1>
          <p className="text-muted">Who you sell to and buy from. Contact details are visible to everyone in this workspace.</p>
        </div>
        {writable && <Button onClick={() => setEditing(null)}><Plus /> Add {kind}</Button>}
      </header>

      <div role="tablist" aria-label="Contact type" className="neu-inset inline-flex gap-1 justify-self-start rounded-2xl p-1">
        {(['customer', 'supplier'] as const).map((k) => (
          <button key={k} role="tab" type="button" aria-selected={kind === k} onClick={() => setParams({ type: k }, { replace: true })} className={cn('rounded-xl px-4 py-1.5 text-sm font-medium transition', kind === k ? 'neu-raised-sm text-primary' : 'text-muted hover:text-ink')}>
            {k === 'customer' ? 'Customers' : 'Suppliers'}
          </button>
        ))}
      </div>

      <Card>
        {parties.isPending ? <Skeleton className="h-32" /> : parties.error ? <Alert tone="danger">{parties.error.message}</Alert> : parties.data.length === 0 ? (
          <EmptyState icon={UsersRound} title={`No ${kind}s yet`} action={writable && <Button onClick={() => setEditing(null)}><Plus /> Add {kind}</Button>}>
            {kind === 'customer' ? 'Add the businesses and people you invoice.' : 'Add the businesses you buy stock or services from.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {parties.data.map((p) => (
              <li key={p.id} className={cn('flex flex-wrap items-center gap-3 py-3', p.status === 'archived' && 'opacity-60')}>
                <span className="neu-raised-sm grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-primary">{initials(p.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">{p.name}{p.status === 'archived' && <Badge>Archived</Badge>}</span>
                  <span className="block truncate text-xs text-muted">{[p.email, p.phone].filter(Boolean).join(', ') || 'No contact details'}</span>
                </span>
                <span className="text-right text-sm">
                  {p.outstanding.length ? p.outstanding.map((o) => <span key={o.currency} className="tabular block font-semibold">{formatMoney(o.amount, o.currency)}</span>) : <span className="text-muted">Nothing owed</span>}
                  {p.outstanding.length > 0 && <span className="block text-xs text-subtle">{kind === 'customer' ? 'owes you' : 'you owe'}</span>}
                </span>
                {writable && (
                  <span className="flex gap-1">
                    <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil /></Button>
                    {p.status === 'active' ? (
                      <Button size="icon" variant="ghost" className="size-8" aria-label={`Archive ${p.name}`} onClick={() => m.save.mutate({ id: p.id, status: 'archived' }, { onSuccess: () => toast.success(`${p.name} archived`), onError: onErr })}><Archive /></Button>
                    ) : (
                      <Button size="icon" variant="ghost" className="size-8" aria-label={`Restore ${p.name}`} onClick={() => m.save.mutate({ id: p.id, status: 'active' }, { onSuccess: () => toast.success(`${p.name} restored`), onError: onErr })}><ArchiveRestore /></Button>
                    )}
                    <Button size="icon" variant="ghost" className="size-8" aria-label={`Delete ${p.name}`} onClick={() => m.remove.mutate(p.id, { onSuccess: () => toast.success(`${p.name} deleted`), onError: onErr })}><Trash2 /></Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Hide archived' : 'Show archived'}</Button>
      {editing !== undefined && <PartyDialog kind={kind} party={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function PartyDialog({ kind, party, onClose }: { kind: PartyKind; party: Party | null; onClose: () => void }) {
  const m = usePartyMutations(kind);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', taxId: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setForm({ name: party?.name ?? '', email: party?.email ?? '', phone: party?.phone ?? '', address: party?.address ?? '', taxId: party?.taxId ?? '', notes: party?.notes ?? '' });
  }, [party]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrors({ name: 'Enter a name.' });
    m.save.mutate(party ? { id: party.id, ...form } : form, {
      onSuccess: (p) => { toast.success(party ? 'Saved' : `${p.name} added`); onClose(); },
      onError: (er) => (er instanceof ApiError && er.details ? setErrors(Object.fromEntries(er.details.map((d) => [d.field, d.message]))) : toast.error(er.message)),
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{party ? `Edit ${party.name}` : `Add a ${kind}`}</DialogTitle>
        <form onSubmit={submit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="pt-name" error={errors.name} className="sm:col-span-2"><Input id="pt-name" value={form.name} onChange={set('name')} /></Field>
          <Field label="Email" htmlFor="pt-email" error={errors.email}><Input id="pt-email" type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Phone" htmlFor="pt-phone"><Input id="pt-phone" inputMode="tel" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Address" htmlFor="pt-addr" className="sm:col-span-2"><Input id="pt-addr" value={form.address} onChange={set('address')} /></Field>
          <Field label="Tax ID (optional)" htmlFor="pt-tax" hint="e.g. a Ghana TIN, shown for reference only."><Input id="pt-tax" value={form.taxId} onChange={set('taxId')} /></Field>
          <Field label="Notes" htmlFor="pt-notes"><Input id="pt-notes" value={form.notes} onChange={set('notes')} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.save.isPending}>{party ? 'Save' : `Add ${kind}`}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
