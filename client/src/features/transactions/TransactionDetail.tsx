import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { Download, FileText, Lock, LockOpen, Paperclip, Pencil, Trash2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { formatDate } from '@/lib/utils';
import { formatMoney, formatYmd, RATE_SOURCE_LABEL } from '@/lib/money';
import { apiBlob, saveBlob } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { AuditEntry, Transaction } from '@/types/api';
import { useAttachmentMutations, useAttachments, useTransaction, useTransactionAction, useTransactionHistory, useWs } from '@/features/finance/hooks';
import { TxBadge } from '@/features/finance/icons';
import { TxAmount } from './TransactionRow';

const FIELD_LABEL: Record<string, string> = {
  amount: 'Amount',
  date: 'Date',
  description: 'Description',
  payee: 'Payee',
  notes: 'Notes',
  categoryId: 'Category',
  accountId: 'Account',
  toAccountId: 'To account',
  toAmount: 'Amount received',
  reportingRate: 'Exchange rate',
  reportingAmount: 'Reporting amount',
  rateSource: 'Rate source',
  recurring: 'Repeats',
  type: 'Type',
};

function describeEntry(e: AuditEntry) {
  switch (e.action) {
    case 'transaction.created': return 'recorded this';
    case 'transaction.deleted': return 'deleted this';
    case 'transaction.reconciled': return 'marked it reconciled';
    case 'transaction.unreconciled': return 'unlocked it for correction';
    case 'transaction.attachment_added': return `attached ${(e.metadata as { name?: string }).name ?? 'a file'}`;
    case 'transaction.attachment_removed': return `removed ${(e.metadata as { name?: string }).name ?? 'a file'}`;
    case 'transaction.updated': {
      const changes = (e.metadata as { changes?: Record<string, { from: unknown; to: unknown }> }).changes ?? {};
      const parts = Object.entries(changes)
        .filter(([k]) => !k.endsWith('Id'))
        .map(([k, c]) => `${FIELD_LABEL[k] ?? k}: ${c.from || '—'} → ${c.to || '—'}`);
      const refs = Object.keys(changes).filter((k) => k.endsWith('Id')).map((k) => FIELD_LABEL[k]?.toLowerCase());
      return ['edited it', ...parts, refs.length ? `changed ${refs.join(', ')}` : ''].filter(Boolean).join('; ');
    }
    default: return e.action;
  }
}

export function TransactionDetail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (t: Transaction) => void }) {
  const q = useTransaction(id);
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        {q.isLoading || !q.data ? (
          q.error ? (
            <>
              <DialogTitle>Transaction</DialogTitle>
              <Alert tone="danger" className="mt-4">{q.error.message}</Alert>
            </>
          ) : (
            <>
              <DialogTitle className="sr-only">Loading transaction</DialogTitle>
              <Skeleton className="h-48" />
            </>
          )
        ) : (
          <Body t={q.data} onClose={onClose} onEdit={onEdit} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({ t, onClose, onEdit }: { t: Transaction; onClose: () => void; onEdit: (t: Transaction) => void }) {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const isAdmin = can(ws.workspace, 'workspace.update');
  const action = useTransactionAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reason, setReason] = useState('');
  const linked = t.invoiceId ? { kind: 'invoice', to: `/business/invoices/${t.invoiceId}` } : t.billId ? { kind: 'bill', to: `/business/bills/${t.billId}` } : null;
  const locked = t.status === 'reconciled' || Boolean(linked);
  const r = t.reporting;
  const foreign = t.currency !== r.currency;

  const run = (a: 'reconcile' | 'unreconcile' | 'delete', done: string) =>
    action.mutate({ id: t.id, action: a, reason }, { onSuccess: () => { toast.success(done); if (a === 'delete') onClose(); }, onError: (e) => toast.error(e.message) });

  return (
    <div className="grid gap-5">
      <div className="flex items-start gap-3 pr-6">
        <TxBadge type={t.type} icon={t.category?.icon} className="size-12" />
        <div className="min-w-0">
          <DialogTitle className="truncate">{t.description}</DialogTitle>
          <DialogDescription>
            {t.type === 'transfer' ? `Transfer, ${t.account.name} to ${t.toAccount?.name}` : `${t.category?.name ?? 'Uncategorised'}, ${t.account.name}`}
          </DialogDescription>
        </div>
      </div>

      <div className="neu-inset rounded-2xl p-4">
        <TxAmount t={t} className="text-3xl tracking-tight" />
        {t.type === 'transfer' && t.toCurrency !== t.currency && <p className="tabular mt-1 text-sm text-muted">Received {formatMoney(t.toAmount, t.toCurrency!)}</p>}
        {foreign && (
          <p className="mt-2 text-sm text-muted">
            Reported as <span className="tabular font-medium text-ink">{formatMoney(r.amount, r.currency)}</span> at 1 {t.currency} = <span className="tabular">{r.rate}</span> {r.currency}.
            {' '}{RATE_SOURCE_LABEL[r.source]}
            {r.providerLabel ? ` (${r.providerLabel})` : ''}
            {r.rateDate && r.source !== 'entered' ? `, dated ${formatYmd(r.rateDate)}` : ''}.
            {r.estimated && <Badge tone="gold" className="ml-1.5">Estimated</Badge>}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted">Date</dt>
        <dd>{formatYmd(t.date, { dateStyle: 'full' })}</dd>
        {t.payee && (<><dt className="text-muted">{t.type === 'income' ? 'From' : 'Paid to'}</dt><dd>{t.payee}</dd></>)}
        {t.recurrence.isRecurring && (<><dt className="text-muted">Repeats</dt><dd className="capitalize">{t.recurrence.frequency}</dd></>)}
        <dt className="text-muted">Status</dt>
        <dd>{locked ? <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Reconciled {t.reconciledAt && formatDate(t.reconciledAt)}</span> : 'Recorded'}</dd>
        {t.notes && (<><dt className="text-muted">Notes</dt><dd className="whitespace-pre-wrap">{t.notes}</dd></>)}
      </dl>

      {linked && (
        <p className="neu-pressed rounded-2xl px-4 py-3 text-sm">
          This records a payment on {linked.kind === 'invoice' ? 'an invoice' : 'a bill'}. To change or remove it, <Link to={linked.to} className="font-medium text-primary hover:underline" onClick={onClose}>open the {linked.kind}</Link>.
        </p>
      )}

      <Attachments t={t} writable={writable} />

      <History id={t.id} />

      {writable && (
        confirmDelete ? (
          <div className="grid gap-3 rounded-2xl bg-danger-soft p-4">
            <p className="text-sm font-medium">Delete this transaction? It will leave your balances and reports. The audit history keeps a record of the deletion.</p>
            <Input aria-label="Reason (optional)" placeholder="Reason (optional), e.g. duplicate" value={reason} onChange={(e) => setReason(e.target.value)} className="glass shadow-none" />
            <div className="flex gap-2">
              <Button variant="danger" size="sm" loading={action.isPending} onClick={() => run('delete', 'Transaction deleted')}>Delete transaction</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!locked && <Button variant="neu" size="sm" onClick={() => onEdit(t)}><Pencil /> Edit</Button>}
            {t.status !== 'reconciled' && <Button variant="neu" size="sm" loading={action.isPending && action.variables?.action === 'reconcile'} onClick={() => run('reconcile', 'Marked as reconciled')} title="Confirm this matches your statement. It locks the record."><Lock /> Mark reconciled</Button>}
            {t.status === 'reconciled' && isAdmin && <Button variant="neu" size="sm" loading={action.isPending} onClick={() => run('unreconcile', 'Unlocked for correction')}><LockOpen /> Unlock to correct</Button>}
            {t.status === 'reconciled' && !isAdmin && <p className="text-sm text-muted">Reconciled records are locked. Ask an admin to unlock it if it needs correcting.</p>}
            {!locked && <Button variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => setConfirmDelete(true)}><Trash2 /> Delete</Button>}
          </div>
        )
      )}
    </div>
  );
}

function Attachments({ t, writable }: { t: Transaction; writable: boolean }) {
  const ws = useWs();
  const list = useAttachments(t.id);
  const { upload, remove } = useAttachmentMutations(t.id);
  const input = useRef<HTMLInputElement>(null);

  const download = async (id: string, name: string) => {
    try {
      saveBlob(await apiBlob(`/transactions/${t.id}/attachments/${id}`, { workspaceId: ws.id }), name);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section aria-labelledby="att-title" className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 id="att-title" className="flex items-center gap-1.5 text-sm font-semibold"><Paperclip className="size-4" /> Receipts</h3>
        {writable && (list.data?.length ?? 0) < 5 && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f, { onSuccess: () => toast.success('Receipt attached'), onError: (err) => toast.error(err.message) });
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="neu" loading={upload.isPending} onClick={() => input.current?.click()}><Upload /> Attach</Button>
          </>
        )}
      </div>
      {list.isPending ? <Skeleton className="h-10" /> : list.data?.length ? (
        <ul className="grid gap-1.5">
          {list.data.map((a) => (
            <li key={a.id} className="neu-pressed flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
              <FileText className="size-4 text-subtle" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-xs text-subtle">{Math.ceil(a.size / 1024)} KB</span>
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Download ${a.name}`} onClick={() => download(a.id, a.name)}><Download /></Button>
              {writable && t.status !== 'reconciled' && (
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${a.name}`} loading={remove.isPending && remove.variables === a.id} onClick={() => remove.mutate(a.id, { onError: (e) => toast.error(e.message) })}><Trash2 /></Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No receipts attached. JPG, PNG, WebP or PDF, up to 5 MB.</p>
      )}
    </section>
  );
}

function History({ id }: { id: string }) {
  const h = useTransactionHistory(id);
  if (!h.data?.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold">History ({h.data.length})</summary>
      <ol className="mt-2 grid gap-2 border-l border-[var(--line)] pl-4">
        {h.data.map((e) => (
          <li key={e.id}>
            <span className="font-medium">{e.actor?.name ?? 'System'}</span> <span className="text-muted">{describeEntry(e)}</span>
            <time className="block text-xs text-subtle" dateTime={e.createdAt}>{formatDate(e.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </li>
        ))}
      </ol>
    </details>
  );
}
