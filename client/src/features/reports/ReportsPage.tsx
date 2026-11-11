import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd, todayYmd } from '@/lib/money';
import { useWs } from '@/features/finance/hooks';
import type { CurrencyAmount, Granularity, Insight } from '@/types/api';
import { BarsWithLine, ChartFrame, DataTable, RunningTotal, type SeriesDef } from './charts';
import { type Range, useExportIncomeSpending, useIncomeSpending, useInsights, useSavingsAnalytics, useSeparated, useSpending } from './hooks';

type Preset = 'this_month' | 'last_3' | 'last_6' | 'this_year' | 'last_12' | 'custom';
const PRESETS: { value: Preset; text: string }[] = [
  { value: 'this_month', text: 'This month' },
  { value: 'last_3', text: 'Last 3 months' },
  { value: 'last_6', text: 'Last 6 months' },
  { value: 'this_year', text: 'This year' },
  { value: 'last_12', text: 'Last 12 months' },
  { value: 'custom', text: 'Custom dates' },
];

const firstOfMonthsAgo = (today: string, n: number) => {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

function presetRange(p: Preset, today: string): Range | null {
  if (p === 'this_month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (p === 'last_3') return { from: firstOfMonthsAgo(today, 2), to: today };
  if (p === 'last_6') return { from: firstOfMonthsAgo(today, 5), to: today };
  if (p === 'this_year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (p === 'last_12') return { from: firstOfMonthsAgo(today, 11), to: today };
  return null;
}

function Change({ value, goodWhen }: { value: string | null; goodWhen: 'up' | 'down' }) {
  if (value === null) return <span className="text-muted">nothing to compare</span>;
  const up = !value.startsWith('-');
  const good = (up && goodWhen === 'up') || (!up && goodWhen === 'down') || Number(value) === 0;
  return <span className={cn('font-medium', good ? 'text-success' : 'text-danger')}>{up ? '+' : '−'}{value.replace('-', '')}%</span>;
}

export function ReportsPage() {
  const ws = useWs();
  const today = todayYmd();
  const [preset, setPreset] = useState<Preset>('last_6');
  const [custom, setCustom] = useState<Range>({ from: firstOfMonthsAgo(today, 2), to: today });
  const [granularity, setGranularity] = useState<Granularity>('month');
  const range = useMemo(() => presetRange(preset, today) ?? custom, [preset, custom, today]);
  const rangeOk = range.from <= range.to;

  const flow = useIncomeSpending(range, granularity);
  const exportCsv = useExportIncomeSpending();
  const cur = ws.workspace?.baseCurrency ?? 'GHS';

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">Reports</h1>
          <p className="text-muted">Worked out on the server from your records, in {cur}. Nothing here is estimated.</p>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Period" htmlFor="r-preset" className="w-48">
          <Select id="r-preset" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.text}
              </option>
            ))}
          </Select>
        </Field>
        {preset === 'custom' && (
          <>
            <Field label="From" htmlFor="r-from" className="w-40">
              <Input id="r-from" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
            </Field>
            <Field label="To" htmlFor="r-to" className="w-40">
              <Input id="r-to" type="date" value={custom.to} min={custom.from} max={today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </Field>
          </>
        )}
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Group by</span>
          <Segmented label="Group by" value={granularity} onChange={setGranularity} options={[{ value: 'month', text: 'Month' }, { value: 'quarter', text: 'Quarter' }, { value: 'year', text: 'Year' }]} />
        </div>
      </div>

      {!rangeOk ? (
        <Alert tone="danger">The start date must be on or before the end date.</Alert>
      ) : flow.isPending ? (
        <Skeleton className="h-40 rounded-[32px]" />
      ) : flow.isError ? (
        <Alert tone="danger">{flow.error.message}</Alert>
      ) : (
        <>
          <section aria-labelledby="sum-title" className="neu-well rounded-[32px] p-6 sm:p-8">
            <h2 id="sum-title" className="sr-only">Summary</h2>
            <p className="max-w-3xl text-xl leading-relaxed sm:text-2xl">
              From {formatYmd(range.from)} to {formatYmd(range.to)} you received <strong className="tabular-nums text-[var(--series-1)]">{formatMoney(flow.data.totals.income, cur)}</strong> and spent{' '}
              <strong className="tabular-nums">{formatMoney(flow.data.totals.expense, cur)}</strong>
              {flow.data.totals.savingsRate !== null && !flow.data.totals.net.startsWith('-') ? (
                <>
                  , keeping <strong className="tabular-nums">{flow.data.totals.savingsRate}%</strong> of what came in.
                </>
              ) : flow.data.totals.net.startsWith('-') ? (
                <>
                  , <strong className="text-danger tabular-nums">{formatMoney(flow.data.totals.net.slice(1), cur)} more</strong> than came in.
                </>
              ) : (
                '.'
              )}
            </p>
            <p className="mt-3 text-sm text-muted">
              {flow.data.previous.incomeChange === null && flow.data.previous.expenseChange === null ? (
                <>No records from {formatYmd(flow.data.previous.from)} to {formatYmd(flow.data.previous.to)} to compare with.</>
              ) : (
                <>
                  Against {formatYmd(flow.data.previous.from)} to {formatYmd(flow.data.previous.to)}: income <Change value={flow.data.previous.incomeChange} goodWhen="up" />, spending <Change value={flow.data.previous.expenseChange} goodWhen="down" />.
                </>
              )}
            </p>
          </section>

          <InsightsList range={range} />

          <ChartFrame
            title="Income and spending"
            description="Tracked income and expenses only. Transfers, savings, Susu and plan payments are listed separately below."
            series={SERIES}
            actions={
              <Button size="sm" variant="neu" loading={exportCsv.isPending} onClick={() => exportCsv.mutate({ ...range, granularity }, { onError: (e) => toast.error(e.message) })}>
                <Download /> CSV
              </Button>
            }
            table={
              <DataTable
                columns={[{ key: 'label', label: 'Period' }, { key: 'income', label: 'Income', numeric: true }, { key: 'expense', label: 'Spending', numeric: true }, { key: 'net', label: 'Net', numeric: true }, { key: 'kept', label: 'Kept', numeric: true }]}
                rows={flow.data.series.map((s) => ({ label: s.label, income: formatMoney(s.income, cur), expense: formatMoney(s.expense, cur), net: formatMoney(s.net, cur), kept: s.savingsRate ? `${s.savingsRate}%` : '—' }))}
              />
            }
          >
            <BarsWithLine data={flow.data.series as unknown as Record<string, string>[]} series={SERIES} currency={cur} />
          </ChartFrame>

          <ChartFrame
            title="Running total"
            description="Income minus spending, added up period by period from the start of the range."
            series={[{ key: 'cumulativeNet', label: 'Running total', color: 'var(--series-1)', mark: 'line' }]}
            table={<DataTable columns={[{ key: 'label', label: 'Period' }, { key: 'v', label: 'Running total', numeric: true }]} rows={flow.data.series.map((s) => ({ label: s.label, v: formatMoney(s.cumulativeNet, cur) }))} />}
          >
            <RunningTotal data={flow.data.series as unknown as Record<string, string>[]} valueKey="cumulativeNet" label="Running total" currency={cur} />
          </ChartFrame>
        </>
      )}

      {rangeOk && (
        <>
          <SpendingSection range={range} currency={cur} />
          <SavingsSection range={range} granularity={granularity} />
          <SeparatedSection range={range} />
          {ws.workspace?.type === 'business' && (
            <Alert action={<Button asChild size="sm" variant="neu"><Link to="/business/reports">Open business reports</Link></Button>}>
              Profit and loss, receivables and payables for this business are in Business reports.
            </Alert>
          )}
        </>
      )}
    </div>
  );
}

