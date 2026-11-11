import { ApiError } from '../utils/ApiError.js';

/**
 * Validates request parts against Joi schemas. Unknown keys are stripped so
 * controllers only ever see whitelisted fields. Results live on req.valid
 * because Express 5 exposes req.query as a read-only getter.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid ?? {};
    const details = [];
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const { value, error } = schemas[part].validate(req[part] ?? {}, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });
      if (error) {
        for (const d of error.details) {
          details.push({ location: part, field: d.path.join('.'), message: d.message.replace(/"/g, '') });
        }
      } else {
        req.valid[part] = value;
      }
    }
    if (details.length) return next(ApiError.validation(details));
    next();
  };
}
