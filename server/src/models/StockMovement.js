import mongoose from 'mongoose';

export const MOVEMENT_TYPES = [
  'PURCHASE_RECEIPT',
  'PRODUCTION_ISSUE',
  'PRODUCTION_RECEIPT',
  'SALE_ISSUE',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'OPENING',
  'SCRAP',
];

const movementSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now, index: true },
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true, index: true },
    location: { type: String, default: 'RM Store' },
    qty: { type: Number, required: true }, // signed: + in, - out
    rate: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    balanceQty: { type: Number, default: 0 },
    balanceValue: { type: Number, default: 0 },
    refType: { type: String, default: '' },
    refId: { type: mongoose.Schema.Types.ObjectId },
    refCode: { type: String, default: '' },
    remarks: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const StockMovement = mongoose.model('StockMovement', movementSchema);
