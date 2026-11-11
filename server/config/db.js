import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri = env.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info(`MongoDB connected (${mongoose.connection.name})`);
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

let transactionSupport;

/** Transactions need a replica set or sharded cluster (Atlas always qualifies). */
export async function supportsTransactions() {
  if (transactionSupport === undefined) {
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      transactionSupport = Boolean(hello.setName || hello.msg === 'isdbgrid');
    } catch {
      transactionSupport = false;
    }
  }
  return transactionSupport;
}

/**
 * Runs multi-document writes atomically where the deployment allows it.
 * On a standalone development server the callback runs with session=null.
 */
export async function runAtomic(fn) {
  if (!(await supportsTransactions())) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function databaseState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown';
}
