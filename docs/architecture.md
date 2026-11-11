# Architecture

> **Name:** the product is **Kontaa**. It was called BudgetFlow during development. Some internal identifiers keep the old prefix on purpose, because renaming them would sign people out or orphan data on their devices:
> - the refresh cookie `bf_rt`
> - the `bf-` browser storage keys (theme, offline outbox, sync tag) and the `budgetflow-refresh` lock
> - the JWT issuer and audience
> - the `bf-` payment reference prefix
> - the existing local database name `budgetflow`
>
> None of these is shown to users. New installs default to a `kontaa` database.

Kontaa is a modular monolith: one Express API and one React SPA, in an npm workspace.

```
client/src/
  app/            router, query client, route guards
  components/ui/  design-system primitives (shadcn conventions)
  components/layout/  app shell, auth layout, navigation
  features/<area>/    pages + hooks per feature (auth, onboarding, dashboard, workspaces, settings, ...)
  services/api.ts     fetch wrapper: auth header, refresh, workspace header, error mapping
  stores/             Zustand (session state only)
  offline/            IndexedDB outbox, sync engine and its UI (per-user, deleted on sign-out)
server/
  server.js           process entry: connect DB, listen, graceful shutdown
  config/             env (Joi-validated), production checks, db (+ runAtomic), express app factory
  jobs/scheduler.js   every 15 min: recurring transactions, subscription expiry, payment reconciliation
  middleware/         auth, workspace access, validation, sanitising, rate limits, errors
  modules/<area>/     model, service, (controller,) routes per domain: auth, users, workspaces, accounts,
                      categories, exchange-rates, transactions, budgets, savings, debts, recurring,
                      notifications, susu (personal + groups), business, subscriptions, payments,
                      analytics, ai, audit
  docs/openapi.js     OpenAPI 3.1 spec served at /api/docs
  tests/              Supertest integration tests against a real MongoDB test database
```

Each server module separates routes (HTTP wiring), controllers (request to response), services (business rules) and models. Controllers read only `req.valid`, the Joi-whitelisted input.

## Authentication and sessions

- Passwords are hashed with bcrypt (12 rounds in production). Login failures are rate limited per IP and lock the account for 15 minutes after 5 failures. Wrong-password and unknown-email responses are identical and take the same time to return.
- **Access token**: a 15-minute JWT (HS256, issuer and audience pinned), kept **in memory only** on the client.
- **Refresh token**: `<sessionId>.<secret>` in an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`. Only `sha256(secret)` is stored. Each refresh rotates the secret. Replaying a previous secret is treated as theft and revokes the session.
- Every authenticated request re-checks that the session is live. Logout, "sign out everywhere", password changes and resets therefore take effect immediately, not when the JWT expires.
- The client serialises refreshes across tabs with the Web Locks API, so two tabs can't race each other into a reuse revocation.
- Email verification and password-reset tokens are single-use, hashed, and expire after 24 hours and 1 hour respectively. Issuing a new one invalidates the old one.

## Workspaces and access control

- A user registers into a private **Personal** workspace and can create more, of type `personal` or `business`. Only business workspaces accept invitations.
- Roles: `owner`, `admin`, `member`, `viewer`. The permission map lives in [`server/modules/workspaces/permissions.js`](../server/modules/workspaces/permissions.js). Only owners can grant admin, and the owner can't be demoted or removed.
- `requireWorkspace(permission)` resolves the workspace from `:workspaceId` or the `X-Workspace-Id` header, checks for an active membership, then checks the permission. Non-members get **404**, so workspace IDs can't be probed. From Phase 2 on, every workspace-scoped query must filter on `req.workspace._id`.
- An invitation can only be accepted by the account whose email it was sent to.

## Susu groups live outside workspaces

A workspace is one person's or one business's books. A Group Susu spans several people, each with their own account, so groups are top-level records with their own membership (`SusuGroupMember`) and roles: organiser, assistant organiser and member. `loadGroup()` confirms the caller is an active or suspended member, and non-members get 404. `groupCan()` resolves capabilities; an assistant's capabilities are configured per group. Group records never touch any workspace's accounts or reports. See [susu-business-rules.md](susu-business-rules.md).

## Audit trail

`AuditLog` is append-only: update operations are blocked at the model level and no delete API exists. It records workspace, member and invitation changes (with before and after values where relevant), plus security events: registration, login, lockout, password change and reset.

## Atomic writes

`runAtomic(fn)` runs multi-document writes in a MongoDB transaction when the deployment supports it (a replica set or Atlas). On a standalone development `mongod` it runs without one. Production should run on a replica set.

## Privacy

- Consent to the terms and privacy notice is required at registration and stored with the document versions (`TERMS_VERSION`, `PRIVACY_VERSION`). Marketing consent is optional, and every change is appended to the history.
- Users can download their profile data (`GET /api/users/me/export`).
- API responses are sent with `Cache-Control: no-store`. On sign-out the client clears every cached query, and no financial data is written to `localStorage`.
- The legal pages are **drafts** that need review by counsel before launch.

## Design system

There are two materials, each with one job:

- **Glass** (`glass`, `glass-strong`) for structure: the sidebar, top bar, cards, dialogs and menus. These are frosted panes over a haze background lit by two blurred orbs, one lagoon and one gold.
- **Neumorphism** (`neu-raised`, `neu-inset`, `neu-pressed`, `neu-well`) for what you touch: secondary buttons, fields, toggles, selected nav items, and the inset balance well on the dashboard.

Primary actions are solid lagoon, so their contrast never depends on a shadow. The colour tokens are defined once in `client/src/index.css`, with light and dark sets (dark follows the device unless overridden). The typeface is Onest, self-hosted so it works offline, with tabular figures for money.

## PWA and offline

The client is an installable PWA. The service worker precaches the app shell only and never caches API responses. Offline, new transactions and Susu records go to a per-user IndexedDB outbox and are sent later with their original Idempotency-Key, which the server uses to store each once. See [offline.md](offline.md).

## Code splitting

Signed-in pages load on demand (`React.lazy` in `app/router.tsx`, with a Suspense boundary in `AppShell`). Reports, with its charts, is its own chunk.

`client/vite.config.ts` upper-cases the Windows drive letter in the `@` alias. Without that, Rolldown could see one file under two ids (`c:` and `C:`) and bundle React and the router twice, which breaks hooks and context in production builds only. Custom vendor chunk groups were tried and dropped for the same reason.

## Further reading

- [Database schema](database-schema.md)
- [API conventions](api-documentation.md)
- [Payment architecture](payment-architecture.md)
- [Security review](security.md)
- [Deployment and operations](deployment.md)
