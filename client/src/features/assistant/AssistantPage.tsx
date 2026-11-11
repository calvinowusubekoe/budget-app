import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { formatYmd, todayYmd } from '@/lib/money';
import { can } from '@/features/workspaces/useWorkspaces';
import { useWs } from '@/features/finance/hooks';
import type { AiAnswer, AiStatus } from '@/types/api';
import { useAiMutations, useAiStatus, useInsights } from '@/features/reports/hooks';
import { InsightRow } from '@/features/reports/ReportsPage';

type Turn = { role: 'user'; content: string } | { role: 'assistant'; content: string; meta: AiAnswer };
type Window = '1' | '3' | '12';

const SUGGESTIONS = ['Summarise my spending this month', 'Where could I cut back?', 'Am I on track with my savings goals?', 'Which Susu contributions have I missed?', 'How is the business doing?'];

function windowRange(w: Window, today: string) {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - (Number(w) - 1));
  return { from: d.toISOString().slice(0, 10), to: today };
}

export function AssistantPage() {
  const status = useAiStatus();
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-[28px] font-semibold">
          <Sparkles className="size-6 text-gold" aria-hidden /> AI Assistant
        </h1>
        <p className="max-w-2xl text-muted">Ask about your records in plain language. Answers quote Kontaa's own figures; anything the assistant suggests is a suggestion, not a verified fact.</p>
      </header>
      {status.isPending ? <Skeleton className="h-48 rounded-3xl" /> : status.isError ? <Alert tone="danger">{status.error.message}</Alert> : <Gate status={status.data} />}
    </div>
  );
}

function Gate({ status }: { status: AiStatus }) {
  const ws = useWs();
  const manager = can(ws.workspace, 'workspace.update');
  const { toggle } = useAiMutations();
  if (!status.configured) {
    return (
      <>
        <Alert>The AI assistant isn't set up on this server, so it can't answer questions here. The insights below come from fixed rules over your figures and don't need AI.</Alert>
        <RuleInsights />
      </>
    );
  }
  if (!status.workspaceEnabled) {
    return (
      <Alert
        tone="gold"
        action={
          manager ? (
            <Button size="sm" variant="neu" loading={toggle.isPending} onClick={() => toggle.mutate(true, { onError: (e) => toast.error(e.message) })}>
              Switch on for this workspace
            </Button>
          ) : undefined
        }
      >
        The assistant is switched off for this workspace{manager ? '.' : '. An owner or admin can switch it on.'}
      </Alert>
    );
  }
  if (!status.consented) return <Consent status={status} />;
  return <Chat status={status} />;
}

function RuleInsights() {
  const today = todayYmd();
  const insights = useInsights(windowRange('3', today));
  if (insights.isPending) return <Skeleton className="h-24" />;
  if (insights.isError || !insights.data.length) return null;
  return (
    <section className="glass rounded-3xl p-5 sm:p-6">
      <h2 className="text-lg font-semibold">What stands out in the last 3 months</h2>
      <ul className="mt-2 divide-y divide-line">
        {insights.data.slice(0, 6).map((i) => (
          <InsightRow key={i.id} i={i} />
        ))}
      </ul>
    </section>
  );
}

function Consent({ status }: { status: AiStatus }) {
  const { consent } = useAiMutations();
  return (
    <section className="glass-strong grid max-w-3xl gap-4 rounded-3xl p-6" aria-labelledby="consent-title">
      <h2 id="consent-title" className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="size-5 text-primary" aria-hidden /> Before you start
      </h2>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="font-medium">Sent to {status.provider}</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            <li>Totals of income and spending, by month and category</li>
            <li>Budgets, savings goals and debt balances</li>
            <li>Your Susu plans and group standing (names and amounts)</li>
            <li>Business totals, for business workspaces</li>
            <li>Your question and the conversation on this screen</li>
            <li>When you scan a receipt: that image, with your category names</li>
          </ul>
        </div>
        <div>
          <p className="font-medium">Never sent</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            <li>Transaction descriptions, payees and notes</li>
            <li>Receipts and proofs already attached to records</li>
            <li>Your email, phone or account numbers</li>
            <li>Anything from other workspaces</li>
          </ul>
        </div>
      </div>
      <p className="text-sm text-muted">
        Kontaa doesn't keep your questions or the answers. A scanned receipt is kept only if you save the transaction, as its attachment. The assistant can't change your records. {status.provider} processes the request under its own data terms. You can withdraw this at any time on this screen.
      </p>
      <div>
        <Button loading={consent.isPending} onClick={() => consent.mutate(undefined, { onError: (e) => toast.error(e.message) })}>
          Agree and continue
        </Button>
      </div>
    </section>
  );
}

