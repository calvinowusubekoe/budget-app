import { useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ClipboardList, History, Mail, Paperclip, Plus, Settings2, ShieldCheck, Undo2, Upload, UserPlus, UsersRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { cn, formatDate, initials } from '@/lib/utils';
import { amountError, cleanAmount, formatMoney, formatYmd, isZero, todayYmd } from '@/lib/money';
import { ApiError } from '@/services/api';
import type { CellState, GroupContribution, GroupCycle, GroupMember, GroupPayout, GroupReport, RecordEvent, SusuGroup } from '@/types/api';
import { describeFrequency } from './hooks';
import { can, ROLE_LABEL, STATUS_LABEL, useGroup, useGroupActivity, useGroupContributions, useGroupCycles, useGroupMembers, useGroupMutations, useGroupPayouts, useGroupReport, useRecordProof, downloadRecordProof } from './groupHooks';

type Tab = 'overview' | 'records' | 'payouts' | 'members' | 'reports' | 'activity' | 'settings';
const TABS: { id: Tab; label: string; show?: (g: SusuGroup) => boolean }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'records', label: 'Contributions' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'members', label: 'Members' },
  { id: 'reports', label: 'Reports' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings', show: (g) => can(g, 'manageSettings') },
];

const errMsg = (e: unknown) => (e instanceof ApiError && e.details?.[0] ? e.details[0].message : (e as Error).message);

export function GroupPage() {
  const { groupId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const group = useGroup(groupId);
  const raw = params.get('tab');
  const tab: Tab = raw === 'mine' ? 'records' : ((TABS.find((t) => t.id === raw)?.id ?? 'overview') as Tab);

  if (group.isPending) return <Skeleton className="h-72 rounded-3xl" />;
  if (group.error) return <Alert tone="danger">{group.error.message} <Link to="/susu" className="text-primary underline">Back to Susu</Link></Alert>;
  const g = group.data;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary"><UsersRound className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <Link to="/susu" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-3.5" /> Susu</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[28px] font-semibold">
            {g.name}
            <Badge tone="primary">{ROLE_LABEL[g.me?.role ?? 'member']}</Badge>
            {g.status !== 'active' && <Badge className="capitalize">{g.status}</Badge>}
            {g.me?.status === 'suspended' && <Badge tone="gold">Suspended</Badge>}
          </h1>
          <p className="text-muted">
            {formatMoney(g.contributionAmount, g.currency)} each, {describeFrequency(g)}, from {formatYmd(g.startDate)}. {g.memberCount} members.
            {g.collectionSchedule && ` ${g.collectionSchedule}.`}
          </p>
        </div>
      </header>

      <Alert tone="info">
        <span className="block font-medium">Records only</span>
        <span className="text-muted">Members pay and collect among themselves, the way the group agrees. Kontaa records what organisers enter and lets each member confirm or dispute it. It never collects, holds or pays out money.</span>
      </Alert>

      <nav aria-label="Group sections" className="-mx-1 overflow-x-auto px-1">
        <div role="tablist" className="neu-inset inline-flex gap-1 rounded-2xl p-1">
          {TABS.filter((t) => !t.show || t.show(g)).map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setParams({ tab: t.id }, { replace: true })} className={cn('rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap transition', tab === t.id ? 'neu-raised-sm text-primary' : 'text-muted hover:text-ink')}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'overview' && <Overview g={g} />}
      {tab === 'records' && <Records g={g} />}
      {tab === 'payouts' && <Payouts g={g} />}
      {tab === 'members' && <Members g={g} />}
      {tab === 'reports' && <Reports g={g} />}
      {tab === 'activity' && <Activity g={g} />}
      {tab === 'settings' && can(g, 'manageSettings') && <Settings g={g} />}
    </div>
  );
}

/* ---------------- overview ---------------- */

/**
 * The rotation track: one coin per cycle, in turn order. A solid lagoon coin
 * means the payout was recorded and the recipient confirmed it; a ring means
 * it's due; outlined coins are still ahead.
 */
