# Business finance

These tools are available in business workspaces only. The server refuses them in personal workspaces, and the navigation shows a Business section only where it applies.

Kontaa is practical bookkeeping. It is **not** certified accounting or tax software, and every report says so. Tax on invoices and bills is a percentage the user enters per line; Kontaa doesn't apply tax rules.

## Customers and suppliers

- **Details:** name, email, phone, address, tax ID (reference only) and notes.
- **Outstanding balances:** each contact shows what it still owes, or is owed, per currency, from issued documents.
- **Deleting:** a contact with invoices or bills can only be archived. Archived contacts can't receive new documents.

## Invoices and bills

- **Numbering:** documents are numbered per workspace with an atomic counter (`INV-0001`, `BILL-0001`). A bill also stores the supplier's own reference.
- **Lifecycle:**
  - **Draft:** fully editable, and not counted as owed.
  - **Issued:** owed. Invoices are "issued"; bills are "marked as owed".
  - **Void:** voided with a reason. It stays on record but is no longer owed. A document with live payments can't be voided.
- **Status shown to users:** draft, open, partially paid, overdue (past the due date with a balance), paid or void.
- **Line maths (server-side, decimal):**
  - amount = quantity × unit price, rounded half-up to the currency
  - tax = amount × rate ÷ 100, rounded the same way, per line
  - totals are sums of the rounded lines, so a printed document always adds up
  - the editor's live totals come from `POST /api/business/documents/preview`; the browser never calculates money
- **Locks:** contents can change until a payment is recorded, and the currency can change only while it's a draft.

## Payments

- **Recording a payment** creates a normal transaction (income for invoices, expense for bills) in the chosen tracking account. The account must be in the document's currency, and the transaction is linked to the document. Account balances, budgets and reports pick it up like any other transaction.
- **No overpayment:** a payment can't exceed the balance, can't be dated in the future, and can't be recorded on a draft or void document.
- **Duplicate protection:** the payment endpoint accepts an `Idempotency-Key`, and the editor sends one per dialog, so a double click records once.
- **Linked transactions:** these can't be edited or deleted from Transactions; the screen points to the document. They can still be marked reconciled against a statement.
- **Removing a payment** needs a reason. It soft-deletes the linked transaction and keeps the payment on the document's history, struck through.
- **No money movement:** Kontaa never collects or pays money. A payment record describes money that moved outside Kontaa.

## Reports (cash basis)

- **Profit and loss** for any period, with the same-length previous period for comparison, margin, and breakdown by category. It's built from recorded income and expenses in the reporting currency. Export as CSV or PDF.
- **Cash flow:** money in, money out, net and running total per month. Transfers are excluded. Export as CSV.
- **Receivables and payables:** issued, unpaid documents grouped as not yet due, 1–30, 31–60, 61–90 and over 90 days overdue, per currency.
- **Analytics endpoint:** `GET /api/analytics/business` returns the period's profit and loss plus receivables and payables.

Unpaid invoices are not income on a cash basis. They appear under receivables until a payment is recorded.

## PDFs

PDFs are generated on the server with pdfkit's built-in Helvetica. Those fonts have no glyph for some currency symbols (such as ₵), so amounts print with ISO codes, for example "GHS 1,250.00", grouped without floating-point conversion. Each PDF notes that Kontaa doesn't process payments.
