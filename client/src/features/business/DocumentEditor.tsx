import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Alert } from '@/components/ui/feedback';
import { amountError, cleanAmount, formatMoney, todayYmd } from '@/lib/money';
import { ApiError } from '@/services/api';
import type { BizDocument, DocKind } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { useDocumentMutations, useLinePreview, useParties, type LineInput } from './hooks';

const blank = (): LineInput => ({ description: '', quantity: '1', unitPrice: '', taxRate: '' });
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function DocumentEditor({ kind, open, onOpenChange, doc }: { kind: DocKind; open: boolean; onOpenChange: (o: boolean) => void; doc?: BizDocument }) {
  const ws = useWs();
  const navigate = useNavigate();
  const parties = useParties(kind === 'invoice' ? 'customer' : 'supplier');
  const m = useDocumentMutations(kind);
  const isInvoice = kind === 'invoice';
  const [partyId, setPartyId] = useState('');
  const [currency, setCurrency] = useState(ws.workspace?.baseCurrency ?? 'GHS');
  const [issueDate, setIssueDate] = useState(todayYmd());
  const [dueDate, setDueDate] = useState(addDays(todayYmd(), 14));
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<LineInput[]>([blank()]);
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPartyId(doc?.party?.id ?? '');
    setCurrency(doc?.currency ?? ws.workspace?.baseCurrency ?? 'GHS');
    setIssueDate(doc?.issueDate ?? todayYmd());
    setDueDate(doc?.dueDate ?? addDays(todayYmd(), 14));
    setReference(doc?.reference ?? '');
    setLines(doc ? doc.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate ?? '' })) : [blank()]);
    setTerms(doc?.terms ?? '');
    setNotes(doc?.notes ?? '');
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.id]);

  const clean = lines.map((l) => ({ ...l, unitPrice: cleanAmount(l.unitPrice), quantity: l.quantity.trim(), taxRate: l.taxRate.trim() }));
  const isValid = (ls: LineInput[]) => ls.every((l) => l.description.trim() && /^\d{1,9}(\.\d{1,3})?$/.test(l.quantity) && /^\d{1,13}(\.\d{1,4})?$/.test(l.unitPrice) && (!l.taxRate || /^\d{1,3}(\.\d{1,2})?$/.test(l.taxRate)));
  // Validate the same (debounced) lines that are sent, so a half-typed row never reaches the server.
  const debounced = useDebounced(clean);
  const preview = useLinePreview(debounced, currency, open && isValid(debounced));
  const setLine = (i: number, patch: Partial<LineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = (issue: boolean) => {
    const next: Record<string, string> = {};
    if (!partyId) next.partyId = `Choose a ${isInvoice ? 'customer' : 'supplier'}.`;
    clean.forEach((l, i) => {
      if (!l.description.trim()) next[`lines.${i}.description`] = 'Describe the item.';
      const e = amountError(l.unitPrice, currency);
      if (e) next[`lines.${i}.unitPrice`] = e;
      if (!/^\d{1,9}(\.\d{1,3})?$/.test(l.quantity)) next[`lines.${i}.quantity`] = 'Enter a quantity like 1 or 2.5.';
    });
    if (dueDate < issueDate) next.dueDate = 'The due date can’t be before the issue date.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = { partyId, currency, issueDate, dueDate, lines: clean.map((l) => ({ ...l, taxRate: l.taxRate || null })), terms, notes, ...(isInvoice ? {} : { reference }) };
    m.save.mutate(doc ? { id: doc.id, ...body } : { ...body, issue }, {
      onSuccess: (d) => {
        onOpenChange(false);
        toast.success(doc ? 'Saved' : issue ? `${d.number} ${isInvoice ? 'issued' : 'recorded'}` : `${d.number} saved as a draft`);
        if (!doc) navigate(`/business/${isInvoice ? 'invoices' : 'bills'}/${d.id}`);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.details) setErrors(Object.fromEntries(e.details.map((x) => [x.field, x.message])));
        else toast.error(e.message);
      },
    });
  };

  const activeParties = (parties.data ?? []).filter((p) => p.status === 'active' || p.id === doc?.party?.id);
  const noParties = parties.isSuccess && activeParties.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
        <DialogTitle>{doc ? `Edit ${doc.number}` : isInvoice ? 'New invoice' : 'Record a bill'}</DialogTitle>
        <DialogDescription>{isInvoice ? 'What a customer owes you. Record their payment once it arrives.' : 'What you owe a supplier. Record your payment once it’s made.'} Totals are worked out for you.</DialogDescription>

        {noParties ? (
          <Alert tone="gold" className="mt-5">Add a {isInvoice ? 'customer' : 'supplier'} first, under Customers and suppliers.</Alert>
        ) : (
          <div className="mt-5 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label={isInvoice ? 'Customer' : 'Supplier'} htmlFor="de-party" error={errors.partyId} className="sm:col-span-2">
                <Select id="de-party" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                  <option value="">Choose…</option>
                  {activeParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Issued" htmlFor="de-issue"><Input id="de-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
              <Field label="Due" htmlFor="de-due" error={errors.dueDate}><Input id="de-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
              {!isInvoice && <Field label="Supplier’s invoice no. (optional)" htmlFor="de-ref" className="sm:col-span-2"><Input id="de-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
              <Field label="Currency" htmlFor="de-cur" className="sm:col-span-2"><CurrencySelect id="de-cur" disabled={doc && doc.status !== 'draft'} value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
            </div>

            <fieldset className="neu-inset grid gap-2 rounded-2xl p-3">
              <legend className="sr-only">Items</legend>
              <div className="hidden grid-cols-[1fr_5rem_8rem_5rem_7rem_2rem] gap-2 px-1 text-xs text-subtle sm:grid">
                <span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span className="text-right">Amount</span><span />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_8rem_5rem_7rem_2rem] sm:items-start">
                  <div className="col-span-2 sm:col-span-1">
                    <Input aria-label={`Item ${i + 1} description`} placeholder="e.g. Cement, 50kg bag" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-invalid={Boolean(errors[`lines.${i}.description`])} className="glass shadow-none" />
                  </div>
                  <Input aria-label={`Item ${i + 1} quantity`} inputMode="decimal" className="tabular glass shadow-none" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-invalid={Boolean(errors[`lines.${i}.quantity`])} />
                  <Input aria-label={`Item ${i + 1} unit price`} inputMode="decimal" placeholder="0.00" className="tabular glass shadow-none" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} aria-invalid={Boolean(errors[`lines.${i}.unitPrice`])} />
                  <Input aria-label={`Item ${i + 1} tax percent`} inputMode="decimal" placeholder="—" className="tabular glass shadow-none" value={l.taxRate} onChange={(e) => setLine(i, { taxRate: e.target.value })} />
                  <span className="tabular self-center text-right text-sm font-medium">{preview.data?.lines[i] ? formatMoney(preview.data.lines[i]!.amount, currency) : '—'}</span>
                  <Button size="icon" variant="ghost" className="size-9" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
                  {(errors[`lines.${i}.unitPrice`] || errors[`lines.${i}.quantity`] || errors[`lines.${i}.description`]) && (
                    <p role="alert" className="col-span-full text-[13px] text-danger">{errors[`lines.${i}.description`] ?? errors[`lines.${i}.quantity`] ?? errors[`lines.${i}.unitPrice`]}</p>
                  )}
                </div>
              ))}
              <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setLines((ls) => [...ls, blank()])} disabled={lines.length >= 100}><Plus /> Add item</Button>
            </fieldset>

            <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm" aria-live="polite">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{preview.data ? formatMoney(preview.data.subtotal, currency) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular">{preview.data ? formatMoney(preview.data.taxTotal, currency) : '—'}</dd></div>
              <div className="flex justify-between border-t border-[var(--line)] pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular">{preview.data ? formatMoney(preview.data.total, currency) : '—'}</dd></div>
            </dl>
            <p className="text-xs text-subtle">Tax is the percentage you enter per item. BudgetFlow doesn’t apply tax rules for you.</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={isInvoice ? 'Payment terms (shown on the invoice)' : 'Terms (optional)'} htmlFor="de-terms"><Input id="de-terms" placeholder={isInvoice ? 'e.g. Pay by MoMo to 024 000 0000 within 14 days' : ''} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
              <Field label="Notes (optional)" htmlFor="de-notes"><Input id="de-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              {doc ? (
                <Button loading={m.save.isPending} onClick={() => submit(false)}>Save changes</Button>
              ) : (
                <>
                  <Button variant="neu" loading={m.save.isPending} onClick={() => submit(false)}>Save as draft</Button>
                  <Button loading={m.save.isPending} onClick={() => submit(true)}>{isInvoice ? 'Issue invoice' : 'Record bill'}</Button>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
