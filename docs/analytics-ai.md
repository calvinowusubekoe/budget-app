# Analytics, insights and the AI assistant

## Reports (deterministic)

Every figure on the Reports screen is calculated on the server, in decimal, from the workspace's records. The browser formats the numbers but never calculates money. Chart geometry uses `Number()` only to position marks; every value a person reads is the server's string.

| Endpoint | What it returns |
| --- | --- |
| `GET /api/analytics/monthly` | Income, spending, net and "kept %" per month, quarter or year (`granularity`), the running total, and the same-length previous period. `format=csv` exports it. |
| `GET /api/analytics/cash-flow` | Money in and out per period, with a running total. |
| `GET /api/analytics/spending` | Spending by category, each against the previous period and its three-period average, plus unusual patterns. |
| `GET /api/analytics/savings` | Savings goals, savings and personal Susu flows per currency, and your standing in each Susu group. |
| `GET /api/analytics/separated` | The six kinds of money movement, kept apart (see below). |
| `GET /api/analytics/insights` | Rule-based insights, each with the exact figures behind it. |
| `GET /api/analytics/dashboard`, `/business` | From earlier phases. |

**Date ranges:**
- Ranges are calendar dates, from and to inclusive, at most ten years long.
- The first and last buckets are clipped to the range, and empty periods still appear.
- The previous period is the same number of days immediately before.

**What counts:**
- Income and spending are tracked income and expense transactions in the reporting currency only.
- Records in other currencies count through their stored rate snapshot.

### Kept separate

| Kind | Counted as income or spending? |
| --- | --- |
| Tracked income and expenses | Yes, and nothing else is |
| Transfers between your own accounts | No |
| Savings allocations (goal contributions and withdrawals) | No |
| Personal Susu contributions and withdrawals | No |
| Group Susu contributions and payouts (your own records) | No |
| Kontaa plan payments (owners and admins only) | No |

Group Susu contributions and payouts never appear in a person's income or spending, or in business revenue.

### Unusual patterns and insights

These come from fixed rules, not from a model:
- **Category spike:** a category at least 1.5× its average over the three previous equal-length periods, and at least 5% of this period's spending.
- **Large expense:** one expense more than 3× the median for its category over the previous 180 days. It needs at least five earlier expenses in that category.
- **Other insights:**
  - spending more than you earned, or the share of income kept
  - spending up or down 20% or more on the previous period
  - budgets at their alert level or over
  - savings goals reached, overdue or behind pace
  - overdue debts
  - missed personal Susu contributions
  - money outstanding in a Susu group
  - for businesses: profit up or down 15% or more, and overdue invoices and bills

## AI assistant (optional)

The assistant is off unless the server sets `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. The model defaults to `claude-opus-5-5`, set with `AI_MODEL`. Effort is set with `AI_EFFORT`, default `medium`.

**Rules it follows:**
- **Consent first.** Each user agrees once on the assistant screen to the data being sent, and can withdraw at any time. Owners and admins can switch it off for the whole workspace.
- **Only authorised data.** It answers about the current workspace the user can read. Subscription payment figures are included only for owners and admins.
- **Data minimisation.** The model receives a "facts pack" built from the same calculations as Reports: totals, categories, budgets, goals, debts, personal Susu, the user's group standing, business totals, and the insights. Transaction descriptions, payees, notes, files, emails and account numbers are never sent.
- **No tools and no writes.** The model has no tools, so it can't read anything else or change any record. It tells the user where in Kontaa to make changes.
- **No invented figures.** It is told to quote amounts exactly and not to recalculate. Every money-like number in its answer is checked against the facts pack, and any that isn't there is shown to the user under "Not from your records".
- **Labelled as a suggestion.** Every answer is marked "AI suggestion", with a note that suggestions are recommendations, not verified facts or professional advice.
- **Nothing stored.** Questions and answers aren't saved. A usage row (model, token counts, outcome) is kept for plan limits and cost, and an audit entry records that a question was asked, but never its text.
- **Limits.** Free allows 20 questions a month per workspace, Personal Pro 300, and Business Pro 600 (configurable with `PLAN_LIMITS`). There is also a per-user burst limit of 8 a minute.
- **Refusals and failures.** Server-side refusal fallback (`fallbacks: "default"`) is enabled on models that support it. A refusal returns a short, polite message. Provider errors map to 503 or 502 with a plain message.

Automated tests use a stubbed client. The live integration was checked on 2026-11-11 with a real key: a two-turn conversation was grounded in the facts pack, flagged no unverified figures, and declined to delete a record, pointing the user to Expenses instead.

## Receipt scanning

Choose **Scan a receipt** on Transactions, Income or Expenses. It reads a photo of a receipt, or a screenshot of a MoMo message or bank alert, and opens the normal "Record a transaction" form already filled in.

- **It only suggests.** `POST /api/ai/receipts/scan` saves nothing. The form is labelled "Filled in by AI from your receipt", lists anything the model was unsure of, and warns about **possible duplicates**: same amount within a day, or the same reference in the notes. Only when the person saves is the transaction created, through the usual endpoint and its checks, with the image attached.
- **Strict reading.** The model is told to copy only what's printed and to use null rather than guess. It answers in a fixed JSON schema (structured outputs). The server then checks every field with the same rules as typed entry:
  - the amount fits the currency's decimals
  - the currency is a real ISO code
  - the date isn't in the future
  - the category is one of the workspace's own

  Anything that fails is dropped with a warning, never "fixed".
- **Where things go.** The total goes in Amount and the counterparty in Payee. The reference and any fees go in Notes. The account is the first one in the receipt's currency.
- **Data sent.** The image and the workspace's category names, and nothing else. It needs the same AI consent as the assistant. The consent version was bumped when scanning was added, so everyone is asked again with the new wording. It also respects the workspace AI switch.
- **Storage.** The image isn't stored unless the person saves the transaction, in which case it becomes an ordinary attachment.
- **Limits.** Scans have their own monthly allowance: Free 10, Personal Pro 200, Business Pro 500 (`receiptScansPerMonth` in `PLAN_LIMITS`). Scans are logged as usage rows with `feature: 'scan'`.
- **Model settings.** It uses the same model as the assistant (`AI_MODEL`) at low effort, with refusal fallback.

## Receipts and proof elsewhere

- **Invoice and bill payments:** each payment row has a **Receipts** button. It opens the payment's linked transaction, where receipts are attached and viewed (`receiptCount` on each payment).
- **Group Susu:**
  - Contribution and payout records accept one proof file: a screenshot or receipt of the payment made outside Kontaa.
  - The member it's about, whoever recorded it, or a manager who may record that kind can add or replace it. Each change is logged in the record's history and the group activity log.
  - Proof follows the record's visibility: payouts are visible to every member, contributions only to managers and that member.
  - It's evidence for the group, not something Kontaa verifies.
