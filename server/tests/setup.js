import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { outbox } from '../services/mailer.js';

beforeAll(async () => {
  if (!/test/i.test(env.mongoUri)) throw new Error(`Refusing to run tests against non-test database: ${env.mongoUri}`);
  await connectDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

beforeEach(async () => {
  outbox.length = 0;
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await disconnectDatabase();
});
