import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { can, permissionsFor } from '../config/roles.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpires,
  });
}

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Missing bearer token');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw ApiError.unauthorized('Session expired, please sign in again');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive');

  req.user = user;
  req.permissions = permissionsFor(user.role);
  next();
});

export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const ok = permissions.some((p) => can(req.user.role, p));
    if (!ok) {
      return next(ApiError.forbidden('Role "' + req.user.role + '" is not allowed to ' + permissions.join(' / ')));
    }
    return next();
  };
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    return next();
  };
}
