import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Ban, CheckCircle2, Coins, Download, MoreHorizontal, Paperclip, Pause, Pencil, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd, isZero, todayYmd } from '@/lib/money';
import { apiBlob, ApiError, saveBlob } from '@/services/api';
import { can } from '@/features/workspaces/useWorkspaces';
import type { SusuEntry, SusuPlan } from '@/types/api';
import { useWs } from '@/features/finance/hooks';
import { describeFrequency, LOCATION_LABEL, useSaveSusuPlan, useSusuEntries, useSusuEntryMutations, useSusuMonthly, useSusuPlan, useSusuSchedule } from './hooks';
import { BeadTrack } from './BeadTrack';
import { PlanDialog } from './PlanDialog';

export function PlanPage() {
  const { planId } = useParams();
  const ws = useWs();
  const plan = useSusuPlan(planId);
  const writable = can(ws.workspace, 'records.write');

  if (plan.isPending) return <Skeleton className="h-72 rounded-[32px]" />;
  if (plan.error) return <Alert tone="danger">{plan.error.message} <Link to="/susu" className="text-primary underline">Back to Susu</Link></Alert>;
  const p = plan.data;
  const editable = writable && p.status !== 'cancelled';

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/susu" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-3.5" /> Susu</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-[28px] font-semibold">
            {p.name}
            {p.status !== 'active' && <Badge className="capitalize">{p.status}</Badge>}
          </h1>
          <p className="text-muted">
            {formatMoney(p.contributionAmount, p.currency)} {describeFrequency(p)} since {formatYmd(p.startDate)}. Kept: {p.location.label ? `${p.location.label} (${LOCATION_LABEL[p.location.type].toLowerCase()})` : LOCATION_LABEL[p.location.type].toLowerCase()}.
          </p>
          {p.status === 'cancelled' && <p className="mt-1 text-sm text-danger">Cancelled: {p.cancelReason}</p>}
        </div>
        {editable && <PlanActions plan={p} />}
      </header>

      <SavingsWell plan={p} />
      <ScheduleCard plan={p} />
      {editable && <RecordPanel plan={p} />}
      <History plan={p} writable={editable} />
    </div>
  );
}

function SavingsWell({ plan: p }: { plan: SusuPlan }) {
  const s = p.summary;
  return (
    <section aria-label="Recorded savings" className="neu-well relative overflow-hidden rounded-[32px] p-6 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-10 size-56 rounded-full border-[16px] border-gold/20" />
      <div className="relative grid gap-5">
        <div>
          <p className="text-sm font-medium text-muted">Recorded savings</p>
          <p className="tabular mt-1 text-5xl font-semibold tracking-tight">{formatMoney(s.current, p.currency)}</p>
        </div>
        {s.progress && (
          <div className="max-w-xl">
            <Progress value={s.progress} tone="gold" label={`${s.progress}% of target`} />
            <p className="mt-2 text-sm text-muted">
              {s.reached ? 'Target reached.' : `${s.progress}% of ${formatMoney(s.target, p.currency)}. ${formatMoney(s.remaining, p.currency)} to go.`}
              {s.onScheduleFinish && ` Keeping to the plan, you’d reach it on ${formatYmd(s.onScheduleFinish)}.`}
            </p>
          </div>
        )}
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><dt className="text-muted">Put in</dt><dd className="tabular font-semibold">{formatMoney(s.contributed, p.currency)}</dd></div>
          <div><dt className="text-muted">Taken out</dt><dd className="tabular font-semibold">{formatMoney(s.withdrawn, p.currency)}</dd></div>
          <div><dt className="text-muted">Contributions</dt><dd className="tabular font-semibold">{s.contributionCount}</dd></div>
        </dl>
      </div>
    </section>
  );
}