function Chat({ status }: { status: AiStatus }) {
  const ws = useWs();
  const manager = can(ws.workspace, 'workspace.update');
  const today = todayYmd();
  const [win, setWin] = useState<Window>('3');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const { ask, withdraw, toggle } = useAiMutations();
  const endRef = useRef<HTMLDivElement>(null);
  const range = windowRange(win, today);
  const limitReached = status.usage.limit !== null && status.usage.used >= status.usage.limit;

  // Braces matter: scrollIntoView can return a Promise, which React would treat as a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, ask.isPending]);

  const send = (question: string) => {
    const q = question.trim();
    if (q.length < 2 || ask.isPending) return;
    // Only the last four exchanges go back as context.
    const history = turns.slice(-8).map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setDraft('');
    ask.mutate(
      { question: q, history, ...range },
      {
        onSuccess: (a) => setTurns((t) => [...t, { role: 'assistant', content: a.answer, meta: a }]),
        onError: (e) => {
          setTurns((t) => t.slice(0, -1));
          setDraft(q);
          toast.error(e.message);
        },
      },
    );
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">Looking at</span>
          <Segmented size="sm" label="Period the assistant looks at" value={win} onChange={setWin} options={[{ value: '1', text: 'This month' }, { value: '3', text: '3 months' }, { value: '12', text: '12 months' }]} />
          <span className="text-xs text-muted">
            {formatYmd(range.from)} to {formatYmd(range.to)}
          </span>
        </div>
        <span className={cn('text-sm', limitReached ? 'text-danger' : 'text-muted')}>
          {status.usage.limit === null ? `${status.usage.used} questions this month` : `${status.usage.used} of ${status.usage.limit} questions this month`}
        </span>
      </div>

      <section className="glass min-h-72 rounded-3xl p-4 sm:p-6" aria-label="Conversation" aria-live="polite">
        {turns.length === 0 ? (
          <div className="grid gap-3">
            <p className="text-muted">Try one of these, or ask your own question.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.filter((s) => ws.workspace?.type === 'business' || !s.includes('business')).map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={limitReached || ask.isPending} className="neu-raised-sm rounded-xl px-3 py-1.5 text-sm text-ink hover:text-primary disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="grid gap-4">
            {turns.map((t, i) =>
              t.role === 'user' ? (
                <li key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-fg">
                  {t.content}
                </li>
              ) : (
                <li key={i} className="max-w-[92%]">
                  <AnswerCard answer={t.meta} />
                </li>
              ),
            )}
            {ask.isPending && (
              <li className="neu-inset w-fit rounded-2xl px-4 py-2.5 text-sm text-muted" role="status">
                Reading your figures…
              </li>
            )}
          </ol>
        )}
        <div ref={endRef} />
      </section>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="ai-q" className="sr-only">
          Your question
        </label>
        <textarea
          id="ai-q"
          rows={2}
          maxLength={1000}
          value={draft}
          disabled={limitReached}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder={limitReached ? 'This workspace has used its questions for the month.' : 'Ask about your spending, budgets, savings, Susu or business…'}
          className="neu-inset min-h-13 flex-1 resize-y rounded-2xl bg-transparent px-4 py-3 text-sm placeholder:text-subtle focus:outline-2 focus:outline-primary"
        />
        <Button type="submit" size="lg" loading={ask.isPending} disabled={limitReached || draft.trim().length < 2}>
          Ask
        </Button>
      </form>
      {limitReached && (
        <p className="text-sm text-muted">
          The limit resets on the 1st. <Link to="/settings/billing" className="text-primary hover:underline">See plans</Link>.
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {turns.length > 0 && (
          <Button variant="link" size="sm" onClick={() => setTurns([])}>
            Clear conversation
          </Button>
        )}
        <Button variant="link" size="sm" loading={withdraw.isPending} onClick={() => withdraw.mutate(undefined, { onSuccess: () => toast.success('Consent withdrawn. The assistant is off for you.'), onError: (e) => toast.error(e.message) })}>
          Withdraw my consent
        </Button>
        {manager && (
          <Button variant="link" size="sm" loading={toggle.isPending} onClick={() => toggle.mutate(false, { onSuccess: () => toast.success('Assistant switched off for this workspace'), onError: (e) => toast.error(e.message) })}>
            Switch off for this workspace
          </Button>
        )}
      </div>
    </div>
  );
}

/** Minimal formatting: paragraphs, "- " bullets and **bold**. Rendered as text, never as HTML. */
function Formatted({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  return (
    <div className="grid gap-2">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{lines.map((l, j) => (j ? [<br key={j} />, inline(l)] : inline(l)))}</p>;
      })}
    </div>
  );
}

function AnswerCard({ answer }: { answer: AiAnswer }) {
  return (
    <article className="neu-raised grid gap-3 rounded-2xl rounded-bl-md p-4">
      <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gold-soft px-2 py-0.5 text-xs font-medium text-gold-ink">
        <Sparkles className="size-3" aria-hidden /> AI suggestion
      </p>
      <div className="text-sm leading-relaxed">
        <Formatted text={answer.answer} />
      </div>
      {answer.unverifiedFigures.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          <span>
            Not from your records: {answer.unverifiedFigures.join(', ')}. The assistant worked these out itself, so treat them as rough. Check Reports for exact figures.
          </span>
        </p>
      )}
      <p className="text-xs text-muted">{answer.disclaimer}</p>
    </article>
  );
}
