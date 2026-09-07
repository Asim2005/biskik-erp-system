import mongoose from 'mongoose';

/** Request for quotation: ask several suppliers, compare, convert the winner to a PO. */

const quoteSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Party', required: true },
    supplierName: String,
    rate: { type: Number, default: 0, min: 0 },
    leadTimeDays: { type: Number, default: 0, min: 0 },
    validUntil: Date,
    paymentTerms: { type: String, default: '' },
    remarks: { type: String, default: '' },
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const rfqLineSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialCode: String,
    materialName: String,
    uom: String,
    qty: { type: Number, required: true, min: 0 },
    quotes: [quoteSchema],
  },
  { _id: false }
);

const rfqSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    title: { type: String, default: '' },
    date: { type: Date, default: Date.now },
    closingDate: Date,
    suppliers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Party' }],
    lines: [rfqLineSchema],
    status: { type: String, enum: ['OPEN', 'CLOSED', 'AWARDED', 'CANCELLED'], default: 'OPEN', index: true },
    awardedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Party' },
    awardedPurchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Rfq = mongoose.model('Rfq', rfqSchema);
