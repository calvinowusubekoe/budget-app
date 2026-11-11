import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, CloudOff, CloudUpload, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatMoney, formatYmd } from '@/lib/money';
import { useAuth } from '@/stores/auth';
import type { OutboxItem, OutboxStatus } from './outbox';
import { discardItem, flushOutbox, retryItem, unsentCount, useOutbox } from './sync';

export const STATUS_TEXT: Record<OutboxStatus, string> = {
  saved_locally: 'Saved on this device',
  pending: 'Syncing…',
  synced: 'Synced',
  failed: 'Sync failed, will retry',
  needs_review: 'Needs your review',
};
const STATUS_TONE: Record<OutboxStatus, string> = {
  saved_locally: 'bg-gold-soft text-gold-ink',
  pending: 'bg-primary-soft text-primary',
  synced: 'bg-primary text-primary-fg',
  failed: 'bg-danger-soft text-danger',
  needs_review: 'bg-danger-soft text-danger',
};
const KIND_TEXT: Record<OutboxItem['kind'], string> = {
  transaction: 'Transaction',
  susu_contribution: 'Susu contribution',
  susu_withdrawal: 'Susu withdrawal',
  group_contribution: 'Group Susu contribution',
};

/** Keeps the outbox moving: on sign-in, reconnect, a background-sync wake-up, and every minute. */
export function OfflineRuntime() {
  const userId = useAuth((s) => s.user?.id);
  const token = useAuth((s) => s.accessToken);
  const setOnline = useOutbox((s) => s.setOnline);

  useEffect(() => {
    void useOutbox.getState().refresh();
    if (userId && token) void flushOutbox();
  }, [userId, token]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void flushOutbox();
    };
    const off = () => setOnline(false);
    const onMessage = (e: MessageEvent) => e.data?.type === 'bf-outbox-sync' && void flushOutbox();
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    const timer = window.setInterval(() => navigator.onLine && void flushOutbox(), 60_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.clearInterval(timer);
    };
  }, [setOnline]);
  return null;
}

export function OfflineBanner() {
  const online = useOutbox((s) => s.online);
  if (online) return null;
  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl bg-gold-soft px-4 py-3 text-sm">
      <WifiOff className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
      <p>
        <strong className="font-medium">You're offline.</strong> You can still record transactions and Susu contributions. They're saved on this device and sent when you reconnect. Other figures may be out of date.
      </p>
    </div>
  );
}

export function SyncIndicator() {
  const items = useOutbox((s) => s.items);
  const syncing = useOutbox((s) => s.syncing);
  const online = useOutbox((s) => s.online);
  const [open, setOpen] = useState(false);
  const unsent = unsentCount(items);
  const review = items.filter((i) => i.status === 'needs_review' || i.status === 'failed').length;
  if (!items.length && online) return null;

  const Icon = !online ? CloudOff : syncing ? Loader2 : review ? AlertTriangle : unsent ? CloudUpload : CheckCircle2;
  const label = !online ? `Offline${unsent ? `, ${unsent} waiting to sync` : ''}` : unsent ? `${unsent} record${unsent > 1 ? 's' : ''} waiting to sync` : 'All records synced';
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} title={label} className="neu-raised-sm relative grid size-10 place-items-center rounded-full text-muted hover:text-ink">
        <Icon className={cn('size-[18px]', syncing && 'animate-spin', review ? 'text-danger' : !online || unsent ? 'text-gold-ink' : 'text-primary')} aria-hidden />
        {unsent > 0 && <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-gold px-1 text-[11px] font-semibold text-ink">{unsent}</span>}
      </button>
      <OutboxDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function OutboxDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const items = useOutbox((s) => s.items);
  const syncing = useOutbox((s) => s.syncing);
  const online = useOutbox((s) => s.online);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogTitle>Records on this device</DialogTitle>
        <DialogDescription>Records made without a connection. They count on the server only once they show as synced.</DialogDescription>
        {items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing waiting.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {items.map((i) => (
              <li key={i.id} className="grid gap-1.5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{i.summary.title}</span>
                  <span className="tabular-nums">{formatMoney(i.summary.amount, i.summary.currency)}</span>
                </div>
                <p className="text-xs text-muted">
                  {KIND_TEXT[i.kind]} · {formatYmd(i.summary.date)}
                  {i.summary.context ? ` · ${i.summary.context}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_TONE[i.status])}>{STATUS_TEXT[i.status]}</span>
                  {i.status === 'failed' && i.attempts > 0 && <span className="text-xs text-muted">Tried {i.attempts} time{i.attempts > 1 ? 's' : ''}</span>}
                </div>
                {i.lastError && i.status !== 'synced' && <p className="text-xs text-danger">{i.lastError}</p>}
                {(i.status === 'failed' || i.status === 'needs_review' || i.status === 'saved_locally') && (
                  <div className="flex gap-3 text-xs">
                    <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={!online || syncing} onClick={() => void retryItem(i.id)}>
                      {i.status === 'needs_review' ? 'Try again' : 'Send now'}
                    </button>
                    {confirm === i.id ? (
                      <>
                        <span className="text-muted">Delete it from this device?</span>
                        <button type="button" className="text-danger hover:underline" onClick={() => void discardItem(i.id).then(() => setConfirm(null))}>
                          Delete
                        </button>
                        <button type="button" className="text-muted hover:underline" onClick={() => setConfirm(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button type="button" className="text-muted hover:text-danger hover:underline" onClick={() => setConfirm(i.id)}>
                        Discard
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">{online ? 'Records needing review stay here until you try again or discard them.' : 'You are offline. Sending starts when you reconnect.'}</p>
          <Button size="sm" variant="neu" disabled={!online} loading={syncing} onClick={() => void flushOutbox({ force: true })}>
            <RefreshCw /> Sync now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Offers a reload when a new version has been downloaded, instead of reloading under someone's feet. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    if (!needRefresh) return;
    toast('A new version of BudgetFlow is ready', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      onDismiss: () => setNeedRefresh(false),
    });
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);
  return null;
}
