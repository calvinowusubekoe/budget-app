# Deployment and operations

Kontaa is two parts:
- **The API:** Node 20+ running `server/server.js`.
- **The client:** static files built into `client/dist`.

Serve both from **one HTTPS origin**, with the API under `/api`. The refresh cookie is `SameSite=Strict` and scoped to `/api/auth`, so a separate API domain would break sign-in.

For a free **test build** for testers (Netlify for the app, Render for the API, MongoDB Atlas for the database), follow [hosting-test-build.md](hosting-test-build.md) instead. This guide is for a live launch.

## 1. Requirements

- **Node.js 20 or later.**
- **MongoDB 7 or later as a replica set.** MongoDB Atlas qualifies, and so does a self-hosted 3-node set. A standalone server works, but multi-document writes then run without transactions.
- **SMTP** for verification, password reset and invitation emails. Production refuses to start without it.
- **Persistent storage** for uploaded receipts and proofs (`UPLOAD_DIR`).
- **A reverse proxy** that terminates TLS, such as nginx, Caddy or a cloud load balancer.

## 2. Configure

Copy `.env.example` to `.env`, or set the same variables in your platform's secret store. Never commit secrets. In production the server **refuses to start** if any of these is wrong (see `server/config/production.js`):

| Must be | Why |
| --- | --- |
| `NODE_ENV=production` | Turns on the checks below |
| `MONGODB_URI` set explicitly | The default is a local development database |
| `JWT_ACCESS_SECRET`: 32+ random characters | Signs access tokens. Create one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CLIENT_URL=https://…` | Links in emails; the CORS origin |
| `COOKIE_SECURE=true` | Session cookie only travels over HTTPS |
| `SMTP_HOST`, plus `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email is required |
| `FLUTTERWAVE_WEBHOOK_HASH`, if `FLUTTERWAVE_SECRET_KEY` is set | Webhooks can't be verified without it |
| `ANTHROPIC_API_KEY`, if `AI_PROVIDER=anthropic` | The assistant is on but would fail |
| Every `CORS_ORIGINS` entry uses https | — |

It warns (but starts) when:
- `TRUST_PROXY` is off. Set it to the number of proxies in front, usually `1`, so rate limits and audit logs see real client IPs.
- A payment key is a test key.
- `UPLOAD_DIR` is the default local folder.

Also set:
- `PLAN_PRICES` with your real prices.
- `PAYSTACK_SECRET_KEY` and/or the Flutterwave keys, once your merchant account is approved.
- `API_DOCS`, which is off by default in production.

## 3. Build and run

```bash
npm ci                         # both workspaces
npm test                       # needs a test MongoDB (MONGODB_URI_TEST)
npm run build                  # type-checks and builds client/dist (with the service worker)
NODE_ENV=production npm start  # runs server/server.js
```

Run the API under a process manager (systemd, PM2, or a container with a restart policy). It shuts down cleanly on `SIGTERM`. Health check: `GET /api/health`, which returns the database state.

**Scheduler.** The API process runs a scheduler every 15 minutes for:
- recurring transactions
- subscription expiry and reminders
- payment reconciliation

Running several instances is safe: every job is idempotent. You can set `DISABLE_SCHEDULER=true` on all but one instance to save work.

## 4. Reverse proxy

Example nginx server block:

```nginx
server {
  listen 443 ssl http2;
  server_name app.kontaa.example;
  # ssl_certificate / ssl_certificate_key …

  root /srv/kontaa/client/dist;
  client_max_body_size 6m;                       # MAX_UPLOAD_MB + headroom
  gzip on; gzip_types text/css application/javascript application/json image/svg+xml;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # The service worker and the HTML must always be revalidated, or updates won't reach people.
  location = /sw.js { add_header Cache-Control "no-cache"; try_files $uri =404; }
  location = /index.html { add_header Cache-Control "no-cache"; }
  location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }
  # Hashed build assets never change.
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location / { try_files $uri /index.html; }
}
```

**About the CSP:**
- `script-src 'unsafe-inline'` covers the two small inline scripts in `index.html` (theme before first paint, and update recovery). To drop it, move them to files or use hashes.
- Payment checkout happens on Paystack's or Flutterwave's own domain by full-page redirect, so it needs no CSP entry.

## 5. Payment providers and webhooks

See [payment-architecture.md](payment-architecture.md). In each provider dashboard:
- Set the webhook URL to `https://<host>/api/payments/webhooks/paystack` (or `/flutterwave`).
- For Flutterwave, also set the secret hash.

