import { lazy } from 'react';
import { createBrowserRouter, Link } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '@/features/auth/TokenPages';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { LegalPage } from '@/features/settings/LegalPage';
import { AcceptInvitationPage } from '@/features/workspaces/AcceptInvitationPage';
import { AcceptGroupInvitationPage } from '@/features/susu/AcceptGroupInvitationPage';
import { BusinessOnly } from '@/features/business/BusinessOnly';
import { GuestOnly, RequireAuth } from './guards';

/**
 * Pages inside the app load on demand, so the first screen downloads less.
 * AppShell wraps its outlet in Suspense. The service worker precaches every
 * chunk, so these still open offline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyPage<M extends Record<K, React.ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const DashboardPage = lazyPage(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const WorkspaceSettingsPage = lazyPage(() => import('@/features/workspaces/WorkspaceSettingsPage'), 'WorkspaceSettingsPage');
const AccountsPage = lazyPage(() => import('@/features/accounts/AccountsPage'), 'AccountsPage');
const TransactionsPage = lazyPage(() => import('@/features/transactions/TransactionsPage'), 'TransactionsPage');
const CategoriesPage = lazyPage(() => import('@/features/settings/CategoriesPage'), 'CategoriesPage');
const ExchangeRatesPage = lazyPage(() => import('@/features/settings/ExchangeRatesPage'), 'ExchangeRatesPage');
const BillingPage = lazyPage(() => import('@/features/billing/BillingPage'), 'BillingPage');
const BudgetsPage = lazyPage(() => import('@/features/budgets/BudgetsPage'), 'BudgetsPage');
const SavingsPage = lazyPage(() => import('@/features/savings/SavingsPage'), 'SavingsPage');
const DebtsPage = lazyPage(() => import('@/features/debts/DebtsPage'), 'DebtsPage');
const RecurringPage = lazyPage(() => import('@/features/recurring/RecurringPage'), 'RecurringPage');
const SusuPage = lazyPage(() => import('@/features/susu/SusuPage'), 'SusuPage');
const PlanPage = lazyPage(() => import('@/features/susu/PlanPage'), 'PlanPage');
const GroupPage = lazyPage(() => import('@/features/susu/GroupPage'), 'GroupPage');
const BusinessOverviewPage = lazyPage(() => import('@/features/business/BusinessPages'), 'BusinessOverviewPage');
const BusinessReportsPage = lazyPage(() => import('@/features/business/BusinessPages'), 'BusinessReportsPage');
const DocumentsPage = lazyPage(() => import('@/features/business/DocumentsPage'), 'DocumentsPage');
const DocumentPage = lazyPage(() => import('@/features/business/DocumentPage'), 'DocumentPage');
const ContactsPage = lazyPage(() => import('@/features/business/ContactsPage'), 'ContactsPage');
const ReportsPage = lazyPage(() => import('@/features/reports/ReportsPage'), 'ReportsPage');
const AssistantPage = lazyPage(() => import('@/features/assistant/AssistantPage'), 'AssistantPage');

function NotFound() {
  return (
    <AuthLayout title="Page not found" subtitle="The link may be old, or the page may have moved.">
      <Button asChild size="lg" className="w-full">
        <Link to="/">Go to dashboard</Link>
      </Button>
    </AuthLayout>
  );
}

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Token links work whether or not someone is signed in.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/legal/:doc', element: <LegalPage /> },
  {
    element: <RequireAuth allowOnboarding />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/invitations/accept', element: <AcceptInvitationPage /> },
      { path: '/susu/invitations/accept', element: <AcceptGroupInvitationPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, path: '/', element: <DashboardPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/settings/workspace', element: <WorkspaceSettingsPage /> },
          { path: '/settings/categories', element: <CategoriesPage /> },
          { path: '/settings/exchange-rates', element: <ExchangeRatesPage /> },
          { path: '/settings/billing', element: <BillingPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/assistant', element: <AssistantPage /> },
          { path: '/accounts', element: <AccountsPage /> },
          { path: '/transactions', element: <TransactionsPage /> },
          { path: '/transactions/recurring', element: <RecurringPage /> },
          { path: '/budgets', element: <BudgetsPage /> },
          { path: '/savings', element: <SavingsPage /> },
          { path: '/debts', element: <DebtsPage /> },
          { path: '/susu', element: <SusuPage /> },
          { path: '/susu/plans/:planId', element: <PlanPage /> },
          { path: '/susu/groups/:groupId', element: <GroupPage /> },
          {
            element: <BusinessOnly />,
            children: [
              { path: '/business', element: <BusinessOverviewPage /> },
              { path: '/business/invoices', element: <DocumentsPage key="invoice" kind="invoice" /> },
              { path: '/business/invoices/:docId', element: <DocumentPage key="invoice" kind="invoice" /> },
              { path: '/business/bills', element: <DocumentsPage key="bill" kind="bill" /> },
              { path: '/business/bills/:docId', element: <DocumentPage key="bill" kind="bill" /> },
              { path: '/business/contacts', element: <ContactsPage /> },
              { path: '/business/reports', element: <BusinessReportsPage /> },
            ],
          },
          { path: '/income', element: <TransactionsPage key="income" fixedType="income" /> },
          { path: '/expenses', element: <TransactionsPage key="expense" fixedType="expense" /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
