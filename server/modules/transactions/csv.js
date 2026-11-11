/**
 * CSV for spreadsheets. Cells starting with = + - @ (or tab/CR) are prefixed
 * with an apostrophe so a malicious description can't run as a formula
 * (CSV injection). Amount columns are plain decimal strings, so they're exempt.
 */
const RISKY = /^[=+\-@\t\r]/;

export function csvCell(value, { numeric = false } = {}) {
  let s = value == null ? '' : String(value);
  if (!numeric && RISKY.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  ['Date', (t) => t.date],
  ['Type', (t) => t.type],
  ['Description', (t) => t.description],
  ['Payee', (t) => t.payee],
  ['Category', (t) => t.category?.name ?? ''],
  ['Account', (t) => t.account.name],
  ['To account', (t) => t.toAccount?.name ?? ''],
  ['Amount', (t) => (t.type === 'expense' ? `-${t.amount}` : t.amount), true],
  ['Currency', (t) => t.currency],
  ['Amount received', (t) => t.toAmount ?? '', true],
  ['Received currency', (t) => t.toCurrency ?? ''],
  ['Exchange rate', (t) => t.reporting.rate, true],
  ['Rate source', (t) => t.reporting.source + (t.reporting.estimated ? ' (estimated)' : '')],
  ['Reporting amount', (t) => (t.type === 'expense' ? `-${t.reporting.amount}` : t.reporting.amount), true],
  ['Reporting currency', (t) => t.reporting.currency],
  ['Status', (t) => t.status],
  ['Recurring', (t) => (t.recurrence.isRecurring ? t.recurrence.frequency : '')],
  ['Notes', (t) => t.notes],
];

export function toCsv(transactions) {
  const header = COLUMNS.map(([name]) => csvCell(name)).join(',');
  const lines = transactions.map((t) => COLUMNS.map(([, get, numeric]) => csvCell(get(t), { numeric })).join(','));
  // BOM so Excel opens UTF-8 (e.g. "₵") correctly.
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}
