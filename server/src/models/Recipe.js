import mongoose from 'mongoose';

export const RECIPE_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ARCHIVED'];

const recipeLineSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialCode: String,
    materialName: String,
    qty: { type: Number, required: true, min: 0 },
    uom: String,
    rate: { type: Number, required: true, min: 0 },
    /** extra % consumed above formula qty due to process loss */
    wastagePercent: { type: Number, default: 0, min: 0, max: 100 },
    lineCost: { type: Number, default: 0 },
    remarks: { type: String, default: '' },
  },
  { _id: false }
);

const recipeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, index: true },
    version: { type: String, default: '1.0' },
    versionNo: { type: Number, default: 1 },
    productName: { type: String, required: true, trim: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    /** expected GOOD units produced by one batch of this formula */
    baseBatchQty: { type: Number, default: 1000, min: 1 },
    baseBatchUom: { type: String, default: 'PCS' },
    yieldPercent: { type: Number, default: 98, min: 1, max: 100 },
    lines: [recipeLineSchema],

    // conversion cost standards (per good unit)
    labourCostPerUnit: { type: Number, default: 0, min: 0 },
    factoryOverheadPerUnit: { type: Number, default: 0, min: 0 },
    adminOverheadPerUnit: { type: Number, default: 0, min: 0 },
    marketingOverheadPerUnit: { type: Number, default: 0, min: 0 },

    // computed snapshot (kept in sync by the costing service)
    materialCostPerBatch: { type: Number, default: 0 },
    materialCostPerUnit: { type: Number, default: 0 },
    manufacturingCostPerUnit: { type: Number, default: 0 },
    fullCostPerUnit: { type: Number, default: 0 },

    status: { type: String, enum: RECIPE_STATUS, default: 'DRAFT', index: true },
    effectiveDate: Date,
    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectionReason: { type: String, default: '' },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe' },
    changeNote: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

recipeSchema.index({ code: 1, versionNo: 1 }, { unique: true });

export const Recipe = mongoose.model('Recipe', recipeSchema);
