import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { env } from './env.js';
import { apiRouter } from '../routes/index.js';
import { apiLimiter } from '../middleware/rateLimiters.js';
import { sanitizeInput } from '../middleware/sanitize.js';
import { errorHandler, notFound } from '../middleware/errorHandler.js';
import { openApiSpec } from '../docs/openapi.js';
import { paymentWebhooksRouter } from '../modules/payments/webhooks.routes.js';

/**
 * Builds the Express application without binding a port, so tests can drive
 * it with Supertest. server.js is the process entry point.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.set('query parser', 'simple');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id', 'Idempotency-Key'],
    }),
  );
  // Provider webhooks need the raw body for signature checks, so they come before the JSON parser.
  app.use('/api/payments/webhooks', paymentWebhooksRouter);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeInput);

  if (env.apiDocs) {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'BudgetFlow API' }));
    app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec));
  }

  app.use('/api', apiLimiter, (_req, res, next) => {
    // API responses carry personal financial data; never let shared caches keep them.
    res.set('Cache-Control', 'no-store');
    next();
  }, apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
