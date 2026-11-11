/**
 * Client-side money helpers. Amounts stay decimal strings end to end:
 * Intl.NumberFormat formats a numeric string exactly, so no value is ever
 * converted to a binary float for display. All arithmetic happens on the server.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, display: 'symbol' | 'code' = 'symbol') {
  const key = `${currency}:${display}`;
  if (!formatters.has(key)) {
    formatters.set(
      key,
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        currencyDisplay: display === 'symbol' ? 'narrowSymbol' : 'code',
      }),
    );
  }
  return formatters.get(key)!;
}

type Numeric = `${number}`;

export function formatMoney(amount: string | null | undefined, currency: string, opts: { sign?: '+' | '-' | 'auto'; display?: 'symbol' | 'code' } = {}) {
  if (amount == null || amount === '') return '';
  const negative = amount.startsWith('-');
  const abs = (negative ? amount.slice(1) : amount) as Numeric;
  const text = formatter(currency, opts.display).format(abs);
  const sign = opts.sign ?? 'auto';
  if (sign === '+') return `+${text}`;
  if (sign === '-' || (sign === 'auto' && negative)) return `−${text}`;
  return text;
}

export function minorUnits(currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Validates a typed amount against the currency's decimal places. */
export function amountError(value: string, currency: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter an amount.';
  if (!/^\d{1,13}(\.\d{1,4})?$/.test(v)) return 'Enter an amount like 125.50.';
  if (/^0+(\.0+)?$/.test(v)) return 'Amount must be more than zero.';
  const decimals = v.split('.')[1]?.length ?? 0;
  const max = minorUnits(currency);
  if (decimals > max) return max === 0 ? `${currency} amounts have no decimal places.` : `${currency} amounts have at most ${max} decimal places.`;
  return null;
}

/** Strips grouping separators people paste in ("1,250.00" becomes "1250.00"). */
export function cleanAmount(value: string) {
  return value.replace(/[\s,]/g, '');
}

export function isZero(amount: string) {
  return /^-?0+(\.0+)?$/.test(amount);
}

/** Today's calendar date in the user's time zone, as YYYY-MM-DD. */
export function todayYmd(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthRange(d = new Date()) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: todayYmd(first), to: todayYmd(last) };
}

export function formatYmd(ymd: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, day] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(y!, m! - 1, day!));
}

export const RATE_SOURCE_LABEL: Record<string, string> = {
  same: 'Same currency',
  entered: 'Rate entered for this record',
  manual: 'Manual rate',
  provider: 'Provider rate',
};
