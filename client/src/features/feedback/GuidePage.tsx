import { Link } from 'react-router';
import { MessageSquarePlus } from 'lucide-react';
import { Backdrop, Logo, ThemeToggle } from '@/components/layout/Brand';
import { Button } from '@/components/ui/button';
import { useMeta } from '@/hooks/useMeta';
import { useAuth } from '@/stores/auth';
import { TestBanner } from './TestBanner';

const AREAS: { title: string; tries: string[] }[] = [
  {
    title: 'Everyday money',
    tries: [
      'Record income and expenses in different accounts (MoMo, bank, cash). Do the balances look right?',
      'Move money between your own accounts. It shouldn’t count as income or spending.',
      'Add an expense in US dollars. Is the cedi amount and the rate shown clearly?',
      'Scan a receipt or a MoMo message screenshot (Expenses → Scan a receipt) and check what it fills in.',
    ],
  },
  {
    title: 'Planning',
    tries: ['Set a monthly budget and spend into it. Do the warnings come at the right time?', 'Create a savings goal and a debt, add payments, and check the progress and pace estimates.', 'Set up a repeating expense, like a data bundle.'],
  },
  {
    title: 'Susu',
    tries: [
      'Open the personal Susu plan and record or miss a few days. Is “missed” and “behind schedule” what you’d expect?',
      'Open the Susu group: record contributions, a payout, and attach a proof screenshot. Does the flow match how real groups run?',
    ],
  },
  {
    title: 'Business (switch to “Efua’s Catering” in the workspace menu)',
    tries: ['Create and issue an invoice, record part payment, and look at what is still owed.', 'Check Business reports: profit and loss, cash flow, and receivables by age. Would an accountant trust these?'],
  },
  {
    title: 'Reports and the assistant',
    tries: ['Open Reports and try month, quarter and year views. Are the separations (transfers, savings, Susu) sensible?', 'Ask the AI Assistant about your spending. Are its answers accurate and appropriately careful?'],
  },
];

const QUESTIONS = [
  'Are any calculations, totals or percentages wrong, or rounded in a way you wouldn’t accept?',
  'Is any wording unclear or not how people in Ghana talk about money?',
  'Which features would you actually use, and what’s missing?',
  'Would you trust it with your real records? If not, why not?',
];

/** For people trying the test build. Readable without signing in. */
export function GuidePage() {
  const { demo, stage } = useMeta();
  const signedIn = useAuth((s) => s.status === 'authenticated');
  return (
    <div className="min-h-dvh px-4 py-6">
      <Backdrop />
      <div className="mx-auto grid max-w-3xl gap-6">
        <header className="flex items-center justify-between">
          <Link to="/" aria-label="Kontaa home">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>
        <TestBanner />
        <section className="glass grid gap-4 rounded-[28px] p-6 sm:p-8">
          <h1 className="text-[28px] leading-tight font-semibold">Thanks for testing Kontaa</h1>
          <p className="text-muted">
            Kontaa keeps track of your money in one place: everyday income and spending across MoMo, bank and cash, budgets and savings, personal and group Susu records, and a small business’s invoices and bills. It only keeps records. It never holds or moves money.
          </p>
          <p className="text-muted">Plan on 20 to 30 minutes. There are no wrong answers: anything that confuses you is useful to hear.</p>
          <div className="grid gap-2 rounded-2xl bg-primary-soft p-4 text-sm">
            <p className="font-medium">How to get in</p>
            {demo ? (
              <p>
                Use the demo account: <strong>{demo.email}</strong> with password <strong>{demo.password}</strong>. It already has sample data for a fictional person called Efua. Others may use it too, so you may see their changes. You can also create your own account.
              </p>
            ) : (
              <p>Create an account with any email address and a password you don’t use elsewhere.</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm">
                <Link to={signedIn ? '/' : '/login'}>{signedIn ? 'Open Kontaa' : 'Sign in'}</Link>
              </Button>
              {!signedIn && (
                <Button asChild size="sm" variant="neu">
                  <Link to="/register">Create an account</Link>
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="glass grid gap-4 rounded-[28px] p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Things to try</h2>
          {AREAS.map((a) => (
            <div key={a.title}>
              <h3 className="font-medium">{a.title}</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                {a.tries.map((t) => (
                  <li key={t} className="py-0.5">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="glass grid gap-3 rounded-[28px] p-6 sm:p-8">
          <h2 className="text-xl font-semibold">What would help most</h2>
          <ul className="list-disc pl-5 text-sm text-muted">
            {QUESTIONS.map((q) => (
              <li key={q} className="py-0.5">
                {q}
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-2 text-sm">
            <MessageSquarePlus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              Use the <strong className="font-medium">feedback button</strong> (speech bubble at the top of every screen) as you go. It sends your note with the page you were on, so you don’t need to describe where you were.
            </span>
          </p>
        </section>

        <section className="glass grid gap-2 rounded-[28px] p-6 text-sm text-muted sm:p-8">
          <h2 className="text-xl font-semibold text-ink">Good to know</h2>
          <ul className="list-disc pl-5">
            {stage === 'test' && <li>This is a test version. Use made-up details, not your real finances or real account numbers.</li>}
            <li>Paid plans can’t be bought here: payments are switched off. The Free plan’s limits still apply, so you may see them.</li>
            <li>Emails (such as password reset) may not arrive in this test version. If you’re locked out, tell whoever invited you.</li>
            <li>The AI assistant and receipt scanning are on, with a small monthly allowance. They send summary figures or the image you choose to the AI provider; the screens explain exactly what.</li>
            <li>The server can take up to a minute to wake up if nobody has used it for a while.</li>
            <li>Data in this test version may be reset at any time.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
