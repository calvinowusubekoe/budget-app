export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static validation(details) {
    return new ApiError(422, 'VALIDATION_ERROR', 'Some fields need attention.', details);
  }
  static unauthorized(message = 'Sign in to continue.') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to do that.') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Not found.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message, code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }
  static tooMany(message = 'Too many attempts. Try again later.') {
    return new ApiError(429, 'TOO_MANY_REQUESTS', message);
  }
}