function ScheduleCard({ plan: p }: { plan: SusuPlan }) {
  const q = useSusuSchedule(p.id, 90);
  const st = p.summary.schedule;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Keeping to the plan</CardTitle>
          <CardDescription>Each bead is one {p.frequency === 'custom' ? `${p.intervalDays}-day period` : p.frequency === 'daily' ? 'day' : p.frequency === 'weekly' ? 'week' : 'month'}, oldest first.</CardDescription>
        </div>
      </CardHeader>
      {q.isPending ? <Skeleton className="h-16" /> : q.error ? <Alert tone="danger">{q.error.message}</Alert> : q.data.windows.length === 0 ? (
        <p className="text-sm text-muted">The first contribution is due on {formatYmd(p.startDate)}.</p>
      ) : (
        <BeadTrack windows={q.data.windows} currency={p.currency} />
      )}
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <Stat label="Paid in full" value={st.met} />
        <Stat label="Part paid" value={st.partial} />
        <Stat label="Missed" value={st.missed} danger={st.missed > 0} />
        <Stat label="Behind by" value={formatMoney(st.arrears, p.currency)} danger={!isZero(st.arrears)} />
        <Stat label="Next due" value={st.nextDue && p.status === 'active' ? formatYmd(st.nextDue, { day: 'numeric', month: 'short' }) : '—'} />
      </dl>
      {st.streak > 1 && <p className="mt-3 text-sm text-muted">{st.streak} periods in a row paid in full.</p>}
    </Card>
  );
}

function Stat({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="neu-pressed rounded-2xl px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={cn('tabular font-semibold', danger && 'text-danger')}>{value}</dd>
    </div>
  );
}

function RecordPanel({ plan: p }: { plan: SusuPlan }) {
  const m = useSusuEntryMutations(p.id);
  const canContribute = p.status === 'active' || p.status === 'paused';
  const [kind, setKind] = useState<SusuEntry['kind']>(canContribute ? 'contribution' : 'withdrawal');
  const [amount, setAmount] = useState(p.contributionAmount);
  const [date, setDate] = useState(todayYmd());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // One key per entry being written, so a retry or a replay after going offline saves it once.
  const [entryKey, setEntryKey] = useState(() => crypto.randomUUID());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = cleanAmount(amount);
    const err = amountError(v, p.currency);
    const next: Record<string, string> = {};
    if (err) next.amount = err;
    if (kind === 'withdrawal' && reason.trim().length < 2) next.reason = 'Say what the money was for.';
    setErrors(next);
    if (Object.keys(next).length) return;
    m.add.mutate(
      { kind, amount: v, date, notes, ...(kind === 'withdrawal' ? { reason } : {}), idempotencyKey: entryKey, summary: { title: p.name, amount: v, currency: p.currency, date, context: kind === 'withdrawal' ? reason : undefined } },
      {
        onSuccess: (r) => {
          setEntryKey(crypto.randomUUID());
          if (r.queued) toast(`${kind === 'contribution' ? 'Contribution' : 'Withdrawal'} saved on this device`, { description: 'It will sync when you’re back online.' });
          else toast.success(kind === 'contribution' ? 'Contribution recorded' : 'Withdrawal recorded');
          setNotes('');
          setReason('');
          if (kind === 'withdrawal') setAmount('');
        },
        onError: (er) => {
          const d = er instanceof ApiError ? er.details?.[0] : undefined;
          if (d) setErrors({ [d.field]: d.message });
          else toast.error(er.message);
        },
      },
    );
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="radiogroup" aria-label="Record" className="neu-inset inline-flex gap-1 rounded-2xl p-1">
            {(['contribution', 'withdrawal'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                disabled={k === 'contribution' && !canContribute}
                onClick={() => { setKind(k); setAmount(k === 'contribution' ? p.contributionAmount : ''); setErrors({}); }}
                className={cn('rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-40', kind === k ? 'neu-raised-sm text-gold-ink' : 'text-muted hover:text-ink')}
              >
                {k === 'contribution' ? 'I contributed' : 'I withdrew'}
              </button>
            ))}
          </div>
          <p className="text-xs text-subtle">Record what already happened. Nothing is paid through Kontaa.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <Field label={`Amount (${p.currency})`} htmlFor="se-amount" error={errors.amount}>
            <Input id="se-amount" inputMode="decimal" className="tabular h-12 text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date" htmlFor="se-date" error={errors.date}>
            <Input id="se-date" type="date" className="h-12" max={todayYmd()} min={p.startDate} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {kind === 'withdrawal' && (
          <Field label="What was it for?" htmlFor="se-reason" error={errors.reason}>
            <Input id="se-reason" placeholder="e.g. School fees, emergency, end of cycle" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </Field>
        )}
        <Input aria-label="Notes (optional)" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        <div className="flex justify-end">
          <Button type="submit" loading={m.add.isPending}>{kind === 'contribution' ? 'Record contribution' : 'Record withdrawal'}</Button>
        </div>
      </form>
    </Card>
  );
}