function RotationTrack({ report, meId }: { report: GroupReport; meId?: string }) {
  return (
    <ol className="flex flex-wrap gap-3" aria-label="Rotation, in turn order">
      {report.cycles.map((c) => {
        const paid = c.payout?.status === 'confirmed';
        const recorded = c.payout && !paid;
        const label = `Cycle ${c.number}, ${formatYmd(c.dueDate)}: ${c.recipient?.displayName ?? 'unknown'} collects. ${paid ? 'Payout confirmed' : recorded ? `Payout ${c.payout!.status}` : c.due ? 'Due' : 'Upcoming'}`;
        return (
          <li key={c.cycleId} aria-label={label} title={label} className="flex w-16 flex-col items-center gap-1 text-center">
            <span
              className={cn(
                'grid size-12 place-items-center rounded-full text-sm font-semibold',
                paid && 'bg-primary text-primary-fg shadow-[inset_-3px_-3px_6px_rgb(0_0_0/0.2),inset_3px_3px_6px_rgb(255_255_255/0.2)]',
                recorded && 'neu-raised-sm border-2 border-primary text-primary',
                !c.payout && c.due && 'neu-inset border-2 border-gold text-ink',
                !c.payout && !c.due && 'neu-raised-sm text-muted',
                c.recipient?.id === meId && 'outline-2 outline-offset-2 outline-gold',
              )}
            >
              {initials(c.recipient?.displayName ?? '?')}
            </span>
            <span className="text-[11px] leading-tight text-muted">#{c.number}<br />{formatYmd(c.dueDate, { day: 'numeric', month: 'short' })}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Overview({ g }: { g: SusuGroup }) {
  const report = useGroupReport(g.id);
  const m = useGroupMutations(g.id);
  if (report.isPending) return <Skeleton className="h-48 rounded-3xl" />;
  if (report.error) return <Alert tone="danger">{report.error.message}</Alert>;
  const r = report.data;
  const mine = r.members.find((x) => x.member.id === g.me?.memberId);
  const myTurn = r.cycles.find((c) => c.recipient?.id === g.me?.memberId);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Rotation</CardTitle>
            <CardDescription>{g.rotationMethod === 'random' ? 'Order drawn at random when the rotation was set up.' : g.rotationMethod === 'manual' ? 'Recipients chosen by the organisers.' : 'Members collect in their listed order.'}</CardDescription>
          </div>
          {can(g, 'manageCycles') && g.rotationMethod !== 'manual' && (
            <Button size="sm" variant="neu" loading={m.generate.isPending} onClick={() => m.generate.mutate({}, { onSuccess: () => toast.success('Rotation set up'), onError: (e) => toast.error(errMsg(e)) })}>
              <Plus /> {r.cycles.length ? 'Add turns for new members' : 'Set up the rotation'}
            </Button>
          )}
        </CardHeader>
        {r.cycles.length === 0 ? (
          <EmptyState icon={UsersRound} title="No rotation yet">{can(g, 'manageCycles') ? 'Add members, then set up the rotation. Each member gets one turn to collect.' : 'The organisers haven’t set up the rotation yet.'}</EmptyState>
        ) : (
          <>
            <RotationTrack report={r} meId={g.me?.memberId} />
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-hidden>
              <li className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-primary" /> Payout confirmed</li>
              <li className="flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-primary" /> Payout recorded</li>
              <li className="flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-gold" /> Due</li>
              <li className="flex items-center gap-1.5"><span className="neu-raised-sm size-3 rounded-full" /> Upcoming</li>
              <li className="flex items-center gap-1.5"><span className="size-3 rounded-full outline-2 outline-gold" /> Your turn</li>
            </ul>
          </>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>You</CardTitle></CardHeader>
          {mine ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Expected so far" value={formatMoney(mine.expectedToDate, r.currency)} />
              <Stat label="Recorded for you" value={formatMoney(mine.received, r.currency)} />
              <Stat label="Outstanding" value={formatMoney(mine.outstanding, r.currency)} danger={!isZero(mine.outstanding)} />
              <Stat label="Your turn" value={myTurn ? `#${myTurn.number}, ${formatYmd(myTurn.dueDate, { day: 'numeric', month: 'short' })}` : 'Not assigned'} />
            </dl>
          ) : (
            <p className="text-sm text-muted">You aren’t expected to contribute in any cycle yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader><CardTitle>The group so far</CardTitle></CardHeader>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Expected to date" value={formatMoney(r.totals.expectedToDate, r.currency)} />
            <Stat label="Recorded" value={formatMoney(r.totals.received, r.currency)} />
            <Stat label="Outstanding" value={formatMoney(r.totals.outstanding, r.currency)} danger={!isZero(r.totals.outstanding)} />
            <Stat label="Payouts confirmed" value={`${r.totals.payoutsConfirmed} of ${r.totals.cycles}`} />
          </dl>
          <p className="mt-3 text-xs text-subtle">The expected amount is what the schedule says should be collected. It isn’t money Kontaa holds.</p>
        </Card>
      </div>

      {r.disputes.length > 0 && (
        <Alert tone="danger">
          <span className="block font-medium">{r.disputes.length} disputed record{r.disputes.length === 1 ? '' : 's'}</span>
          <ul className="mt-1 text-muted">
            {r.disputes.map((d) => <li key={d.id}>{d.member?.displayName}: {formatMoney(d.amount, r.currency)} {d.kind}, “{d.reason}”</li>)}
          </ul>
        </Alert>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="neu-pressed rounded-2xl px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={cn('tabular font-semibold', danger && 'text-danger')}>{value}</dd>
    </div>
  );
}

/* ---------------- contribution records ---------------- */

const CELL: Record<CellState, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'bg-primary-soft text-primary' },
  partial: { label: 'Part paid', cls: 'bg-gold-soft text-gold-ink' },
  missed: { label: 'Missed', cls: 'bg-danger-soft text-danger' },
  due: { label: 'Due today', cls: 'bg-gold-soft text-gold-ink' },
  disputed: { label: 'Disputed', cls: 'bg-danger-soft text-danger' },
  scheduled: { label: 'Scheduled', cls: 'neu-pressed text-muted' },
};

function Records({ g }: { g: SusuGroup }) {
  const cycles = useGroupCycles(g.id);
  const report = useGroupReport(g.id);
  const members = useGroupMembers(g.id);
  const active = (cycles.data ?? []).filter((c) => c.status === 'active');
  const current = active.find((c) => c.dueDate >= todayYmd()) ?? active.at(-1);
  const [cycleId, setCycleId] = useState<string | undefined>();
  const selected = active.find((c) => c.id === (cycleId ?? current?.id));
  const records = useGroupContributions(g.id, selected?.id);
  const [recording, setRecording] = useState<GroupMember | null>(null);
  const manager = can(g, 'viewAllRecords');
  const byId = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m])), [members.data]);
  const cell = report.data?.cycles.find((c) => c.cycleId === selected?.id);

  if (cycles.isPending || report.isPending) return <Skeleton className="h-64 rounded-3xl" />;
  if (!active.length) return <Card><EmptyState icon={ClipboardList} title="No cycles yet">Contributions are recorded against a cycle. Set up the rotation first.</EmptyState></Card>;

  return (
    <div className="grid gap-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Cycle" htmlFor="rec-cycle" className="min-w-60">
            <Select id="rec-cycle" value={selected?.id} onChange={(e) => setCycleId(e.target.value)}>
              {active.map((c) => <option key={c.id} value={c.id}>#{c.number}, {formatYmd(c.dueDate)}: {c.recipient.displayName} collects</option>)}
            </Select>
          </Field>
          {cell && (
            <p className="text-sm text-muted">
              Recorded <span className="tabular font-semibold text-ink">{formatMoney(cell.received, g.currency)}</span> of an expected {formatMoney(cell.expectedPool, g.currency)}
              {!isZero(cell.outstanding) && <>, <span className="text-danger">{formatMoney(cell.outstanding, g.currency)} outstanding</span></>}.
            </p>
          )}
        </div>

        {cell && (
          <ul className="mt-5 grid gap-2">
            {cell.members.map((x) => {
              const member = byId.get(x.memberId);
              return (
                <li key={x.memberId} className="neu-pressed flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{member?.displayName ?? 'Member'}{x.memberId === g.me?.memberId && <span className="text-subtle"> (you)</span>}</span>
                  <span className="tabular text-muted">{formatMoney(x.received, g.currency)} / {formatMoney(selected!.expectedPerMember, g.currency)}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', CELL[x.state].cls)}>{CELL[x.state].label}</span>
                  {can(g, 'recordContributions') && member && member.status !== 'removed' && (
                    <Button size="sm" variant="neu" onClick={() => setRecording(member)}><Plus /> Record</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{manager ? 'Records for this cycle' : 'Your records'}</CardTitle>
            <CardDescription>{manager ? 'Each member confirms their own record from their account. Members added without an account can’t confirm.' : 'Confirm a record if it matches what you paid. Dispute it if it doesn’t.'}</CardDescription>
          </div>
        </CardHeader>
        {records.isPending ? <Skeleton className="h-24" /> : records.data!.length === 0 ? <p className="text-sm text-muted">Nothing recorded for this cycle yet.</p> : (
          <ul className="grid gap-2">{records.data!.map((r) => <RecordRow key={r.id} g={g} record={r} registered={byId.get(r.member.id)?.registered ?? false} />)}</ul>
        )}
      </Card>

      {recording && selected && <RecordContributionDialog g={g} cycle={selected} member={recording} onClose={() => setRecording(null)} />}
    </div>
  );
}

function RecordContributionDialog({ g, cycle, member, onClose }: { g: SusuGroup; cycle: GroupCycle; member: GroupMember; onClose: () => void }) {
  const m = useGroupMutations(g.id);
  const [amount, setAmount] = useState(cycle.expectedPerMember);
  const [date, setDate] = useState(todayYmd());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();
  const [key] = useState(() => crypto.randomUUID()); // one per dialog: a retry or offline replay saves it once
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>Record {member.displayName}’s contribution</DialogTitle>
        <DialogDescription>For cycle #{cycle.number}. Record what {member.displayName} paid outside Kontaa. {member.registered ? 'They’ll be asked to confirm it.' : 'They have no account, so it stays unconfirmed.'}</DialogDescription>
        <form className="mt-4 grid gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const v = cleanAmount(amount);
          const err = amountError(v, g.currency);
          if (err) return setError(err);
          m.recordContribution.mutate({ cycleId: cycle.id, memberId: member.id, amount: v, date, notes, idempotencyKey: key, summary: { title: `${member.displayName}, cycle #${cycle.number}`, amount: v, currency: g.currency, date, context: g.name } }, { onSuccess: (r) => { if (r.queued) toast('Contribution saved on this device', { description: 'It will sync when you’re back online.' }); else toast.success('Contribution recorded'); onClose(); }, onError: (er) => setError(errMsg(er)) });
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Amount (${g.currency})`} htmlFor="gc-amt" error={error}><Input id="gc-amt" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Paid on" htmlFor="gc-date"><Input id="gc-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Input aria-label="Notes (optional)" placeholder="Notes (optional), e.g. paid in cash at the meeting" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.recordContribution.isPending}>Record contribution</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shared row for contribution and payout records, with the actions the viewer may take. */
function RecordRow({ g, record, registered }: { g: SusuGroup; record: GroupContribution | GroupPayout; registered: boolean }) {
  const m = useGroupMutations(g.id);
  const [prompt, setPrompt] = useState<null | 'dispute' | 'cancel'>(null);
  const [reason, setReason] = useState('');
  const isPayout = record.kind === 'payout';
  const who = isPayout ? (record as GroupPayout).recipient.displayName : (record as GroupContribution).member.displayName;
  const amount = isPayout ? (record as GroupPayout).actualAmount : (record as GroupContribution).amount;
  const date = isPayout ? (record as GroupPayout).payoutDate : (record as GroupContribution).date;
  const canManage = can(g, isPayout ? 'recordPayouts' : 'recordContributions');
  const canCancel = canManage && record.status !== 'cancelled' && (record.status !== 'confirmed' || can(g, 'cancelConfirmed'));
  const act = (action: 'confirm' | 'dispute' | 'cancel', r?: string) =>
    m.act.mutate({ kind: record.kind, recordId: record.id, action, reason: r }, { onSuccess: () => { toast.success(action === 'confirm' ? 'Confirmed' : action === 'dispute' ? 'Dispute sent to the organisers' : 'Record cancelled'); setPrompt(null); }, onError: (e) => toast.error(errMsg(e)) });

  return (
    <li className={cn('rounded-2xl px-3 py-2.5 text-sm', record.status === 'cancelled' ? 'opacity-60' : 'neu-pressed')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 shrink-0 text-xs text-subtle">{formatYmd(date)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{who}{record.cycleNumber ? <span className="font-normal text-subtle">, cycle #{record.cycleNumber}</span> : null}</span>
          {isPayout && (record as GroupPayout).confirmationDetails && <span className="block truncate text-xs text-muted">{(record as GroupPayout).confirmationDetails}</span>}
          {record.notes && <span className="block truncate text-xs text-muted">{record.notes}</span>}
        </span>
        <span className={cn('tabular font-semibold', record.status === 'cancelled' && 'line-through')}>{formatMoney(amount, record.currency)}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', record.status === 'confirmed' ? 'bg-primary-soft text-primary' : record.status === 'disputed' ? 'bg-danger-soft text-danger' : record.status === 'cancelled' ? 'neu-pressed text-subtle' : 'bg-gold-soft text-gold-ink')}>
          {record.status === 'recorded' && record.selfRecorded ? 'Self-recorded, no confirmation' : record.status === 'recorded' && !registered ? 'Recorded (no account to confirm)' : STATUS_LABEL[record.status]}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {record.canRespond && (
          <>
            <Button size="sm" onClick={() => act('confirm')} loading={m.act.isPending && m.act.variables?.action === 'confirm'}><Check /> Confirm</Button>
            {record.status === 'recorded' && <Button size="sm" variant="neu" onClick={() => { setPrompt('dispute'); setReason(''); }}><AlertTriangle /> Dispute</Button>}
          </>
        )}
        {canCancel && <Button size="sm" variant="ghost" onClick={() => { setPrompt('cancel'); setReason(''); }}><X /> Cancel record</Button>}
        <ProofControl g={g} record={record} canAttach={record.status !== 'cancelled' && (canManage || record.canRespond || (isPayout ? (record as GroupPayout).recipient.id : (record as GroupContribution).member.id) === g.me?.memberId)} />
        <EventHistory events={record.events} />
      </div>
      {prompt && (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); act(prompt, reason); }}>
          <Input aria-label="Reason" placeholder={prompt === 'dispute' ? 'What’s wrong? e.g. I paid 100, not 80' : 'Why cancel? e.g. recorded twice'} value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 min-w-56 flex-1 glass shadow-none" autoFocus />
          <Button size="sm" type="submit" variant={prompt === 'cancel' ? 'danger' : 'primary'} disabled={reason.trim().length < 3} loading={m.act.isPending}>{prompt === 'dispute' ? 'Send dispute' : 'Cancel record'}</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setPrompt(null)}>Back</Button>
        </form>
      )}
    </li>
  );
}

function EventHistory({ events }: { events: RecordEvent[] }) {
  if (events.length < 2) return null;
  return (
    <details className="ml-auto text-xs text-muted">
      <summary className="cursor-pointer"><History className="mr-1 inline size-3.5" />History ({events.length})</summary>
      <ol className="mt-1 grid gap-0.5">
        {events.map((e, i) => (
          <li key={i}>
            {formatDate(e.at, { dateStyle: 'medium', timeStyle: 'short' })}: {e.actor} {e.type}
            {e.changes?.amount && ` (${e.changes.amount.from} → ${e.changes.amount.to})`}
            {e.reason && `: “${e.reason}”`}
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ---------------- payouts ---------------- */

function Payouts({ g }: { g: SusuGroup }) {
  const cycles = useGroupCycles(g.id);
  const payouts = useGroupPayouts(g.id);
  const members = useGroupMembers(g.id);
  const [recordFor, setRecordFor] = useState<GroupCycle | null>(null);
  if (cycles.isPending || payouts.isPending) return <Skeleton className="h-48 rounded-3xl" />;
  const live = (payouts.data ?? []).filter((p) => p.status !== 'cancelled');
  const byCycle = new Map(live.map((p) => [p.cycleId, p]));
  const registered = new Map((members.data ?? []).map((m) => [m.id, m.registered]));
  const active = (cycles.data ?? []).filter((c) => c.status === 'active');

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Payouts</CardTitle>
          <CardDescription>A record of each payout made outside Kontaa. The recipient confirms it from their account. A confirmed payout is the recipient’s acknowledgement, not a bank or MoMo check.</CardDescription>
        </div>
      </CardHeader>
      {active.length === 0 ? <p className="text-sm text-muted">No cycles yet.</p> : (
        <ul className="grid gap-2">
          {active.map((c) => {
            const p = byCycle.get(c.id);
            return p ? (
              <RecordRow key={c.id} g={g} record={p} registered={registered.get(p.recipient.id) ?? false} />
            ) : (
              <li key={c.id} className="neu-pressed flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-subtle">{formatYmd(c.dueDate)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.recipient.displayName}<span className="font-normal text-subtle">, cycle #{c.number}</span></span>
                <span className="tabular text-muted">Expected {formatMoney(c.expectedPool, g.currency)}</span>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium neu-pressed text-muted">{c.dueDate <= todayYmd() ? 'Not recorded' : 'Scheduled'}</span>
                {can(g, 'recordPayouts') && c.dueDate <= todayYmd() && <Button size="sm" variant="neu" onClick={() => setRecordFor(c)}><Plus /> Record payout</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {recordFor && <RecordPayoutDialog g={g} cycle={recordFor} onClose={() => setRecordFor(null)} />}
    </Card>
  );
}

function RecordPayoutDialog({ g, cycle, onClose }: { g: SusuGroup; cycle: GroupCycle; onClose: () => void }) {
  const m = useGroupMutations(g.id);
  const [amount, setAmount] = useState(cycle.expectedPool);
  const [date, setDate] = useState(todayYmd());
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>Record payout to {cycle.recipient.displayName}</DialogTitle>
        <DialogDescription>Record a payout that has already been made, outside Kontaa. The schedule expected {formatMoney(cycle.expectedPool, g.currency)}; enter what was actually handed over.</DialogDescription>
        <form className="mt-4 grid gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const v = cleanAmount(amount);
          const err = amountError(v, g.currency);
          if (err) return setError(err);
          m.recordPayout.mutate({ cycleId: cycle.id, actualAmount: v, payoutDate: date, confirmationDetails: details }, { onSuccess: () => { toast.success('Payout recorded'); onClose(); }, onError: (er) => setError(errMsg(er)) });
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Amount paid out (${g.currency})`} htmlFor="gp-amt" error={error}><Input id="gp-amt" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Paid out on" htmlFor="gp-date"><Input id="gp-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Field label="How it was paid (optional)" htmlFor="gp-det" hint="For the group’s reference, e.g. “Cash at Sunday meeting”. Kontaa doesn’t check it."><Input id="gp-det" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={200} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.recordPayout.isPending}>Record payout</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- members ---------------- */

function Members({ g }: { g: SusuGroup }) {
  const members = useGroupMembers(g.id);
  const m = useGroupMutations(g.id);
  const manage = can(g, 'manageMembers');
  const [adding, setAdding] = useState<null | 'name' | 'email'>(null);
  const [linking, setLinking] = useState<GroupMember | null>(null);
  const update = (member: GroupMember, body: Record<string, unknown>, msg: string) => m.updateMember.mutate({ memberId: member.id, ...body }, { onSuccess: () => toast.success(msg), onError: (e) => toast.error(errMsg(e)) });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Members</CardTitle>
          <CardDescription>{manage ? 'Phone numbers and emails are visible only to organisers.' : 'Everyone in the group, in turn order.'}</CardDescription>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="neu" onClick={() => setAdding('name')}><UserPlus /> Add by name</Button>
            <Button size="sm" onClick={() => setAdding('email')}><Mail /> Invite by email</Button>
          </div>
        )}
      </CardHeader>
      {members.isPending ? <Skeleton className="h-32" /> : (
        <ul className="divide-y divide-line">
          {members.data!.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="neu-raised-sm grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-primary">{initials(x.displayName)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {x.rotationPosition != null && <span className="text-subtle">#{x.rotationPosition}</span>} {x.displayName}
                  {x.id === g.me?.memberId && <span className="text-subtle">(you)</span>}
                  {x.role !== 'member' && <Badge tone="primary">{ROLE_LABEL[x.role]}</Badge>}
                  {x.status !== 'active' && <Badge tone={x.status === 'invited' ? 'gold' : 'neutral'} className="capitalize">{x.status}</Badge>}
                  {!x.registered && x.status === 'active' && <Badge>No account</Badge>}
                </span>
                {x.contact && (x.contact.phone || x.contact.email) && <span className="block truncate text-xs text-muted">{[x.contact.phone, x.contact.email].filter(Boolean).join(', ')}</span>}
              </span>
              {manage && x.id !== g.me?.memberId && (
                <span className="flex flex-wrap gap-1.5">
                  {!x.registered && x.status === 'active' && <Button size="sm" variant="ghost" onClick={() => setLinking(x)}><Mail /> Invite to confirm</Button>}
                  {g.me?.role === 'organizer' && x.status === 'active' && (
                    <Select aria-label={`Role for ${x.displayName}`} className="h-8 w-44 text-xs" value={x.role} onChange={(e) => update(x, { role: e.target.value }, 'Role changed')}>
                      <option value="member">Member</option>
                      <option value="assistant">Assistant organiser</option>
                      <option value="organizer">Organiser</option>
                    </Select>
                  )}
                  {x.status === 'active' && <Button size="sm" variant="ghost" onClick={() => update(x, { status: 'suspended' }, 'Member suspended')}>Suspend</Button>}
                  {x.status === 'suspended' && <Button size="sm" variant="ghost" onClick={() => update(x, { status: 'active' }, 'Member reinstated')}><Undo2 /> Reinstate</Button>}
                  {x.status !== 'invited' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => update(x, { status: 'removed' }, 'Member removed')}>Remove</Button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddMemberDialog g={g} mode={adding} onClose={() => setAdding(null)} />}
      {linking && <AddMemberDialog g={g} mode="email" linkMember={linking} onClose={() => setLinking(null)} />}
    </Card>
  );
}

function AddMemberDialog({ g, mode, linkMember, onClose }: { g: SusuGroup; mode: 'name' | 'email'; linkMember?: GroupMember; onClose: () => void }) {
  const m = useGroupMutations(g.id);
  const [name, setName] = useState(linkMember?.displayName ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('member');
  const busy = m.addMember.isPending || m.invite.isPending;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const done = { onSuccess: () => { toast.success(mode === 'name' ? `${name} added` : `Invitation sent to ${email}`); onClose(); }, onError: (er: Error) => toast.error(errMsg(er)) };
    if (mode === 'name') m.addMember.mutate({ displayName: name, phone, role }, done);
    else m.invite.mutate(linkMember ? { email, memberId: linkMember.id } : { email, displayName: name, role }, done);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>{linkMember ? `Invite ${linkMember.displayName}` : mode === 'name' ? 'Add a member by name' : 'Invite a member'}</DialogTitle>
        <DialogDescription>
          {mode === 'name' ? 'For members without a smartphone or account. You record their contributions, but they can’t confirm them until they’re invited.' : 'They’ll get an email to join with their own account, so they can see the schedule and confirm their records.'}
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          {!linkMember && <Field label="Name" htmlFor="gm-name"><Input id="gm-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>}
          {mode === 'email' ? (
            <Field label="Email" htmlFor="gm-email"><Input id="gm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          ) : (
            <Field label="Phone (optional)" htmlFor="gm-phone" hint="Only organisers can see it."><Input id="gm-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          )}
          {!linkMember && (
            <Field label="Role" htmlFor="gm-role">
              <Select id="gm-role" value={role} onChange={(e) => setRole(e.target.value)}><option value="member">Member</option><option value="assistant">Assistant organiser</option></Select>
            </Field>
          )}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={(!linkMember && !name.trim()) || (mode === 'email' && !email)}>{mode === 'name' ? 'Add member' : 'Send invitation'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- reports ---------------- */

function Reports({ g }: { g: SusuGroup }) {
  const report = useGroupReport(g.id);
  if (report.isPending) return <Skeleton className="h-64 rounded-3xl" />;
  if (report.error) return <Alert tone="danger">{report.error.message}</Alert>;
  const r = report.data;
  const money = (v: string) => formatMoney(v, r.currency);
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{can(g, 'viewAllRecords') ? 'Outstanding by member' : 'Your contributions'}</CardTitle>
            <CardDescription>As of {formatYmd(r.asOf)}. Counts cycles that are due. Recorded and confirmed records count as received. Disputed records are shown separately and don’t count.</CardDescription>
          </div>
        </CardHeader>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr><th className="px-2 py-2 font-medium">Member</th><th className="px-2 py-2 text-right font-medium">Expected</th><th className="px-2 py-2 text-right font-medium">Recorded</th><th className="px-2 py-2 text-right font-medium">Confirmed</th><th className="px-2 py-2 text-right font-medium">Disputed</th><th className="px-2 py-2 text-right font-medium">Outstanding</th><th className="px-2 py-2 text-right font-medium">Missed</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.members.map((x) => (
                <tr key={x.member.id}>
                  <td className="px-2 py-2.5 font-medium">{x.member.displayName}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(x.expectedToDate)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(x.received)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(x.confirmed)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{isZero(x.disputed) ? '—' : money(x.disputed)}</td>
                  <td className={cn('tabular px-2 py-2.5 text-right font-semibold', !isZero(x.outstanding) && 'text-danger')}>{money(x.outstanding)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{x.missedCycles}{x.partialCycles ? ` (+${x.partialCycles} part)` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader><CardTitle>By cycle</CardTitle></CardHeader>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-160 text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr><th className="px-2 py-2 font-medium">Cycle</th><th className="px-2 py-2 font-medium">Recipient</th><th className="px-2 py-2 text-right font-medium">Expected pool</th><th className="px-2 py-2 text-right font-medium">Recorded</th><th className="px-2 py-2 text-right font-medium">Outstanding</th><th className="px-2 py-2 font-medium">Payout</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.cycles.map((c) => (
                <tr key={c.cycleId} className={cn(!c.due && 'text-muted')}>
                  <td className="px-2 py-2.5">#{c.number}, {formatYmd(c.dueDate, { day: 'numeric', month: 'short' })}</td>
                  <td className="px-2 py-2.5">{c.recipient?.displayName}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(c.expectedPool)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{money(c.received)}</td>
                  <td className={cn('tabular px-2 py-2.5 text-right', c.due && !isZero(c.outstanding) && 'font-semibold text-danger')}>{c.due ? money(c.outstanding) : 'Not due'}</td>
                  <td className="px-2 py-2.5">{c.payout ? `${money(c.payout.actualAmount)}, ${(STATUS_LABEL[c.payout.status] ?? c.payout.status).toLowerCase()}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- activity ---------------- */

const ACTION_TEXT: Record<string, string> = {
  'group.created': 'created the group',
  'group.settings_changed': 'changed the group settings',
  'group.completed': 'marked the group complete',
  'group.cancelled': 'cancelled the group',
  'group.active': 'reopened the group',
  'member.added': 'added a member',
  'member.invited': 'invited a member',
  'member.joined': 'joined the group',
  'member.role_changed': 'changed a member’s role',
  'member.suspended': 'suspended a member',
  'member.active': 'reinstated a member',
  'member.removed': 'removed a member',
  'member.updated': 'updated a member',
  'rotation.randomised': 'drew the rotation order at random',
  'cycles.generated': 'set up the rotation',
  'cycle.created': 'added a cycle',
  'cycle.changed': 'changed a cycle',
  'cycle.cancelled': 'cancelled a cycle',
  'contribution.recorded': 'recorded a contribution',
  'contribution.corrected': 'corrected a contribution',
  'contribution.confirmed': 'confirmed a contribution',
  'contribution.disputed': 'disputed a contribution',
  'contribution.cancelled': 'cancelled a contribution',
  'payout.recorded': 'recorded a payout',
  'payout.corrected': 'corrected a payout',
  'payout.confirmed': 'confirmed a payout',
  'payout.disputed': 'disputed a payout',
  'payout.cancelled': 'cancelled a payout',
};

function Activity({ g }: { g: SusuGroup }) {
  const q = useGroupActivity(g.id);
  if (q.isPending) return <Skeleton className="h-48 rounded-3xl" />;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Activity</CardTitle>
          <CardDescription>A permanent history of changes. Entries can’t be edited or deleted.</CardDescription>
        </div>
      </CardHeader>
      <ol className="grid gap-2.5">
        {q.data!.map((a) => {
          const md = a.metadata as Record<string, string | number | undefined>;
          const detail = md.member ?? md.recipient ?? md.displayName ?? (md.cycle ? `cycle #${md.cycle}` : md.number ? `cycle #${md.number}` : '');
          return (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span><span className="font-medium">{a.actor}</span> <span className="text-muted">{ACTION_TEXT[a.action] ?? a.action}{detail ? `: ${detail}` : ''}{md.reason ? ` (“${md.reason}”)` : ''}</span></span>
              <time className="tabular text-xs text-subtle" dateTime={a.createdAt}>{formatDate(a.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ---------------- settings ---------------- */

function Settings({ g }: { g: SusuGroup }) {
  const m = useGroupMutations(g.id);
  const [name, setName] = useState(g.name);
  const [schedule, setSchedule] = useState(g.collectionSchedule);
  const [perms, setPerms] = useState(g.assistantPermissions);
  const [cancelReason, setCancelReason] = useState('');
  const save = (body: Record<string, unknown>, msg: string) => m.update.mutate(body, { onSuccess: () => toast.success(msg), onError: (e) => toast.error(errMsg(e)) });
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader><CardTitle><Settings2 className="mr-1.5 inline size-4" />Group details</CardTitle></CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="gs-name"><Input id="gs-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="When and where you collect" htmlFor="gs-sched" hint="Shown to everyone, e.g. “Sundays after church, at Auntie Akos’s shop”"><Input id="gs-sched" value={schedule} onChange={(e) => setSchedule(e.target.value)} /></Field>
        </div>
        <Button className="mt-4" loading={m.update.isPending} onClick={() => save({ name, collectionSchedule: schedule }, 'Group saved')}>Save details</Button>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle><ShieldCheck className="mr-1.5 inline size-4" />What assistant organisers can do</CardTitle>
            <CardDescription>Organisers can always do everything. Only organisers can change settings, roles, or cancel a confirmed record.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {([['recordContributions', 'Record contributions'], ['recordPayouts', 'Record payouts'], ['manageMembers', 'Add, invite and suspend members'], ['manageCycles', 'Set up and change cycles']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-3 text-sm"><Checkbox checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} /> {label}</label>
          ))}
        </div>
        <Button className="mt-4" variant="neu" loading={m.update.isPending} onClick={() => save({ assistantPermissions: perms }, 'Permissions saved')}>Save permissions</Button>
      </Card>
      <Card>
        <CardHeader><CardTitle>Finish or cancel</CardTitle></CardHeader>
        <div className="grid gap-3">
          {g.status === 'active' ? (
            <>
              <Button variant="neu" className="justify-self-start" onClick={() => save({ status: 'completed' }, 'Group marked complete')}><CheckCircle2 /> Mark the group complete</Button>
              <div className="flex flex-wrap gap-2">
                <Input aria-label="Reason for cancelling" placeholder="Reason for cancelling the group" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="max-w-sm" />
                <Button variant="danger" disabled={cancelReason.trim().length < 3} onClick={() => save({ status: 'cancelled', cancelReason }, 'Group cancelled')}>Cancel group</Button>
              </div>
              <p className="text-xs text-subtle">Completed and cancelled groups become read-only. All records and history stay.</p>
            </>
          ) : (
            <Button variant="neu" className="justify-self-start" onClick={() => save({ status: 'active' }, 'Group reopened')}><Undo2 /> Reopen the group</Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/** A screenshot or receipt of the payment made outside Kontaa: evidence for members, not something Kontaa verifies. */
function ProofControl({ g, record, canAttach }: { g: SusuGroup; record: GroupContribution | GroupPayout; canAttach: boolean }) {
  const proof = useRecordProof(g.id);
  const input = useRef<HTMLInputElement>(null);
  const pick = (f?: File) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error('Files can be up to 5 MB.');
    proof.mutate({ kind: record.kind, recordId: record.id, file: f }, { onSuccess: () => toast.success(record.proof ? 'Proof replaced' : 'Proof added'), onError: (e) => toast.error(errMsg(e)) });
  };
  return (
    <>
      {record.proof && (
        <Button size="sm" variant="ghost" onClick={() => downloadRecordProof(g.id, record.kind, record.id, record.proof!.name).catch((e: Error) => toast.error(e.message))}>
          <Paperclip /> Proof
        </Button>
      )}
      {canAttach && (
        <>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label={`Proof file for ${record.kind}`} onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" variant="ghost" loading={proof.isPending} onClick={() => input.current?.click()}>
            <Upload /> {record.proof ? 'Replace proof' : 'Add proof'}
          </Button>
        </>
      )}
    </>
  );
}
