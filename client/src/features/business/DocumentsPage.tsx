import { useState } from 'react';
import { Link } from 'react-router';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd } from '@/lib/money';
import { can } from '@/features/workspaces/useWorkspaces';
import type { DocKind } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { STATUS_TEXT, STATUS_TONE, useDocuments } from './hooks';
import { DocumentEditor } from './DocumentEditor';

export function StatusPill({ status }: { status: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_TONE[status])}>{STATUS_TEXT[status] ?? status}</span>;
}

export function DocumentsPage({ kind }: { kind: DocKind }) {
  const ws = useWs();
  const writable = can(ws.workspace, 'records.write');
  const [status, setStatus] = useState('');
  const docs = useDocuments(kind, status ? { status } : {});
  const [open, setOpen] = useState(false);
  const isInvoice = kind === 'invoice';

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/business" className="text-sm text-primary hover:underline">Business</Link>
          <h1 className="text-[28px] font-semibold">{isInvoice ? 'Invoices' : 'Bills'}</h1>
          <p className="max-w-xl text-muted">{isInvoice ? 'What customers owe you. When a customer pays, record it here and it lands in your account as income.' : 'What you owe suppliers. Record each payment and it’s counted as an expense from the account you paid from.'}</p>
        </div>
        {writable && <Button onClick={() => setOpen(true)}><Plus /> {isInvoice ? 'New invoice' : 'Record a bill'}</Button>}
      </header>

      <Card className="p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-48">
            <option value="">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="overdue">Overdue</option>
            <option value="partially_paid">Part paid</option>
            <option value="paid">Paid</option>
            <option value="draft">Drafts</option>
            <option value="void">Void</option>
          </Select>
          {docs.data && <span className="text-sm text-muted">{docs.data.length} shown</span>}
        </div>
        {docs.isPending ? <Skeleton className="h-40" /> : docs.error ? <Alert tone="danger">{docs.error.message}</Alert> : docs.data.length === 0 ? (
          <EmptyState icon={FileText} title={status ? 'Nothing matches' : isInvoice ? 'No invoices yet' : 'No bills yet'} action={writable && !status && <Button onClick={() => setOpen(true)}><Plus /> {isInvoice ? 'Create an invoice' : 'Record a bill'}</Button>}>
            {status ? 'Try a different filter.' : isInvoice ? 'Bill a customer for goods or work. You can print it as a PDF and track what’s still owed.' : 'Keep track of what suppliers have billed you and when it’s due.'}
          </EmptyState>
        ) : (
          <>
          <ul className="grid gap-2 sm:hidden">
            {docs.data.map((d) => (
              <li key={d.id}>
                <Link to={`/business/${isInvoice ? 'invoices' : 'bills'}/${d.id}`} className="neu-pressed block rounded-2xl px-4 py-3 text-sm">
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-primary">{d.number}</span>
                    <StatusPill status={d.displayStatus} />
                  </span>
                  <span className="mt-1 flex items-end justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate">{d.party?.name}</span>
                      <span className={cn('block text-xs text-subtle', d.displayStatus === 'overdue' && 'text-danger')}>Due {formatYmd(d.dueDate)}{d.daysOverdue > 0 && d.displayStatus === 'overdue' && `, ${d.daysOverdue} days late`}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block font-semibold">{d.status === 'issued' ? formatMoney(d.balance, d.currency) : formatMoney(d.total, d.currency)}</span>
                      <span className="block text-xs text-subtle">{d.status === 'issued' ? 'still owed' : 'total'}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="-mx-1 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-160 text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr><th className="px-2 py-2 font-medium">Number</th><th className="px-2 py-2 font-medium">{isInvoice ? 'Customer' : 'Supplier'}</th><th className="px-2 py-2 font-medium">Due</th><th className="px-2 py-2 text-right font-medium">Total</th><th className="px-2 py-2 text-right font-medium">Still owed</th><th className="px-2 py-2 font-medium">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {docs.data.map((d) => (
                  <tr key={d.id} className="hover:bg-line">
                    <td className="px-2 py-2.5 font-medium"><Link to={`/business/${isInvoice ? 'invoices' : 'bills'}/${d.id}`} className="text-primary hover:underline">{d.number}</Link>{d.reference && <span className="block text-xs text-subtle">{d.reference}</span>}</td>
                    <td className="px-2 py-2.5">{d.party?.name}</td>
                    <td className={cn('px-2 py-2.5', d.displayStatus === 'overdue' && 'text-danger')}>{formatYmd(d.dueDate)}{d.daysOverdue > 0 && d.displayStatus === 'overdue' && <span className="block text-xs">{d.daysOverdue} days late</span>}</td>
                    <td className="tabular px-2 py-2.5 text-right">{formatMoney(d.total, d.currency)}</td>
                    <td className="tabular px-2 py-2.5 text-right font-semibold">{d.status === 'issued' ? formatMoney(d.balance, d.currency) : '—'}</td>
                    <td className="px-2 py-2.5"><StatusPill status={d.displayStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      <DocumentEditor kind={kind} open={open} onOpenChange={setOpen} />
    </div>
  );
}
