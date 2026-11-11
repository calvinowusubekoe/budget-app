import { Router } from 'express';
import { ok } from '../utils/http.js';
import { databaseState } from '../config/db.js';
import { CURRENCY_CODES, FEATURED_CURRENCIES } from '../utils/currencies.js';
import { env } from '../config/env.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { workspacesRouter } from '../modules/workspaces/workspaces.routes.js';
import { accountsRouter } from '../modules/accounts/accounts.routes.js';
import { categoriesRouter } from '../modules/categories/categories.routes.js';
import { ratesRouter } from '../modules/exchange-rates/rates.routes.js';
import { transactionsRouter } from '../modules/transactions/transactions.routes.js';
import { analyticsRouter } from '../modules/analytics/analytics.routes.js';
import { budgetsRouter } from '../modules/budgets/budgets.routes.js';
import { savingsRouter } from '../modules/savings/savings.routes.js';
import { debtsRouter } from '../modules/debts/debts.routes.js';
import { recurringRouter } from '../modules/recurring/recurring.routes.js';
import { notificationsRouter } from '../modules/notifications/notifications.routes.js';
import { susuRouter } from '../modules/susu/susu.routes.js';
import { groupsRouter, susuInvitationsRouter } from '../modules/susu/groups.routes.js';
import { businessRouter } from '../modules/business/business.routes.js';
import { subscriptionsRouter } from '../modules/subscriptions/subscriptions.routes.js';
import { aiRouter } from '../modules/ai/ai.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => ok(res, { status: 'ok', database: databaseState() }));
apiRouter.get('/meta', (_req, res) =>
  ok(res, {
    currencies: { featured: FEATURED_CURRENCIES, all: CURRENCY_CODES },
    legal: env.legal,
  }),
);

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/workspaces', workspacesRouter);
// Workspace-scoped: these read the workspace from the X-Workspace-Id header.
apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/exchange-rates', ratesRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/budgets', budgetsRouter);
apiRouter.use('/savings-goals', savingsRouter);
apiRouter.use('/debts', debtsRouter);
apiRouter.use('/recurring', recurringRouter);
apiRouter.use('/notifications', notificationsRouter);
// Susu is record-keeping only; no payment routes exist under it.
// Groups span several people's accounts, so they're governed by group membership, not a workspace.
apiRouter.use('/susu/groups', groupsRouter);
apiRouter.use('/susu/invitations', susuInvitationsRouter);
apiRouter.use('/susu', susuRouter);
// Business workspaces only: customers, suppliers, invoices, bills and reports.
apiRouter.use('/business', businessRouter);
// Kontaa's own plans: the only place money is taken (webhooks are mounted in config/express.js).
apiRouter.use('/subscriptions', subscriptionsRouter);
// Optional, read-only AI assistant over deterministic figures.
apiRouter.use('/ai', aiRouter);
