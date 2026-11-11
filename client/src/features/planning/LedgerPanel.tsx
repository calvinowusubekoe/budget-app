import { useState } from 'react';
import { toast } from 'sonner';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd, todayYmd } from '@/lib/money';
import { ApiError } from '@/services/api';
import type { LedgerEntry } from '@/types/api';
import { useLedger, useLedgerMutations, type LedgerKind } from './hooks';

interface Props {
  kind: LedgerKind;
  id: string;
  currency: string;
  writable: boolean;
  /** [positive type, negative type] with labels, e.g. contribution/withdrawal. */
  types: { value: LedgerEntry['type']; label: string; sign: '+' | '-' }[];
  note: string;
}

/**
 * Record entries and see their history. Entries can't be edited; a wrong
 * one is reversed with a reason, and the reversal stays visible.
 */
export function LedgerPanel({ kind, id, currency, writable, types, note }: Props) {
  const ledger = useLedger(kind, id);
  const { add, reverse } = useLedgerMutations(kind, id);
  const [type, setType] = useState(types[0]!.value);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = cleanAmount(amount);
    const err = amountError(v, currency);
    if (err) return setError(err);
    setError(undefined);
    add.mutate(
      { type, amount: v, date, notes },
      {
        onSuccess: () => { setAmount(''); setNotes(''); toast.success(`${types.find((t) => t.value === type)!.label} recorded`); },
        onError: (er) => setError(er instanceof ApiError && er.details?.[0] ? er.details[0].message : er.message),
      },
    );
  };

  return (
    <div className="grid gap-4">
      {writable && (
        <form onSubmit={submit} noValidate className="neu-inset grid gap-3 rounded-2xl p-4">
          <div role="radiogroup" aria-label="Entry type" className="flex gap-1">
            {types.map((t) => (
              <button key={t.value} type="button" role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)} className={cn('rounded-xl px-3 py-1.5 text-sm font-medium transition', type === t.value ? 'neu-raised-sm text-primary' : 'text-muted hover:text-ink')}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label={`Amount (${currency})`} htmlFor={`${id}-amt`} error={error}>
              <Input id={`${id}-amt`} inputMode="decimal" className="tabular glass shadow-none" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor={`${id}-date`}>
              <Input id={`${id}-date`} type="date" max={todayYmd()} className="glass shadow-none" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Input aria-label="Notes (optional)" placeholder="Notes (optional)" className="glass shadow-none" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-subtle">{note}</p>
            <Button type="submit" size="sm" loading={add.isPending}>Record</Button>
          </div>
        </form>
      )}

      {ledger.isPending ? <Skeleton className="h-20" /> : ledger.error ? <Alert tone="danger">{ledger.error.message}</Alert> : ledger.data!.length === 0 ? (
        <p className="text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="grid gap-1.5">
          {ledger.data!.map((e) => {
            const t = types.find((x) => x.value === e.type)!;
            const reversed = e.status === 'reversed';
            return (
              <li key={e.id} className={cn('rounded-xl px-3 py-2 text-sm', reversed ? 'opacity-60' : 'neu-pressed')}>
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-subtle">{formatYmd(e.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.label}{e.notes ? `: ${e.notes}` : ''}</span>
                  <span className={cn('tabular font-medium', reversed && 'line-through', t.sign === '+' ? 'text-primary' : '')}>{formatMoney(e.amount, currency, { sign: t.sign })}</span>
                  {writable && !reversed && (
                    <Button size="icon" variant="ghost" className="size-8" aria-label="Reverse this entry" onClick={() => { setReversing(e.id); setReason(''); }}><Undo2 /></Button>
                  )}
                </div>
                {reversed && <p className="mt-0.5 pl-27 text-xs text-subtle">Reversed: {e.reversalReason}</p>}
                {reversing === e.id && (
                  <form className="mt-2 flex gap-2" onSubmit={(ev) => { ev.preventDefault(); reverse.mutate({ entryId: e.id, reason }, { onSuccess: () => { setReversing(null); toast.success('Entry reversed'); }, onError: (er) => toast.error(er instanceof ApiError && er.details?.[0] ? er.details[0].message : er.message) }); }}>
                    <Input aria-label="Reason for reversing" placeholder="Why? e.g. entered twice" value={reason} onChange={(ev) => setReason(ev.target.value)} className="h-9 glass shadow-none" autoFocus />
                    <Button size="sm" variant="danger" type="submit" loading={reverse.isPending} disabled={reason.trim().length < 3}>Reverse</Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setReversing(null)}>Cancel</Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
