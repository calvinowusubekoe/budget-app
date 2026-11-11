import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Backdrop, Logo, ThemeToggle } from './Brand';

/** Centered glass pane for sign-in, registration and token flows. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <Backdrop />
      <header className="mx-auto flex w-full max-w-md items-center justify-between">
        <Link to="/" aria-label="BudgetFlow home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <div className="glass rounded-[28px] p-6 sm:p-8">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
      </main>
      <p className="mx-auto max-w-md text-center text-xs text-subtle">
        BudgetFlow is a record-keeping tool. It is not a bank or wallet and never holds or moves your money.
      </p>
    </div>
  );
}
