import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Download, FileText, Plus, Receipt, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd, isZero, monthRange } from '@/lib/money';
import { can } from '@/features/workspaces/useWorkspaces';
import type { Aging, AgingTotals, ProfitLoss } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { CategoryIcon } from '@/features/finance/icons';
import { downloadReport, useAging, useBusinessOverview, useCashFlow, useDocuments, useProfitLoss } from './hooks';
import { DocumentEditor } from './DocumentEditor';
import { StatusPill } from './DocumentsPage';

const NOTE = 'Cash basis: built from the income and expenses you record. Not a certified financial statement or tax return.';

/* ---------------- overview ---------------- */

export function BusinessOverviewPage() {
  const ws = useWs();
  const range = monthRange();
  const overview = useBusinessOverview(range);
  const recent = useDocuments('invoice', { status: 'unpaid' });
  const writable = can(ws.workspace, 'records.write');
  const [newInvoice, setNewInvoice] = useState(false);
  const [newBill, setNewBill] = useState(false);
  const month = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date());
  const o = overview.data;
  const pl = o?.profitAndLoss;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">{ws.workspace?.business?.legalName || ws.workspace?.name}</h1>
          <p className="text-muted">Sales, spending, and who owes what.</p>
        </div>
        {writable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="neu" onClick={() => setNewBill(true)}><Receipt /> Record a bill</Button>
            <Button onClick={() => setNewInvoice(true)}><Plus /> New invoice</Button>
          </div>
        )}
      </header>

      {overview.error && <Alert tone="danger">{overview.error.message}</Alert>}

      <section aria-labelledby="pl-title" className="neu-well relative overflow-hidden rounded-[32px] p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full border-[18px] border-primary/10" />
        <h2 id="pl-title" className="relative text-sm font-medium text-muted">Profit, {month}</h2>
        {!pl ? <Skeleton className="mt-3 h-14 w-64" /> : (
          <div className="relative">
            <p className={cn('tabular mt-2 text-5xl font-semibold tracking-tight', pl.netProfit.startsWith('-') ? 'text-danger' : 'text-ink')}>{formatMoney(pl.netProfit, pl.currency)}</p>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div><dt className="text-muted">Sales received</dt><dd className="tabular font-semibold text-primary">{formatMoney(pl.income.total, pl.currency)}</dd></div>
              <div><dt className="text-muted">Spent</dt><dd className="tabular font-semibold">{formatMoney(pl.expenses.total, pl.currency)}</dd></div>
              {pl.margin && <div><dt className="text-muted">Margin</dt><dd className="tabular font-semibold">{pl.margin}%</dd></div>}
              <div><dt className="text-muted">Last month</dt><dd className="tabular font-semibold">{formatMoney(pl.previous.netProfit, pl.currency)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-subtle">{NOTE}</p>
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <OwedCard title="Customers owe you" totals={o?.receivables} overdue={o?.overdueInvoices} link="/business/invoices" kind="invoices" />
        <OwedCard title="You owe suppliers" totals={o?.payables} overdue={o?.overdueBills} link="/business/bills" kind="bills" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unpaid invoices</CardTitle>
          <Button asChild size="sm" variant="ghost"><Link to="/business/invoices">All invoices</Link></Button>
        </CardHeader>
        {recent.isPending ? <Skeleton className="h-24" /> : recent.data!.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : (
          <ul className="grid gap-1">
            {recent.data!.slice(0, 6).map((d) => (
              <li key={d.id}>
                <Link to={`/business/invoices/${d.id}`} className="flex flex-wrap items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-[var(--line)]">
                  <span className="w-20 font-medium">{d.number}</span>
                  <span className="min-w-0 flex-1 truncate">{d.party?.name}</span>
                  <span className="text-xs text-subtle">due {formatYmd(d.dueDate, { day: 'numeric', month: 'short' })}</span>
                  <span className="tabular font-semibold">{formatMoney(d.balance, d.currency)}</span>
                  <StatusPill status={d.displayStatus} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <nav aria-label="Business tools" className="grid gap-3 sm:grid-cols-3">
        {[
          { to: '/business/contacts', icon: UsersRound, title: 'Customers and suppliers', body: 'Contacts and what each owes' },
          { to: '/business/bills', icon: Receipt, title: 'Bills', body: 'What you owe and when' },
          { to: '/business/reports', icon: FileText, title: 'Reports', body: 'Profit and loss, cash flow, aging' },
        ].map(({ to, icon: Icon, title, body }) => (
          <Link key={to} to={to} className="neu-raised-sm flex items-center gap-3 rounded-2xl p-4 hover:text-primary">
            <Icon className="size-5 text-primary" aria-hidden />
            <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted">{body}</span></span>
          </Link>
        ))}
      </nav>

      <DocumentEditor kind="invoice" open={newInvoice} onOpenChange={setNewInvoice} />
      <DocumentEditor kind="bill" open={newBill} onOpenChange={setNewBill} />
    </div>
  );
}

function OwedCard({ title, totals, overdue, link, kind }: { title: string; totals?: AgingTotals[]; overdue?: number; link: string; kind: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Button asChild size="sm" variant="ghost"><Link to={link}>See {kind}</Link></Button>
      </CardHeader>
      {!totals ? <Skeleton className="h-16" /> : totals.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : (
        <div className="grid gap-2">
          {totals.map((t) => (
            <div key={t.currency} className="flex items-baseline justify-between">
              <span className="tabular text-2xl font-semibold">{formatMoney(t.total, t.currency)}</span>
              <span className="text-sm text-muted">{t.count} unpaid{!isZero(t.current) && t.total !== t.current ? `, ${formatMoney(t.current, t.currency)} not yet due` : ''}</span>
            </div>
          ))}
          {overdue ? <p className="text-sm text-danger">{overdue} overdue</p> : null}
        </div>
      )}
    </Card>
  );
}

/* ---------------- reports ---------------- */

export function BusinessReportsPage() {
  const ws = useWs();
  const [range, setRange] = useState(monthRange());
  const pl = useProfitLoss(range);
  const cf = useCashFlow(range);
  const ar = useAging('receivables');
  const ap = useAging('payables');
  const quick = (months: number) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    setRange({ from: monthRange(start).from, to: monthRange(now).to });
  };
  const dl = (report: 'profit-loss' | 'cash-flow', format: 'csv' | 'pdf') => downloadReport(ws.id, report, range, format).catch((e) => toast.error(e.message));

  return (
    <div className="grid gap-6">
      <header>
        <Link to="/business" className="text-sm text-primary hover:underline">Business</Link>
        <h1 className="text-[28px] font-semibold">Business reports</h1>
        <p className="max-w-2xl text-muted">{NOTE}</p>
      </header>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm"><span className="font-medium">From</span><Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-44" /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">To</span><Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-44" /></label>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => quick(1)}>This month</Button>
          <Button size="sm" variant="ghost" onClick={() => quick(3)}>Last 3 months</Button>
          <Button size="sm" variant="ghost" onClick={() => setRange({ from: `${new Date().getFullYear()}-01-01`, to: monthRange().to })}>This year</Button>
        </div>
      </Card>

      {range.from > range.to ? <Alert tone="danger">The start date is after the end date.</Alert> : (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Profit and loss</CardTitle>
                <CardDescription>{formatYmd(range.from)} to {formatYmd(range.to)}, compared with the same length of time before it.</CardDescription>
              </div>
              <div className="flex gap-2"><Button size="sm" variant="neu" onClick={() => dl('profit-loss', 'csv')}><Download /> CSV</Button><Button size="sm" variant="neu" onClick={() => dl('profit-loss', 'pdf')}><Download /> PDF</Button></div>
            </CardHeader>
            {pl.isPending ? <Skeleton className="h-48" /> : pl.error ? <Alert tone="danger">{pl.error.message}</Alert> : <PLTable pl={pl.data} />}
          </Card>

          <Card>
            <CardHeader>
              <div><CardTitle>Cash flow by month</CardTitle><CardDescription>Money in and out, not counting transfers between your own accounts.</CardDescription></div>
              <Button size="sm" variant="neu" onClick={() => dl('cash-flow', 'csv')}><Download /> CSV</Button>
            </CardHeader>
            {cf.isPending ? <Skeleton className="h-32" /> : cf.error ? <Alert tone="danger">{cf.error.message}</Alert> : (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="text-left text-xs text-subtle"><tr><th className="px-2 py-2 font-medium">Month</th><th className="px-2 py-2 text-right font-medium">Money in</th><th className="px-2 py-2 text-right font-medium">Money out</th><th className="px-2 py-2 text-right font-medium">Net</th><th className="px-2 py-2 text-right font-medium">Running total</th></tr></thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {cf.data.months.map((m) => (
                      <tr key={m.month}>
                        <td className="px-2 py-2.5">{formatYmd(`${m.month}-01`, { month: 'long', year: 'numeric' })}</td>
                        <td className="tabular px-2 py-2.5 text-right text-primary">{formatMoney(m.inflow, cf.data.currency)}</td>
                        <td className="tabular px-2 py-2.5 text-right">{formatMoney(m.outflow, cf.data.currency)}</td>
                        <td className={cn('tabular px-2 py-2.5 text-right font-semibold', m.net.startsWith('-') && 'text-danger')}>{formatMoney(m.net, cf.data.currency)}</td>
                        <td className={cn('tabular px-2 py-2.5 text-right', m.cumulative.startsWith('-') && 'text-danger')}>{formatMoney(m.cumulative, cf.data.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <AgingCard title="Receivables" description="Unpaid invoices, by how overdue they are." q={ar} base="/business/invoices" />
        <AgingCard title="Payables" description="Unpaid bills, by how overdue they are." q={ap} base="/business/bills" />
      </div>
    </div>
  );
}

function Change({ c, invert = false }: { c: { amount: string; percent: string | null }; invert?: boolean }) {
  if (c.percent === null) return <span className="text-subtle">—</span>;
  const up = !c.amount.startsWith('-') && !isZero(c.amount);
  const good = invert ? !up : up;
  return <span className={cn('tabular text-xs', isZero(c.amount) ? 'text-subtle' : good ? 'text-primary' : 'text-danger')}>{up ? '+' : ''}{c.percent}%</span>;
}

function PLTable({ pl }: { pl: ProfitLoss }) {
  const cur = pl.currency;
  const rows = (items: ProfitLoss['income']['byCategory']) =>
    items.length ? items.map((r) => (
      <tr key={r.categoryId}><td className="flex items-center gap-2 px-2 py-2 pl-6"><CategoryIcon icon={r.icon} className="size-3.5 text-muted" /> {r.name}</td><td className="tabular px-2 py-2 text-right">{formatMoney(r.amount, cur)}</td><td /></tr>
    )) : <tr><td className="px-2 py-2 pl-6 text-muted">None recorded</td><td /><td /></tr>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead className="text-left text-xs text-subtle"><tr><th className="px-2 py-2 font-medium" /><th className="px-2 py-2 text-right font-medium">This period</th><th className="px-2 py-2 text-right font-medium">vs before</th></tr></thead>
        <tbody>
          <tr className="font-semibold"><td className="px-2 pt-3 pb-1">Income</td><td /><td /></tr>
          {rows(pl.income.byCategory)}
          <tr className="border-t border-[var(--line)] font-semibold"><td className="px-2 py-2">Total income</td><td className="tabular px-2 py-2 text-right">{formatMoney(pl.income.total, cur)}</td><td className="px-2 py-2 text-right"><Change c={pl.change.income} /></td></tr>
          <tr className="font-semibold"><td className="px-2 pt-4 pb-1">Expenses</td><td /><td /></tr>
          {rows(pl.expenses.byCategory)}
          <tr className="border-t border-[var(--line)] font-semibold"><td className="px-2 py-2">Total expenses</td><td className="tabular px-2 py-2 text-right">{formatMoney(pl.expenses.total, cur)}</td><td className="px-2 py-2 text-right"><Change c={pl.change.expenses} invert /></td></tr>
          <tr className="border-t-2 border-[var(--line)] text-base font-semibold"><td className="px-2 py-3">{pl.netProfit.startsWith('-') ? 'Net loss' : 'Net profit'}</td><td className={cn('tabular px-2 py-3 text-right', pl.netProfit.startsWith('-') ? 'text-danger' : 'text-primary')}>{formatMoney(pl.netProfit, cur)}</td><td className="px-2 py-3 text-right"><Change c={pl.change.netProfit} /></td></tr>
        </tbody>
      </table>
      {pl.margin && <p className="px-2 text-sm text-muted">Margin: {pl.margin}% of income.</p>}
    </div>
  );
}

function AgingCard({ title, description, q, base }: { title: string; description: string; q: ReturnType<typeof useAging>; base: string }) {
  return (
    <Card>
      <CardHeader><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div></CardHeader>
      {q.isPending ? <Skeleton className="h-32" /> : q.error ? <Alert tone="danger">{q.error.message}</Alert> : <AgingBody a={q.data} base={base} />}
    </Card>
  );
}

function AgingBody({ a, base }: { a: Aging; base: string }) {
  if (!a.totals.length) return <p className="text-sm text-muted">Nothing outstanding.</p>;
  return (
    <div className="grid gap-4">
      {a.totals.map((t) => (
        <div key={t.currency} className="grid grid-cols-5 gap-2 text-center text-xs">
          {a.buckets.map((b) => (
            <div key={b.key} className={cn('rounded-xl px-1 py-2', b.key === 'current' ? 'neu-pressed' : !isZero(t[b.key]) ? 'bg-danger-soft' : 'neu-pressed')}>
              <p className="text-subtle">{b.label}</p>
              <p className="tabular mt-0.5 text-sm font-semibold">{formatMoney(t[b.key], t.currency)}</p>
            </div>
          ))}
        </div>
      ))}
      <ul className="grid gap-1 text-sm">
        {a.items.slice(0, 8).map((i) => (
          <li key={i.id}>
            <Link to={`${base}/${i.id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-[var(--line)]">
              <span className="w-20 font-medium">{i.number}</span>
              <span className="min-w-0 flex-1 truncate">{i.party}</span>
              <span className={cn('text-xs', i.daysOverdue > 0 ? 'text-danger' : 'text-subtle')}>{i.daysOverdue > 0 ? `${i.daysOverdue} days late` : `due ${formatYmd(i.dueDate, { day: 'numeric', month: 'short' })}`}</span>
              <span className="tabular font-semibold">{formatMoney(i.balance, i.currency)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
