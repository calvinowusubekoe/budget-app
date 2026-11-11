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

export function databaseState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown';
}
