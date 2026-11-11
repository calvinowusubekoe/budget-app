import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn, formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/money';
import { can } from '@/features/workspaces/useWorkspaces';
import { useWs } from '@/features/finance/hooks';
import type { BillingPeriod, CurrentPlan, LimitKey, PaymentProviderKey, PaymentStatus, Plan, PlanPayment } from '@/types/api';
import { useBillingMutations, useCurrentPlan, usePaymentHistory, usePlans } from './hooks';

const LIMIT_TEXT: Record<LimitKey, string> = {
  accounts: 'Accounts',
  budgets: 'Budgets',
  savingsGoals: 'Savings goals',
  debts: 'Debts',
  recurring: 'Repeating schedules',
  susuPlans: 'Personal Susu plans',
  invoicesPerMonth: 'Invoices this month',
  billsPerMonth: 'Bills this month',
  aiQuestionsPerMonth: 'AI questions this month',
  receiptScansPerMonth: 'Receipt scans this month',
};
const INCLUDES_TEXT: Record<LimitKey, string> = {
  accounts: 'accounts',
  budgets: 'budgets',
  savingsGoals: 'savings goals',
  debts: 'debts',
  recurring: 'repeating schedules',
  susuPlans: 'personal Susu plans',
  invoicesPerMonth: 'invoices a month',
  billsPerMonth: 'bills a month',
  aiQuestionsPerMonth: 'AI assistant questions a month',
  receiptScansPerMonth: 'receipt scans a month',
};
const PERSONAL_LIMITS: LimitKey[] = ['accounts', 'budgets', 'savingsGoals', 'debts', 'recurring', 'susuPlans', 'aiQuestionsPerMonth', 'receiptScansPerMonth'];
const BUSINESS_LIMITS: LimitKey[] = [...PERSONAL_LIMITS, 'invoicesPerMonth', 'billsPerMonth'];

const PAY_STATUS: Record<PaymentStatus, { text: string; tone: string }> = {
  pending: { text: 'Waiting for provider', tone: 'bg-gold-soft text-gold-ink' },
  succeeded: { text: 'Paid', tone: 'bg-primary text-primary-fg' },
  failed: { text: 'Failed', tone: 'bg-danger-soft text-danger' },
  abandoned: { text: 'Not completed', tone: 'neu-pressed text-muted' },
  review: { text: 'Being checked', tone: 'bg-danger-soft text-danger' },
  refunded: { text: 'Refunded', tone: 'neu-pressed text-muted' },
  partially_refunded: { text: 'Part refunded', tone: 'bg-gold-soft text-gold-ink' },
};
const PERIOD_TEXT: Record<BillingPeriod, string> = { monthly: 'Monthly', yearly: 'Yearly' };
const PER: Record<BillingPeriod, string> = { monthly: 'a month', yearly: 'a year' };

export function BillingPage() {
  const ws = useWs();
  const plans = usePlans();
  const current = useCurrentPlan();
  const isOwner = can(ws.workspace, 'billing.manage');
  const canSeeHistory = can(ws.workspace, 'workspace.update');
  const history = usePaymentHistory(canSeeHistory);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/settings" className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Settings
          </Link>
          <h1 className="text-[28px] font-semibold">Plan and billing</h1>
          <p className="text-muted">For {ws.workspace?.name ?? 'this workspace'}. Each workspace has its own plan.</p>
        </div>
      </header>

      <ReturnFromCheckout />

      {current.isPending || plans.isPending ? (
        <Skeleton className="h-64 rounded-[32px]" />
      ) : current.isError || plans.isError ? (
        <Alert tone="danger">{(current.error ?? plans.error)?.message ?? "Couldn't load your plan."}</Alert>
      ) : (
        <>
          <CurrentPlanPanel current={current.data} businessWs={ws.workspace?.type === 'business'} />
          <OfferCard current={current.data} plans={plans.data.plans} providers={plans.data.providers} isOwner={isOwner} />
        </>
      )}

      {canSeeHistory && <HistoryCard history={history.data} loading={history.isPending} isOwner={isOwner} />}

      <p className="flex max-w-3xl items-start gap-2 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          You pay on the provider's own secure page, so Kontaa never sees your card number, CVV or mobile money PIN. These payments are for Kontaa software only. Kontaa doesn't renew plans automatically, and Susu money never passes through Kontaa.
        </span>
      </p>
    </div>
  );
}

