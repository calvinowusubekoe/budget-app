import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Joi from 'joi';
import { productionProblems } from './production.js';

// Load the repo-root .env here rather than with --env-file, so the dev
// watcher doesn't restart on every change in the repo root. Real environment
// variables always win; tests never read .env.
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * Validates and freezes runtime configuration. The process refuses to start
 * with missing or malformed configuration rather than running insecurely.
 */
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4000),
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .default('mongodb://127.0.0.1:27017/budgetflow'),
  MONGODB_URI_TEST: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .default('mongodb://127.0.0.1:27017/budgetflow_test'),
  CLIENT_URL: Joi.string().uri().default('http://localhost:5173'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  TRUST_PROXY: Joi.alternatives(Joi.boolean(), Joi.number().integer().min(0)).default(false),

  JWT_ACCESS_SECRET: Joi.string().min(32).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().default('dev-only-access-secret-change-me-0123456789'),
  }),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(90).default(30),
  COOKIE_SECURE: Joi.boolean().default(Joi.ref('$isProd')),
  BCRYPT_ROUNDS: Joi.number().integer().min(4).max(15).default(12),

  LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(3).default(5),
  LOGIN_LOCK_MINUTES: Joi.number().integer().min(1).default(15),

  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_SECURE: Joi.boolean().default(false),
  MAIL_FROM: Joi.string().default('BudgetFlow <no-reply@budgetflow.local>'),

  EXCHANGE_RATE_PROVIDER: Joi.string().valid('none', 'open_er_api').default('none'),
  UPLOAD_DIR: Joi.string().default('uploads'),
  MAX_UPLOAD_MB: Joi.number().min(1).max(25).default(5),

  // Subscription payments (BudgetFlow's own plans only). A provider is enabled only when its keys are set.
  PAYSTACK_SECRET_KEY: Joi.string().pattern(/^sk_(test|live)_\w+$/).allow('').default(''),
  FLUTTERWAVE_SECRET_KEY: Joi.string().pattern(/^FLWSECK(_TEST)?-\w+(-X)?$/).allow('').default(''),
  FLUTTERWAVE_WEBHOOK_HASH: Joi.string().min(16).allow('').default(''),
  PAYMENT_API_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(15000),
  PLAN_CURRENCY: Joi.string().uppercase().length(3).default('GHS'),
  PLAN_PRICES: Joi.string().allow('').default(''),
  PLAN_LIMITS: Joi.string().allow('').default(''),
  SUBSCRIPTION_GRACE_DAYS: Joi.number().integer().min(0).max(30).default(3),
  RENEWAL_REMINDER_DAYS: Joi.number().integer().min(1).max(30).default(7),

  // Optional AI assistant. Off unless AI_PROVIDER=anthropic and a key is set.
  AI_PROVIDER: Joi.string().valid('none', 'anthropic').default('none'),
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  AI_MODEL: Joi.string().default('claude-opus-5-5'),
  AI_EFFORT: Joi.string().valid('low', 'medium', 'high').default('medium'),
  AI_TIMEOUT_MS: Joi.number().integer().min(5000).max(300000).default(90000),

  // Interactive API docs at /api/docs. On by default outside production.
  API_DOCS: Joi.boolean().default(Joi.ref('$notProd')),

  TERMS_VERSION: Joi.string().default('2026-11-01'),
  PRIVACY_VERSION: Joi.string().default('2026-11-11'),
}).unknown(true);

// A blank line like `JWT_ACCESS_SECRET=` in .env means "not set", so defaults apply.
const source = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));

const { value, error } = schema.validate(source, {
  abortEarly: false,
  context: { isProd: process.env.NODE_ENV === 'production', notProd: process.env.NODE_ENV !== 'production' },
});

if (error) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n' + error.details.map((d) => `  - ${d.message}`).join('\n'));
  process.exit(1);
}

if (value.NODE_ENV === 'production') {
  const { errors, warnings } = productionProblems(value, source);
  // eslint-disable-next-line no-console
  for (const w of warnings) console.warn(`[config] ${w}`);
  if (errors.length) {
    // eslint-disable-next-line no-console
    console.error(['Refusing to start in production:', ...errors.map((e) => `  - ${e}`)].join('\n'));
    process.exit(1);
  }
}

export const env = Object.freeze({
  nodeEnv: value.NODE_ENV,
  isProd: value.NODE_ENV === 'production',
  isTest: value.NODE_ENV === 'test',
  port: value.PORT,
  mongoUri: value.NODE_ENV === 'test' ? value.MONGODB_URI_TEST : value.MONGODB_URI,
  clientUrl: value.CLIENT_URL,
  corsOrigins: [value.CLIENT_URL, ...value.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)],
  trustProxy: value.TRUST_PROXY,
  jwt: { accessSecret: value.JWT_ACCESS_SECRET, accessTtl: value.JWT_ACCESS_TTL },
  refreshTtlDays: value.REFRESH_TOKEN_TTL_DAYS,
  cookieSecure: value.COOKIE_SECURE,
  bcryptRounds: value.NODE_ENV === 'test' ? 4 : value.BCRYPT_ROUNDS,
  login: { maxAttempts: value.LOGIN_MAX_ATTEMPTS, lockMinutes: value.LOGIN_LOCK_MINUTES },
  smtp: {
    host: value.SMTP_HOST,
    port: value.SMTP_PORT,
    user: value.SMTP_USER,
    pass: value.SMTP_PASS,
    secure: value.SMTP_SECURE,
  },
  mailFrom: value.MAIL_FROM,
  apiDocs: value.API_DOCS,
  legal: { termsVersion: value.TERMS_VERSION, privacyVersion: value.PRIVACY_VERSION },
  exchangeRateProvider: value.EXCHANGE_RATE_PROVIDER,
  payments: {
    paystackSecret: value.PAYSTACK_SECRET_KEY,
    flutterwaveSecret: value.FLUTTERWAVE_SECRET_KEY,
    flutterwaveHash: value.FLUTTERWAVE_WEBHOOK_HASH,
    timeoutMs: value.PAYMENT_API_TIMEOUT_MS,
  },
  plans: {
    currency: value.PLAN_CURRENCY,
    prices: value.PLAN_PRICES,
    limits: value.PLAN_LIMITS,
    graceDays: value.SUBSCRIPTION_GRACE_DAYS,
    reminderDays: value.RENEWAL_REMINDER_DAYS,
  },
  ai: {
    provider: value.AI_PROVIDER,
    apiKey: value.ANTHROPIC_API_KEY,
    model: value.AI_MODEL,
    effort: value.AI_EFFORT,
    timeoutMs: value.AI_TIMEOUT_MS,
  },
  uploads: { dir: value.UPLOAD_DIR, maxBytes: Math.round(value.MAX_UPLOAD_MB * 1024 * 1024) },
});
