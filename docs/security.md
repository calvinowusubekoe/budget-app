# Security review and compliance readiness

Reviewed 2026-11-11, at the end of Phase 9. Each control below is backed by code and, where noted, by an automated test.

## Controls

| Area | What's in place | Where |
| --- | --- | --- |
| Passwords | bcrypt (12 rounds); at least 10 characters with a letter and a number; changing the password signs out other devices | `modules/auth` |
| Sessions | 15-minute access token held in memory only; rotating refresh token in an httpOnly, `SameSite=Strict`, `Secure` cookie scoped to `/api/auth`, stored hashed; replaying an old refresh token revokes the session; the session is re-checked in the database on each request | `modules/auth`, `middleware/auth.js` |
| Brute force | Per-IP rate limits (all of `/api` and auth routes); account lockout after repeated failed sign-ins; AI burst limit per user | `middleware/rateLimiters.js` |
| Validation | Joi on every route, unknown fields dropped; money must be decimal strings; `$` and `.` keys stripped from input (blocks operator injection) | `middleware/validate.js`, `middleware/sanitize.js`; tested in `tests/security.test.js` |
| Access control | Workspace roles (owner, admin, member, viewer) checked on the server; non-members get 404; Susu groups have their own roles | `middleware/workspace.js`, `modules/susu/groupAccess.js`; isolation sweep in `tests/security.test.js` |
| HTTP | Helmet (CSP, HSTS, nosniff, frame protection); `x-powered-by` off; CORS limited to `CLIENT_URL` and `CORS_ORIGINS`; 100 kB JSON limit; `Cache-Control: no-store` on all API responses | `config/express.js`; tested |
| Uploads | Type checked from file content, not the stated type (JPG, PNG, WebP, PDF); size limit; random stored names; served only to authorised users | `services/fileStorage.js` |
| Payments | Signed webhooks (HMAC-SHA512 for Paystack; secret hash for Flutterwave), each re-verified with the provider API; duplicate events dropped; exact amount and currency checked before activation; no card data stored; secrets on the server only | `modules/payments`; `tests/subscriptions.test.js` |
| Audit | Append-only audit log (updates throw); immutable Susu activity log | `modules/audit`, `modules/susu` |
| Configuration | Joi-validated environment; production refuses to start with unsafe settings (http URLs, insecure cookies, default secrets, missing SMTP or webhook secret) | `config/env.js`, `config/production.js`; tested |
| Shared devices | No tokens or financial data in localStorage; the service worker never caches API responses; offline queue is separate per user and deleted on sign-out | `client/src/offline`, `client/vite.config.ts`; see [offline.md](offline.md) |
| AI | Off unless configured; per-user consent; can be switched off per workspace; summary figures only (no payees, descriptions, notes or files); no tools, no writes; text not stored | `modules/ai`; see [analytics-ai.md](analytics-ai.md) |
| Money | Decimal arithmetic only; Decimal128 storage; rate snapshots never recalculated | `utils/money.js`; see [money.md](money.md) |

## Product rules enforced by tests

- No route collects, holds, transfers or pays out Susu money.
- Susu code never imports payment providers.
- Payment code never touches Susu, wallets or payouts.
- No route lets a user set their own plan.
- The AI router has no record-writing routes.

## Dependency audit

`npm audit` (2026-11-11) reports 6 issues (2 low, 4 moderate). All are in **build-time tooling only**: `workbox-build` and its `glob`, `minimatch` and `deepmerge` dependencies, used while building the service worker. None ships to browsers or runs on the API server.

The suggested fix (`npm audit fix --force`) downgrades `workbox-build` with breaking changes, so it wasn't applied. Re-check when `vite-plugin-pwa` updates. The server's runtime dependencies have no reported issues.

## Known limits and follow-ups

- **Account deletion is by request.** The privacy page says so; there's no self-service button yet. Deleting an account needs decisions about shared business workspaces (transfer ownership) and Group Susu records, which other members rely on.
- **The data export covers profile data.** Transactions export as CSV from Transactions, and business reports export as CSV and PDF. There's no single "everything I have" archive yet.
- **Uploads sit on local disk** (`UPLOAD_DIR`). For several servers, or for managed backups, move them to object storage. The storage module is the single place to change.
- **Rate limits are kept in memory**, so each instance counts separately. With several instances behind a load balancer, add a shared store such as Redis, or rate-limit at the proxy.
- **CSP for the client** is set at the reverse proxy (see [deployment.md](deployment.md)). Its `script-src` allows the two small inline scripts in `index.html`.
- **No independent penetration test has been done.** Have one done before a public launch.

## Ghana data protection

Kontaa processes personal and financial data of people in Ghana. That falls under the **Data Protection Act, 2012 (Act 843)**, overseen by the **Data Protection Commission (DPC)**. This is a readiness summary, not legal advice. Confirm the obligations with a Ghanaian data-protection adviser.

**What the product already supports:**
- **Consent and notice:** terms and privacy acceptance recorded at sign-up, with the version and time. A separate, withdrawable consent for the AI assistant.
- **Purpose limitation and minimisation:** data is used to provide the service. The AI assistant gets summary figures only. Payment providers get only what checkout needs (email and amount).
- **Data-subject rights:**
  - view and correct the profile
  - export profile data, plus CSV exports of records
  - withdraw marketing consent and AI consent
  - ask for deletion (handled manually for now; see above)
- **Security safeguards:** the controls above, the audit trail, and backups (see [deployment.md](deployment.md)).
- **Retention:** notifications expire after 180 days and AI usage rows after 400 days. Financial records and audit logs are kept while the account exists.

**For the operator to complete before launch:**
- Register as a data controller with the DPC.
- Name a data protection supervisor or contact, and publish how to reach them in the privacy notice.
- Record and disclose processors and **cross-border transfers**:
  - hosting and database provider
  - email (SMTP) provider
  - payment providers (Paystack, Flutterwave)
  - the AI provider (Anthropic, outside Ghana) when the assistant is on
- Agree data-processing terms with each processor.
- Write a breach-response procedure: who assesses, how affected people and the DPC are told, and within what time.
- Set the retention period for closed accounts, and implement or document how deletion requests are handled within the required time.

## What Kontaa is not

- **Not a bank, wallet, payment processor or deposit-taking service.** It holds no Bank of Ghana licence and must not be marketed as one.
- **Not certified accounting or tax software.** Reports say so.
- **Subscription payments only.** They are processed by an approved provider, and Kontaa never collects or moves anyone else's money, including Susu money.
