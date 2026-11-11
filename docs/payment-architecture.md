# Subscriptions and payments

This is the only place Kontaa takes money: payments for Kontaa's own software plans, processed by an approved provider (Paystack or Flutterwave) and settled to Kontaa's merchant account. Susu contributions, payouts and withdrawals never go through it, and there is no Kontaa wallet or balance.

## Plans

| Plan | Workspaces | Limits |
| --- | --- | --- |
| Free | Any | 5 accounts, 5 budgets, 3 savings goals, 5 debts, 5 repeating schedules, 2 personal Susu plans, 10 invoices and 10 bills a month |
| Personal Pro | Personal | No limits |
| Business Pro | Business | No limits |

- **One plan per workspace.** Only the workspace owner can buy or cancel. Owners and admins can see payment history.
- **Limits apply to new records only.** If a plan lapses, nothing is deleted or locked; the Free limits just apply to the next new record. Archived and ended records don't count towards a limit.
- **The server enforces limits.** It returns `403 PLAN_LIMIT` with a message saying what to do.
- **Configuration:**
  - `PLAN_PRICES` sets prices as decimal strings, for example `personal_pro.monthly=25.00`. A plan or period with no price is shown as "not on sale" and can't be bought.
  - `PLAN_LIMITS` overrides limits as JSON, for example `{"free":{"accounts":8}}`. `null` means unlimited.
  - `PLAN_CURRENCY` sets the currency (default GHS).
  - The example prices in `.env.example` are placeholders, not decided prices.

## Payment flow

1. The owner picks a period and a provider on **Settings → Plan and billing**.
2. `POST /api/subscriptions/checkout` creates a pending payment with Kontaa's own reference (`bf-…`) and a hosted checkout session at the provider. The price comes from the server's configuration; any amount in the request is ignored. An `Idempotency-Key` makes a double click open one checkout, not two.
3. The user pays on the provider's page. Kontaa never sees card numbers, CVVs or mobile money PINs.
4. The provider sends a webhook to `/api/payments/webhooks/<provider>`. Then:
   - The server checks the signature: an HMAC-SHA512 of the raw body for Paystack, or the `verif-hash` secret for Flutterwave. Bad signatures get a 401.
   - Each event is stored once by its event id. A repeated delivery is acknowledged and ignored.
   - The server **asks the provider's API** about the payment. It doesn't trust the webhook body.
5. The plan is activated only if the provider confirms success with the **same reference, the exact amount and the same currency**. A mismatch marks the payment "review", activates nothing and notifies the owner.
6. Activation is a conditional update from pending to succeeded, so each payment extends a plan exactly once, however many webhooks or checks arrive. Provider fees and the payment method type are recorded.

When the user comes back from checkout, the page calls `POST /api/subscriptions/payments/:reference/check`. This is still a server-to-provider check; the status in the return URL is ignored.

## Renewals, grace, cancellation and expiry

- **Renewals:** Kontaa keeps no saved cards, so nothing is charged automatically. Renewing is another payment. Paying early extends from the end of the current period, so no days are lost. Owners get a reminder `RENEWAL_REMINDER_DAYS` (default 7) before the end.
- **Grace period:** after the paid period ends, the plan keeps working for `SUBSCRIPTION_GRACE_DAYS` (default 3) while the owner renews, shown as "past due". After that it expires and the workspace is on Free.
- **Cancelling** stops the plan at the end of the paid period, with no grace period. The owner can choose "Keep my plan" until then. No refund is made for the time left.
- **How the plan is worked out:** entitlements come from the dates every time, so a late scheduler run can't give or take away access. The scheduler (every 15 minutes) updates stored statuses and sends notifications.

## Failures, retries, refunds and reconciliation

- **Failed or abandoned payments** are recorded, and the owner can start a new checkout at any time.
- **Webhook retries:** if the provider's API can't be reached while handling a webhook, the endpoint returns 502 so the provider retries, and the event is processed on the retry.
- **Reconciliation:** the scheduler checks any payment still pending after 10 minutes directly with the provider, which catches missed webhooks. Checkouts not completed within 24 hours are marked "not completed".
- **Refunds (Paystack):** a `refund.processed` webhook is verified by fetching the refund from Paystack. A full refund removes the period that payment bought; a partial refund is recorded and the plan stays. Flutterwave refunds aren't processed automatically yet.

## Records kept

- **`Payment`:**
  - who paid, the workspace and the subscription
  - the provider, our reference and the provider's transaction id (unique)
  - amount and currency (Decimal128), and status
  - payment method type, paid date and fees
  - the period the payment bought
  - verification timestamps (webhook and API) and reconciliation status
  - refunds
- **`Subscription`:** one per workspace, with the plan, period, status, start date, current period start and end, cancellation and the latest payment.
- **`PaymentWebhookEvent`:** the provider, event id (unique), type, reference, a hash of the payload, attempts and outcome. Raw payloads aren't stored because they contain customer details.
- **Audit log:** checkout started, activated, renewed, cancelled, resumed, expired, mismatch and refunded are all recorded.

## Setting up a provider

1. Get approved merchant credentials. Start with test keys.
2. Set `PAYSTACK_SECRET_KEY`, or `FLUTTERWAVE_SECRET_KEY` plus `FLUTTERWAVE_WEBHOOK_HASH`, on the server only.
3. In the provider dashboard, set the webhook URL to `https://<api-host>/api/payments/webhooks/paystack` (or `/flutterwave`), and for Flutterwave the same secret hash.
4. Check that `CLIENT_URL` is correct. Providers send users back to `<CLIENT_URL>/settings/billing`.

A provider is offered only when its keys are set. Neither is assumed to be active.

The integration has been tested against mocked provider APIs only. It has not been run against Paystack's or Flutterwave's test environments.
