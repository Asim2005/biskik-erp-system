import mongoose from 'mongoose';

export const MATERIAL_CATEGORIES = ['RAW', 'PACKAGING', 'CONSUMABLE', 'FINISHED', 'WIP'];
export const UOMS = ['KG', 'GM', 'LTR', 'ML', 'PCS', 'BOX', 'CTN', 'DOZ'];

const materialSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, index: true },
    category: { type: String, enum: MATERIAL_CATEGORIES, default: 'RAW', index: true },
    uom: { type: String, enum: UOMS, default: 'KG' },
    standardRate: { type: Number, default: 0, min: 0 },
    lastPurchaseRate: { type: Number, default: 0, min: 0 },
    movingAvgRate: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },
    shelfLifeDays: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 18, min: 0, max: 100 },
    hsCode: { type: String, default: '' },
    defaultLocation: { type: String, default: 'RM Store' },
    isActive: { type: Boolean, default: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

materialSchema.index({ name: 'text', code: 'text' });

export const Material = mongoose.model('Material', materialSchema);
