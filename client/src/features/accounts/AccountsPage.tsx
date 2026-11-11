import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/money';
import { can } from '@/features/workspaces/useWorkspaces';
import type { Account } from '@/types/api';
import { useAccounts, useDeleteAccount, useSaveAccount, useWs } from '@/features/finance/hooks';
import { ACCOUNT_TYPE_LABEL, AccountIcon } from '@/features/finance/icons';
import { AccountDialog } from './AccountDialog';

export function AccountsPage() {
  const ws = useWs();
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts(showArchived);
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const save = useSaveAccount();
  const remove = useDeleteAccount();
  const writable = can(ws.workspace, 'records.write');

  const active = useMemo(() => accounts.data?.items.filter((a) => a.status === 'active') ?? [], [accounts.data]);
  const archived = accounts.data?.items.filter((a) => a.status === 'archived') ?? [];
  // Totals come from the server; the client never adds money up itself.
  const totals = accounts.data?.totals ?? [];

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">Accounts</h1>
          <p className="max-w-xl text-muted">Where your money sits: cash, bank, mobile money. Balances are worked out from what you record here.</p>
        </div>
        {writable && (
          <Button onClick={openNew}>
            <Plus /> Add account
          </Button>
        )}
      </header>

      {totals.length > 0 && (
        <section aria-label="Totals by currency" className="flex flex-wrap gap-3">
          {totals.map((t) => (
            <div key={t.currency} className="neu-inset rounded-2xl px-4 py-3">
              <p className="text-xs text-subtle">Total in {t.currency}</p>
              <p className={cn('tabular text-xl font-semibold', t.amount.startsWith('-') && 'text-danger')}>{formatMoney(t.amount, t.currency)}</p>
            </div>
          ))}
        </section>
      )}

      {accounts.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-3xl" />)}
        </div>
      ) : accounts.error ? (
        <Alert tone="danger">{accounts.error.message}</Alert>
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="Add your first account"
            action={writable && <Button onClick={openNew}><Plus /> Add account</Button>}
          >
            Start with where you spend from most, like your MoMo wallet or cash. Enter what’s in it today and Kontaa keeps the balance as you record transactions.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((a) => (
            <AccountCard key={a.id} account={a} writable={writable} onEdit={() => { setEditing(a); setOpen(true); }} onArchive={() => save.mutate({ id: a.id, status: 'archived' }, { onSuccess: () => toast.success(`${a.name} archived`), onError: (e) => toast.error(e.message) })} onDelete={() => remove.mutate(a.id, { onSuccess: () => toast.success(`${a.name} deleted`), onError: (e) => toast.error(e.message) })} />
          ))}
        </ul>
      )}

      <div>
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
          {showArchived ? 'Hide archived accounts' : 'Show archived accounts'}
        </Button>
        {showArchived && (
          archived.length === 0 ? <p className="mt-2 px-3 text-sm text-muted">No archived accounts.</p> : (
            <ul className="mt-3 grid gap-2">
              {archived.map((a) => (
                <li key={a.id} className="neu-pressed flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
                  <AccountIcon type={a.type} className="size-4 text-subtle" />
                  <span className="flex-1">{a.name}</span>
                  <span className="tabular text-muted">{formatMoney(a.balance, a.currency)}</span>
                  {writable && (
                    <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: a.id, status: 'active' }, { onSuccess: () => toast.success(`${a.name} restored`) })}>
                      <ArchiveRestore /> Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      <AccountDialog open={open} onOpenChange={setOpen} account={editing} />
    </div>
  );
}

function AccountCard({ account: a, writable, onEdit, onArchive, onDelete }: { account: Account; writable: boolean; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  const negative = a.balance.startsWith('-');
  return (
    <li className="glass relative flex flex-col gap-4 rounded-3xl p-5">
      <div className="flex items-start gap-3">
        <span className="neu-raised-sm grid size-11 shrink-0 place-items-center rounded-2xl text-primary">
          <AccountIcon type={a.type} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link to={`/transactions?accountId=${a.id}`} className="block truncate font-semibold hover:text-primary after:absolute after:inset-0 after:content-['']">
            {a.name}
          </Link>
          <p className="truncate text-sm text-muted">{a.institution || ACCOUNT_TYPE_LABEL[a.type]}</p>
        </div>
        {writable && (
          <DropdownMenu>
            <DropdownMenuTrigger className="relative z-10 rounded-lg p-1.5 text-subtle hover:text-ink" aria-label={`Actions for ${a.name}`}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}><Pencil /> Edit</DropdownMenuItem>
              {a.transactionCount > 0 ? (
                <DropdownMenuItem onSelect={onArchive}><Archive /> Archive</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onDelete} className="text-danger"><Trash2 className="!text-danger" /> Delete</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="neu-inset rounded-2xl px-4 py-3">
        <p className="text-xs text-subtle">Balance</p>
        <p className={cn('tabular text-2xl font-semibold tracking-tight', negative && 'text-danger')}>{formatMoney(a.balance, a.currency)}</p>
      </div>
      <p className="flex items-center justify-between text-xs text-subtle">
        <span>{a.transactionCount === 0 ? 'No transactions yet' : `${a.transactionCount} transaction${a.transactionCount === 1 ? '' : 's'}`}</span>
        <Badge>{a.currency}</Badge>
      </p>
    </li>
  );
}
