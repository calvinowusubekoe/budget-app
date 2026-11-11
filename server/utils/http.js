/** Consistent response envelope: { success, data, meta? }. */
export function ok(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function created(res, data) {
  return ok(res, data, { status: 201 });
}

/** Express 5 forwards rejected promises, but this keeps intent explicit and testable. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function requestContext(req) {
  return { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) };
}
