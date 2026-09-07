import { AuditLog } from '../models/AuditLog.js';

/** Fire-and-forget audit trail writer. Never blocks or fails the request. */
export function recordAudit(req, { action, entity, entityId, entityCode, detail, meta }) {
  const user = req.user;
  AuditLog.create({
    user: user?._id,
    userName: user?.name,
    userRole: user?.role,
    action,
    entity,
    entityId,
    entityCode,
    detail,
    meta,
    ip: req.ip,
  }).catch((e) => console.warn('[audit] failed:', e.message));
}
