/**
 * Calendar maths on YYYY-MM-DD strings, done in UTC so a date never shifts
 * with the server's time zone. Used by budgets (period windows) and the
 * recurring engine (occurrence dates).
 */

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const parse = (s) => new Date(`${s}T00:00:00.000Z`);
export const addDays = (s, n) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86_400_000);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Today's date in a given IANA time zone (the user's), as YYYY-MM-DD. */
export function todayIn(timeZone = 'Africa/Accra', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Adds whole months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s, n, anchorDay) {
  const d = parse(s);
  const day = anchorDay ?? d.getUTCDate();
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const y = Math.floor(total / 12);
  const m = total % 12;
  return `${y}-${pad(m + 1)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

/**
 * Budget period containing a date. Weeks run Monday to Sunday; months and
 * years are calendar months and years. `key` identifies the period for
 * alerts and history.
 */
export function periodOf(period, date) {
  const d = parse(date);
  if (period === 'weekly') {
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    const start = addDays(date, -dow);
    return { start, end: addDays(start, 6), key: `W${start}` };
  }
  if (period === 'monthly') {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(daysInMonth(y, m))}`, key: `M${y}-${pad(m + 1)}` };
  }
  if (period === 'yearly') {
    const y = d.getUTCFullYear();
    return { start: `${y}-01-01`, end: `${y}-12-31`, key: `Y${y}` };
  }
  throw new Error(`Unknown period: ${period}`);
}

/** The period immediately before the one containing `date`. */
export function previousPeriod(period, date) {
  return periodOf(period, addDays(periodOf(period, date).start, -1));
}

/**
 * The n-th occurrence (0-based) of a schedule. Computed from the anchor each
 * time rather than by stepping, so month-end clamping never drifts
 * (31 Jan, 28 Feb, 31 Mar, not 31 Jan, 28 Feb, 28 Mar).
 */
export function occurrence(anchor, frequency, interval, n) {
  const step = interval * n;
  switch (frequency) {
    case 'daily':
      return addDays(anchor, step);
    case 'weekly':
      return addDays(anchor, 7 * step);
    case 'monthly':
      return addMonths(anchor, step);
    case 'quarterly':
      return addMonths(anchor, 3 * step);
    case 'yearly':
      return addMonths(anchor, 12 * step);
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}

/** Approximate days per period, for savings projections. */
export const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30.436875, quarterly: 91.310625, yearly: 365.2425 };
