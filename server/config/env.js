import Joi from 'joi';

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

  TERMS_VERSION: Joi.string().default('2026-11-01'),
  PRIVACY_VERSION: Joi.string().default('2026-11-01'),
}).unknown(true);

const { value, error } = schema.validate(process.env, {
  abortEarly: false,
  context: { isProd: process.env.NODE_ENV === 'production' },
});

if (error) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n' + error.details.map((d) => `  - ${d.message}`).join('\n'));
  process.exit(1);
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
  legal: { termsVersion: value.TERMS_VERSION, privacyVersion: value.PRIVACY_VERSION },
});
