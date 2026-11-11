import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (err instanceof mongoose.Error.CastError) {
    error = ApiError.badRequest('Invalid identifier.');
  } else if (err?.code === 11000) {
    error = ApiError.conflict('A record with these details already exists.', 'DUPLICATE');
  } else if (err?.type === 'entity.parse.failed') {
    error = ApiError.badRequest('Request body is not valid JSON.');
  } else if (err?.type === 'entity.too.large') {
    error = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  } else if (!(err instanceof ApiError)) {
    logger.error(err);
    error = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Try again shortly.');
  }

  res.status(error.status).json({
    success: false,
    error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
  });
}
