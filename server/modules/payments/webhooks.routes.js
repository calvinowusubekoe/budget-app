import express, { Router } from 'express';
import { webhookLimiter } from '../../middleware/rateLimiters.js';
import { ok } from '../../utils/http.js';
import { handleWebhook } from './payments.service.js';

/**
 * Public provider webhooks for BudgetFlow subscription payments. Mounted
 * before the JSON parser: the signature is computed over the exact raw bytes.
 * There are no webhooks for Susu and never will be.
 */
export const paymentWebhooksRouter = Router();

paymentWebhooksRouter.use(
  webhookLimiter,
  express.raw({ type: () => true, limit: '200kb' }),
);

for (const provider of ['paystack', 'flutterwave']) {
  paymentWebhooksRouter.post(`/${provider}`, async (req, res) => {
    const result = await handleWebhook(provider, req.body, req.headers);
    res.set('Cache-Control', 'no-store');
    ok(res, { received: true, duplicate: result.duplicate });
  });
}
