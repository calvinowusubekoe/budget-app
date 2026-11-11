# BudgetFlow

A multi-currency financial tracking PWA for personal and business use, with Personal Susu and Group Susu record-keeping.

**BudgetFlow manages financial information. It does not hold or move users' money.** Susu contributions and payouts always happen outside the app; BudgetFlow only records them. The only payment integration is for BudgetFlow's own subscriptions. See [docs/susu-business-rules.md](docs/susu-business-rules.md).

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Foundation: auth, users, workspaces, roles, navigation, design system, dashboard shell | **Done** |
| 2 | Income, expenses, transactions, transfers, categories, accounts, multi-currency, receipts, CSV export | **Done** |
| 3 | Budgets with alerts and history, savings goals, debts, recurring transactions, notifications | **Done** |
| 4 | Personal Susu: plans, contributions, withdrawals, missed periods, monthly summaries, proof files | **Done** |
| 5 | Group Susu: members and roles, invitations, rotation cycles, contribution and payout records with confirm/dispute, reports, activity history | **Done** |
| 6 | Business finance: customers, suppliers, invoices, bills, payments into accounts, P&L, cash flow, aging, CSV/PDF | **Done** |
| 7 | Subscriptions: Free/Personal Pro/Business Pro, server-enforced limits, Paystack/Flutterwave hosted checkout, verified webhooks, renewals, grace, refunds, reconciliation | **Done** (tested against mocked providers) |
| 8 | Reports and charts (monthly/quarterly/yearly, cash flow, spending, savings and Susu, kept-separate view), rule-based insights, optional read-only AI assistant | **Done** (AI checked live) |
| 9 | Installable PWA, offline drafts with a sync queue, security review and production checks, code splitting, deployment, backup and recovery docs | **Done** |

All nine phases are built. Payment providers have been tested against mocked APIs only; see [docs/payment-architecture.md](docs/payment-architecture.md).

## Stack

- **client/**: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui conventions (Radix primitives), TanStack Query, Zustand, React Hook Form + Zod, React Router, Recharts, vite-plugin-pwa (Workbox), IndexedDB (idb).
- **server/**: Node.js (ES modules), Express 5, MongoDB/Mongoose, Joi validation, JWT access tokens + rotating refresh tokens, Swagger UI. Entry point: `server/server.js`.
- Tests: Vitest, Supertest, React Testing Library.

## Getting started

Requirements: Node 20+ and MongoDB 7+ (a local `mongod`, or an Atlas URI).

```bash
npm install                 # installs both workspaces
cp .env.example .env        # defaults work for local development
npm run dev:server          # API on http://localhost:4000, docs at /api/docs
npm run dev:client          # app on http://localhost:5173 (proxies /api to :4000)
```

If port 5173 is taken, run `npm run dev --workspace client -- --port 5174` and set `CLIENT_URL` in `.env` to match, so links in emails point to the right place.

Without SMTP settings, emails (verification, password reset, invitations) are printed to the server console with their links.

## Tests

```bash
npm test                    # server then client
npm test --workspace server # needs MongoDB; uses MONGODB_URI_TEST and wipes it between tests
npm test --workspace client
npm run typecheck
```

## Production

```bash
npm ci && npm test && npm run build   # client/dist includes the service worker
NODE_ENV=production npm start           # refuses to start with unsafe settings
```

See [docs/deployment.md](docs/deployment.md) for configuration, the reverse proxy, backups and recovery, and the go-live checklist.

## Documentation

- [Architecture](docs/architecture.md): structure, auth and session design, workspace isolation, design system
- [Money and currencies](docs/money.md): decimals, rate snapshots, balances, locks
- [Planning](docs/planning.md): budgets, savings goals, debts, recurring schedules
- [Business](docs/business.md): invoices, bills, payments and cash-basis reports
- [Payment architecture](docs/payment-architecture.md): subscription plans, limits, the verified payment flow and provider setup
- [Analytics and AI](docs/analytics-ai.md): report definitions, insight rules and the assistant's data rules
- [Susu business rules](docs/susu-business-rules.md): permanent product constraints
- [PWA and offline](docs/offline.md): app-shell caching, offline drafts, sync statuses, shared devices
- [Database schema](docs/database-schema.md): collections, fields and indexes
- [API conventions](docs/api-documentation.md): auth, money, idempotency, errors, rate limits; full reference at `/api/docs`
- [Security review](docs/security.md): controls, dependency audit, known limits, Ghana data protection readiness
- [Deployment and operations](docs/deployment.md): configuration, proxy, backups and recovery, releases
