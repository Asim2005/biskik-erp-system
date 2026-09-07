import mongoose from 'mongoose';

const invoiceLineSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialCode: String,
    materialName: String,
    uom: String,
    qty: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 18 },
    taxAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, default: 0 },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['SALES', 'PURCHASE'], required: true, index: true },
    party: { type: mongoose.Schema.Types.ObjectId, ref: 'Party', required: true },
    partyName: String,
    date: { type: Date, default: Date.now, index: true },
    period: { type: String, index: true },
    reference: { type: String, default: '' },
    /** three-way match: which order and receipts this invoice settles */
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', index: true },
    purchaseOrderCode: String,
    grns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Grn' }],
    matchStatus: { type: String, enum: ['NOT_APPLICABLE', 'MATCHED', 'EXCEPTION'], default: 'NOT_APPLICABLE' },
    matchVariance: { type: Number, default: 0 },
    lines: [invoiceLineSchema],
    subtotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    cogsAmount: { type: Number, default: 0 },
    grossProfit: { type: Number, default: 0 },
    status: { type: String, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT', index: true },
    journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    postedAt: Date,
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

invoiceSchema.pre('validate', function setPeriod(next) {
  if (this.date) {
    const d = new Date(this.date);
    this.period = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  next();
});

export const Invoice = mongoose.model('Invoice', invoiceSchema);
