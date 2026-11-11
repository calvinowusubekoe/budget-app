import { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cleanAmount, formatYmd, todayYmd } from '@/lib/money';
import { applyFieldErrors } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import { useRateMutations, useRates, useWs } from '@/features/finance/hooks';
import { ArrowLeftRight } from 'lucide-react';

export function ExchangeRatesPage() {
  const ws = useWs();
  const base = ws.workspace?.baseCurrency ?? 'GHS';
  const writable = can(ws.workspace, 'records.write');
  const rates = useRates();
  const { save, fetch, remove } = useRateMutations();
  const [from, setFrom] = useState(base === 'USD' ? 'GHS' : 'USD');
  const [to, setTo] = useState(base);
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = cleanAmount(rate);
    if (!/^\d{1,10}(\.\d{1,10})?$/.test(value) || /^0+(\.0+)?$/.test(value)) return setErrors({ rate: 'Enter a rate like 15.42.' });
    if (from === to) return setErrors({ to: 'Choose two different currencies.' });
    setErrors({});
    save.mutate(
      { from, to, rate: value, effectiveDate: date },
      {
        onSuccess: () => { setRate(''); toast.success(`Saved 1 ${from} = ${value} ${to}`); },
        onError: (err) => { if (!applyFieldErrors(err, (f: never, m: { message: string }) => setErrors((x) => ({ ...x, [f]: m.message })))) toast.error(err.message); },
      },
    );
  };

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-[28px] font-semibold">Exchange rates</h1>
        <p className="max-w-2xl text-muted">
          Totals in this workspace are reported in {base}. When you record money in another currency, Kontaa uses the latest rate here on or before that date and saves a copy with the record. Changing a rate later never changes past records.
        </p>
      </header>

      {writable && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Add a rate</CardTitle>
              <CardDescription>Use the rate you actually got, for example from your bank or forex bureau. One rate per currency pair per day; saving again replaces it.</CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_10rem_auto] sm:items-start">
            <Field label="1 unit of" htmlFor="r-from"><CurrencySelect id="r-from" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Equals, in" htmlFor="r-to" error={errors.to}><CurrencySelect id="r-to" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Rate" htmlFor="r-rate" error={errors.rate}><Input id="r-rate" inputMode="decimal" className="tabular" placeholder="15.42" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field label="From date" htmlFor="r-date" error={errors.effectiveDate}><Input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Button type="submit" className="sm:mt-7" loading={save.isPending}>Save rate</Button>
          </form>
          {rates.data?.provider ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <Button variant="neu" size="sm" loading={fetch.isPending} disabled={from === to} onClick={() => fetch.mutate({ from, to }, { onSuccess: (r) => toast.success(`Fetched 1 ${r.from} = ${r.rate} ${r.to}`), onError: (e) => toast.error(e.message) })}>
                <RefreshCw /> Get today’s {from}→{to} rate
              </Button>
              <span className="text-muted">From {rates.data.provider}. Provider rates are mid-market estimates and may differ from what you were charged.</span>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Automatic rates are off for this installation, so rates are entered by hand.</p>
          )}
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Saved rates</CardTitle></CardHeader>
        {rates.isPending ? <Skeleton className="h-24" /> : rates.error ? <Alert tone="danger">{rates.error.message}</Alert> : rates.data!.items.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="No rates saved">If you only use {base}, you won’t need any. Add a rate before recording money in another currency, or enter one on the transaction itself.</EmptyState>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr><th className="px-2 py-2 font-medium">Pair</th><th className="px-2 py-2 font-medium">Rate</th><th className="px-2 py-2 font-medium">From date</th><th className="px-2 py-2 font-medium">Source</th><th className="sr-only">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {rates.data!.items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2.5 font-medium">1 {r.from} → {r.to}</td>
                    <td className="tabular px-2 py-2.5">{r.rate}</td>
                    <td className="px-2 py-2.5">{formatYmd(r.effectiveDate)}</td>
                    <td className="px-2 py-2.5">{r.source === 'manual' ? <Badge>Manual</Badge> : <Badge tone="primary" >{r.providerLabel ?? 'Provider'}</Badge>}</td>
                    <td className="px-2 py-2.5 text-right">
                      {writable && <Button size="icon" variant="ghost" className="size-8" aria-label={`Delete ${r.from} to ${r.to} rate from ${r.effectiveDate}`} onClick={() => remove.mutate(r.id, { onSuccess: () => toast.success('Rate removed. Saved records keep the rate they used.'), onError: (e) => toast.error(e.message) })}><Trash2 /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
