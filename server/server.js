import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './config/express.js';
import { logger } from './utils/logger.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { seedDemo } from './services/demoSeed.js';

async function start() {
  await connectDatabase();
  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`Kontaa API on http://localhost:${env.port}  (docs: /api/docs)`);
  });
  if (process.env.DISABLE_SCHEDULER !== 'true') startScheduler();

  // Test builds create the shared demo account on first start (hosts without a shell can't run the script).
  if (env.demo) {
    seedDemo(env.demo)
      .then((r) => r === 'created' && logger.info(`demo: created ${env.demo.email}`))
      .catch((err) => logger.error('demo: could not create the demo account', err));
  }

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    stopScheduler();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
