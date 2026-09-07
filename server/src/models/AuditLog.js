import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    userRole: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, default: '', index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    entityCode: { type: String, default: '' },
    detail: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);
