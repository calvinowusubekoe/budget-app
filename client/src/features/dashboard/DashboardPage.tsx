import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Coins, CreditCard, PiggyBank, Plus, Target, UsersRound, Wallet } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMoney, isZero, monthRange } from '@/lib/money';
import { api } from '@/services/api';
import { useAuth } from '@/stores/auth';
import { can, useActiveWorkspace } from '@/features/workspaces/useWorkspaces';
import { useDashboard } from '@/features/finance/hooks';
import { AccountIcon, CategoryIcon } from '@/features/finance/icons';
import { TransactionDialog } from '@/features/transactions/TransactionDialog';
import { TransactionDetail } from '@/features/transactions/TransactionDetail';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import type { Summary, Transaction } from '@/types/api';

function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * The balance well: an inset basin holding this month's net cash flow,
 * which is income minus spending in the reporting currency. Every figure comes from
 * the server's exact decimal totals.
 */
function BalanceWell({ summary, writable, onRecord, empty }: { summary?: Summary; writable: boolean; onRecord: () => void; empty: boolean }) {
  const month = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date());
  const cur = summary?.currency ?? 'GHS';
  const net = summary?.net ?? '0';
  const negative = net.startsWith('-');
  return (
    <section aria-labelledby="well-title" className="neu-well relative overflow-hidden rounded-4xl p-6 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full border-18 border-gold/15" />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h2 id="well-title" className="text-sm font-medium text-muted">Net cash flow, {month}</h2>
          {!summary ? (
            <Skeleton className="mt-3 h-14 w-64" />
          ) : (
            <p className={cn('tabular mt-2 text-5xl font-semibold tracking-tight sm:text-6xl', negative ? 'text-danger' : isZero(net) ? 'text-subtle' : 'text-ink')}>
              {formatMoney(net, cur, { sign: negative ? '-' : isZero(net) ? undefined : '+' })}
            </p>
          )}
          {summary && !empty && (
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div><dt className="text-muted">Came in</dt><dd className="tabular font-semibold text-primary">{formatMoney(summary.income, cur)}</dd></div>
              <div><dt className="text-muted">Went out</dt><dd className="tabular font-semibold">{formatMoney(summary.expense, cur)}</dd></div>
            </dl>
          )}
          {empty && <p className="mt-3 max-w-md text-sm text-muted">Nothing recorded this month yet. This shows what came in minus what went out. Transfers between your own accounts don’t count.</p>}
        </div>
        {writable && <Button onClick={onRecord}><Plus /> Record a transaction</Button>}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const { workspace, isLoading, error } = useActiveWorkspace();
  const range = monthRange();
  const dash = useDashboard(range);
  const resend = useMutation({ mutationFn: () => api('/auth/resend-verification', { method: 'POST' }) });
  const [recording, setRecording] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (isLoading || !workspace) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-56 rounded-4xl" />
      </div>
    );
  }

  const writable = can(workspace, 'records.write');
  const d = dash.data;
  const monthEmpty = Boolean(d && d.summary.incomeCount + d.summary.expenseCount === 0);
  const noAccounts = d?.accounts.length === 0;
  const isBusiness = workspace.type === 'business';

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm text-muted">{greeting()},</p>
        <h1 className="text-[28px] font-semibold">{user.name.split(' ')[0]}</h1>
      </header>

      {!user.emailVerified && (
        <Alert
          tone="gold"
          action={
            <Button size="sm" variant="neu" loading={resend.isPending} disabled={resend.isSuccess} onClick={() => resend.mutate()}>
              {resend.isSuccess ? 'Email sent' : 'Resend email'}
            </Button>
          }
        >
          <span className="block font-medium">Confirm your email address</span>
          <span className="text-muted">We sent a link to {user.email}. Confirming it lets you recover your account if you forget your password.</span>
          {resend.isError && <span className="mt-1 block text-danger">{resend.error.message}</span>}
        </Alert>
      )}

      {dash.error && <Alert tone="danger">{dash.error.message}</Alert>}

      <BalanceWell summary={d?.summary} writable={writable} empty={monthEmpty} onRecord={() => setRecording(true)} />

      {noAccounts ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="Start with an account"
            action={writable && <Button asChild><Link to="/accounts"><Plus /> Add an account</Link></Button>}
          >
            Add where your money sits, such as cash, a MoMo wallet or a bank account, with today’s balance. Then record what comes in and goes out.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>{d ? `${d.totalTransactions} recorded in total` : ' '}</CardDescription>
              </div>
              <Button asChild size="sm" variant="ghost"><Link to="/transactions">See all</Link></Button>
            </CardHeader>
            {!d ? <Skeleton className="h-48" /> : d.recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No transactions yet.</p>
            ) : (
              <ul className="-mx-2">{d.recent.map((t) => <TransactionRow key={t.id} t={t} showDate onOpen={() => setDetail(t.id)} />)}</ul>
            )}
          </Card>

          <div className="grid content-start gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Accounts</CardTitle>
                <Button asChild size="sm" variant="ghost"><Link to="/accounts">Manage</Link></Button>
              </CardHeader>
              {!d ? <Skeleton className="h-24" /> : (
                <ul className="grid gap-2">
                  {d.accounts.map((a) => (
                    <li key={a.id}>
                      <Link to={`/transactions?accountId=${a.id}`} className="flex items-center gap-3 rounded-xl px-1 py-1.5 hover:bg-line">
                        <span className="neu-raised-sm grid size-9 place-items-center rounded-xl text-primary"><AccountIcon type={a.type} className="size-4" /></span>
                        <span className="flex-1 truncate text-sm font-medium">{a.name}</span>
                        <span className={cn('tabular text-sm font-semibold', a.balance.startsWith('-') && 'text-danger')}>{formatMoney(a.balance, a.currency)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {d && d.summary.expenseByCategory.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Where it went this month</CardTitle></CardHeader>
                <ul className="grid gap-3">
                  {d.summary.expenseByCategory.slice(0, 5).map((c) => (
                    <li key={c.categoryId} className="grid gap-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <CategoryIcon icon={c.icon} className="size-4 text-muted" />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="tabular font-medium">{formatMoney(c.amount, d.summary.currency)}</span>
                      </div>
                      <div className="neu-inset h-2 overflow-hidden rounded-full" aria-hidden>
                        <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(Number(c.share), 2)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {d && <PlanningCard d={d} />}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Coming next</CardTitle>
            <CardDescription>Being built in this order.</CardDescription>
          </div>
          {isBusiness && can(workspace, 'invitations.manage') && (
            <Button asChild size="sm" variant="neu"><Link to="/settings/workspace"><UsersRound /> Invite your team</Link></Button>
          )}
        </CardHeader>
        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Target, title: 'Business tools', body: 'Customers, suppliers, invoices, bills and profit and loss.' },
            { icon: CreditCard, title: 'Subscriptions', body: 'Paid BudgetFlow plans, billed securely by an approved provider.' },
            { icon: PiggyBank, title: 'Reports and AI', body: 'Charts, period reports and an optional assistant that explains your numbers.' },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="neu-raised-sm grid size-9 shrink-0 place-items-center rounded-xl text-primary"><Icon className="size-4" aria-hidden /></span>
              <span><span className="block text-sm font-medium">{title}</span><span className="block text-sm text-muted">{body}</span></span>
            </li>
          ))}
        </ul>
      </Card>

      <TransactionDialog open={recording || Boolean(editing)} transaction={editing} onOpenChange={(o) => { if (!o) { setRecording(false); setEditing(null); } }} />
      <TransactionDetail id={detail} onClose={() => setDetail(null)} onEdit={(t) => { setDetail(null); setEditing(t); }} />
    </div>
  );
}

/** Budgets, savings and debts at a glance. Every figure is a server total. */
function PlanningCard({ d }: { d: import('@/types/api').Dashboard }) {
  const hasAny = d.budgets.length || d.savings.length || d.debts.length || d.susu.length;
  if (!hasAny) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Plan ahead</CardTitle>
            <CardDescription>Set a budget, save toward a goal, or keep track of a loan.</CardDescription>
          </div>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="neu" size="sm"><Link to="/budgets"><Target /> Create a budget</Link></Button>
          <Button asChild variant="neu" size="sm"><Link to="/savings"><PiggyBank /> Start a savings goal</Link></Button>
          <Button asChild variant="neu" size="sm"><Link to="/debts"><CreditCard /> Track a debt</Link></Button>
        </div>
      </Card>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Budgets</CardTitle>
          <Button asChild size="sm" variant="ghost"><Link to="/budgets">See all</Link></Button>
        </CardHeader>
        {d.budgets.length === 0 ? (
          <p className="text-sm text-muted">No active budgets. <Link to="/budgets" className="text-primary hover:underline">Create one</Link></p>
        ) : (
          <ul className="grid gap-4">
            {[...d.budgets].sort((a, b) => Number(b.current.utilisation) - Number(a.current.utilisation)).slice(0, 4).map((b) => (
              <li key={b.id} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{b.name}</span>
                  <span className={cn('tabular', b.current.state === 'over' ? 'text-danger' : 'text-muted')}>
                    {formatMoney(b.current.spent, b.currency)} of {formatMoney(b.current.amount, b.currency)}
                  </span>
                </div>
                <Progress value={b.current.utilisation} tone={b.current.state === 'over' ? 'danger' : b.current.state === 'warning' ? 'gold' : 'primary'} label={`${b.name}: ${b.current.utilisation}%`} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Savings, Susu and debts</CardTitle></CardHeader>
        <dl className="grid gap-3 text-sm">
          {d.savings.map((s) => (
            <Link key={`s-${s.currency}`} to="/savings" className="flex items-center justify-between rounded-xl px-1 py-1 hover:bg-line">
              <dt className="flex items-center gap-2 text-muted"><PiggyBank className="size-4" /> Saved toward {s.goals} goal{s.goals === 1 ? '' : 's'}</dt>
              <dd className="tabular font-semibold">{formatMoney(s.saved, s.currency)}</dd>
            </Link>
          ))}
          {d.susu.map((s) => (
            <Link key={`su-${s.currency}`} to="/susu" className="flex items-center justify-between rounded-xl px-1 py-1 hover:bg-line">
              <dt className="flex items-center gap-2 text-muted">
                <Coins className="size-4" /> Susu recorded ({s.plans} plan{s.plans === 1 ? '' : 's'})
                {s.missed > 0 && <span className="text-danger">({s.missed} missed)</span>}
              </dt>
              <dd className="tabular font-semibold text-gold-ink">{formatMoney(s.current, s.currency)}</dd>
            </Link>
          ))}
          {d.debts.map((x) => (
            <Link key={`d-${x.direction}-${x.currency}`} to="/debts" className="flex items-center justify-between rounded-xl px-1 py-1 hover:bg-line">
              <dt className="flex items-center gap-2 text-muted">
                <CreditCard className="size-4" /> {x.direction === 'i_owe' ? 'You owe' : 'Owed to you'}
                {x.overdue > 0 && <span className="text-danger">({x.overdue} overdue)</span>}
              </dt>
              <dd className={cn('tabular font-semibold', x.direction === 'i_owe' && 'text-danger')}>{formatMoney(x.balance, x.currency)}</dd>
            </Link>
          ))}
          {d.savings.length === 0 && d.debts.length === 0 && d.susu.length === 0 && <p className="text-muted">No savings goals, Susu plans or debts tracked yet.</p>}
        </dl>
      </Card>
    </div>
  );
}