const SERIES: SeriesDef[] = [
  { key: 'income', label: 'Income', color: 'var(--series-1)', mark: 'bar' },
  { key: 'expense', label: 'Spending', color: 'var(--series-2)', mark: 'bar' },
  { key: 'net', label: 'Net', color: 'var(--ink)', mark: 'line', dashed: true },
];

const SEVERITY_ICON = { warning: AlertTriangle, info: Info, good: CheckCircle2 };
const SEVERITY_COLOR = { warning: 'text-danger', info: 'text-primary', good: 'text-success' };

export function InsightRow({ i }: { i: Insight }) {
  const Icon = SEVERITY_ICON[i.severity];
  return (
    <li className="flex gap-3 py-3">
      <Icon className={cn('mt-0.5 size-4 shrink-0', SEVERITY_COLOR[i.severity])} aria-label={i.severity === 'warning' ? 'Needs attention' : i.severity === 'good' ? 'Going well' : 'For information'} />
      <div className="min-w-0">
        <Link to={i.link} className="font-medium hover:text-primary">
          {i.title}
        </Link>
        <p className="text-sm text-muted">{i.detail}</p>
      </div>
    </li>
  );
}

function InsightsList({ range }: { range: Range }) {
  const insights = useInsights(range);
  const [all, setAll] = useState(false);
  if (insights.isPending) return <Skeleton className="h-24" />;
  if (insights.isError || !insights.data.length) return null;
  const shown = all ? insights.data : insights.data.slice(0, 5);
  return (
    <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="ins-title">
      <h2 id="ins-title" className="text-lg font-semibold">What stands out</h2>
      <p className="text-sm text-muted">Found by fixed rules over your figures, not by AI.</p>
      <ul className="mt-2 divide-y divide-[var(--line)]">
        {shown.map((i) => (
          <InsightRow key={i.id} i={i} />
        ))}
      </ul>
      {insights.data.length > 5 && (
        <Button variant="link" size="sm" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${insights.data.length}`}
        </Button>
      )}
    </section>
  );
}

function SpendingSection({ range, currency }: { range: Range; currency: string }) {
  const q = useSpending(range);
  if (q.isPending) return <Skeleton className="h-64 rounded-3xl" />;
  if (q.isError) return <Alert tone="danger">{q.error.message}</Alert>;
  const d = q.data;
  const top = d.categories[0]?.amount ?? '0';
  return (
    <section className="glass grid gap-4 rounded-3xl p-5 sm:p-6" aria-labelledby="sp-title">
      <header>
        <h2 id="sp-title" className="text-lg font-semibold">Where the money went</h2>
        <p className="text-sm text-muted">
          {formatMoney(d.total, currency)} in total
          {d.change !== null && (
            <>
              , <Change value={d.change} goodWhen="down" /> on {formatYmd(d.previous.from)} to {formatYmd(d.previous.to)}
            </>
          )}
          .
        </p>
      </header>
      {d.categories.length === 0 ? (
        <p className="text-sm text-muted">No spending recorded in this period.</p>
      ) : (
        <ul className="grid gap-3">
          {d.categories.map((c) => (
            <li key={c.categoryId} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="tabular-nums">
                  {formatMoney(c.amount, currency)} <span className="text-muted">· {c.share}%</span>
                </span>
              </div>
              {/* Bar length relative to the largest category; the width is display only. */}
              <div className="neu-inset h-2.5 overflow-hidden rounded-full">
                <div className="h-full rounded-full bg-[var(--series-2)]" style={{ width: `${Math.max((Number(c.amount) / Number(top)) * 100, 1.5)}%` }} />
              </div>
              <p className="text-xs text-muted">
                Previous period {formatMoney(c.previous, currency)}
                {c.change !== null && (
                  <>
                    {' '}
                    (<Change value={c.change} goodWhen="down" />)
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {d.unusual.length > 0 && (
        <div className="rounded-2xl bg-gold-soft p-4">
          <h3 className="font-medium">Unusual patterns</h3>
          <ul className="mt-1 grid gap-1 text-sm">
            {d.unusual.map((u, i) => (
              <li key={i}>
                {u.kind === 'category_spike'
                  ? `${u.category}: ${formatMoney(u.amount, currency)}, ${u.ratio}× its average of ${formatMoney(u.average, currency)}.`
                  : `${formatYmd(u.date)}: a ${u.category} expense of ${formatMoney(u.amount, currency)}, ${u.ratio}× the typical ${formatMoney(u.typical, currency)}.`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{d.rules}</p>
        </div>
      )}
    </section>
  );
}

function SavingsSection({ range, granularity }: { range: Range; granularity: Granularity }) {
  const q = useSavingsAnalytics(range, granularity);
  if (q.isPending) return <Skeleton className="h-48 rounded-3xl" />;
  if (q.isError) return <Alert tone="danger">{q.error.message}</Alert>;
  const d = q.data;
  const empty = !d.goals.length && !d.personalSusu.plans.length && !d.groupSusu.length;
  return (
    <section className="glass grid gap-5 rounded-3xl p-5 sm:p-6" aria-labelledby="sv-title">
      <header>
        <h2 id="sv-title" className="text-lg font-semibold">Savings and Susu</h2>
        <p className="text-sm text-muted">Records of money you keep elsewhere. None of it counts as income or spending.</p>
      </header>
      {empty && <p className="text-sm text-muted">No savings goals or Susu plans yet.</p>}
      {d.goals.length > 0 && (
        <div className="grid gap-3">
          <h3 className="text-sm font-medium text-muted">Savings goals</h3>
          {d.goals.map((g) => (
            <div key={g.id} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <Link to={`/savings/${g.id}`} className="font-medium hover:text-primary">{g.name}</Link>
                <span className="tabular-nums">
                  {formatMoney(g.summary.current, g.currency)} <span className="text-muted">of {formatMoney(g.targetAmount, g.currency)}</span>
                </span>
              </div>
              <Progress value={g.summary.progress} label={`${g.name}: ${g.summary.progress}%`} tone={g.summary.overdue ? 'danger' : g.summary.onTrack === false ? 'gold' : 'primary'} />
            </div>
          ))}
        </div>
      )}
      {d.savingsFlow.map((f) => (
        <FlowTable key={`s-${f.currency}`} title={`Saved and taken out (${f.currency})`} flow={f} inLabel="Saved" outLabel="Taken out" />
      ))}
      {d.personalSusu.plans.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium text-muted">Personal Susu plans</h3>
          <ul className="grid gap-1 text-sm">
            {d.personalSusu.plans.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-x-3">
                <Link to={`/susu/plans/${p.id}`} className="hover:text-primary">{p.name}</Link>
                <span className="tabular-nums">
                  {formatMoney(p.current, p.currency)} recorded{p.missed > 0 && <span className="text-danger"> · {p.missed} missed</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.personalSusu.flow.map((f) => (
        <FlowTable key={`p-${f.currency}`} title={`Susu contributions and withdrawals (${f.currency})`} flow={f} inLabel="Contributed" outLabel="Withdrawn" />
      ))}
      {d.groupSusu.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium text-muted">Your Susu groups</h3>
          <ul className="grid gap-1 text-sm">
            {d.groupSusu.map((g) => (
              <li key={g.groupId} className="flex flex-wrap justify-between gap-x-3">
                <Link to={`/susu/groups/${g.groupId}`} className="hover:text-primary">{g.name}</Link>
                <span className="tabular-nums">
                  {g.missedCycles > 0 || g.outstanding !== '0.00' ? (
                    <span className="text-danger">
                      {formatMoney(g.outstanding, g.currency)} outstanding · {g.missedCycles} missed
                    </span>
                  ) : (
                    'Up to date'
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FlowTable({ title, flow, inLabel, outLabel }: { title: string; flow: { currency: string; points: { label: string; in: string; out: string; net: string }[] }; inLabel: string; outLabel: string }) {
  const rows = flow.points.filter((p) => p.in !== '0.00' || p.out !== '0.00');
  if (!rows.length) return null;
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium text-muted">{title}</h3>
      <div className="-mx-2 overflow-x-auto">
        <DataTable
          columns={[{ key: 'label', label: 'Period' }, { key: 'in', label: inLabel, numeric: true }, { key: 'out', label: outLabel, numeric: true }, { key: 'net', label: 'Net', numeric: true }]}
          rows={rows.map((p) => ({ label: p.label, in: formatMoney(p.in, flow.currency), out: formatMoney(p.out, flow.currency), net: formatMoney(p.net, flow.currency) }))}
        />
      </div>
    </div>
  );
}

const list = (items: CurrencyAmount[], none = 'None') => (items.length ? items.map((i) => `${formatMoney(i.amount, i.currency)} (${i.count})`).join(', ') : none);

function SeparatedSection({ range }: { range: Range }) {
  const q = useSeparated(range);
  if (q.isPending) return <Skeleton className="h-48 rounded-3xl" />;
  if (q.isError) return <Alert tone="danger">{q.error.message}</Alert>;
  const d = q.data;
  const t = d.trackedIncomeExpense;
  const rows: { name: string; what: string; value: string }[] = [
    { name: 'Income and spending', what: 'The only figures counted as income or spending in reports.', value: `${formatMoney(t.income, t.currency)} in, ${formatMoney(t.expense, t.currency)} out` },
    { name: 'Transfers between your accounts', what: 'Money moved, not earned or spent.', value: list(d.transfers) },
    { name: 'Savings allocations', what: 'Recorded against savings goals.', value: d.savingsAllocations.length ? d.savingsAllocations.map((s) => `${formatMoney(s.contributed, s.currency)} saved, ${formatMoney(s.withdrawn, s.currency)} taken out`).join('; ') : 'None' },
    { name: 'Personal Susu', what: 'Manual records; Kontaa never holds Susu money.', value: `${list(d.personalSusu.contributions, 'Nothing')} contributed; ${list(d.personalSusu.withdrawals, 'nothing')} withdrawn` },
    { name: 'Group Susu', what: 'Your records across your groups.', value: `${list(d.groupSusu.yourContributions, 'Nothing')} contributed; ${list(d.groupSusu.payoutsToYou, 'nothing')} paid out to you` },
  ];
  if (d.subscriptionPayments) rows.push({ name: 'Kontaa plan payments', what: 'What this workspace paid for its Kontaa plan.', value: list(d.subscriptionPayments) });
  return (
    <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="sep-title">
      <h2 id="sep-title" className="text-lg font-semibold">Kept separate</h2>
      <p className="text-sm text-muted">Six kinds of money movement in this period. Only the first is counted as income or spending.</p>
      <dl className="mt-3 divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <div key={r.name} className="grid gap-1 py-3 sm:grid-cols-[minmax(12rem,1fr)_2fr] sm:gap-4">
            <dt>
              <span className="font-medium">{r.name}</span>
              <span className="block text-xs text-muted">{r.what}</span>
            </dt>
            <dd className="text-sm tabular-nums sm:text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
