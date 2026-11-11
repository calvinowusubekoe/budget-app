import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './config/express.js';
import { logger } from './utils/logger.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

async function start() {
  await connectDatabase();
  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`Kontaa API on http://localhost:${env.port}  (docs: /api/docs)`);
  });
  if (process.env.DISABLE_SCHEDULER !== 'true') startScheduler();

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
