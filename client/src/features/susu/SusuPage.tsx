import { useState } from 'react';
import { Link } from 'react-router';
import { Coins, Plus, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd } from '@/lib/money';
import { can } from '@/features/workspaces/useWorkspaces';
import { useWs } from '@/features/finance/hooks';
import { describeFrequency, LOCATION_LABEL, useSusuPlans, useSusuSummary } from './hooks';
import { PlanDialog } from './PlanDialog';
import { GroupDialog } from './GroupDialog';
import { useMyGroups } from './groupHooks';
import { ROLE_LABEL } from './groupHooks';
import { isZero } from '@/lib/money';

export function SusuPage() {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [showClosed, setShowClosed] = useState(false);
  const plans = useSusuPlans(showClosed);
  const summary = useSusuSummary();
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">Susu</h1>
          <p className="max-w-xl text-muted">Keep a clear record of the Susu you save, whether in a box at home or with a collector.</p>
        </div>
        {writable && <Button onClick={() => setOpen(true)}><Plus /> New personal plan</Button>}
      </header>

      <Alert tone="info">
        <span className="block font-medium">BudgetFlow never holds or moves Susu money</span>
        <span className="text-muted">You pay in and withdraw the way you always have. BudgetFlow only keeps the record you enter, and it isn’t counted as income or spending.</span>
      </Alert>

      <section aria-labelledby="personal-title" className="grid gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-gold-soft text-gold-ink"><Coins className="size-4" aria-hidden /></span>
          <div>
            <h2 id="personal-title" className="font-semibold">Personal Susu</h2>
            <p className="text-sm text-muted">Your own savings plans.</p>
          </div>
          {summary.data && summary.data.totals.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              {summary.data.totals.map((t) => (
                <div key={t.currency} className="neu-inset rounded-2xl px-3 py-2 text-right">
                  <p className="text-[11px] text-subtle">Recorded, {t.currency}</p>
                  <p className="tabular font-semibold">{formatMoney(t.current, t.currency)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {plans.isPending ? (
          <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-3xl" />)}</div>
        ) : plans.error ? (
          <Alert tone="danger">{plans.error.message}</Alert>
        ) : plans.data.length === 0 ? (
          <Card>
            <EmptyState icon={Coins} title="No Susu plans yet" action={writable && <Button onClick={() => setOpen(true)}><Plus /> Start a plan</Button>}>
              Say how much you put aside and how often, and who or where keeps it. Each time you contribute, record it here to see what you’ve saved and any days you missed.
            </EmptyState>
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.data.map((p) => {
              const s = p.summary;
              return (
                <li key={p.id}>
                  <Link to={`/susu/plans/${p.id}`} className={cn('glass flex h-full flex-col gap-3 rounded-3xl p-5 transition hover:brightness-105', p.status !== 'active' && 'opacity-75')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{p.name}</p>
                        <p className="truncate text-sm text-muted">
                          {formatMoney(p.contributionAmount, p.currency)} {describeFrequency(p)}, {p.location.label || LOCATION_LABEL[p.location.type].toLowerCase()}
                        </p>
                      </div>
                      {p.status !== 'active' && <Badge className="capitalize">{p.status}</Badge>}
                    </div>
                    <p className="tabular text-2xl font-semibold tracking-tight">{formatMoney(s.current, p.currency)}</p>
                    {s.progress && <Progress value={s.progress} tone="gold" label={`${p.name}: ${s.progress}% of target`} />}
                    <p className="mt-auto text-sm">
                      {s.schedule.missed > 0 ? (
                        <span className="text-danger">{s.schedule.missed} missed, {formatMoney(s.schedule.arrears, p.currency)} behind</span>
                      ) : (
                        <span className="text-muted">Up to date</span>
                      )}
                      {s.schedule.nextDue && p.status === 'active' && <span className="text-subtle">. Next due {formatYmd(s.schedule.nextDue, { day: 'numeric', month: 'short' })}</span>}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowClosed((v) => !v)}>{showClosed ? 'Hide completed and cancelled' : 'Show completed and cancelled'}</Button>
      </section>

      <GroupsSection />

      <PlanDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

/** Groups the user belongs to, in any of their workspaces: groups are shared between people. */
function GroupsSection() {
  const groups = useMyGroups();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="group-title" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary"><UsersRound className="size-4" aria-hidden /></span>
        <div className="flex-1">
          <h2 id="group-title" className="font-semibold">Group Susu</h2>
          <p className="text-sm text-muted">Rotating groups you organise or belong to. Members join with their own accounts.</p>
        </div>
        <Button variant="neu" onClick={() => setOpen(true)}><Plus /> New group</Button>
      </div>
      {groups.isPending ? (
        <Skeleton className="h-32 rounded-3xl" />
      ) : groups.error ? (
        <Alert tone="danger">{groups.error.message}</Alert>
      ) : groups.data.length === 0 ? (
        <Card>
          <EmptyState icon={UsersRound} title="No groups yet">
            Organise a rotating Susu and keep its records here: who pays, who collects when, and payouts made. If someone invited you, open the link in their email.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.data.map((g) => (
            <li key={g.id}>
              <Link to={`/susu/groups/${g.id}`} className={cn('glass flex h-full flex-col gap-2 rounded-3xl p-5 transition hover:brightness-105', g.status !== 'active' && 'opacity-75')}>
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-semibold">{g.name}</p>
                  <Badge tone="primary">{ROLE_LABEL[g.me?.role ?? 'member']}</Badge>
                </div>
                <p className="text-sm text-muted">{formatMoney(g.contributionAmount, g.currency)} each, {describeFrequency(g)}. {g.memberCount} members.</p>
                {g.standing && (
                  <p className="mt-auto text-sm">
                    {isZero(g.standing.outstanding) ? <span className="text-muted">You’re up to date</span> : <span className="text-danger">You owe {formatMoney(g.standing.outstanding, g.currency)} by the schedule</span>}
                    {g.standing.nextCycle && <span className="text-subtle">. Next: #{g.standing.nextCycle.number} on {formatYmd(g.standing.nextCycle.dueDate, { day: 'numeric', month: 'short' })}, {g.standing.nextCycle.recipient} collects</span>}
                  </p>
                )}
                {g.status !== 'active' && <Badge className="capitalize self-start">{g.status}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <GroupDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}
