import { ApiError } from './ApiError.js';

/** Reads and checks an optional Idempotency-Key header (a client-made id, e.g. a UUID). */
export function idempotencyKey(req) {
  const key = req.get('idempotency-key');
  if (key === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw ApiError.badRequest('Idempotency-Key must be 8–100 letters, numbers, dashes or underscores.');
  return key;
}

export const isDuplicateKey = (err) => err?.code === 11000;
