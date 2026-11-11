# Money and currencies

How BudgetFlow stores and calculates money. Read this before touching anything that adds, converts or reports amounts.

## No floating point, anywhere

- **API input:** amounts are accepted only as decimal strings (`"1250.50"`). A JSON number is rejected with 422, because it has already passed through binary floating point by the time the server sees it.
- **Storage:** amounts are stored as MongoDB `Decimal128`.
- **Calculation:** server-side arithmetic uses `decimal.js` through [`server/utils/money.js`](../server/utils/money.js). Totals and balances are summed by MongoDB aggregations over `Decimal128`, which are also exact.
- **Display:** the client never does arithmetic on money. It formats the strings the server sends with `Intl.NumberFormat`, which formats numeric strings exactly. Totals, shares and balances all come from the API.
- **Decimal places:** each amount must fit its currency's minor units (GHS 2, JPY 0, BHD 3, from `Intl`). Stored values are normalised to exactly that many places.
- **Rounding:** conversions round half-up to the target currency's minor units. Rates are kept to 10 decimal places.

## Accounts are tracking labels

An account (cash, bank, mobile money, savings, other) records where money sits *outside* BudgetFlow. Its balance is derived, never stored:

```
balance = opening balance + income − expenses − transfers out + transfers received
```

Soft-deleted transactions are excluded. An account's currency is locked once it has transactions. Accounts with history can't be deleted, only archived.

## Transactions

| Type | Category | Affects income/expense totals | Accounts |
| --- | --- | --- | --- |
| income | income category, required | yes | +amount to the account |
| expense | expense category, required | yes | −amount from the account |
| transfer | not allowed | **no** | −amount from source, +toAmount to destination |

- **Currency:** a transaction is always in its account's currency. A transfer between accounts in different currencies records both the amount sent and the amount received.
- **Delete:** deletes are soft. The record leaves balances and reports but stays in the database for the audit trail.
- **Reconciled records:** marking a record reconciled locks it against edits, deletion and receipt removal. Only an owner or admin can unlock it.
- **Edits:** every edit is audited field by field. Sending `version` rejects stale edits with 409.
- **Idempotency:** `POST /api/transactions` accepts an `Idempotency-Key` header. A retry with the same key returns the original record instead of saving a second one (this is groundwork for the offline queue in Phase 9).

## Reporting currency and rate snapshots

Each workspace has one reporting currency. Every income and expense record stores a **snapshot** of how it converts to that currency:

| `source` | Meaning |
| --- | --- |
| `same` | Already in the reporting currency; rate 1 |
| `entered` | Rate typed in for this record |
| `manual` | Taken from the workspace's manual rate table |
| `provider` | Taken from an automatic provider rate |

`estimated: true` means the rate was inverted from the reverse pair, or dates from before the transaction. The UI labels these.

**Rate resolution order:**
1. A rate entered on the record itself.
2. The most recent direct rate on or before the transaction date.
3. The inverted reverse pair, marked estimated.
4. Otherwise `422 RATE_REQUIRED`, which tells the user exactly which rate to enter.

A rate dated after the transaction is never used.

**Snapshots are permanent.** Editing or deleting a rate in the table never changes saved records. Editing a record's notes keeps its snapshot. Changing the amount on the same day and in the same currency reuses the snapshot's rate. Changing the date, account or currency resolves the rate again.

**The reporting currency locks** once a workspace has any transaction. Changing it would either mix currencies in totals or silently re-convert history, and the spec forbids both.

## Exchange-rate providers

`EXCHANGE_RATE_PROVIDER=none` (the default) means rates are entered by hand. `open_er_api` enables a "Get today's rate" button. Only the currency pair is sent to the provider. Provider rates are mid-market estimates and may differ from what a bank charged; the UI says so.

The provider integration is covered by tests with a mocked response only. It has not been run against the live service in this environment.

## Receipts

Accepted files are JPG, PNG, WebP or PDF, up to 5 MB and 5 per transaction.

- **Type checking:** the type is checked from the file's first bytes, not its name or declared type.
- **Storage:** files are saved under `UPLOAD_DIR/<workspaceId>/` with random names. They are served only through an authenticated, workspace-checked endpoint, as attachments with a sandboxing CSP.
- **Production:** local disk storage needs a persistent volume, or a swap to object storage.

## CSV export

The export uses the same filters as the list. Expenses are written as negative amounts, and the rate and rate source are included. Text cells that start with `= + - @` are prefixed to block spreadsheet formula injection.
