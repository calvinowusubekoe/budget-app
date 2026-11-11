import { D, normalize } from '../../utils/money.js';
import { addDays, occurrence } from '../../utils/periods.js';

/**
 * Turns a Personal Susu plan into its contribution periods ("windows") up to
 * today and says how each went. Pure: takes plain data, returns plain data,
 * so it is easy to test.
 *
 * A window runs from its due date to the day before the next due date.
 *   met      contributions in the window reach the planned amount
 *   partial  something was contributed, but less than planned
 *   missed   the window has ended with nothing contributed
 *   open     the window includes today and isn't met yet
 *   paused   the due date fell while the plan was paused
 *
 * Contributions are matched to the window their date falls in. Arrears are
 * worked out on totals: paying extra one week covers a short week.
 */

export function stepOf(plan) {
  if (plan.frequency === 'custom') return { frequency: 'daily', interval: plan.intervalDays };
  return { frequency: plan.frequency, interval: 1 };
}

export function dueDate(plan, n) {
  const { frequency, interval } = stepOf(plan);
  return occurrence(plan.startDate, frequency, interval, n);
}

/** The planned amount that applied on a given date. */
export function plannedOn(plan, date) {
  const sorted = [...plan.contributionAmounts].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  let current = sorted[0];
  for (const a of sorted) if (a.effectiveFrom <= date) current = a;
  return current.amount;
}

function inPause(plan, date) {
  return plan.pauses.some((p) => p.from <= date && (p.to === null || date <= p.to));
}

const MAX_WINDOWS = 5000;

/**
 * @param plan   { startDate, frequency, intervalDays, targetDate, currency, contributionAmounts[{amount, effectiveFrom}], pauses[{from,to}], endedOn }
 *               All dates are YYYY-MM-DD strings, amounts decimal strings.
 * @param contributions [{ date, amount }] valid (not cancelled) contributions
 * @param today  YYYY-MM-DD
 */
export function buildSchedule(plan, contributions, today) {
  const cur = plan.currency;
  // The schedule stops at today, the target date or the day the plan ended, whichever is first.
  const stop = [today, plan.targetDate, plan.endedOn].filter(Boolean).sort()[0];
  const sorted = [...contributions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const windows = [];
  let cursor = 0;

  for (let n = 0; n < MAX_WINDOWS; n += 1) {
    const due = dueDate(plan, n);
    if (due > stop) break;
    const end = addDays(dueDate(plan, n + 1), -1);
    while (cursor < sorted.length && sorted[cursor].date < due) cursor += 1;
    let sum = new D(0);
    let count = 0;
    for (let i = cursor; i < sorted.length && sorted[i].date <= end; i += 1) {
      sum = sum.plus(sorted[i].amount);
      count += 1;
    }
    const expected = plannedOn(plan, due);
    const met = sum.greaterThanOrEqualTo(expected);
    let status;
    if (inPause(plan, due)) status = 'paused';
    else if (met) status = 'met';
    else if (end >= today) status = 'open';
    else status = sum.greaterThan(0) ? 'partial' : 'missed';
    windows.push({ index: n, due, end, expected: normalize(expected, cur), contributed: normalize(sum.toString(), cur), entries: count, status });
  }

  const counted = windows.filter((w) => w.status !== 'paused' && w.status !== 'open');
  const expectedToDate = counted.reduce((acc, w) => acc.plus(w.expected), new D(0));
  const contributedToDate = counted.reduce((acc, w) => acc.plus(w.contributed), new D(0));
  const tally = (s) => windows.filter((w) => w.status === s).length;

  let streak = 0;
  for (let i = windows.length - 1; i >= 0; i -= 1) {
    const s = windows[i].status;
    if (s === 'open' || s === 'paused') continue;
    if (s !== 'met') break;
    streak += 1;
  }

  return {
    windows,
    stats: {
      periods: windows.length,
      met: tally('met'),
      partial: tally('partial'),
      missed: tally('missed'),
      open: tally('open'),
      paused: tally('paused'),
      expectedToDate: normalize(expectedToDate.toString(), cur),
      arrears: normalize(D.max(expectedToDate.minus(contributedToDate), 0).toString(), cur),
      streak,
      // The first due date after the last window, unless the plan is over.
      nextDue: (() => {
        if (plan.endedOn) return null;
        const d = dueDate(plan, windows.length);
        return plan.targetDate && d > plan.targetDate ? null : d;
      })(),
    },
  };
}