function History({ plan: p, writable }: { plan: SusuPlan; writable: boolean }) {
  const [tab, setTab] = useState<'contribution' | 'withdrawal' | 'monthly'>('contribution');
  return (
    <Card>
      <div role="tablist" aria-label="History" className="neu-inset mb-4 inline-flex gap-1 rounded-2xl p-1">
        {([['contribution', 'Contributions'], ['withdrawal', 'Withdrawals'], ['monthly', 'By month']] as const).map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('rounded-xl px-3 py-1.5 text-sm font-medium transition', tab === k ? 'neu-raised-sm text-ink' : 'text-muted hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'monthly' ? <Monthly plan={p} /> : <Entries plan={p} kind={tab} writable={writable} />}
    </Card>
  );
}

function Entries({ plan: p, kind, writable }: { plan: SusuPlan; kind: SusuEntry['kind']; writable: boolean }) {
  const q = useSusuEntries(p.id, kind);
  const m = useSusuEntryMutations(p.id);
  const ws = useWs();
  const [cancelling, setCancelling] = useState<SusuEntry | null>(null);
  const [reason, setReason] = useState('');
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (q.data.length === 0) return <EmptyState icon={Coins} title={kind === 'contribution' ? 'No contributions recorded' : 'No withdrawals recorded'} />;

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && fileFor.current) m.attach.mutate({ id: fileFor.current, file: f }, { onSuccess: () => toast.success('Proof attached'), onError: (er) => toast.error(er.message) });
          e.target.value = '';
        }}
      />
      <ul className="grid gap-1.5">
        {q.data.map((e) => {
          const cancelled = e.status === 'cancelled';
          return (
            <li key={e.id} className={cn('flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm', cancelled ? 'opacity-60' : 'neu-pressed')}>
              <span className="w-24 shrink-0 text-xs text-subtle">{formatYmd(e.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.reason ?? (e.notes || 'Contribution')}</span>
                {e.reason && e.notes && <span className="block truncate text-xs text-muted">{e.notes}</span>}
                {cancelled && <span className="block text-xs text-subtle">Cancelled: {e.cancelReason}</span>}
              </span>
              <span className={cn('tabular font-semibold', cancelled && 'line-through', kind === 'contribution' && 'text-gold-ink')}>
                {formatMoney(e.amount, e.currency, { sign: kind === 'contribution' ? '+' : '-' })}
              </span>
              {e.attachment && (
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Download ${e.attachment.name}`} onClick={async () => {
                  try { saveBlob(await apiBlob(`/susu/plans/${p.id}/contributions/${e.id}/attachment`, { workspaceId: ws.id }), e.attachment!.name); } catch (er) { toast.error((er as Error).message); }
                }}><Download /></Button>
              )}
              {writable && !cancelled && kind === 'contribution' && (
                <Button size="icon" variant="ghost" className="size-8" aria-label={e.attachment ? 'Replace proof' : 'Attach proof'} title="Attach a photo of the collector’s card or a receipt" onClick={() => { fileFor.current = e.id; fileInput.current?.click(); }}><Paperclip /></Button>
              )}
              {writable && !cancelled && (
                <Button size="icon" variant="ghost" className="size-8" aria-label="Cancel this entry" onClick={() => { setCancelling(e); setReason(''); }}><Ban /></Button>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={Boolean(cancelling)} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogTitle>Cancel this {cancelling?.kind}?</DialogTitle>
          <DialogDescription>It stops counting toward your totals but stays in the history with your reason. It can’t be undone; record it again if needed.</DialogDescription>
          <form className="mt-4 grid gap-3" onSubmit={(ev) => {
            ev.preventDefault();
            if (!cancelling) return;
            m.cancel.mutate({ kind: cancelling.kind, id: cancelling.id, reason }, { onSuccess: () => { toast.success('Entry cancelled'); setCancelling(null); }, onError: (er) => toast.error(er.message) });
          }}>
            <Field label="Reason" htmlFor="se-cancel"><Input id="se-cancel" placeholder="e.g. Entered twice" value={reason} onChange={(ev) => setReason(ev.target.value)} autoFocus /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelling(null)}>Keep it</Button>
              <Button type="submit" variant="danger" loading={m.cancel.isPending} disabled={reason.trim().length < 3}>Cancel entry</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Monthly({ plan: p }: { plan: SusuPlan }) {
  const q = useSusuMonthly(p.id);
  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  if (q.data.length === 0) return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead className="text-left text-xs text-subtle">
          <tr><th className="px-2 py-2 font-medium">Month</th><th className="px-2 py-2 text-right font-medium">Put in</th><th className="px-2 py-2 text-right font-medium">Taken out</th><th className="px-2 py-2 text-right font-medium">Net</th></tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {q.data.map((m) => (
            <tr key={m.month}>
              <td className="px-2 py-2.5">{formatYmd(`${m.month}-01`, { month: 'long', year: 'numeric' })}</td>
              <td className="tabular px-2 py-2.5 text-right">{formatMoney(m.contributed, p.currency)} <span className="text-xs text-subtle">({m.contributions})</span></td>
              <td className="tabular px-2 py-2.5 text-right">{formatMoney(m.withdrawn, p.currency)}</td>
              <td className={cn('tabular px-2 py-2.5 text-right font-semibold', m.net.startsWith('-') && 'text-danger')}>{formatMoney(m.net, p.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanActions({ plan: p }: { plan: SusuPlan }) {
  const save = useSaveSusuPlan();
  const [editing, setEditing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const act = (status: SusuPlan['status'], msg: string, extra: Record<string, unknown> = {}) =>
    save.mutate({ id: p.id, status, ...extra }, { onSuccess: () => { toast.success(msg); setCancelOpen(false); }, onError: (e) => toast.error(e.message) });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="neu"><MoreHorizontal /> Manage plan</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Edit details</DropdownMenuItem>
          {p.status === 'active' && <DropdownMenuItem onSelect={() => act('paused', 'Plan paused. Days while paused won’t count as missed.')}><Pause /> Pause</DropdownMenuItem>}
          {p.status === 'paused' && <DropdownMenuItem onSelect={() => act('active', 'Plan resumed')}><Play /> Resume</DropdownMenuItem>}
          {(p.status === 'active' || p.status === 'paused') && <DropdownMenuItem onSelect={() => act('completed', 'Plan marked complete')}><CheckCircle2 /> Mark complete</DropdownMenuItem>}
          {p.status === 'completed' && <DropdownMenuItem onSelect={() => act('active', 'Plan reopened')}><RotateCcw /> Reopen</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setCancelOpen(true)} className="text-danger"><Ban className="!text-danger" /> Cancel plan</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PlanDialog open={editing} onOpenChange={setEditing} plan={p} />
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogTitle>Cancel this plan?</DialogTitle>
          <DialogDescription>The plan becomes read-only. Its records stay for your history and can’t be changed afterwards.</DialogDescription>
          <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); act('cancelled', 'Plan cancelled', { cancelReason: reason }); }}>
            <Field label="Reason" htmlFor="sp-cancel"><Input id="sp-cancel" placeholder="e.g. Collector stopped collecting" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>Keep plan</Button>
              <Button type="submit" variant="danger" loading={save.isPending} disabled={reason.trim().length < 3}>Cancel plan</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
