# API conventions

The full, interactive reference is generated from `server/docs/openapi.js`. It's served at `/api/docs` (Swagger UI) and `/api/openapi.json` when `API_DOCS=true`, which is the default outside production. This page covers the rules every endpoint follows.

## Requests

- **Base path:** `/api`.
- **Authentication:** `Authorization: Bearer <access token>` (15 minutes). `POST /api/auth/refresh` exchanges the httpOnly `bf_rt` cookie for a new access token and rotates the cookie. Reusing an old refresh token revokes the session.
- **Workspace:** workspace-scoped routes take `X-Workspace-Id`, or `:workspaceId` in the path. Membership and role are checked on every request. A workspace you're not a member of returns **404**, so its id can't be probed.
- **Money:** amounts are decimal **strings** (`"1250.50"`), with at most the currency's minor units. JSON numbers are rejected. Exchange rates are strings too.
- **Dates:** calendar dates are `YYYY-MM-DD`. Timestamps are ISO 8601 UTC.
- **Idempotency:** creates that may be retried accept `Idempotency-Key`. That's 8–100 characters from A–Z, a–z, 0–9, `-` and `_`, such as a UUID. A repeated key returns the original record instead of creating another. Supported on:
  - transactions
  - invoice and bill payments
  - personal Susu contributions and withdrawals
  - group Susu contribution records
  - subscription checkout
- **Validation:** Joi on every route. Unknown body fields are dropped, so only documented fields have any effect.

## Responses

Success:

```json
{ "success": true, "data": {}, "meta": {} }
```

Error:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Some fields need attention.", "details": [{ "location": "body", "field": "amount", "message": "..." }] } }
```

| Status | Typical codes |
| --- | --- |
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED`, `TOKEN_EXPIRED` |
| 403 | `FORBIDDEN`, `PLAN_LIMIT`, `AI_CONSENT_REQUIRED` |
| 404 | `NOT_FOUND` (including other people's workspaces) |
| 409 | `CONFLICT`, `DUPLICATE`, `LINKED_TO_DOCUMENT`, `HAS_PAYMENTS`, `NOT_ON_SALE`, `PROVIDER_NOT_CONFIGURED`, `AI_NOT_CONFIGURED` |
| 413 | Body over 100 kB (JSON) or over the upload limit |
| 422 | `VALIDATION_ERROR` with `details` |
| 429 | `TOO_MANY_REQUESTS` |
| 502, 503 | `PROVIDER_UNAVAILABLE`, `AI_BUSY`, `AI_UNAVAILABLE` |

**Caching:** every `/api` response sends `Cache-Control: no-store`.

## Rate limits (per client IP unless noted)

| Scope | Limit |
| --- | --- |
| All of `/api` | 600 requests / 15 min |
| Sign-in, registration, password reset | 20 / 15 min, plus a lockout after repeated failed sign-ins |
| Payment webhooks | 300 / min |
| AI questions | 8 / min per user, plus a monthly cap from the plan |

Behind a proxy, set `TRUST_PROXY` so these limits see real client IPs.

## Endpoint groups

| Area | Endpoints |
| --- | --- |
| Auth and users | `/auth/*`, `/users/*` |
| Workspaces | `/workspaces/*` |
| Tracking | `/accounts`, `/categories`, `/exchange-rates`, `/transactions` |
| Planning | `/budgets`, `/savings-goals`, `/debts`, `/recurring`, `/notifications` |
| Susu (records only) | `/susu/plans`, `/susu/summary`, `/susu/groups/*`, `/susu/invitations/*` |
| Business | `/business/*` |
| Subscriptions | `/subscriptions/*` |
| Payment webhooks | `/payments/webhooks/paystack`, `/payments/webhooks/flutterwave` |
| Analytics | `/analytics/dashboard`, `/monthly`, `/cash-flow`, `/spending`, `/savings`, `/separated`, `/insights`, `/business` |
| AI assistant | `/ai/status`, `/ai/consent`, `/ai/workspace`, `/ai/ask` |
| Meta | `/health`, `/meta` |

No endpoint collects, holds, transfers or pays out Susu money. Tests enforce this by scanning the route tables.
