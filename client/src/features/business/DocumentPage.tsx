import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Ban, Download, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd, isZero, todayYmd } from '@/lib/money';
import { ApiError } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { BizDocument, DocKind } from '@/types/api';
import { useAccounts, useCategories, useWs } from '@/features/finance/hooks';
import { downloadDocumentPdf, useDocument, useDocumentMutations } from './hooks';
import { DocumentEditor } from './DocumentEditor';
import { StatusPill } from './DocumentsPage';

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

export function DocumentPage({ kind }: { kind: DocKind }) {
  const { docId } = useParams();
  const ws = useWs();
  const q = useDocument(kind, docId);
  const m = useDocumentMutations(kind);
  const writable = can(ws.workspace, 'records.write');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const isInvoice = kind === 'invoice';
  const list = `/business/${isInvoice ? 'invoices' : 'bills'}`;

  if (q.isPending) return <Skeleton className="h-96 rounded-3xl" />;
  if (q.error) return <Alert tone="danger">{q.error.message} <Link to={list} className="text-primary underline">Back</Link></Alert>;
  const d = q.data;
  const livePayments = d.payments.filter((p) => !p.removed);
  const onErr = (e: Error) => toast.error(e instanceof ApiError && e.details?.[0] ? e.details[0].message : e.message);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={list} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-3.5" /> {isInvoice ? 'Invoices' : 'Bills'}</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-[28px] font-semibold">{d.number} <StatusPill status={d.displayStatus} /></h1>
          <p className="text-muted">
            {isInvoice ? 'To' : 'From'} {d.party?.name}. Issued {formatYmd(d.issueDate)}, due {formatYmd(d.dueDate)}
            {d.reference ? `. Supplier ref ${d.reference}` : ''}.
          </p>
          {d.status === 'void' && <p className="mt-1 text-sm text-danger">Voided: {d.voidReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="neu" onClick={() => downloadDocumentPdf(ws.id, kind, d).catch((e) => toast.error(e.message))}><Download /> PDF</Button>
          {writable && d.status === 'draft' && <Button variant="neu" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          {writable && d.status === 'issued' && livePayments.length === 0 && <Button variant="neu" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          {writable && d.status === 'draft' && <Button loading={m.issue.isPending} onClick={() => m.issue.mutate(d.id, { onSuccess: () => toast.success(isInvoice ? 'Invoice issued' : 'Bill recorded as owed'), onError: onErr })}><Send /> {isInvoice ? 'Issue' : 'Mark as owed'}</Button>}
          {writable && d.status === 'issued' && !isZero(d.balance) && <Button onClick={() => setPaying(true)}><Plus /> Record payment</Button>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr><th className="px-2 py-2 font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Unit price</th><th className="px-2 py-2 text-right font-medium">Tax</th><th className="px-2 py-2 text-right font-medium">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {d.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-2.5">{l.description}</td>
                    <td className="tabular px-2 py-2.5 text-right">{l.quantity}</td>
                    <td className="tabular px-2 py-2.5 text-right">{formatMoney(l.unitPrice, d.currency)}</td>
                    <td className="tabular px-2 py-2.5 text-right text-muted">{l.taxRate ? `${l.taxRate}%` : '—'}</td>
                    <td className="tabular px-2 py-2.5 text-right">{formatMoney(l.amount, d.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-4 ml-auto grid w-full max-w-xs gap-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{formatMoney(d.subtotal, d.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular">{formatMoney(d.taxTotal, d.currency)}</dd></div>
            <div className="flex justify-between border-t border-[var(--line)] pt-1 font-semibold"><dt>Total</dt><dd className="tabular">{formatMoney(d.total, d.currency)}</dd></div>
          </dl>
          {(d.terms || d.notes) && (
            <div className="mt-4 grid gap-2 text-sm">
              {d.terms && <p><span className="font-medium">Terms:</span> <span className="text-muted">{d.terms}</span></p>}
              {d.notes && <p><span className="font-medium">Notes:</span> <span className="text-muted">{d.notes}</span></p>}
            </div>
          )}
        </Card>

        <div className="grid content-start gap-6">
          <section aria-label="Balance" className="neu-well rounded-[28px] p-6">
            <p className="text-sm text-muted">{isInvoice ? 'Still owed to you' : 'Still to pay'}</p>
            <p className={cn('tabular mt-1 text-4xl font-semibold tracking-tight', d.displayStatus === 'overdue' && 'text-danger')}>{formatMoney(d.status === 'void' ? '0' : d.balance, d.currency)}</p>
            <p className="mt-2 text-sm text-muted">{formatMoney(d.paid, d.currency)} {isInvoice ? 'received' : 'paid'} of {formatMoney(d.total, d.currency)}{d.displayStatus === 'overdue' ? `. ${d.daysOverdue} days overdue.` : '.'}</p>
          </section>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Payments</CardTitle>
                <CardDescription>Each one is also {isInvoice ? 'an income' : 'an expense'} transaction in the account you chose.</CardDescription>
              </div>
            </CardHeader>
            {d.payments.length === 0 ? <p className="text-sm text-muted">None recorded yet.</p> : (
              <ul className="grid gap-2">
                {d.payments.map((p) => (
                  <li key={p.id} className={cn('rounded-xl px-3 py-2 text-sm', p.removed ? 'opacity-60' : 'neu-pressed')}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-subtle">{formatYmd(p.date)}</span>
                        <span className="block truncate" title={p.account.name}>{p.account.name}</span>
                      </span>
                      <span className={cn('tabular font-semibold', p.removed && 'line-through')}>{formatMoney(p.amount, d.currency)}</span>
                      {writable && !p.removed && <Button size="icon" variant="ghost" className="size-8" aria-label="Remove payment" onClick={() => { setRemoving(p.id); setReason(''); }}><Trash2 /></Button>}
                    </div>
                    {p.removed && <p className="text-xs text-subtle">Removed: {p.removeReason}</p>}
                    {removing === p.id && (
                      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); m.removePayment.mutate({ id: d.id, paymentId: p.id, reason }, { onSuccess: () => { toast.success('Payment removed'); setRemoving(null); }, onError: onErr }); }}>
                        <Input aria-label="Reason" placeholder="Why? e.g. cheque bounced" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 glass shadow-none" autoFocus />
                        <Button size="sm" variant="danger" type="submit" disabled={reason.trim().length < 3} loading={m.removePayment.isPending}>Remove</Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setRemoving(null)}>Keep</Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {writable && d.status !== 'void' && (
            voiding ? (
              <Card>
                <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.void.mutate({ id: d.id, reason }, { onSuccess: () => { toast.success(`${d.number} voided`); setVoiding(false); }, onError: onErr }); }}>
                  <p className="text-sm">{livePayments.length ? 'Remove the payments first; a document with payments can’t be voided.' : `Voiding keeps ${d.number} on record but it no longer counts as owed.`}</p>
                  <Input aria-label="Reason for voiding" placeholder="Reason, e.g. order cancelled" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2"><Button type="submit" variant="danger" size="sm" disabled={reason.trim().length < 3 || livePayments.length > 0} loading={m.void.isPending}>Void {isInvoice ? 'invoice' : 'bill'}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setVoiding(false)}>Cancel</Button></div>
                </form>
              </Card>
            ) : (
              <Button variant="ghost" className="justify-self-start text-danger" onClick={() => { setVoiding(true); setReason(''); }}><Ban /> Void</Button>
            )
          )}
        </div>
      </div>

      <DocumentEditor kind={kind} open={editing} onOpenChange={setEditing} doc={d} />
      {paying && <PaymentDialog kind={kind} doc={d} onClose={() => setPaying(false)} />}
    </div>
  );
}

function PaymentDialog({ kind, doc, onClose }: { kind: DocKind; doc: BizDocument; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const m = useDocumentMutations(kind);
  const isInvoice = kind === 'invoice';
  const usable = (accounts.data?.items ?? []).filter((a) => a.status === 'active' && a.currency === doc.currency);
  const cats = (categories.data ?? []).filter((c) => c.kind === (isInvoice ? 'income' : 'expense'));
  const defaultCat = cats.find((c) => c.systemKey === (isInvoice ? 'business_revenue' : 'business_expenses'))?.id ?? '';
  const [amount, setAmount] = useState(doc.balance);
  const [date, setDate] = useState(todayYmd());
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [rate, setRate] = useState('');
  const [needsRate, setNeedsRate] = useState(false);
  const [error, setError] = useState<string>();
  const key = useMemo(newKey, []);
  const account = accountId || usable[0]?.id || '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = cleanAmount(amount);
    const err = amountError(v, doc.currency);
    if (err) return setError(err);
    m.pay.mutate(
      { id: doc.id, amount: v, date, accountId: account, categoryId: categoryId || defaultCat || undefined, exchangeRate: needsRate && rate ? cleanAmount(rate) : undefined, idempotencyKey: key },
      {
        onSuccess: () => { toast.success('Payment recorded'); onClose(); },
        onError: (er) => {
          if (er instanceof ApiError && er.code === 'RATE_REQUIRED') setNeedsRate(true);
          setError(er instanceof ApiError && er.details?.[0] ? er.details[0].message : er.message);
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{isInvoice ? 'Record money received' : 'Record a payment made'}</DialogTitle>
        <DialogDescription>{isInvoice ? `For ${doc.number}. This adds the amount as income to the account it went into.` : `For ${doc.number}. This records it as an expense from the account you paid from.`}</DialogDescription>
        {accounts.isSuccess && usable.length === 0 ? (
          <Alert tone="gold" className="mt-4">You need an account in {doc.currency} to record this. <Link to="/accounts" className="text-primary underline">Add one</Link></Alert>
        ) : (
          <form onSubmit={submit} noValidate className="mt-4 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Amount (${doc.currency})`} htmlFor="dp-amt" error={error}><Input id="dp-amt" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Date" htmlFor="dp-date"><Input id="dp-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
            <Field label={isInvoice ? 'Paid into' : 'Paid from'} htmlFor="dp-acc"><Select id="dp-acc" value={account} onChange={(e) => setAccountId(e.target.value)}>{usable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Category" htmlFor="dp-cat"><Select id="dp-cat" value={categoryId || defaultCat} onChange={(e) => setCategoryId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            {needsRate && <Field label={`Exchange rate: 1 ${doc.currency} in your reporting currency`} htmlFor="dp-rate"><Input id="dp-rate" inputMode="decimal" className="tabular" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.pay.isPending}>Record payment</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
