import { z } from 'zod';
import { User } from '../models/User.js';
import { signToken } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { permissionsFor, ROLE_LABELS } from '../config/roles.js';
import { recordAudit } from '../middleware/audit.js';

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

function shape(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    department: user.department,
    permissions: permissionsFor(user.role),
    lastLoginAt: user.lastLoginAt,
  };
}

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('No account found for that email');
  if (!user.isActive) throw ApiError.unauthorized('This account has been deactivated');

  const ok = await user.verifyPassword(password);
  if (!ok) throw ApiError.unauthorized('Incorrect password');

  user.lastLoginAt = new Date();
  await user.save();

  req.user = user;
  recordAudit(req, { action: 'auth.login', entity: 'User', entityId: user._id, detail: user.email });

  res.json({ token: signToken(user), user: shape(user) });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: shape(req.user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  const ok = await user.verifyPassword(req.body.currentPassword);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');
  await user.setPassword(req.body.newPassword);
  await user.save();
  recordAudit(req, { action: 'auth.passwordChanged', entity: 'User', entityId: user._id });
  res.json({ message: 'Password updated' });
});
