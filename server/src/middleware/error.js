import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found: ' + req.method + ' ' + req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    details = Object.values(err.errors).map((e) => e.message);
    message = 'Validation failed';
  }
  if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier: ' + err.value;
  }
  if (err.code === 11000) {
    status = 409;
    message = 'Duplicate value for ' + Object.keys(err.keyValue || {}).join(', ');
  }
  if (err.name === 'ZodError') {
    status = 400;
    message = 'Validation failed';
    details = err.issues.map((i) => i.path.join('.') + ': ' + i.message);
  }

  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    error: message,
    details,
    ...(env.nodeEnv === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
}
