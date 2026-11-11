import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', UPLOAD_DIR: 'tests/.uploads', EXCHANGE_RATE_PROVIDER: 'none',
      // Dummy test-mode credentials; every provider call is mocked in tests.
      PAYSTACK_SECRET_KEY: 'sk_test_bfdummy',
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-bfdummy-X',
      FLUTTERWAVE_WEBHOOK_HASH: 'test-webhook-hash-0123',
      PLAN_PRICES: 'personal_pro.monthly=25.00,personal_pro.yearly=250.00,business_pro.monthly=75.00',
    },
    setupFiles: ['./tests/setup.js'],
    // Suites share one test database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
