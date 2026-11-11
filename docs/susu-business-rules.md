# Susu business rules

These rules are permanent product constraints. Changing any of them requires a separately approved product and legal scope change. They are not engineering decisions.

## Kontaa never handles Susu money

Kontaa must never:

- collect Susu contributions
- pool or hold Susu funds
- transfer Susu money between members
- distribute or initiate Susu payouts
- create a withdrawable Susu balance or any wallet
- integrate a payment gateway for Susu contributions or payouts

There must be no dormant Susu payment endpoints, "future-ready" gateway abstractions, or simulated transfers. Members and organisers transact outside Kontaa. The app only records what authorised users enter.

## Language and meaning

- A **recorded** contribution is an entry someone made. It is not proof that money moved.
- A **confirmed** contribution or payout is a member's acknowledgement. It is not independent verification of a bank or mobile-money transaction.
- The **expected pool** (members × expected contribution) is a schedule estimate, not money received or held.
- Scheduled contributions are never counted as received.

## Reporting separation

- Personal Susu contributions are not expenses, and withdrawals are not income. No income or expense transactions are created from Susu records automatically.
- Group contributions and payouts never appear in an individual's income or expense totals, or in Kontaa business revenue.
- Analytics keep these apart: tracked income and expenses, account transfers, savings allocations, Personal Susu, Group Susu, and Kontaa subscription payments.

## Record integrity

- Confirmed records are never silently edited or deleted. Corrections use cancellation or reversal records, with a reason and an audit entry.
- Every creation, modification, confirmation, dispute, cancellation, payout record, invitation, role change and group settings change is written to the audit history.

## Subscriptions are separate

The only payment integration is for Kontaa's own subscription plans, through an approved provider (Paystack or Flutterwave). A subscription is activated only after server-side webhook signature verification and an independent check of the transaction with the provider.

## How Personal Susu applies these rules

Personal Susu is built as plans plus two ledgers: contributions and withdrawals.

- **No money movement anywhere.** The `/api/susu` router has no payment, payout, transfer, checkout or wallet routes. A test fails if one is ever added.
- **Separate from accounts and reports.** Recording a contribution or withdrawal never creates a transaction, never changes an account balance, and never appears in income or spending totals. The dashboard reports Susu on its own line.
- **Recorded savings** = contributions − withdrawals, excluding cancelled entries. A withdrawal can't exceed what's recorded.
- **Entries are never edited or deleted.** A mistake is cancelled with a reason, and the cancelled entry stays in the history. A cancellation that would leave the plan below zero is refused. Every change is in the workspace audit log.
- **Missed contributions, period by period.** Each scheduled period (daily, weekly, monthly, or every N days, starting from the plan's start date) runs from its due date to the day before the next one.
  - *Met:* contributions dated in the period reach the planned amount.
  - *Partial:* something was contributed, but less than planned.
  - *Missed:* the period has ended with nothing recorded.
  - *Open:* the period includes today and isn't met yet.
  - *Paused:* the due date fell while the plan was paused.
- **Arrears** = expected for closed, unpaused periods − contributed in them. Extra paid in one period covers a short one.
- **The schedule locks once contributions exist.** Frequency, start date and currency can't change, because that would rewrite which past periods were missed. A new planned amount applies from the day it's changed; earlier periods keep their expectation.
- **Plan statuses:**
  - *Paused:* contributions are still allowed, and paused periods aren't counted as missed.
  - *Completed:* withdrawals are allowed, contributions are not.
  - *Cancelled:* fully read-only, and a reason is required.
- **Proof files:** each contribution can carry one JPG, PNG, WebP or PDF, such as a photo of the collector's card. It's stored and served like transaction receipts and is checked by file content.

## How Group Susu applies these rules

- **Records only.** "Payout" endpoints record payouts already made between members. Nothing sends, collects, initiates or verifies money. Two tests guard this: one fails if a group route looks like a payment action, and one fails if any Susu code references a payment provider or the payments module.
- **Groups and roles.** Groups are governed by their own membership, not workspaces.
  - **Organisers** can do everything.
  - **Assistant organisers** get only what the group settings allow: recording contributions (on by default), recording payouts, managing members, managing cycles.
  - **Members** can view the group, the rotation, the payouts, their own contributions and cycle totals. They confirm or dispute records about themselves.
  - **Restricted to organisers:** settings, roles, and cancelling a confirmed record. Contact details are visible to organisers and to assistants allowed to manage members.
- **Members without accounts** can be added by name and invited later to link an account. Until then their records can't be confirmed, and the screen says so.
- **Cycles snapshot their expectations.** Each cycle stores who is expected to contribute and how much each person owes, at creation. Changing the group's amount affects only new cycles. The schedule locks once cycles exist. A cycle can be changed or cancelled only with a reason, and its recipient can't change once a payout is recorded. A random rotation is drawn once and the order is logged.
- **The expected pool** (contributors × expected per member) is labelled as a schedule estimate, never as money received or held.
- **Record lifecycle** (contributions and payouts):
  - **Recorded:** entered by an organiser, or an assistant with permission. This is not proof of payment.
  - **Confirmed:** the member it's about (the recipient, for payouts) acknowledged it from their own account. It's an acknowledgement, not verification of a bank or mobile-money transaction. The person who last entered or corrected a record can't also confirm it, so self-recorded entries stay "recorded".
  - **Disputed:** that member says it's wrong, and gives a reason. Organisers are notified.
  - **Corrected:** an organiser fixes a recorded or disputed record, with a reason. It goes back to "recorded", and the member is asked to confirm again.
  - **Cancelled:** an organiser withdraws it, with a reason. Only organisers can cancel a confirmed record.
  - Every step is kept on the record's own history and in the group's activity log, and nothing is deleted.
- **Outstanding contributions.** For each due cycle and expected member: received = recorded + confirmed. Disputed amounts are shown separately and don't count. Outstanding = expected − received, never below zero. Each member's state for a cycle is one of:
  - *Paid:* received at least the expected amount.
  - *Partial:* something received, but less than expected.
  - *Disputed:* a disputed record exists and the amount isn't fully received.
  - *Due:* today is the collection day and nothing is recorded yet. This counts as outstanding but not as missed.
  - *Missed:* the due date has passed with nothing recorded.
  - *Scheduled:* not due yet, and never counted as received.
- **Members with records can't be removed,** only suspended, so the history stays intact. A group always keeps at least one active organiser.
- **The activity history** is append-only. Members see group-wide events and anything about themselves; organisers see everything.
