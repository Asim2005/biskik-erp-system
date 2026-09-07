import { ApiError } from '../utils/apiError.js';

/** Validates req.body against a zod schema and replaces it with the parsed value. */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return next(
      ApiError.badRequest(
        'Validation failed',
        result.error.issues.map((i) => (i.path.join('.') || 'body') + ': ' + i.message)
      )
    );
  }
  req.body = result.data;
  return next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return next(
      ApiError.badRequest(
        'Invalid query',
        result.error.issues.map((i) => i.path.join('.') + ': ' + i.message)
      )
    );
  }
  req.validatedQuery = result.data;
  return next();
};
