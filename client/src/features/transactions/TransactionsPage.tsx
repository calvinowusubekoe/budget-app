import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeftRight, CalendarClock, Download, Plus, ScanLine, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd, monthRange } from '@/lib/money';
import { apiBlob, saveBlob } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { ReceiptScan, Transaction, TxType } from '@/types/api';
import { ScanReceiptDialog } from '@/features/receipts/ScanReceiptDialog';
import { toQuery, useAccounts, useCategories, useSummary, useTransactions, useWs, type TxFilters } from '@/features/finance/hooks';
import { CategoryIcon } from '@/features/finance/icons';
import { TransactionDialog } from './TransactionDialog';
import { TransactionDetail } from './TransactionDetail';
import { TransactionRow } from './TransactionRow';

const PAGE_SIZE = 30;

interface Props {
  /** Income and Expenses pages fix the type and show a category breakdown. */
  fixedType?: Exclude<TxType, 'transfer'>;
}

const COPY = {
  all: { title: 'Transactions', intro: 'Everything recorded in this workspace: income, spending and transfers between your accounts.' },
  income: { title: 'Income', intro: 'Money coming in: salary, sales, side work, gifts.' },
  expense: { title: 'Expenses', intro: 'Money going out, by category, so you can see where it goes.' },
};

export function TransactionsPage({ fixedType }: Props) {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [dialog, setDialog] = useState<{ open: boolean; tx?: Transaction | null; type?: TxType; receipt?: { scan: ReceiptScan; file: File } | null }>({ open: false });
  const [scanning, setScanning] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const copy = COPY[fixedType ?? 'all'];

  const filters: TxFilters = useMemo(
    () => ({
      type: fixedType ?? params.get('type') ?? undefined,
      accountId: params.get('accountId') ?? undefined,
      categoryId: params.get('categoryId') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      q: params.get('q') ?? undefined,
    }),
    [params, fixedType],
  );
  const hasFilters = Object.entries(filters).some(([k, v]) => v && !(k === 'type' && fixedType));

  useEffect(() => setPage(1), [filters]);
  // Debounce the search box into the URL.
  useEffect(() => {
    const id = setTimeout(() => setParam('q', search.trim() || null), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function setParam(key: string, value: string | null) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  const list = useTransactions(filters, page, PAGE_SIZE);
  const accounts = useAccounts(true);
  const categories = useCategories(true);

  const grouped = useMemo(() => {
    const groups: { date: string; items: Transaction[] }[] = [];
    for (const t of list.data?.items ?? []) {
      const last = groups[groups.length - 1];
      if (last?.date === t.date) last.items.push(t);
      else groups.push({ date: t.date, items: [t] });
    }
    return groups;
  }, [list.data]);

  const exportCsv = async () => {
    try {
      const { type, accountId, categoryId, from, to, q } = filters;
      saveBlob(await apiBlob(`/transactions/export.csv${toQuery({ type, accountId, categoryId, from, to, q })}`, { workspaceId: ws.id }), `kontaa-${fixedType ?? 'transactions'}.csv`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const total = list.data?.meta.total ?? 0;
  const pages = list.data?.meta.pages ?? 1;
  const kindCats = (categories.data ?? []).filter((c) => !fixedType || c.kind === fixedType);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold">{copy.title}</h1>
          <p className="max-w-xl text-muted">{copy.intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!fixedType && <Button asChild variant="neu"><Link to="/transactions/recurring"><CalendarClock /> Recurring</Link></Button>}
          <Button variant="neu" onClick={exportCsv} disabled={total === 0} title={total === 0 ? 'Nothing to export yet' : 'Download as CSV'}>
            <Download /> Export CSV
          </Button>
          {writable && (
            <Button variant="neu" onClick={() => setScanning(true)}>
              <ScanLine /> Scan a receipt
            </Button>
          )}
          {writable && (
            <Button onClick={() => setDialog({ open: true, tx: null, type: fixedType ?? 'expense' })}>
              <Plus /> {fixedType === 'income' ? 'Record income' : fixedType === 'expense' ? 'Record expense' : 'Record transaction'}
            </Button>
          )}
        </div>
      </header>

      {fixedType && <CategoryBreakdown type={fixedType} accountId={filters.accountId} />}

      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
          <div className="relative col-span-2 md:col-span-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input aria-label="Search" placeholder="Search description, payee, notes" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          {!fixedType && (
            <Select aria-label="Type" value={filters.type ?? ''} onChange={(e) => setParam('type', e.target.value || null)}>
              <option value="">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expenses</option>
              <option value="transfer">Transfers</option>
            </Select>
          )}
          <Select aria-label="Account" value={filters.accountId ?? ''} onChange={(e) => setParam('accountId', e.target.value || null)}>
            <option value="">All accounts</option>
            {accounts.data?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select aria-label="Category" value={filters.categoryId ?? ''} onChange={(e) => setParam('categoryId', e.target.value || null)} disabled={filters.type === 'transfer'}>
            <option value="">All categories</option>
            {kindCats.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}
          </Select>
          <PeriodSelect from={filters.from} to={filters.to} onChange={(from, to) => setParams((p) => {
            const n = new URLSearchParams(p);
            from ? n.set('from', from) : n.delete('from');
            to ? n.set('to', to) : n.delete('to');
            return n;
          }, { replace: true })} />
        </div>
        {hasFilters && (
          <div className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>{total} matching</span>
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}><X /> Clear filters</Button>
          </div>
        )}
      </Card>

      <Card className={cn('p-3 sm:p-4', list.isPlaceholderData && 'opacity-70')}>
        {list.isPending ? (
          <div className="grid gap-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : list.error ? (
          <Alert tone="danger">{list.error.message}</Alert>
        ) : grouped.length === 0 ? (
          hasFilters ? (
            <EmptyState icon={Search} title="Nothing matches these filters">Try a different search or clear the filters.</EmptyState>
          ) : (
            <EmptyState
              icon={ArrowLeftRight}
              title={fixedType === 'income' ? 'No income recorded yet' : fixedType === 'expense' ? 'No expenses recorded yet' : 'No transactions yet'}
              action={writable && <Button onClick={() => setDialog({ open: true, tx: null, type: fixedType ?? 'expense' })}><Plus /> Record the first one</Button>}
            >
              Each record updates the account it belongs to and the totals on your dashboard.
            </EmptyState>
          )
        ) : (
          <div className="grid gap-4">
            {grouped.map((g) => (
              <section key={g.date} aria-label={formatYmd(g.date)}>
                <h2 className="px-2 pb-1 text-xs font-medium text-subtle">{formatYmd(g.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</h2>
                <ul>{g.items.map((t) => <TransactionRow key={t.id} t={t} onOpen={() => setDetailId(t.id)} />)}</ul>
              </section>
            ))}
            {pages > 1 && (
              <nav aria-label="Pages" className="flex items-center justify-between border-t border-line px-2 pt-3 text-sm">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
                <span className="text-muted">Page {page} of {pages}</span>
                <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older</Button>
              </nav>
            )}
          </div>
        )}
      </Card>

      <TransactionDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        transaction={dialog.tx}
        defaultType={dialog.type}
        defaultAccountId={filters.accountId}
        receipt={dialog.receipt}
      />
      <ScanReceiptDialog open={scanning} onOpenChange={setScanning} onRead={(scan, file) => setDialog({ open: true, tx: null, type: scan.draft.type ?? fixedType ?? 'expense', receipt: { scan, file } })} />
      <TransactionDetail id={detailId} onClose={() => setDetailId(null)} onEdit={(t) => { setDetailId(null); setDialog({ open: true, tx: t }); }} />
    </div>
  );
}

/** Quick periods map onto from/to; "All time" clears them. */
function PeriodSelect({ from, to, onChange }: { from?: string; to?: string; onChange: (from?: string, to?: string) => void }) {
  const now = new Date();
  const thisMonth = monthRange(now);
  const lastMonth = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const year = { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  const options = [
    { key: 'all', label: 'All time', range: { from: undefined, to: undefined } },
    { key: 'this', label: 'This month', range: thisMonth },
    { key: 'last', label: 'Last month', range: lastMonth },
    { key: 'year', label: 'This year', range: year },
  ];
  const current = options.find((o) => o.range.from === from && o.range.to === to)?.key ?? 'custom';
  return (
    <Select aria-label="Period" value={current} onChange={(e) => { const o = options.find((x) => x.key === e.target.value); if (o) onChange(o.range.from, o.range.to); }}>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      {current === 'custom' && <option value="custom">{from ?? '…'} to {to ?? '…'}</option>}
    </Select>
  );
}

/** Where the money came from or went, for the selected month. */
function CategoryBreakdown({ type, accountId }: { type: 'income' | 'expense'; accountId?: string }) {
  const range = monthRange();
  const summary = useSummary({ ...range, accountId });
  const rows = type === 'income' ? summary.data?.incomeByCategory : summary.data?.expenseByCategory;
  const total = type === 'income' ? summary.data?.income : summary.data?.expense;
  const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date());
  if (summary.isLoading) return <Skeleton className="h-36 rounded-3xl" />;
  if (!summary.data || !rows?.length) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{type === 'income' ? `Income in ${month}` : `Spending in ${month}`}</h2>
        <p className="tabular text-2xl font-semibold">{formatMoney(total, summary.data.currency)}</p>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.slice(0, 8).map((r) => (
          <li key={r.categoryId} className="grid gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              <CategoryIcon icon={r.icon} className="size-4 text-muted" />
              <span className="flex-1 truncate">{r.name}</span>
              <span className="tabular font-medium">{formatMoney(r.amount, summary.data!.currency)}</span>
              <span className="tabular w-12 text-right text-xs text-subtle">{r.share}%</span>
            </div>
            <div className="neu-inset h-2 overflow-hidden rounded-full" aria-hidden>
              <div className={cn('h-full rounded-full', type === 'income' ? 'bg-primary' : 'bg-gold')} style={{ width: `${Math.max(Number(r.share), 2)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
