import mongoose from 'mongoose';

export const PO_STATUS = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
];

const poLineSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialCode: String,
    materialName: String,
    uom: String,
    qty: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, default: 18 },
    amount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, default: 0 },
    /** rolled up from goods receipts, drives partial-receipt status */
    receivedQty: { type: Number, default: 0 },
    invoicedQty: { type: Number, default: 0 },
    requiredBy: Date,
    remarks: { type: String, default: '' },
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Party', required: true },
    supplierName: String,
    date: { type: Date, default: Date.now, index: true },
    expectedDate: Date,
    reference: { type: String, default: '' },
    rfq: { type: mongoose.Schema.Types.ObjectId, ref: 'Rfq' },

    lines: [poLineSchema],
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },

    status: { type: String, enum: PO_STATUS, default: 'DRAFT', index: true },
    deliveryLocation: { type: String, default: 'RM Store' },
    paymentTerms: { type: String, default: '30 days' },
    remarks: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectionReason: { type: String, default: '' },
    closedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

/** Fully received when every line has met or exceeded its ordered quantity. */
purchaseOrderSchema.methods.receiptState = function receiptState() {
  const any = this.lines.some((l) => l.receivedQty > 0.0001);
  const all = this.lines.every((l) => l.receivedQty >= l.qty - 0.0001);
  if (all) return 'RECEIVED';
  if (any) return 'PARTIALLY_RECEIVED';
  return 'APPROVED';
};

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