Test with test keys before going live. A test key logs a warning at startup.

## 6. Backups and recovery

**What to back up:**

| Data | Where | How |
| --- | --- | --- |
| Database | MongoDB | Atlas continuous backup (point-in-time), or `mongodump` |
| Uploaded receipts and proofs | `UPLOAD_DIR` | File or volume snapshots |
| Configuration and secrets | Secret store | Your platform's secret backup; keep an offline copy of `JWT_ACCESS_SECRET` |

**Self-hosted MongoDB:** a nightly dump, kept for 30 days, with weekly copies stored off-site:

```bash
mongodump --uri="$MONGODB_URI" --gzip --archive="/backups/kontaa-$(date +%F).archive.gz"
find /backups -name 'kontaa-*.archive.gz' -mtime +30 -delete
```

**Restore** (rehearse this quarterly on a staging copy):

1. Stop the API, or put it in maintenance at the proxy.
2. Restore the database. `--drop` replaces the existing collections:
   ```bash
   mongorestore --uri="$MONGODB_URI" --gzip --archive=/backups/kontaa-YYYY-MM-DD.archive.gz --drop
   ```
3. Restore `UPLOAD_DIR` from the snapshot taken at the same time.
4. Start the API. Indexes are created on start, and the scheduler catches up on recurring items and payment reconciliation by itself. Recurring occurrences have fixed idempotency keys, so nothing is created twice.
5. Check `GET /api/health`, sign in, and open a few records and an attachment.

**Notes:**
- Restoring to an earlier point loses records made after it. Records still waiting in someone's browser outbox sync again afterwards.
- People signed in before the restore may need to sign in again, because restored refresh sessions may be older.
- If `JWT_ACCESS_SECRET` is lost or rotated, active access tokens stop working within 15 minutes. Sessions refresh normally, since refresh tokens are stored hashed in the database.
- **Data retention:**
  - Audit logs and Susu activity logs are append-only and kept.
  - Notifications expire after 180 days.
  - AI usage rows (no text) expire after 400 days.

## 7. Releasing an update

1. Run `npm ci && npm test && npm run build`.
2. Deploy the API first: database changes are additive.
3. Then deploy `client/dist`.
4. Open browsers get "A new version of Kontaa is ready" and reload when the person chooses. If a release is broken, the recovery script in `index.html` moves people onto the next fixed release as soon as it's deployed.
5. Roll back by redeploying the previous `dist` and API build.

## 8. Go-live checklist

- [ ] HTTPS, with HSTS enabled at the proxy
- [ ] `NODE_ENV=production`; the server starts without config errors
- [ ] SMTP delivers verification and reset emails
- [ ] `TRUST_PROXY` set; rate limits see real IPs
- [ ] `UPLOAD_DIR` on persistent storage and backed up
- [ ] Database backups running; one restore rehearsed
- [ ] Payment provider in live mode, webhook URL and secret set, one real low-value payment checked end to end, refund process agreed
- [ ] Real `PLAN_PRICES` set
- [ ] AI assistant: provider data terms reviewed, privacy notice current (`PRIVACY_VERSION` bumped when it changes)
- [ ] Ghana Data Protection Commission registration, and the other items in [security.md](security.md#ghana-data-protection)
- [ ] Monitoring on `/api/health` and on server error logs
