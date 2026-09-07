import { z } from 'zod';
import { User } from '../models/User.js';
import { ROLES, ROLE_LABELS, ROLE_META, ROLE_PERMISSIONS, permissionMatrix } from '../config/roles.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';

export const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(Object.values(ROLES)),
  department: z.string().optional().default(''),
  phone: z.string().optional().default(''),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

export const listUsers = asyncHandler(async (req, res) => {
  const { search, role, active } = req.query;
  const q = {};
  if (role) q.role = role;
  if (active === 'true') q.isActive = true;
  if (active === 'false') q.isActive = false;
  if (search) q.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];
  const users = await User.find(q).sort({ createdAt: -1 });
  res.json({ data: users, roles: Object.values(ROLES), roleLabels: ROLE_LABELS });
});

export const getRoles = asyncHandler(async (_req, res) => {
  res.json({
    roles: Object.values(ROLES).map((r) => {
      const meta = ROLE_META[r] || {};
      return {
        value: r,
        label: meta.label || r,
        department: meta.department,
        description: meta.description,
        approvalLimit: meta.approvalLimit === Infinity ? null : meta.approvalLimit,
        permissions: ROLE_PERMISSIONS[r],
        permissionCount: ROLE_PERMISSIONS[r].length,
      };
    }),
    departments: [...new Set(Object.values(ROLE_META).map((m) => m.department))],
  });
});

/**
 * The action-based permission grid: one row per action, one column per role.
 * Answers "what can this specific user do?" rather than the much weaker
 * question "what department are they in?".
 */
export const getPermissionMatrix = asyncHandler(async (_req, res) => {
  res.json({
    groups: permissionMatrix(),
    roles: Object.values(ROLES).map((r) => ({
      value: r,
      label: ROLE_META[r]?.label || r,
      department: ROLE_META[r]?.department,
      approvalLimit: ROLE_META[r]?.approvalLimit === Infinity ? null : ROLE_META[r]?.approvalLimit,
    })),
  });
});

export const createUser = asyncHandler(async (req, res) => {
  const { password, ...rest } = req.body;
  const exists = await User.findOne({ email: rest.email.toLowerCase() });
  if (exists) throw ApiError.conflict('A user with that email already exists');
  const user = new User(rest);
  await user.setPassword(password);
  await user.save();
  recordAudit(req, { action: 'user.create', entity: 'User', entityId: user._id, detail: user.email + ' as ' + user.role });
  res.status(201).json({ data: user });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  if (String(user._id) === String(req.user._id) && req.body.isActive === false) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }
  if (String(user._id) === String(req.user._id) && req.body.role && req.body.role !== user.role) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  const { password, ...rest } = req.body;
  Object.assign(user, rest);
  if (password) await user.setPassword(password);
  await user.save();
  recordAudit(req, { action: 'user.update', entity: 'User', entityId: user._id, detail: user.email });
  res.json({ data: user });
});

export const deleteUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot delete your own account');
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  recordAudit(req, { action: 'user.delete', entity: 'User', entityId: user._id, detail: user.email });
  res.json({ message: 'User removed' });
});
