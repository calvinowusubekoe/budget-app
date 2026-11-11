# Planning: budgets, savings goals, debts, recurring

All amounts follow [money.md](money.md): decimal strings in, `Decimal128` stored, exact sums on the server.

## Budgets

- **Period and scope:** a budget is weekly (Monday to Sunday), monthly or yearly, and covers either all spending or chosen expense categories. Its currency is the workspace's reporting currency.
- **Spending:** spent = the exact sum of the `reporting.amount` of expense transactions in the period. Transfers, income, savings entries and debt payments never count.
- **What a budget reports:** spent, remaining (negative when over), and utilisation to one decimal place. Its state is `under`, `warning` (at or above the alert level, 80% by default) or `over` (above 100%).
- **Limit history:** when the limit changes, the new amount is appended with the period it starts from. History (`/budgets/:id/history`) compares each past period with the limit that applied then.
- **Alerts:** owners and admins are notified once per budget, period and level the first time the current period crosses the warning level or the limit. Alerts are checked after an expense is saved or edited. Paused budgets don't alert, and past periods never alert.
- **Archiving:** the period can't change after creation. Deleting a budget archives it.

## Savings goals

- **A separate ledger:** contributions and withdrawals are tracking entries only. They don't move account balances or appear in income or expense totals. If money physically moved between accounts, record a transfer too.
- **Saved amount:** saved = contributions − withdrawals, excluding reversed entries. A withdrawal can't exceed what's saved.
- **No edits:** entries are never edited. A mistake is reversed with a reason, and the reversed entry stays visible. A reversal that would take the goal below zero is refused.
- **Estimates, labelled as such in the UI:**
  - *Projected completion:* from the average pace so far. It is only shown after 14 days of history.
  - *Per-period amount:* what's needed each period to reach the target date, rounded up.
- **Trend:** net saved per month, for the last 12 months.

## Debts

- **Direction:** a debt is either `i_owe` or `owed_to_me`.
- **Balance:** balance = principal + charges − payments, excluding reversed entries. A payment can't exceed the balance.
- **Interest:** the interest rate is stored for reference only. Interest is never calculated silently; it's recorded as a charge when the lender applies it.
- **Status:** a debt becomes `paid_off` automatically when the balance reaches zero. Reversing the final payment reopens it.
- **Overdue:** a debt is overdue when the due date has passed and a balance remains.
- **Locks:** the principal and currency lock once payments or charges exist. Like savings, debt entries don't touch accounts or reports.

## Recurring transactions

- **Occurrence dates:** a schedule holds a template (type, account, category, amount and so on), a frequency, an interval, an anchor date and an optional end date. Occurrence *n* falls on `occurrence(anchor, frequency, interval, n)`, computed from the anchor every time. Month ends clamp without drift: 31 Jan, 28 Feb, 31 Mar.
- **Creating a schedule:**
  - from scratch, with a start date (catch-up is limited to the last year), or
  - from an existing transaction ("Repeat this" in the form), which becomes occurrence 0.
- **Modes:**
  - `auto` records each occurrence on its date.
  - `remind` notifies and waits for the user to confirm or dismiss it.
- **The engine:** it runs in the API every 15 minutes, and immediately when a schedule is created or resumed. Each occurrence is created through the normal transaction service, so every rule applies, including rate resolution and budget alerts.
- **No duplicates:** each occurrence uses the fixed idempotency key `rec-<scheduleId>-<date>`, and schedules advance with a conditional update. Running the engine twice, or on several servers, never creates a duplicate.
- **Failures stop and notify:** a missing exchange rate, an archived account, or a creator who has lost write access stops the schedule at that date and notifies owners and admins. Nothing is guessed or skipped; resuming retries the same date.
- **Per-run cap:** at most 24 occurrences are handled per schedule per run.

## Notifications

In-app only for now (`/api/notifications`, the bell in the top bar).

- **Types:** budget warnings and overruns, recurring reminders, and recurring failures.
- **No repeats:** each notification is de-duplicated per user, so the same alert never fires twice.
- **Retention:** notifications older than 180 days are removed automatically.
