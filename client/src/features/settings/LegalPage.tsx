import { Link, useParams } from 'react-router';
import { Backdrop, Logo } from '@/components/layout/Brand';
import { Alert } from '@/components/ui/feedback';
import { useMeta } from '@/hooks/useMeta';

/**
 * DRAFT legal text. It describes how the product actually behaves today but
 * has not been reviewed by counsel. It must be replaced with approved text,
 * and the version bumped (TERMS_VERSION / PRIVACY_VERSION), before launch.
 */
export function LegalPage() {
  const { doc } = useParams();
  const { legal } = useMeta();
  const privacy = doc === 'privacy';
  return (
    <div className="min-h-dvh px-4 py-8">
      <Backdrop />
      <div className="mx-auto max-w-2xl">
        <Link to="/" aria-label="Kontaa home">
          <Logo />
        </Link>
        <article className="glass mt-6 rounded-3xl p-6 sm:p-10">
          <h1 className="text-2xl font-semibold">{privacy ? 'Privacy notice' : 'Terms of use'}</h1>
          <p className="mt-1 text-sm text-subtle">Version {privacy ? legal.privacyVersion : legal.termsVersion}</p>
          <Alert tone="gold" className="mt-5">
            Draft for review. This text has not yet been approved by legal counsel.
          </Alert>
          <div className="mt-6 grid max-w-[68ch] gap-4 text-[15px] leading-relaxed text-muted [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink">
            {privacy ? <PrivacyText /> : <TermsText />}
          </div>
        </article>
      </div>
    </div>
  );
}

function PrivacyText() {
  return (
    <>
      <h2>What Kontaa is</h2>
      <p>Kontaa is a tool for recording and organising financial information. It is not a bank, wallet or payment service, and it never holds, collects or moves your money, including Susu contributions and payouts.</p>
      <h2>What we store</h2>
      <p>Your name, email address, password (stored only as a one-way hash), preferences, the records you enter, the workspaces you belong to, and security logs such as sign-in times, IP addresses and device types.</p>
      <h2>Why</h2>
      <p>To provide the service you signed up for, to keep your account secure, and to meet legal obligations. Product update emails are sent only if you opt in.</p>
      <h2>Who can see it</h2>
      <p>Records in a personal workspace are visible only to you. Records in a business workspace are visible to the members its owner invites. Group Susu records are visible to that group’s members according to their role.</p>
      <h2>AI assistant (optional)</h2>
      <p>If you agree to use the AI assistant, each question you ask sends summary figures from the current workspace (totals, categories, budgets, goals, debts, Susu and business figures) and your question to the AI provider, Anthropic. If you scan a receipt or payment screenshot, that image and your category names are sent so it can be read. Transaction descriptions, payees, notes and attached files are never sent. Kontaa doesn’t keep your questions or the answers, keeps a scanned image only if you save it as an attachment, and you can withdraw your agreement on the assistant screen at any time.</p>
      <h2>Your rights</h2>
      <p>You can view and correct your profile, download a copy of your profile data from Settings, withdraw marketing consent at any time, and ask for your account to be deleted. These rights follow Ghana’s Data Protection Act, 2012 (Act 843).</p>
    </>
  );
}

function TermsText() {
  return (
    <>
      <h2>The service</h2>
      <p>Kontaa helps you keep records of income, expenses, budgets, savings, debts and Susu activity. Figures are only as accurate as what you and your workspace members enter.</p>
      <h2>Not financial, accounting or tax advice</h2>
      <p>Reports and AI suggestions are for your information. Kontaa is not a certified accounting or tax filing platform.</p>
      <h2>Susu</h2>
      <p>Susu features are record-keeping only. Contributions and payouts happen outside Kontaa between the people involved. A record marked as confirmed is an acknowledgement by a member, not proof that money changed hands.</p>
      <h2>Subscriptions</h2>
      <p>Paid plans are billed through an approved payment provider. Kontaa does not see or store your full card details.</p>
    </>
  );
}
