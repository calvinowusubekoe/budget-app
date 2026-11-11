import { logger } from '../utils/logger.js';
import { runDueSchedules } from '../modules/recurring/recurring.service.js';
import { sweepSubscriptions } from '../modules/subscriptions/subscriptions.service.js';
import { reconcilePendingPayments } from '../modules/payments/payments.service.js';

const INTERVAL_MS = 15 * 60 * 1000;
let timer = null;
let running = false;

/**
 * In-process scheduler for recurring transactions, subscription expiry and
 * payment reconciliation. Safe to run on several
 * instances at once: each occurrence has a fixed idempotency key and schedules
 * advance with a conditional update, so nothing is created twice.
 */
export function startScheduler() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await runDueSchedules();
      if (n) logger.info(`recurring: handled ${n} occurrence(s)`);
    } catch (err) {
      logger.error('recurring scheduler tick failed', err);
    }
    try {
      const s = await sweepSubscriptions();
      if (s) logger.info(`subscriptions: ${s} status change(s)`);
      const p = await reconcilePendingPayments();
      if (p) logger.info(`payments: settled ${p} pending payment(s) with the provider`);
    } catch (err) {
      logger.error('subscription scheduler tick failed', err);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5_000).unref();
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
