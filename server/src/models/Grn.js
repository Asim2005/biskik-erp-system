import mongoose from 'mongoose';

/**
 * Goods Receipt Note.
 *
 * The warehouse records what physically arrived against a purchase order.
 * Posting a GRN moves stock and writes  Dr Inventory / Cr Goods Received Not
 * Invoiced  - the liability sits in GRNI until Finance matches the supplier
 * invoice, which is what makes a three-way match possible.
 */

const grnLineSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialCode: String,
    materialName: String,
    uom: String,
    /** what the purchase order still expects */
    orderedQty: { type: Number, default: 0 },
    previouslyReceived: { type: Number, default: 0 },
    /** what actually turned up */
    receivedQty: { type: Number, required: true, min: 0 },
    acceptedQty: { type: Number, default: 0 },
    rejectedQty: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    /** quality check outcome recorded at the gate */
    qcStatus: { type: String, enum: ['PENDING', 'PASSED', 'FAILED', 'PARTIAL'], default: 'PASSED' },
    batchNo: { type: String, default: '' },
    expiryDate: Date,
    remarks: { type: String, default: '' },
  },
  { _id: false }
);

const grnSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', index: true },
    purchaseOrderCode: String,
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Party' },
    supplierName: String,
    date: { type: Date, default: Date.now, index: true },
    location: { type: String, default: 'RM Store' },
    deliveryNote: { type: String, default: '' },
    vehicleNo: { type: String, default: '' },

    lines: [grnLineSchema],
    totalValue: { type: Number, default: 0 },
    totalAccepted: { type: Number, default: 0 },
    totalRejected: { type: Number, default: 0 },

    status: { type: String, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT', index: true },
    journalEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
    /** set once a supplier invoice has been matched against this receipt */
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    matched: { type: Boolean, default: false, index: true },

    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    postedAt: Date,
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Grn = mongoose.model('Grn', grnSchema);
