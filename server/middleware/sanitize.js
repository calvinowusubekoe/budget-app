/**
 * Removes keys that MongoDB would interpret as operators ($gt, $where) or
 * path traversal (a.b) from body and params. Joi whitelisting is the primary
 * defence; this is a backstop for any route that forgets it.
 */
function scrub(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor') {
      delete value[key];
    } else {
      value[key] = scrub(value[key], depth + 1);
    }
  }
  return value;
}

export function sanitizeInput(req, _res, next) {
  if (req.body) scrub(req.body);
  if (req.params) scrub(req.params);
  next();
}

export const _scrub = scrub;