function stateLine(c: CurrentPlan) {
  const s = c.subscription;
  if (c.plan === 'free') {
    if (s?.paymentStatus === 'refunded') return 'Your last payment was refunded, so this workspace is on Free.';
    if (s && ['expired', 'cancelled', 'lapsed'].includes(c.state)) return `${s.planName} ended on ${formatDate(s.currentPeriodEnd)}. Your records are all still here.`;
    return 'Free for as long as you like. Limits apply to new records only.';
  }
  if (!s) return '';
  if (c.state === 'ending') return `You cancelled. ${s.planName} stays on until ${formatDate(s.currentPeriodEnd)}, then this workspace moves to Free.`;
  if (c.state === 'grace') return `Your paid period ended on ${formatDate(s.currentPeriodEnd)}. Renew by ${formatDate(c.graceUntil!)} to keep ${s.planName}.`;
  return `Paid through ${formatDate(s.currentPeriodEnd)}. Renew any time before then; the new period starts where this one ends.`;
}

function CurrentPlanPanel({ current, businessWs }: { current: CurrentPlan; businessWs: boolean }) {
  const keys = businessWs ? BUSINESS_LIMITS : PERSONAL_LIMITS;
  return (
    <section aria-labelledby="plan-title" className="neu-well relative overflow-hidden rounded-[32px] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-sm text-muted">Current plan</p>
          <h2 id="plan-title" className="mt-1 text-[34px] leading-tight font-semibold tracking-tight">{current.planName}</h2>
          <p className="mt-2 text-muted">{stateLine(current)}</p>
        </div>
        {current.state === 'grace' && <span className="rounded-full bg-gold-soft px-3 py-1 text-sm font-medium text-gold-ink">Grace period</span>}
        {current.state === 'ending' && <span className="rounded-full neu-pressed px-3 py-1 text-sm font-medium text-muted">Ends soon</span>}
      </div>

      <ul className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Usage">
        {keys.map((k) => {
          const limit = current.limits[k];
          const used = current.usage[k];
          const full = limit !== null && used >= limit;
          return (
            <li key={k} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>{LIMIT_TEXT[k]}</span>
                <span className={cn('tabular-nums', full ? 'font-medium text-danger' : 'text-muted')}>{limit === null ? `${used} · no limit` : `${used} of ${limit}`}</span>
              </div>
              {limit !== null && <Progress value={String(limit === 0 ? 100 : Math.round((used / limit) * 100))} tone={full ? 'danger' : used / limit >= 0.8 ? 'gold' : 'primary'} label={`${LIMIT_TEXT[k]}: ${used} of ${limit}`} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OfferCard({ current, plans, providers, isOwner }: { current: CurrentPlan; plans: Plan[]; providers: { key: PaymentProviderKey; label: string; testMode: boolean }[]; isOwner: boolean }) {
  const ws = useWs();
  const plan = plans.find((p) => p.workspaceType === ws.workspace?.type);
  const free = plans.find((p) => p.key === 'free')!;
  const firstOnSale = (plan?.prices?.monthly ? 'monthly' : plan?.prices?.yearly ? 'yearly' : 'monthly') as BillingPeriod;
  const [period, setPeriod] = useState<BillingPeriod>(firstOnSale);
  const [provider, setProvider] = useState<PaymentProviderKey | undefined>(providers[0]?.key);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { checkout, resume } = useBillingMutations();
  // One key per choice, so a double click opens one checkout rather than two.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [period, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan) return null;
  const price = plan.prices?.[period] ?? null;
  const sub = current.subscription;
  const onPaidPlan = current.plan === plan.key;
  const providerInfo = providers.find((p) => p.key === provider);

  const blocked = !isOwner
    ? 'Only the workspace owner can change the plan.'
    : providers.length === 0
      ? "Payments aren't set up on this server yet, so plans can't be bought here."
      : !price
        ? `${plan.name} isn't on sale ${period === 'yearly' ? 'yearly' : 'monthly'} yet.`
        : null;

  const pay = () =>
    checkout.mutate(
      { plan: plan.key as 'personal_pro' | 'business_pro', billingPeriod: period, provider: provider!, idempotencyKey },
      {
        onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
        onError: (err) => toast.error(err.message),
      },
    );

  const limitList = (Object.keys(free.limits) as LimitKey[]).filter((k) => (ws.workspace?.type === 'business' ? BUSINESS_LIMITS : PERSONAL_LIMITS).includes(k));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{onPaidPlan ? `Renew ${plan.name}` : `Upgrade to ${plan.name}`}</CardTitle>
          <CardDescription>{plan.summary}</CardDescription>
        </div>
      </CardHeader>

      <div className="grid gap-6 md:grid-cols-[1fr_minmax(16rem,22rem)]">
        <div className="grid content-start gap-2 text-sm">
          <p className="text-muted">Free includes:</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {limitList.map((k) => (
              <li key={k}>
                {free.limits[k]} {INCLUDES_TEXT[k]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted">{plan.name} removes these limits and raises the AI allowances to {plan.limits.aiQuestionsPerMonth} questions and {plan.limits.receiptScansPerMonth} receipt scans a month. Everything else in Kontaa is the same on both plans.</p>
        </div>

        <div className="glass grid gap-4 rounded-3xl p-5">
          <Segmented
            label="Billing period"
            value={period}
            onChange={setPeriod}
            options={(['monthly', 'yearly'] as BillingPeriod[]).map((b) => ({ value: b, text: PERIOD_TEXT[b], disabled: !plan.prices?.[b] }))}
          />
          <div>
            {price ? (
              <p className="text-[30px] leading-none font-semibold tabular-nums">
                {formatMoney(price, plan.currency)} <span className="text-base font-normal text-muted">{PER[period]}</span>
              </p>
            ) : (
              <p className="text-muted">Not on sale</p>
            )}
            {onPaidPlan && sub && price && <p className="mt-1 text-sm text-muted">Adds {period === 'yearly' ? 'a year' : 'a month'} after {formatDate(sub.currentPeriodEnd)}.</p>}
          </div>
          {providers.length > 1 && (
            <Segmented label="Pay with" value={provider!} onChange={setProvider} options={providers.map((p) => ({ value: p.key, text: p.label }))} />
          )}
          {providerInfo?.testMode && <p className="text-xs text-gold-ink">{providerInfo.label} is in test mode: no real money is taken.</p>}
          <Button size="lg" onClick={pay} loading={checkout.isPending} disabled={Boolean(blocked)}>
            {providerInfo ? `Pay with ${providerInfo.label}` : 'Pay'}
          </Button>
          {blocked && <p className="text-sm text-muted">{blocked}</p>}
          {!blocked && <p className="text-xs text-muted">You'll go to {providerInfo?.label}'s page to pay, then come back here. The plan switches on once {providerInfo?.label} confirms the payment to Kontaa.</p>}
        </div>
      </div>

      {isOwner && sub && onPaidPlan && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4 text-sm">
          {sub.cancelAtPeriodEnd ? (
            <>
              <span className="text-muted">Cancelled. It runs until {formatDate(sub.currentPeriodEnd)}.</span>
              <Button variant="neu" size="sm" loading={resume.isPending} onClick={() => resume.mutate(undefined, { onSuccess: () => toast.success(`You're keeping ${plan.name}`), onError: (e) => toast.error(e.message) })}>
                Keep my plan
              </Button>
            </>
          ) : (
            <>
              <span className="text-muted">Don't want it any more?</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancel plan
              </Button>
            </>
          )}
        </div>
      )}
      {confirmCancel && sub && <CancelDialog endsAt={sub.currentPeriodEnd} planName={plan.name} onClose={() => setConfirmCancel(false)} />}
    </Card>
  );
}

function CancelDialog({ endsAt, planName, onClose }: { endsAt: string; planName: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { cancel } = useBillingMutations();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>Cancel {planName}?</DialogTitle>
        <DialogDescription>
          You keep {planName} until {formatDate(endsAt)}. After that the workspace moves to Free. Nothing is deleted, and no refund is made for the time left.
        </DialogDescription>
        <form
          className="mt-4 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate(reason.trim(), {
              onSuccess: () => {
                toast.success(`${planName} will end on ${formatDate(endsAt)}`);
                onClose();
              },
              onError: (err) => toast.error(err.message),
            });
          }}
        >
          <Field label="Why are you cancelling? (optional)" htmlFor="cancel-reason">
            <Input id="cancel-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="neu" onClick={onClose}>
              Keep plan
            </Button>
            <Button type="submit" variant="danger" loading={cancel.isPending}>
              Cancel plan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * After the provider sends the user back, ask the server to confirm the
 * payment with the provider. The URL's own status parameter is ignored.
 */
function ReturnFromCheckout() {
  const [params, setParams] = useSearchParams();
  const reference = params.get('reference') ?? params.get('tx_ref');
  const returned = params.has('checkout') && reference && /^bf-[a-f0-9]{24}$/.test(reference) ? reference : null;
  const [ref, setRef] = useState<string | null>(null);
  const { check } = useBillingMutations();
  const started = useRef(false);

  useEffect(() => {
    if (!returned || started.current) return;
    started.current = true;
    setRef(returned);
    check.mutate(returned);
    setParams({}, { replace: true });
  }, [returned]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ref) return null;
  if (check.isPending) return <Alert>Confirming your payment with the provider…</Alert>;
  if (check.isError) return <Alert tone="danger" action={<Button size="sm" variant="neu" onClick={() => check.mutate(ref)}>Check again</Button>}>{check.error.message}</Alert>;
  const p = check.data;
  if (!p) return null;
  if (p.status === 'succeeded') return <Alert tone="success">Payment confirmed. {p.planName} is on{p.coverage ? ` until ${formatDate(p.coverage.end)}` : ''}.</Alert>;
  if (p.status === 'pending')
    return (
      <Alert tone="gold" action={<Button size="sm" variant="neu" loading={check.isPending} onClick={() => check.mutate(ref)}>Check again</Button>}>
        The provider hasn't confirmed this payment yet. It can take a few minutes; Kontaa also keeps checking on its own.
      </Alert>
    );
  if (p.status === 'review') return <Alert tone="danger">The provider confirmed a different amount from the plan price, so the plan wasn't changed. Contact Kontaa support with reference {p.reference}.</Alert>;
  return <Alert tone="danger">{p.failureReason ?? "The payment didn't go through."} Nothing changed on your plan; you can try again below.</Alert>;
}

function HistoryCard({ history, loading, isOwner }: { history?: PlanPayment[]; loading: boolean; isOwner: boolean }) {
  const { check } = useBillingMutations();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>Every plan payment for this workspace, as confirmed by the provider.</CardDescription>
        </div>
      </CardHeader>
      {loading ? (
        <Skeleton className="h-24" />
      ) : !history?.length ? (
        <p className="text-sm text-muted">No payments yet.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Plan</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id} className="border-t border-[var(--line)] align-top">
                  <td className="px-2 py-2.5 whitespace-nowrap">{formatDate(p.paidAt ?? p.createdAt)}</td>
                  <td className="px-2 py-2.5">
                    {p.planName}, {PERIOD_TEXT[p.billingPeriod].toLowerCase()}
                    <div className="text-xs text-muted capitalize">
                      {p.provider}
                      {p.methodType ? `, ${p.methodType.replace(/_/g, ' ')}` : ''}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {formatMoney(p.amount, p.currency)}
                    {p.refunds.filter((r) => r.status === 'processed').map((r, i) => (
                      <div key={i} className="text-xs text-muted">refunded {formatMoney(r.amount, p.currency)}</div>
                    ))}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', PAY_STATUS[p.status].tone)}>{PAY_STATUS[p.status].text}</span>
                    {p.failureReason && p.status !== 'succeeded' && <div className="mt-1 text-xs text-muted">{p.failureReason}</div>}
                    {p.status === 'pending' && isOwner && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {p.checkoutUrl && (
                          <a href={p.checkoutUrl} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            Continue paying <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => check.mutate(p.reference, { onError: (e) => toast.error(e.message), onSuccess: (r) => toast(r.status === 'succeeded' ? 'Payment confirmed' : PAY_STATUS[r.status].text) })}>
                          Check status
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-muted">{p.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
