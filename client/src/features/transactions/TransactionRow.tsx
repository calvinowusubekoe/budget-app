import { Lock, Paperclip, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd } from '@/lib/money';
import type { Transaction } from '@/types/api';
import { TxBadge } from '@/features/finance/icons';

/** Signed amount in the record's own currency. Transfers carry no sign. */
export function TxAmount({ t, className }: { t: Transaction; className?: string }) {
  return (
    <span
      className={cn(
        'tabular font-semibold whitespace-nowrap',
        t.type === 'income' && 'text-primary',
        t.type === 'transfer' && 'text-muted',
        className,
      )}
    >
      {formatMoney(t.amount, t.currency, { sign: t.type === 'income' ? '+' : t.type === 'expense' ? '-' : undefined })}
    </span>
  );
}

export function TransactionRow({ t, onOpen, showDate = false }: { t: Transaction; onOpen: () => void; showDate?: boolean }) {
  const secondary =
    t.type === 'transfer'
      ? `${t.account.name} → ${t.toAccount?.name ?? ''}`
      : [t.category?.name, t.account.name].filter(Boolean).join(', ');
  const foreign = t.currency !== t.reporting.currency;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-[var(--line)] focus-visible:bg-[var(--line)]">
        <TxBadge type={t.type} icon={t.category?.icon} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{t.description}</span>
            {t.recurrence.isRecurring && <Repeat className="size-3.5 shrink-0 text-subtle" aria-label="Repeats" />}
            {t.attachmentCount > 0 && <Paperclip className="size-3.5 shrink-0 text-subtle" aria-label={`${t.attachmentCount} attachment${t.attachmentCount === 1 ? '' : 's'}`} />}
            {t.status === 'reconciled' && <Lock className="size-3.5 shrink-0 text-subtle" aria-label="Reconciled" />}
          </span>
          <span className="block truncate text-[13px] text-muted">
            {showDate && `${formatYmd(t.date, { day: 'numeric', month: 'short' })}, `}
            {secondary}
          </span>
        </span>
        <span className="text-right">
          <TxAmount t={t} className="block text-sm" />
          {foreign && <span className="tabular block text-xs text-subtle">{formatMoney(t.reporting.amount, t.reporting.currency)}{t.reporting.estimated ? ' est.' : ''}</span>}
          {t.type === 'transfer' && t.toCurrency && t.toCurrency !== t.currency && (
            <span className="tabular block text-xs text-subtle">received {formatMoney(t.toAmount, t.toCurrency)}</span>
          )}
        </span>
      </button>
    </li>
  );
}
